/**
 * Menu — Planificateur de Repas Nutritionnel & Générateur de Liste de Courses IA
 * Toutes les recettes sont chargées depuis `./data/recipes.json`.
 */

import {
  generateMenuPdfBytes,
  generateShoppingListPdfBytes,
  isIosOrStandaloneWebApp,
  shareOrOpenPdfBytes
} from "./pdf-print.js";

export const CATEGORIES_META = {
  A: {
    code: "A",
    title: "Catégorie A • Équilibre & Vitalité",
    shortLabel: "Cat. A (Illimité)",
    subtitle: "Excellente densité nutritionnelle : fort apport en protéines et légumes/fibres, faible en graisses saturées.",
    badgeClass: "grade-a",
    quotaTagClass: "quota-cat-a",
    fillClass: "quota-fill-a",
    defaultScore: 85,
    defaultProtein: "Élevé • Riche en fibres",
    defaultFatSugar: "Gras faible • Sans sucres ajoutés"
  },
  B: {
    code: "B",
    title: "Catégorie B • Bon Compromis",
    shortLabel: "Cat. B (Bon compromis)",
    subtitle: "Plats complets et rassasiants, riches en protéines avec féculents ou légumes et un apport lipidique maîtrisé.",
    badgeClass: "grade-b",
    quotaTagClass: "quota-cat-b",
    fillClass: "quota-fill-b",
    defaultScore: 72,
    defaultProtein: "Bon (28g/pers.)",
    defaultFatSugar: "Glucides complets • Gras maîtrisé"
  },
  C: {
    code: "C",
    title: "Catégorie C • Plaisir Modéré",
    shortLabel: "Cat. C (Modéré)",
    subtitle: "Bon apport protéique mais plus riche en graisses saturées (fromages, charcuterie, pâte feuilletée ou béchamel).",
    badgeClass: "grade-c",
    quotaTagClass: "quota-cat-c",
    fillClass: "quota-fill-c",
    defaultScore: 56,
    defaultProtein: "Modéré à élevé",
    defaultFatSugar: "Plus riche en lipides (fromage/sauce)"
  },
  D: {
    code: "D",
    title: "Catégorie D • Plaisir Gourmand",
    shortLabel: "Cat. D (Gourmand)",
    subtitle: "Plats réconfortants riches en glucides raffinés ou crème/fromage. Conseillé à 1 seul plat maximum.",
    badgeClass: "grade-d",
    quotaTagClass: "quota-cat-d",
    fillClass: "quota-fill-d",
    defaultScore: 38,
    defaultProtein: "Variable",
    defaultFatSugar: "Riche en lipides saturés / glucides"
  }
};

/**
 * Normalise une chaîne pour générer un identifiant d'ingrédient ou de plat sans accents
 */
export function slugify(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Normalise une recette issue de `recipes.json` afin que vous puissiez éditer `recipes.json`
 * très simplement (même en omettant `id`, `key`, `rawDescription` ou `score`).
 */
export function normalizeRecipe(raw) {
  const category = ["A", "B", "C", "D"].includes(String(raw.category).toUpperCase())
    ? String(raw.category).toUpperCase()
    : "B";
  const meta = CATEGORIES_META[category];
  const name = String(raw.name || "Plat sans nom").trim();
  const id = raw.id || slugify(name);
  const score = Number.isFinite(Number(raw.score)) ? Number(raw.score) : meta.defaultScore;

  const ingredients = Array.isArray(raw.ingredients)
    ? raw.ingredients.map((ing) => {
        const ingName = String(ing.name || "Ingrédient").trim();
        const qty = Number.isFinite(Number(ing.qty)) ? Number(ing.qty) : 1;
        const unit = String(ing.unit || "pièce").trim();
        return {
          key: ing.key || slugify(ingName),
          name: ingName,
          qty,
          unit,
          aisle: ing.aisle || "Épicerie Salée",
          detail: ing.detail || `${qty} ${unit} — ${ingName}`
        };
      })
    : [];

  const rawDescription =
    raw.rawDescription ||
    ingredients.map((i) => `${i.qty} ${i.unit} de ${i.name.toLowerCase()}`).join(" + ");

  return {
    id,
    name,
    category,
    score,
    proteinLevel: raw.proteinLevel || meta.defaultProtein,
    fatSugarNote: raw.fatSugarNote || meta.defaultFatSugar,
    nutritionHighlight: raw.nutritionHighlight || name,
    rawDescription,
    ingredients
  };
}

/**
 * Calculateur de recommandations selon le nombre de plats souhaités (1 / 2 / 3+ jours).
 */
export function computeCategoryQuotas(targetMeals) {
  const n = Math.max(1, targetMeals);
  const maxD = n <= 1 ? 0 : 1; // 0 pour 1 jour, 1 seul plat max au-delà
  const maxC = n <= 1 ? 0 : 1; // Quota réduit : 1 seul plat max en Catégorie C sur la semaine
  const maxB = n <= 2 ? 1 : n <= 4 ? 2 : 3;

  return {
    A: { max: Infinity, recommendedLabel: "Illimité", desc: "À volonté ! Privilégiez ces plats pour compléter votre semaine." },
    B: { max: maxB, recommendedLabel: `Max ${maxB} conseillé${maxB > 1 ? "s" : ""}`, desc: `Jusqu'à ${maxB} plat${maxB > 1 ? "s" : ""} équilibré${maxB > 1 ? "s" : ""} sur ${n} repas.` },
    C: { max: maxC, recommendedLabel: `Max ${maxC} conseillé`, desc: maxC === 0 ? "Privilégiez la Cat. A ou B pour 1 repas." : "1 seul plat plaisir modéré maximum." },
    D: { max: maxD, recommendedLabel: `Max ${maxD} conseillé`, desc: maxD === 0 ? "Aucun plat riche pour 1 seul repas." : "1 seul plat maximum parmi les moins bien notés." }
  };
}

const STORAGE_KEY = "mes-petites-courses-state-v1";

// État de l'application
const state = {
  targetMeals: 4,
  strictQuotas: true,
  activeFilter: "ALL",
  searchQuery: "",
  dishes: [], // Chargé depuis ./recipes.json
  selectedDishIds: new Set([
    "soupe-butternut",
    "petit-sale",
    "salade-chevre-chaud",
    "raclette"
  ]),
  preparedDishIds: new Set(),
  checkedIngredients: new Set()
};

function loadPersistedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (Number.isFinite(Number(saved.targetMeals)) && saved.targetMeals >= 1) {
      state.targetMeals = Number(saved.targetMeals);
    }
    if (typeof saved.strictQuotas === "boolean") {
      state.strictQuotas = saved.strictQuotas;
    }
    if (Array.isArray(saved.selectedDishIds)) {
      state.selectedDishIds = new Set(saved.selectedDishIds);
    }
    if (Array.isArray(saved.preparedDishIds)) {
      state.preparedDishIds = new Set(saved.preparedDishIds);
    }
    if (Array.isArray(saved.checkedIngredients)) {
      state.checkedIngredients = new Set(saved.checkedIngredients);
    }
  } catch {
    // Ignore erreurs de lecture localStorage (mode privé, etc.)
  }
}

function savePersistedState() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        targetMeals: state.targetMeals,
        strictQuotas: state.strictQuotas,
        selectedDishIds: Array.from(state.selectedDishIds),
        preparedDishIds: Array.from(state.preparedDishIds),
        checkedIngredients: Array.from(state.checkedIngredients)
      })
    );
  } catch {
    // Ignore erreurs d'écriture localStorage
  }
}

/**
 * Charge la base de données `./data/recipes.json`
 */
async function loadRecipesDatabase() {
  try {
    const response = await fetch("./data/recipes.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const list = Array.isArray(data) ? data : Array.isArray(data.recipes) ? data.recipes : [];
    state.dishes = list.map(normalizeRecipe).sort((a, b) => b.score - a.score);
  } catch (err) {
    console.error("Erreur lors du chargement de data/recipes.json :", err);
  }
}

// Sélection des éléments du DOM
const dom = {
  bottomBarCount: document.getElementById("bottom-bar-count"),
  bottomBarQuotas: document.getElementById("bottom-bar-quotas"),
  customDaysValue: document.getElementById("custom-days-value"),
  btnDaysMinus: document.getElementById("btn-days-minus"),
  btnDaysPlus: document.getElementById("btn-days-plus"),
  dayPresetBtns: document.querySelectorAll(".day-preset-btn"),
  strictModeCheckbox: document.getElementById("strict-mode-checkbox"),
  advisorSummaryText: document.getElementById("advisor-summary-text"),
  quotaCardsContainer: document.getElementById("quota-cards-container"),
  totalDishesCount: document.getElementById("total-dishes-count"),
  filterPillAll: document.getElementById("filter-pill-all"),
  dishesCategoriesContainer: document.getElementById("dishes-categories-container"),
  dishSearchInput: document.getElementById("dish-search"),
  filterPills: document.querySelectorAll(".filter-pill"),
  selectedMealsCount: document.getElementById("selected-meals-count"),
  selectedMealsList: document.getElementById("selected-meals-list"),
  shoppingStatusSubtitle: document.getElementById("shopping-status-subtitle"),
  btnClearSelection: document.getElementById("btn-clear-selection"),
  ingredientsTotalCount: document.getElementById("ingredients-total-count"),
  ingredientsListContainer: document.getElementById("ingredients-list-container"),
  tooltipsPortal: document.getElementById("tooltips-portal"),
  btnAutoSuggest: document.getElementById("btn-auto-suggest"),
  btnPrintShopping: document.getElementById("btn-print-shopping"),
  btnPrintMenu: document.getElementById("btn-print-menu"),
  printDocumentTitle: document.getElementById("print-document-title"),
  printDateSummary: document.getElementById("print-date-summary"),
  shoppingListDialog: document.getElementById("shopping-list-dialog"),
  pwaInstallDialog: document.getElementById("pwa-install-dialog"),
  btnInstallApp: document.getElementById("btn-install-app"),
  aiScriptData: document.getElementById("ai-shopping-list-data"),
  btnCopyAiPrompt: document.getElementById("btn-copy-ai-prompt"),
  copyPromptLabel: document.getElementById("copy-prompt-label")
};

function openShoppingListPopup() {
  if (dom.shoppingListDialog && !dom.shoppingListDialog.open && typeof dom.shoppingListDialog.showModal === "function") {
    dom.shoppingListDialog.showModal();
  }
}

function getSelectedCountsByCategory() {
  const counts = { A: 0, B: 0, C: 0, D: 0 };
  for (const id of state.selectedDishIds) {
    const dish = state.dishes.find((d) => d.id === id);
    if (dish) counts[dish.category]++;
  }
  return counts;
}

function formatQuantity(qty, unit) {
  if (unit === "g" && qty >= 1000) {
    const kg = qty / 1000;
    return `${Number.isInteger(kg) ? kg : kg.toFixed(2).replace(/\.?0+$/, "")} kg (${qty} g)`;
  }
  return `${qty} ${unit}`;
}

/**
 * Agrège tous les ingrédients des plats sélectionnés et conserve la trace des plats associés
 * pour l'affichage dans l'info-bulle PC (`popover="hint"` + `interestfor`) et l'export JSON IA.
 */
function aggregateIngredients() {
  const map = new Map();

  for (const dishId of state.selectedDishIds) {
    const dish = state.dishes.find((d) => d.id === dishId);
    if (!dish) continue;

    for (const ing of dish.ingredients) {
      if (!map.has(ing.key)) {
        map.set(ing.key, {
          key: ing.key,
          name: ing.name,
          totalQty: 0,
          unit: ing.unit,
          aisle: ing.aisle,
          usedInDishes: []
        });
      }
      const entry = map.get(ing.key);
      entry.totalQty += Number(ing.qty) || 0;
      entry.usedInDishes.push({
        dishId: dish.id,
        dishName: dish.name,
        category: dish.category,
        quantityForDish: `${ing.qty} ${ing.unit}`,
        rawNote: ing.detail
      });
    }
  }

  return Array.from(map.values());
}

/**
 * Construit le payload JSON normalisé pour les navigateurs avec IA
 */
function buildAiShoppingJson() {
  const selectedDishes = Array.from(state.selectedDishIds)
    .map((id) => state.dishes.find((d) => d.id === id))
    .filter(Boolean);

  const aggregated = aggregateIngredients();

  return {
    schema: "https://menu-nutrition.app/schemas/ai-shopping-list-v1.json",
    generatedAt: new Date().toISOString(),
    targetDays: state.targetMeals,
    selectedMealsCount: selectedDishes.length,
    aiBrowserInstructions:
      "Utilise la liste `shoppingList` ci-dessous pour rechercher et ajouter automatiquement chaque ingrédient avec sa quantité totale (`formattedTotalQuantity`) dans le panier du site de courses ou Drive actif.",
    selectedMeals: selectedDishes.map((d) => ({
      id: d.id,
      name: d.name,
      nutritionCategory: d.category,
      nutritionScore: d.score,
      summary: d.rawDescription
    })),
    shoppingList: aggregated.map((item) => ({
      ingredientKey: item.key,
      name: item.name,
      totalQuantity: item.totalQty,
      unit: item.unit,
      formattedTotalQuantity: formatQuantity(item.totalQty, item.unit),
      aisleCategory: item.aisle,
      checked: state.checkedIngredients.has(item.key),
      usedInMeals: item.usedInDishes.map((u) => ({
        mealName: u.dishName,
        quantityNeeded: u.quantityForDish,
        recipeDetail: u.rawNote
      }))
    }))
  };
}

/**
 * Rendu du panneau des recommandations nutritionnelles (sans suivi) et de la barre de suivi en bas d'écran
 */
function renderAdvisorAndQuotas() {
  const quotas = computeCategoryQuotas(state.targetMeals);
  const counts = getSelectedCountsByCategory();
  const totalSelected = state.selectedDishIds.size;

  dom.customDaysValue.textContent = `${state.targetMeals} plat${state.targetMeals > 1 ? "s" : ""}`;

  if (dom.bottomBarCount) {
    dom.bottomBarCount.textContent = `${totalSelected} / ${state.targetMeals} plat${state.targetMeals > 1 ? "s" : ""}`;
    dom.bottomBarCount.classList.toggle("is-complete", totalSelected >= state.targetMeals);
  }

  if (dom.bottomBarQuotas) {
    dom.bottomBarQuotas.innerHTML = ["A", "B", "C", "D"]
      .map((catCode) => {
        const q = quotas[catCode];
        const current = counts[catCode];
        const maxLabel = Number.isFinite(q.max) ? q.max : "∞";
        const isAtMax = Number.isFinite(q.max) && q.max > 0 && current === q.max;
        const isOver = Number.isFinite(q.max) && current > q.max;
        return `
          <span
            class="bottom-cat-pill bottom-cat-${catCode.toLowerCase()} ${isAtMax ? "is-at-max" : ""} ${isOver ? "is-over" : ""}"
            title="Catégorie ${catCode} : ${current} sélectionné${current > 1 ? "s" : ""} sur ${maxLabel === "∞" ? "illimité" : maxLabel + " max"}"
          >
            <strong class="bottom-cat-letter">${catCode}</strong>
            <span class="bottom-cat-ratio">${current} / ${maxLabel}</span>
          </span>
        `;
      })
      .join("");
  }

  dom.dayPresetBtns.forEach((btn) => {
    const d = Number(btn.dataset.days);
    btn.classList.toggle("active", d === state.targetMeals);
  });

  dom.advisorSummaryText.textContent =
    `Pour ${state.targetMeals} plat${state.targetMeals > 1 ? "s" : ""}, privilégiez les recettes Équilibre (A) à volonté et limitez progressivement les plats plus riches :`;

  const order = ["A", "B", "C", "D"];
  dom.quotaCardsContainer.innerHTML = order
    .map((catCode) => {
      const meta = CATEGORIES_META[catCode];
      const q = quotas[catCode];

      return `
        <div class="quota-card">
          <div class="quota-card-top">
            <span class="quota-cat-tag ${meta.quotaTagClass}">${meta.shortLabel}</span>
            <span class="quota-count">${q.recommendedLabel}</span>
          </div>
          <p class="quota-rule-desc">${q.desc}</p>
        </div>
      `;
    })
    .join("");
}

/**
 * Rendu du catalogue des plats issus de `recipes.json` groupés par catégorie
 */
function renderCatalog() {
  const quotas = computeCategoryQuotas(state.targetMeals);
  const counts = getSelectedCountsByCategory();
  const query = state.searchQuery.trim().toLowerCase();

  if (dom.totalDishesCount) dom.totalDishesCount.textContent = String(state.dishes.length);
  if (dom.filterPillAll) dom.filterPillAll.textContent = `Toutes les notes (${state.dishes.length})`;

  const categoriesOrder = ["A", "B", "C", "D"];
  let html = "";

  for (const catCode of categoriesOrder) {
    if (state.activeFilter !== "ALL" && state.activeFilter !== catCode) continue;

    const dishesInCat = state.dishes.filter((dish) => {
      if (dish.category !== catCode) return false;
      if (!query) return true;
      return (
        dish.name.toLowerCase().includes(query) ||
        dish.rawDescription.toLowerCase().includes(query) ||
        (dish.nutritionHighlight && dish.nutritionHighlight.toLowerCase().includes(query))
      );
    });

    if (dishesInCat.length === 0) continue;

    const meta = CATEGORIES_META[catCode];
    const q = quotas[catCode];
    const current = counts[catCode];
    const isUnlimited = !Number.isFinite(q.max);
    const isCategoryFull = !isUnlimited && current >= q.max;

    const quotaPillText = isUnlimited
      ? `${current} sélectionné${current > 1 ? "s" : ""} • Quota illimité`
      : `${current} / ${q.max} max conseillé`;

    html += `
      <section class="category-section" aria-labelledby="cat-heading-${catCode}">
        <div class="category-banner">
          <div class="category-banner-left">
            <div class="nutri-grade-circle ${meta.badgeClass}" aria-hidden="true">${catCode}</div>
            <div>
              <h3 id="cat-heading-${catCode}">${meta.title}</h3>
              <p>${meta.subtitle}</p>
            </div>
          </div>
          <span class="category-quota-pill ${meta.quotaTagClass}">${quotaPillText}</span>
        </div>

        <div class="dishes-grid">
          ${dishesInCat
            .map((dish) => {
              const isSelected = state.selectedDishIds.has(dish.id);
              const isLocked = state.strictQuotas && !isSelected && isCategoryFull;

              return `
                <button
                  type="button"
                  class="dish-card ${isSelected ? "is-selected" : ""} ${isLocked ? "is-quota-locked" : ""}"
                  data-dish-id="${dish.id}"
                  aria-pressed="${isSelected}"
                >
                  <div>
                    <div class="dish-card-header">
                      <span class="dish-title">${dish.name}</span>
                      <span class="dish-score-pill ${meta.quotaTagClass}">Note ${dish.score}/100</span>
                    </div>

                    <div class="dish-macros">
                      <span class="macro-chip">Protéines : ${dish.proteinLevel}</span>
                      <span class="macro-chip">${dish.fatSugarNote}</span>
                    </div>

                    <p class="dish-ingredients-preview">${dish.rawDescription}</p>
                  </div>

                  <div class="dish-card-footer">
                    <span>${dish.ingredients.length} ingrédient${dish.ingredients.length > 1 ? "s" : ""}</span>
                    <span class="dish-action-label">
                      ${
                        isSelected
                          ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="icon-xs" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg> Sélectionné`
                          : isLocked
                          ? `Quota Cat. ${catCode} atteint`
                          : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="icon-xs" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Choisir ce plat`
                      }
                    </span>
                  </div>
                </button>
              `;
            })
            .join("")}
        </div>
      </section>
    `;
  }

  if (!html) {
    html = `
      <div class="empty-state-box">
        Aucun plat ne correspond à votre recherche « ${state.searchQuery} ».
      </div>
    `;
  }

  dom.dishesCategoriesContainer.innerHTML = html;
}

const MIN_PRINT_MEAL_SLOTS = 8;

function buildBlankMealCardsHtml(blankCount) {
  if (blankCount <= 0) return "";
  const cards = Array.from({ length: blankCount }, () => `
    <li class="selected-meal-item is-blank-meal print-only" aria-hidden="true">
      <div class="selected-meal-top">
        <div class="meal-prepared-label">
          <input type="checkbox" class="meal-prepared-checkbox print-only" tabindex="-1">
          <span class="quota-cat-tag quota-cat-blank print-only">&nbsp;</span>
          <span class="selected-meal-name blank-meal-title-line"></span>
        </div>
      </div>
      <div class="meal-expiry-row print-only">
        <span class="meal-expiry-label">À cuisiner avant le :</span>
        <span class="meal-expiry-slots">__ / __ / __</span>
      </div>
      <ul class="selected-meal-ingredients print-only">
        <li><span class="blank-ingredient-line"></span></li>
        <li><span class="blank-ingredient-line"></span></li>
        <li><span class="blank-ingredient-line"></span></li>
        <li><span class="blank-ingredient-line"></span></li>
      </ul>
    </li>
  `).join("");

  return `
    <div class="meal-category-group print-only" aria-hidden="true">
      <ul class="aisle-items-list">
        ${cards}
      </ul>
    </div>
  `;
}

/**
 * Rendu du contenu de la Popup Liste de Courses & Ingrédients avec info-bulles (`popover="hint"` + `interestfor`)
 */
function renderShoppingPopupContent() {
  const catOrder = ["A", "B", "C", "D"];
  const catRank = { A: 1, B: 2, C: 3, D: 4 };
  const selectedDishes = Array.from(state.selectedDishIds)
    .map((id) => state.dishes.find((d) => d.id === id))
    .filter(Boolean)
    .sort((a, b) => (catRank[a.category] || 99) - (catRank[b.category] || 99) || b.score - a.score);

  dom.selectedMealsCount.textContent = `${selectedDishes.length} plat${selectedDishes.length > 1 ? "s" : ""}`;
  dom.btnClearSelection.hidden = selectedDishes.length === 0;
  const blankSlotsNeeded = Math.max(0, MIN_PRINT_MEAL_SLOTS - selectedDishes.length);

  if (selectedDishes.length === 0) {
    dom.shoppingStatusSubtitle.textContent = "Aucun plat sélectionné. Fermez cette fenêtre et cliquez sur des plats pour composer votre semaine.";
    dom.selectedMealsList.innerHTML = `
      <div class="empty-state-box no-print">
        Aucun plat sélectionné pour le moment.
      </div>
      ${buildBlankMealCardsHtml(blankSlotsNeeded)}
    `;
    dom.ingredientsTotalCount.textContent = "0 article";
    dom.ingredientsListContainer.innerHTML = `
      <div class="empty-state-box">
        Votre liste d'ingrédients apparaîtra automatiquement ici avec le cumul des quantités.
      </div>
    `;
    dom.tooltipsPortal.innerHTML = "";
    syncAiJsonOutputs();
    return;
  }

  const aggregated = aggregateIngredients();
  dom.shoppingStatusSubtitle.textContent = `${selectedDishes.length} repas sélectionnés • ${aggregated.length} ingrédients agrégés par rayon.`;

  // Liste des plats retenus classés par catégorie nutritionnelle (A -> B -> C -> D)
  // Sur écran : liste épurée par catégorie ; à l'impression PDF : cartes complètes (complétées jusqu'à 8 cases avec des fiches vierges)
  dom.selectedMealsList.innerHTML =
    catOrder
      .map((catCode) => {
        const dishesOfCat = selectedDishes.filter((d) => d.category === catCode);
        if (dishesOfCat.length === 0) return "";
        const meta = CATEGORIES_META[catCode];

        return `
          <div class="meal-category-group">
            <h4 class="aisle-group-title meal-cat-group-title no-print">
              <span class="nutri-grade-circle nutri-grade-xs ${meta.badgeClass}" aria-hidden="true">${catCode}</span>
              <span>${meta.title}</span>
            </h4>
            <ul class="aisle-items-list">
              ${dishesOfCat
                .map((dish) => {
                  const isPrepared = state.preparedDishIds.has(dish.id);
                  return `
                    <li class="selected-meal-item ${isPrepared ? "is-prepared" : ""}">
                      <div class="selected-meal-top">
                        <label class="meal-prepared-label">
                          <input
                            type="checkbox"
                            class="meal-prepared-checkbox print-only"
                            data-prepared-dish="${dish.id}"
                            ${isPrepared ? "checked" : ""}
                          >
                          <span class="quota-cat-tag ${meta.quotaTagClass} print-only">${dish.category}</span>
                          <span class="selected-meal-name">${dish.name}</span>
                        </label>
                        <button
                          type="button"
                          class="btn-remove-meal no-print"
                          data-remove-dish="${dish.id}"
                          aria-label="Retirer ${dish.name} du menu"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon-xs" aria-hidden="true">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                          </svg>
                        </button>
                      </div>
                      <div class="meal-expiry-row print-only">
                        <span class="meal-expiry-label">À cuisiner avant le :</span>
                        <span class="meal-expiry-slots">__ / __ / __</span>
                      </div>
                      <ul class="selected-meal-ingredients print-only">
                        ${dish.ingredients.map((ing) => `<li>${ing.detail}</li>`).join("")}
                      </ul>
                    </li>
                  `;
                })
                .join("")}
            </ul>
          </div>
        `;
      })
      .join("") + buildBlankMealCardsHtml(blankSlotsNeeded);

  // Agrégation des ingrédients par rayon
  dom.ingredientsTotalCount.textContent = `${aggregated.length} ingrédient${aggregated.length > 1 ? "s" : ""}`;

  const byAisle = new Map();
  for (const item of aggregated) {
    if (!byAisle.has(item.aisle)) byAisle.set(item.aisle, []);
    byAisle.get(item.aisle).push(item);
  }

  let groupsHtml = "";
  let tooltipsHtml = "";

  for (const [aisle, items] of byAisle.entries()) {
    groupsHtml += `
      <div class="aisle-group">
        <h4 class="aisle-group-title">${aisle}</h4>
        <ul class="aisle-items-list">
          ${items
            .map((item) => {
              const isChecked = state.checkedIngredients.has(item.key);
              const tooltipId = `tooltip-ing-${item.key}`;
              const anchorVar = `--anchor-ing-${item.key}`;
              const dishCount = item.usedInDishes.length;

              // Création du popover "hint" conforme à `interest-triggered-tooltips`
              tooltipsHtml += `
                <div
                  popover="hint"
                  id="${tooltipId}"
                  class="ingredient-tooltip-popover"
                  style="--anchor-id: ${anchorVar};"
                >
                  <span class="tooltip-title">${item.name} (${formatQuantity(item.totalQty, item.unit)})</span>
                  <ul class="tooltip-dishes-list">
                    ${item.usedInDishes
                      .map((u) => `<li><strong>${u.dishName}</strong> : ${u.rawNote}</li>`)
                      .join("")}
                  </ul>
                </div>
              `;

              return `
                <li class="ingredient-row ${isChecked ? "is-checked" : ""}">
                  <label class="ingredient-label-wrap">
                    <input
                      type="checkbox"
                      class="ingredient-checkbox no-print"
                      data-ing-key="${item.key}"
                      ${isChecked ? "checked" : ""}
                    >
                    <span class="ingredient-name-qty">
                      <span>${item.name} : </span>
                      <strong class="ingredient-qty-strong">${formatQuantity(item.totalQty, item.unit)}</strong>
                    </span>
                  </label>

                  <button
                    type="button"
                    class="ingredient-dish-trigger no-print"
                    interestfor="${tooltipId}"
                    style="--anchor-id: ${anchorVar};"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon-xs" aria-hidden="true">
                      <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
                    </svg>
                    <span>${dishCount} plat${dishCount > 1 ? "s" : ""}</span>
                  </button>
                </li>
              `;
            })
            .join("")}
        </ul>
      </div>
    `;
  }

  dom.ingredientsListContainer.innerHTML = groupsHtml;
  dom.tooltipsPortal.innerHTML = tooltipsHtml;

  // Mise à jour de l'en-tête d'impression et du JSON IA
  const dateStr = new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "long"
  }).format(new Date());
  dom.printDateSummary.textContent = `Généré le ${dateStr} • ${selectedDishes.length} repas sélectionnés (${aggregated.length} ingrédients au total)`;

  syncAiJsonOutputs();
}

/**
 * Synchronise le JSON dans la balise `<script id="ai-shopping-list-data">`,
 * dans `window.MENU_SHOPPING_LIST` et dans l'aperçu de la popup.
 */
function syncAiJsonOutputs() {
  savePersistedState();
  const payload = buildAiShoppingJson();
  const formattedJson = JSON.stringify(payload, null, 2);

  window.MENU_SHOPPING_LIST = payload;
  if (dom.aiScriptData) {
    dom.aiScriptData.textContent = formattedJson;
  }
}

function renderAll() {
  if (dom.strictModeCheckbox) {
    dom.strictModeCheckbox.checked = state.strictQuotas;
  }
  savePersistedState();
  renderAdvisorAndQuotas();
  renderCatalog();
  renderShoppingPopupContent();
}

/**
 * Suggestion automatique d'un menu équilibré respectant la progression conseillée
 * et ouverture directe de la popup avec la liste de courses générée.
 */
function autoSuggestBalancedMenu() {
  const target = state.targetMeals;
  const quotas = computeCategoryQuotas(target);
  const pickRandom = (arr, count) => {
    const copy = [...arr].sort(() => Math.random() - 0.5);
    return copy.slice(0, count);
  };

  const dishesA = state.dishes.filter((d) => d.category === "A");
  const dishesB = state.dishes.filter((d) => d.category === "B");
  const dishesC = state.dishes.filter((d) => d.category === "C");
  const dishesD = state.dishes.filter((d) => d.category === "D");

  const chosen = [];

  if (target === 1) {
    chosen.push(...pickRandom(dishesA, 1));
  } else if (target === 2) {
    chosen.push(...pickRandom(dishesB, 1));
    chosen.push(...pickRandom(dishesA, 1));
  } else {
    const countD = Math.min(1, quotas.D.max);
    const countC = Math.min(target >= 4 ? 1 : 0, quotas.C.max);
    const remainingAfterDC = target - countD - countC;
    const countB = Math.min(quotas.B.max, Math.floor(remainingAfterDC / 2));
    const countA = Math.max(0, target - countD - countC - countB);

    chosen.push(...pickRandom(dishesD, countD));
    chosen.push(...pickRandom(dishesC, countC));
    chosen.push(...pickRandom(dishesB, countB));
    chosen.push(...pickRandom(dishesA, countA));
  }

  state.selectedDishIds = new Set(chosen.map((d) => d.id));
  state.checkedIngredients.clear();
  renderAll();
  openShoppingListPopup();
}

// ================= Écouteurs d'événements =================

function initEventListeners() {
  // Boutons de jours prédéfinis (1, 2, 3, 4, 5, 7 jours)
  dom.dayPresetBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      state.targetMeals = Number(btn.dataset.days);
      renderAll();
    });
  });

  // Stepper - / +
  dom.btnDaysMinus.addEventListener("click", () => {
    if (state.targetMeals > 1) {
      state.targetMeals--;
      renderAll();
    }
  });

  dom.btnDaysPlus.addEventListener("click", () => {
    const maxMeals = Math.max(21, state.dishes.length);
    if (state.targetMeals < maxMeals) {
      state.targetMeals++;
      renderAll();
    }
  });

  // Activation/désactivation du mode strict des quotas
  dom.strictModeCheckbox.addEventListener("change", (e) => {
    state.strictQuotas = e.target.checked;
    renderAll();
  });

  // Recherche de plat ou d'ingrédient
  dom.dishSearchInput.addEventListener("input", (e) => {
    state.searchQuery = e.target.value;
    renderCatalog();
  });

  // Filtres par catégorie (A, B, C, D)
  dom.filterPills.forEach((pill) => {
    pill.addEventListener("click", () => {
      state.activeFilter = pill.dataset.filter;
      dom.filterPills.forEach((p) => p.classList.toggle("active", p === pill));
      renderCatalog();
    });
  });

  // Clic sur une carte de plat
  dom.dishesCategoriesContainer.addEventListener("click", (e) => {
    const card = e.target.closest(".dish-card");
    if (!card) return;

    const dishId = card.dataset.dishId;
    const dish = state.dishes.find((d) => d.id === dishId);
    if (!dish) return;

    if (state.selectedDishIds.has(dishId)) {
      state.selectedDishIds.delete(dishId);
      renderAll();
      return;
    }

    // Vérification du quota conseillé si le mode strict est coché
    if (state.strictQuotas) {
      const quotas = computeCategoryQuotas(state.targetMeals);
      const counts = getSelectedCountsByCategory();
      const maxAllowed = quotas[dish.category].max;

      if (counts[dish.category] >= maxAllowed) {
        dom.advisorSummaryText.textContent =
          `Quota atteint pour la Catégorie ${dish.category} (${maxAllowed} max conseillé pour ${state.targetMeals} repas). ` +
          `Choisissez un plat mieux noté (Catégorie A est illimitée) ou décochez « Respecter les quotas ».`;
        return;
      }
    }

    state.selectedDishIds.add(dishId);
    renderAll();

    // Une fois le nombre de plats cible atteint, ouvre automatiquement la popup de liste de courses
    if (state.selectedDishIds.size === state.targetMeals) {
      openShoppingListPopup();
    }
  });

  // Retirer un plat depuis la popup
  dom.selectedMealsList.addEventListener("click", (e) => {
    const removeBtn = e.target.closest("[data-remove-dish]");
    if (!removeBtn) return;
    const id = removeBtn.dataset.removeDish;
    state.selectedDishIds.delete(id);
    state.preparedDishIds.delete(id);
    renderAll();
  });

  // Cocher / décocher un plat comme "Déjà préparé dans la semaine"
  dom.selectedMealsList.addEventListener("change", (e) => {
    const checkbox = e.target.closest("[data-prepared-dish]");
    if (!checkbox) return;
    const id = checkbox.dataset.preparedDish;
    if (checkbox.checked) {
      state.preparedDishIds.add(id);
    } else {
      state.preparedDishIds.delete(id);
    }
    renderShoppingPopupContent();
  });

  // Vider toute la sélection
  dom.btnClearSelection.addEventListener("click", () => {
    state.selectedDishIds.clear();
    state.preparedDishIds.clear();
    state.checkedIngredients.clear();
    renderAll();
  });

  // Cocher / décocher un ingrédient dans la liste de courses
  dom.ingredientsListContainer.addEventListener("change", (e) => {
    const checkbox = e.target.closest(".ingredient-checkbox");
    if (!checkbox) return;
    const key = checkbox.dataset.ingKey;
    if (checkbox.checked) {
      state.checkedIngredients.add(key);
    } else {
      state.checkedIngredients.delete(key);
    }
    renderShoppingPopupContent();
  });

  // Suggestion équilibrée automatique
  dom.btnAutoSuggest.addEventListener("click", () => {
    autoSuggestBalancedMenu();
  });

  // Impression dissociée 1 : Liste de courses uniquement
  dom.btnPrintShopping.addEventListener("click", () => {
    document.body.dataset.printMode = "shopping";
    if (dom.printDocumentTitle) {
      dom.printDocumentTitle.textContent = "Liste de Courses de la Semaine (par rayon)";
    }
    if (isIosOrStandaloneWebApp()) {
      const dateStr = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date());
      const pdfBytes = generateShoppingListPdfBytes({
        aggregatedIngredients: aggregateIngredients(),
        checkedIngredients: state.checkedIngredients,
        selectedMealsCount: state.selectedDishIds.size,
        formatQuantity,
        dateStr
      });
      shareOrOpenPdfBytes(pdfBytes, "Liste-de-Courses.pdf", "Liste de Courses de la Semaine");
      return;
    }
    window.print();
  });

  // Impression dissociée 2 : Menu de la semaine & Fiches ingrédients
  dom.btnPrintMenu.addEventListener("click", () => {
    document.body.dataset.printMode = "menu";
    if (dom.printDocumentTitle) {
      dom.printDocumentTitle.textContent = "Menu de la Semaine & Fiches Ingrédients";
    }
    if (isIosOrStandaloneWebApp()) {
      const catRank = { A: 1, B: 2, C: 3, D: 4 };
      const selectedDishes = Array.from(state.selectedDishIds)
        .map((id) => state.dishes.find((d) => d.id === id))
        .filter(Boolean)
        .sort((a, b) => (catRank[a.category] || 99) - (catRank[b.category] || 99) || b.score - a.score);
      const dateStr = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date());
      const pdfBytes = generateMenuPdfBytes({
        selectedDishes,
        preparedDishIds: state.preparedDishIds,
        totalIngredientsCount: aggregateIngredients().length,
        dateStr
      });
      shareOrOpenPdfBytes(pdfBytes, "Menu-de-la-Semaine.pdf", "Menu de la Semaine & Fiches Ingrédients");
      return;
    }
    window.print();
  });

  // Action d'auto-remplissage Drive par IA
  dom.btnCopyAiPrompt.addEventListener("click", async () => {
    const payload = buildAiShoppingJson();
    const promptText = [
      "Voici ma liste de courses générée depuis Mes petites courses.",
      "Parcours chaque article de `shoppingList` et ajoute-le automatiquement à mon panier de courses en ligne avec la quantité indiquée dans `formattedTotalQuantity` :",
      "",
      JSON.stringify(payload, null, 2)
    ].join("\n");

    await navigator.clipboard.writeText(promptText);
    dom.copyPromptLabel.textContent = "Copié !";
    setTimeout(() => {
      dom.copyPromptLabel.textContent = "Export IA";
    }, 2000);
  });

  // Conformité au guide `dialog` de modern-web-guidance :
  dom.shoppingListDialog.addEventListener("close", () => {
    dom.shoppingListDialog.returnValue = "";
  });
  if (dom.pwaInstallDialog) {
    dom.pwaInstallDialog.addEventListener("close", () => {
      dom.pwaInstallDialog.returnValue = "";
    });
  }

  // Installation WebApp (PWA Android native via beforeinstallprompt + Guide iOS / Android)
  let deferredInstallPrompt = null;
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;

  if (isStandalone && dom.btnInstallApp) {
    dom.btnInstallApp.hidden = true;
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (dom.btnInstallApp) dom.btnInstallApp.hidden = false;
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    if (dom.btnInstallApp) dom.btnInstallApp.hidden = true;
  });

  if (dom.btnInstallApp) {
    dom.btnInstallApp.addEventListener("click", async () => {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const choice = await deferredInstallPrompt.userChoice;
        if (choice.outcome === "accepted") {
          deferredInstallPrompt = null;
        }
        return;
      }
      if (dom.pwaInstallDialog && typeof dom.pwaInstallDialog.showModal === "function") {
        dom.pwaInstallDialog.showModal();
      }
    });
  }

  // Fallback autonome pour `command="show-modal"` si le navigateur ou le réseau bloque le polyfill CDN
  document.addEventListener("click", (e) => {
    const invoker = e.target.closest('[command="show-modal"][commandfor]');
    if (!invoker) return;
    const targetDialog = document.getElementById(invoker.getAttribute("commandfor"));
    if (targetDialog && !targetDialog.open && typeof targetDialog.showModal === "function") {
      targetDialog.showModal();
    }
  });

  // Support tactile (mobile iOS / Android) et fallback PC/clavier pour `interestfor`
  let activeTouchTrigger = null;
  const getPopoverForTrigger = (trigger) => {
    const targetId = trigger?.getAttribute("interestfor");
    return targetId ? document.getElementById(targetId) : null;
  };

  const positionAndShowHint = (trigger) => {
    const popoverEl = getPopoverForTrigger(trigger);
    if (!popoverEl) return;

    if (!("anchorName" in document.documentElement.style)) {
      const rect = trigger.getBoundingClientRect();
      popoverEl.style.position = "fixed";
      popoverEl.style.top = `${Math.min(window.innerHeight - 140, rect.bottom + 6)}px`;
      popoverEl.style.left = `${Math.max(12, Math.min(window.innerWidth - 292, rect.left - 120))}px`;
    }

    if (typeof popoverEl.showPopover === "function") {
      try {
        popoverEl.showPopover();
      } catch {
        popoverEl.classList.add(":popover-open");
      }
    } else {
      popoverEl.classList.add(":popover-open");
    }
  };

  const hideHint = (trigger) => {
    const popoverEl = getPopoverForTrigger(trigger);
    if (!popoverEl) return;

    if (typeof popoverEl.hidePopover === "function") {
      try {
        popoverEl.hidePopover();
      } catch {
        popoverEl.classList.remove(":popover-open");
      }
    } else {
      popoverEl.classList.remove(":popover-open");
    }
  };

  // Support du tap tactile sur mobile pour ouvrir/fermer le détail des plats d'un ingrédient
  document.addEventListener("click", (e) => {
    const trigger = e.target.closest("[interestfor]");
    if (!trigger) {
      if (activeTouchTrigger) {
        hideHint(activeTouchTrigger);
        activeTouchTrigger = null;
      }
      return;
    }
    if (activeTouchTrigger === trigger) {
      hideHint(trigger);
      activeTouchTrigger = null;
    } else {
      if (activeTouchTrigger) hideHint(activeTouchTrigger);
      positionAndShowHint(trigger);
      activeTouchTrigger = trigger;
    }
  });

  if (!HTMLButtonElement.prototype.hasOwnProperty("interestForElement")) {
    document.addEventListener("mouseover", (e) => {
      const trigger = e.target.closest("[interestfor]");
      if (trigger) positionAndShowHint(trigger);
    });
    document.addEventListener("mouseout", (e) => {
      const trigger = e.target.closest("[interestfor]");
      if (trigger && !trigger.contains(e.relatedTarget) && activeTouchTrigger !== trigger) {
        hideHint(trigger);
      }
    });
    document.addEventListener("focusin", (e) => {
      const trigger = e.target.closest("[interestfor]");
      if (trigger) positionAndShowHint(trigger);
    });
    document.addEventListener("focusout", (e) => {
      const trigger = e.target.closest("[interestfor]");
      if (trigger && activeTouchTrigger !== trigger) hideHint(trigger);
    });
  }

  if (!("closedBy" in HTMLDialogElement.prototype)) {
    const outside = (e, dialog) => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    for (const dialog of document.querySelectorAll('dialog[closedby="any"]')) {
      let pressedOutside = false;
      dialog.addEventListener("pointerdown", (e) => {
        pressedOutside = outside(e, dialog);
      });
      dialog.addEventListener("pointerup", (e) => {
        if (pressedOutside && outside(e, dialog)) dialog.close();
      });
    }
  }
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }
}

async function bootstrap() {
  loadPersistedState();
  initEventListeners();
  registerServiceWorker();
  await loadRecipesDatabase();
  renderAll();
}

bootstrap();
