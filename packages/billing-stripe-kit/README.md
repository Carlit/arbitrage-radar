# billing-stripe-kit — déplacé dans son propre repo

Le code qui vivait ici a été extrait le 2026-09-03 dans un repo indépendant, avec son
historique Git complet (5 commits) : **https://github.com/Carlit/billing-stripe-kit**

Ce dossier ne contient plus que ce README. Le kit lui-même (`src/`, tests, `package.json`)
vit désormais uniquement dans ce nouveau repo.

## Comment récupérer le kit pour faire tourner ce projet

`web/` consomme le kit via une dépendance de fichier local (`file:../../billing-stripe-kit`,
cf. `web/package.json`) — **pas** via npm, **pas** via ce dossier `packages/`. Il faut donc
cloner `billing-stripe-kit` sur votre machine, **au bon endroit**, avant de pouvoir faire
`npm install` dans `web/`.

**Le bon endroit** : un dossier `billing-stripe-kit/` **frère du dossier racine de ce repo**
(pas un sous-dossier, pas dans `packages/`). Concrètement, si le repo `arbitrage-radar` est
cloné dans `~/code/arbitrage-radar/`, alors `billing-stripe-kit` doit être cloné dans
`~/code/billing-stripe-kit/` — au même niveau, pas à l'intérieur :

```
~/code/
├── arbitrage-radar/              ← ce repo
│   ├── packages/billing-stripe-kit/   ← juste ce README, plus de code
│   ├── web/
│   │   └── package.json          ← référence "file:../../billing-stripe-kit"
│   └── ...
└── billing-stripe-kit/           ← à cloner ICI, en frère de arbitrage-radar/
```

Commandes (à exécuter depuis le dossier qui contient `arbitrage-radar/`, pas depuis
l'intérieur du repo) :

```bash
cd .. # sortir du repo arbitrage-radar, se placer dans son dossier parent
git clone https://github.com/Carlit/billing-stripe-kit.git

# billing-stripe-kit a ses propres dépendances (stripe) — les installer ici
# est indispensable : "npm install" dans web/ ne les résout PAS tout seul
# pour une dépendance file:, contrairement à un vrai workspace npm.
cd billing-stripe-kit && npm install && cd ..

cd arbitrage-radar/web
npm install
```

Si vous ouvrez ce projet sur une nouvelle machine (ou dans plusieurs mois, une fois les
détails oubliés) : ce sont les deux seules étapes manuelles à refaire avant que `web/`
fonctionne :
1. Sans le clone au bon endroit, `npm install` dans `web/` échoue avec une erreur de
   résolution de `billing-stripe-kit` introuvable.
2. Sans le `npm install` **à l'intérieur** de `billing-stripe-kit/`, `web/` type-checke sans
   erreur (tsc suit les symlinks) mais **`next build`/`next dev` échouent** à la compilation
   avec `Module not found: Can't resolve 'stripe'` — l'erreur n'apparaît qu'au build, pas au
   typecheck, ce qui peut surprendre.

Notez aussi que `web/next.config.ts` fixe explicitement `turbopack.root`/
`outputFileTracingRoot` sur le dossier **parent de `arbitrage-radar/`** (deux niveaux
au-dessus de `web/`, pas un seul) — Turbopack refuse sinon de résoudre un module dont le
chemin réel (après le symlink `file:`) tombe hors de la racine configurée. Si vous déplacez
un jour `billing-stripe-kit/` ailleurs que "frère de `arbitrage-radar/`", ce chemin dans
`next.config.ts` doit être ajusté en conséquence.

## Pourquoi ce découpage

Le kit ne dépend d'aucun concept du produit `arbitrage-radar` (pas de "tenant", pas de
schéma DB) — c'est un module Stripe générique (checkout, portail, remboursements, webhooks)
pensé pour être réutilisé sur un futur produit sans copier-coller. Le extraire en repo
indépendant, plutôt que de le garder dans ce monorepo, évite que les deux usages divergent
silencieusement au fil du temps.

Pas de git submodule ici — volontairement, pour rester simple à maintenir : `web/`
consommait déjà le kit via `file:` dependency (jamais via un chemin dans l'arbre Git), un
submodule n'aurait rien apporté de plus que ce README + un clone manuel.
