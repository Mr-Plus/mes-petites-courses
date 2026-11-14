/**
 * Générateur PDF vectoriel/haute-définition autonome (100% synchrone & hors-ligne)
 * Permet d'imprimer, partager (AirPrint via feuille de partage iOS) ou enregistrer en PDF
 * depuis la WebApp installée sur iOS (mode standalone où `window.print()` est bloqué par WebKit).
 */

const CATEGORY_COLORS = {
  A: { bg: "#ECFDF5", border: "#6EE7B7", text: "#065F46" },
  B: { bg: "#F0F9FF", border: "#7DD3FC", text: "#075985" },
  C: { bg: "#FFFBEB", border: "#FCD34D", text: "#92400E" },
  D: { bg: "#FEF2F2", border: "#FCA5A5", text: "#991B1B" }
};

/**
 * Convertit un DataURL JPEG (`data:image/jpeg;base64,...`) en octets `Uint8Array`
 */
function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(",")[1] || "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Assemble un fichier PDF 1.4 valide (format A4 portrait : 595.28 x 841.89 pt)
 * à partir d'un tableau d'images JPEG de pages.
 */
function buildPdfFromJpegPages(pages) {
  const PAGE_W = 595.28;
  const PAGE_H = 841.89;
  const chunks = [];
  const offsets = [0];
  let byteLength = 0;
  const encoder = new TextEncoder();

  const pushStr = (str) => {
    const bytes = encoder.encode(str);
    chunks.push(bytes);
    byteLength += bytes.length;
  };

  const pushBytes = (bytes) => {
    chunks.push(bytes);
    byteLength += bytes.length;
  };

  const startObj = (id) => {
    offsets[id] = byteLength;
    pushStr(`${id} 0 obj\n`);
  };

  const endObj = () => {
    pushStr("endobj\n");
  };

  pushStr("%PDF-1.4\n%\xFF\xFF\xFF\xFF\n");

  const numPages = pages.length;
  // Obj 1: Catalog, Obj 2: Pages
  // Pour chaque page i (0..numPages-1) :
  //   pageObjId = 3 + i * 3
  //   contentObjId = 4 + i * 3
  //   imageObjId = 5 + i * 3
  const kidsRef = pages.map((_, i) => `${3 + i * 3} 0 R`).join(" ");

  startObj(1);
  pushStr("<< /Type /Catalog /Pages 2 0 R >>\n");
  endObj();

  startObj(2);
  pushStr(`<< /Type /Pages /Kids [ ${kidsRef} ] /Count ${numPages} >>\n`);
  endObj();

  pages.forEach((page, i) => {
    const pageObjId = 3 + i * 3;
    const contentObjId = 4 + i * 3;
    const imageObjId = 5 + i * 3;
    const imgName = `/Im${i}`;

    // Page object
    startObj(pageObjId);
    pushStr(
      `<< /Type /Page /Parent 2 0 R /MediaBox [ 0 0 ${PAGE_W} ${PAGE_H} ] ` +
        `/Resources << /XObject << ${imgName} ${imageObjId} 0 R >> >> ` +
        `/Contents ${contentObjId} 0 R >>\n`
    );
    endObj();

    // Content stream qui dessine l'image sur toute la page A4
    const streamContent = `q\n${PAGE_W} 0 0 ${PAGE_H} 0 0 cm\n${imgName} Do\nQ\n`;
    startObj(contentObjId);
    pushStr(`<< /Length ${streamContent.length} >>\nstream\n${streamContent}endstream\n`);
    endObj();

    // Image XObject (DCTDecode = JPEG)
    startObj(imageObjId);
    pushStr(
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.length} >>\nstream\n`
    );
    pushBytes(page.bytes);
    pushStr("\nendstream\n");
    endObj();
  });

  const totalObjs = 2 + numPages * 3;
  const xrefOffset = byteLength;
  pushStr(`xref\n0 ${totalObjs + 1}\n`);
  pushStr("0000000000 65535 f \n");
  for (let id = 1; id <= totalObjs; id++) {
    const off = String(offsets[id] || 0).padStart(10, "0");
    pushStr(`${off} 00000 n \n`);
  }

  pushStr(
    `trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  );

  const out = new Uint8Array(byteLength);
  let pos = 0;
  for (const chunk of chunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  return out;
}

/**
 * Trace un rectangle aux coins arrondis sur un contexte Canvas 2D
 */
function roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * Découpe un texte en plusieurs lignes selon la largeur maximale disponible
 */
function wrapTextLines(ctx, text, maxWidth) {
  const words = String(text || "").split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

/**
 * Crée un canvas A4 (1654 x 2339 px ~ 200 DPI) avec l'en-tête du document
 */
function createA4PageCanvas(docTitle, dateSummary, sectionTitle, rightBadgeText) {
  const W = 1654;
  const H = 2339;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // Fond blanc A4
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, W, H);

  const marginX = 90;
  let y = 100;

  // Titre principal
  ctx.fillStyle = "#111111";
  ctx.font = "700 44px Rubik, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(docTitle, marginX, y);

  // Sous-titre date & résumé
  y += 42;
  ctx.fillStyle = "#333333";
  ctx.font = "400 25px 'Nunito Sans', -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(dateSummary, marginX, y);

  // Ligne noire de séparation
  y += 28;
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(marginX, y);
  ctx.lineTo(W - marginX, y);
  ctx.stroke();

  // En-tête de section + badge à droite
  y += 56;
  ctx.fillStyle = "#111111";
  ctx.font = "700 30px Rubik, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(sectionTitle, marginX, y);

  if (rightBadgeText) {
    ctx.font = "700 22px 'Nunito Sans', -apple-system, BlinkMacSystemFont, sans-serif";
    const badgeW = ctx.measureText(rightBadgeText).width + 36;
    const badgeH = 38;
    const badgeX = W - marginX - badgeW;
    const badgeY = y - 28;
    roundRectPath(ctx, badgeX, badgeY, badgeW, badgeH, 19);
    ctx.fillStyle = "#FFFFFF";
    ctx.fill();
    ctx.strokeStyle = "#D1BDB6";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#574340";
    ctx.fillText(rightBadgeText, badgeX + 18, y - 2);
  }

  return { canvas, ctx, W, H, marginX, startY: y + 34 };
}

/**
 * Génère le PDF A4 "Menu de la Semaine & Fiches Ingrédients" (toujours au moins 8 cases)
 */
export function generateMenuPdfBytes({ selectedDishes, preparedDishIds, totalIngredientsCount, dateStr }) {
  const totalSlots = Math.max(8, selectedDishes.length);
  const slots = [];
  for (let i = 0; i < totalSlots; i++) {
    slots.push(selectedDishes[i] || null);
  }

  const docTitle = "Menu de la Semaine & Fiches Ingrédients";
  const dateSummary = `Généré le ${dateStr} • ${selectedDishes.length} repas sélectionné${selectedDishes.length > 1 ? "s" : ""} (${totalIngredientsCount} ingrédient${totalIngredientsCount > 1 ? "s" : ""} au total)`;
  const sectionTitle = "Plats de la semaine & Ingrédients par recette";
  const rightBadge = `${selectedDishes.length} plat${selectedDishes.length > 1 ? "s" : ""}`;

  const pages = [];
  let pageState = createA4PageCanvas(docTitle, dateSummary, sectionTitle, rightBadge);
  let { ctx, W, H, marginX } = pageState;
  let cursorY = pageState.startY;

  const colGap = 32;
  const rowGap = 28;
  const colW = (W - marginX * 2 - colGap) / 2;

  // Parcourt les cartes par rangée de 2 colonnes
  for (let i = 0; i < slots.length; i += 2) {
    const rowItems = [slots[i], slots[i + 1]];

    // Calcul de la hauteur de chaque carte de la rangée
    const heights = rowItems.map((dish) => {
      if (dish === undefined) return 0;
      const ingCount = dish ? Math.max(4, dish.ingredients.length) : 4;
      return 155 + ingCount * 36 + 24;
    });
    const rowH = Math.max(...heights, 310);

    if (cursorY + rowH > H - 70 && i > 0) {
      pages.push({
        width: W,
        height: H,
        bytes: dataUrlToBytes(pageState.canvas.toDataURL("image/jpeg", 0.92))
      });
      pageState = createA4PageCanvas(docTitle, dateSummary, sectionTitle, rightBadge);
      ctx = pageState.ctx;
      cursorY = pageState.startY;
    }

    rowItems.forEach((dish, colIdx) => {
      if (dish === undefined) return;
      const cardX = marginX + colIdx * (colW + colGap);
      const cardY = cursorY;

      // Cadre de la fiche repas
      ctx.save();
      roundRectPath(ctx, cardX, cardY, colW, rowH, 16);
      ctx.fillStyle = "#FFFFFF";
      ctx.fill();
      ctx.strokeStyle = "#222222";
      ctx.lineWidth = 2.6;
      ctx.stroke();

      const innerX = cardX + 26;
      let innerY = cardY + 30;

      // Case à cocher
      const cbSize = 28;
      roundRectPath(ctx, innerX, innerY, cbSize, cbSize, 5);
      ctx.strokeStyle = "#555555";
      ctx.lineWidth = 2;
      ctx.stroke();

      if (dish && preparedDishIds.has(dish.id)) {
        ctx.strokeStyle = "#059669";
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(innerX + 6, innerY + 14);
        ctx.lineTo(innerX + 12, innerY + 21);
        ctx.lineTo(innerX + 22, innerY + 7);
        ctx.stroke();
      }

      // Badge Catégorie (A, B, C, D ou case vierge en pointillés)
      const badgeX = innerX + cbSize + 16;
      const badgeW = 42;
      const badgeH = 32;
      roundRectPath(ctx, badgeX, innerY - 2, badgeW, badgeH, 8);
      if (dish) {
        const colors = CATEGORY_COLORS[dish.category] || CATEGORY_COLORS.B;
        ctx.fillStyle = colors.bg;
        ctx.fill();
        ctx.strokeStyle = colors.border;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = colors.text;
        ctx.font = "700 21px 'Nunito Sans', -apple-system, sans-serif";
        const letterW = ctx.measureText(dish.category).width;
        ctx.fillText(dish.category, badgeX + (badgeW - letterW) / 2, innerY + 22);
      } else {
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = "#666666";
        ctx.lineWidth = 1.8;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Titre du plat ou ligne pointillée pour plat manuel
      const titleX = badgeX + badgeW + 16;
      const titleMaxW = cardX + colW - 26 - titleX;
      if (dish) {
        ctx.fillStyle = "#111111";
        ctx.font = "700 26px Rubik, -apple-system, sans-serif";
        const titleLines = wrapTextLines(ctx, dish.name, titleMaxW);
        ctx.fillText(titleLines[0], titleX, innerY + 23);
      } else {
        ctx.setLineDash([4, 5]);
        ctx.strokeStyle = "#555555";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(titleX, innerY + 25);
        ctx.lineTo(cardX + colW - 26, innerY + 25);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Encadré date de péremption : "À cuisiner avant le :   __ / __ / __"
      innerY += 46;
      const expH = 44;
      const expW = colW - 52;
      roundRectPath(ctx, innerX, innerY, expW, expH, 10);
      ctx.fillStyle = "#F8F8F8";
      ctx.fill();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = "#666666";
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = "#111111";
      ctx.font = "700 21px 'Nunito Sans', -apple-system, sans-serif";
      ctx.fillText("À cuisiner avant le :", innerX + 16, innerY + 29);

      const slotsText = "__ / __ / __";
      ctx.font = "700 23px ui-monospace, SFMono-Regular, Menlo, monospace";
      const slotsW = ctx.measureText(slotsText).width;
      ctx.fillText(slotsText, innerX + expW - slotsW - 16, innerY + 29);

      // Liste des ingrédients du plat (ou 4 lignes pointillées si case vierge)
      innerY += expH + 34;
      ctx.fillStyle = "#222222";
      ctx.font = "400 23px 'Nunito Sans', -apple-system, sans-serif";

      if (dish) {
        for (const ing of dish.ingredients) {
          // Puce
          ctx.beginPath();
          ctx.arc(innerX + 12, innerY - 8, 4, 0, Math.PI * 2);
          ctx.fill();

          const lines = wrapTextLines(ctx, ing.detail, expW - 32);
          ctx.fillText(lines[0], innerX + 28, innerY);
          innerY += 35;
        }
      } else {
        for (let k = 0; k < 4; k++) {
          ctx.beginPath();
          ctx.arc(innerX + 12, innerY - 8, 4, 0, Math.PI * 2);
          ctx.fill();

          ctx.setLineDash([3, 5]);
          ctx.strokeStyle = "#888888";
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(innerX + 28, innerY + 3);
          ctx.lineTo(innerX + expW, innerY + 3);
          ctx.stroke();
          ctx.setLineDash([]);
          innerY += 38;
        }
      }

      ctx.restore();
    });

    cursorY += rowH + rowGap;
  }

  pages.push({
    width: W,
    height: H,
    bytes: dataUrlToBytes(pageState.canvas.toDataURL("image/jpeg", 0.92))
  });

  return buildPdfFromJpegPages(pages);
}

/**
 * Génère le PDF A4 "Liste de Courses de la Semaine (par rayon)"
 */
export function generateShoppingListPdfBytes({
  aggregatedIngredients,
  checkedIngredients,
  selectedMealsCount,
  formatQuantity,
  dateStr
}) {
  const docTitle = "Liste de Courses de la Semaine (par rayon)";
  const dateSummary = `Généré le ${dateStr} • ${selectedMealsCount} repas sélectionné${selectedMealsCount > 1 ? "s" : ""} (${aggregatedIngredients.length} ingrédient${aggregatedIngredients.length > 1 ? "s" : ""} au total)`;
  const sectionTitle = "Ingrédients à ajouter au panier";
  const rightBadge = `${aggregatedIngredients.length} ingrédient${aggregatedIngredients.length > 1 ? "s" : ""}`;

  const byAisle = new Map();
  for (const item of aggregatedIngredients) {
    if (!byAisle.has(item.aisle)) byAisle.set(item.aisle, []);
    byAisle.get(item.aisle).push(item);
  }
  const aisleEntries = Array.from(byAisle.entries());

  const pages = [];
  let pageState = createA4PageCanvas(docTitle, dateSummary, sectionTitle, rightBadge);
  let { ctx, W, H, marginX } = pageState;

  const colGap = 36;
  const colW = (W - marginX * 2 - colGap) / 2;
  const colY = [pageState.startY, pageState.startY];

  for (const [aisle, items] of aisleEntries) {
    const colIdx = colY[0] <= colY[1] ? 0 : 1;
    const blockH = 52 + items.length * 60 + 24;

    if (colY[colIdx] + blockH > H - 80 && (colY[0] > pageState.startY || colY[1] > pageState.startY)) {
      pages.push({
        width: W,
        height: H,
        bytes: dataUrlToBytes(pageState.canvas.toDataURL("image/jpeg", 0.92))
      });
      pageState = createA4PageCanvas(docTitle, dateSummary, sectionTitle, rightBadge);
      ctx = pageState.ctx;
      colY[0] = pageState.startY;
      colY[1] = pageState.startY;
    }

    const targetCol = colY[0] <= colY[1] ? 0 : 1;
    const x = marginX + targetCol * (colW + colGap);
    let y = colY[targetCol];

    // Titre du rayon
    ctx.fillStyle = "#574340";
    ctx.font = "700 22px Rubik, -apple-system, sans-serif";
    ctx.fillText(aisle.toUpperCase(), x, y + 22);

    y += 32;
    ctx.strokeStyle = "#E7DAD5";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + colW, y);
    ctx.stroke();
    y += 14;

    for (const item of items) {
      const rowH = 52;
      roundRectPath(ctx, x, y, colW, rowH, 10);
      ctx.fillStyle = "#FFFFFF";
      ctx.fill();
      ctx.strokeStyle = "#D1BDB6";
      ctx.lineWidth = 1.6;
      ctx.stroke();

      // Case à cocher
      const cbX = x + 16;
      const cbY = y + 13;
      roundRectPath(ctx, cbX, cbY, 24, 24, 5);
      ctx.strokeStyle = "#666666";
      ctx.lineWidth = 1.8;
      ctx.stroke();

      const isChecked = checkedIngredients.has(item.key);
      if (isChecked) {
        ctx.strokeStyle = "#059669";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cbX + 5, cbY + 12);
        ctx.lineTo(cbX + 10, cbY + 18);
        ctx.lineTo(cbX + 19, cbY + 6);
        ctx.stroke();
      }

      const labelText = `${item.name} : `;
      const qtyText = formatQuantity(item.totalQty, item.unit);
      ctx.fillStyle = isChecked ? "#888888" : "#1E1311";
      ctx.font = "400 22px 'Nunito Sans', -apple-system, sans-serif";
      ctx.fillText(labelText, cbX + 36, y + 33);

      const labelW = ctx.measureText(labelText).width;
      ctx.font = "700 22px 'Nunito Sans', -apple-system, sans-serif";
      ctx.fillText(qtyText, cbX + 36 + labelW, y + 33);

      y += rowH + 8;
    }

    colY[targetCol] = y + 22;
  }

  pages.push({
    width: W,
    height: H,
    bytes: dataUrlToBytes(pageState.canvas.toDataURL("image/jpeg", 0.92))
  });

  return buildPdfFromJpegPages(pages);
}

/**
 * Détecte si l'application tourne sur iOS / iPadOS ou en mode WebApp installée (standalone)
 */
export function isIosOrStandaloneWebApp() {
  const ua = window.navigator.userAgent || "";
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);
  const isStandalone =
    window.navigator.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches;
  return isIOS || isStandalone;
}

/**
 * Partage ou ouvre le PDF généré sur iOS / WebApp (permet AirPrint, Fichiers, AirDrop, WhatsApp...)
 */
export async function shareOrOpenPdfBytes(pdfBytes, fileName, title) {
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  const file = new File([blob], fileName, { type: "application/pdf" });

  if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title
      });
      return;
    } catch (err) {
      if (err && err.name === "AbortError") {
        return; // L'utilisateur a fermé la feuille de partage iOS
      }
    }
  }

  // Repli : téléchargement / ouverture directe du Blob PDF
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = fileName;
  link.target = "_blank";
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
}
