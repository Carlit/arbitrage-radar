# Tâches — Dashboard complet : filtres, statut, vue tableau, Realtime

## Phase 1 : Base de données (Realtime)

- [x] **1.1. Migration SQL** :
  - Ajouter la configuration `ALTER PUBLICATION supabase_realtime` pour `market_alerts` et `tenant_alert_access` dans `supabase_schema.sql` et `supabase_schema_ready.sql`.
  - Appliquer cette modification sur la base locale.

## Phase 2 : Frontend - Préparation et Composants UI

- [x] **2.1. Nouveaux composants shadcn/ui** :
  - Ajouter/Vérifier la présence des composants nécessaires : `Table`, `Badge`, `Select`, `Input` si besoin (la majorité peut être construite avec du HTML/Tailwind standard pour un MVP rapide, ou utiliser les composants existants).

- [x] **2.2. Modification de `page.tsx`** :
  - Ajouter la jointure `assets (symbol)` à la requête initiale `supabase.from("market_alerts")`.
  - Séparer la logique de rendu interactif vers un nouveau composant `<AlertsDashboard />`.

## Phase 3 : Frontend - Composant Client (`AlertsDashboard.tsx`)

- [x] **3.1. Structure d'état (State)** :
  - Créer l'état pour les filtres : `assetFilter`, `venueFilter`, `statusFilter` (uniquement "open").
  - Créer l'état pour la vue : `viewMode` ('grid' | 'table').
  - Créer l'état pour les données : `alerts` (initialisé avec les props serveur).

- [x] **3.2. Rendu des Vues (Grille & Tableau)** :
  - Implémenter le rendu de la grille (réutilisation du code actuel de `page.tsx`).
  - Implémenter le rendu du tableau (nouvelle structure HTML `<table>`).

- [x] **3.3. Marquage "Lu" (Action)** :
  - Créer la fonction `markAsRead(alertId)` effectuant un `update` sur `tenant_alert_access`.
  - Mettre à jour l'état local immédiatement (Optimistic UI) ou via l'événement Realtime.

- [x] **3.4. Abonnement Realtime** :
  - Configurer `supabase.channel` pour écouter les INSERTS sur `tenant_alert_access` (avec filtre `tenant_id=eq.${activeTenantId}`).
  - Lors de la réception, faire un `select` ciblé sur `market_alerts` et l'ajouter à l'état local.
  - Configurer l'écoute des UPDATES pour répercuter les changements d'état (bien que le client lui-même puisse s'en charger).

- [x] **3.5. Export CSV** :
  - Créer une fonction utilitaire transformant le tableau d'alertes filtrées en chaîne CSV.
  - Déclencher le téléchargement du fichier via un Blob.

## Phase 4 : Finalisation

- [x] **4.1. Mise à jour de la spec** :
  - Mettre à jour `specs/dashboard-features/spec.md` avec le statut "fait".