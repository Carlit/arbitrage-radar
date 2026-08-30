# Constitution du projet — Arbitrage Radar

## Stack

- Frontend : Next.js (App Router) + TypeScript + Tailwind CSS + shadcn/ui
- Backend / données : Supabase (Postgres, Auth SSR, Realtime)
- Traitement des données : Python (polars, numpy) pour la simulation et détection d'arbitrage
- Paiements (à venir) : Stripe

## Principes de sécurité (non négociables)

1. **RLS toujours active en conditions réelles.** Aucune requête client ne doit dépendre
   d'une clé Service Role pour fonctionner. La Service Role Key est réservée aux scripts
   serveur ponctuels (ex : le pipeline Python d'insertion), jamais au code servant des
   requêtes utilisateur.
2. **Isolation multi-tenant par défaut.** Toute donnée liée à un utilisateur ou à une
   opportunité d'arbitrage doit être rattachable à un tenant dès l'insertion. Pas de données
   orphelines "à trier plus tard".
3. **Pas de contournement silencieux.** Si un contournement temporaire est nécessaire pour
   avancer (ex : démo), il doit être : (a) documenté dans le plan de la feature concernée,
   (b) assorti d'une tâche de correction explicite, (c) jamais fusionné sans cette tâche
   associée.

## Conventions

- Les policies RLS sont écrites et versionnées en SQL dans le repo (pas seulement via l'UI Supabase).
- Toute nouvelle table sensible passe par une revue de policy avant d'être exposée côté client.

## Contexte métier

- Le produit détecte et affiche des opportunités d'arbitrage cross-exchange (paires crypto/USD).
- Les utilisateurs appartiennent à des tenants ; l'accès aux alertes est scopé par tenant.
- Un modèle d'abonnement (Stripe) doit à terme conditionner l'accès à certaines fonctionnalités
  via `subscription_tier`.
