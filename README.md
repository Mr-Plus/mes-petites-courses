# Mes petites courses

Site familial pour composer ses menus équilibrés de la semaine et générer automatiquement sa liste de courses par rayon.

## Structure du projet

```text
├── assets/
│   ├── apple-touch-icon.png   # Icône iOS (écran d'accueil)
│   ├── favicon.svg            # Icône vectorielle principale
│   ├── icon-192.png           # Icône PWA 192x192
│   ├── icon-512.png           # Icône PWA 512x512
│   ├── icon-maskable-512.png  # Icône PWA adaptative Android
│   └── manifest.webmanifest   # Manifeste d'installation WebApp (PWA)
├── css/
│   └── styles.css             # Feuille de style principale
├── data/
│   └── recipes.json           # Base de données des recettes et ingrédients
├── js/
│   └── app.js                 # Logique applicative (catalogue, quotas, panier, export IA)
├── index.html                 # Point d'entrée de l'application
├── sw.js                      # Service Worker pour le mode hors-ligne (doit rester à la racine)
├── netlify.toml               # Configuration de déploiement continu Netlify (headers & redirections)
└── README.md                  # Documentation du projet
```
