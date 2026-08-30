# Tâches — Accès multi-tenant sécurisé sur les alertes d'arbitrage

## Phase 1 : Configuration et Base de données

- [ ] **1.1. Variables d'environnement Python** :
  - Ajouter `DEFAULT_TENANT_ID` dans `.env.supabase-poc`.

- [ ] **1.2. Mises à jour SQL (Policies)** :
  - Ajouter la policy `tenant_alert_access_update_member` (UPDATE) dans `supabase_schema.sql` et `supabase_schema_ready.sql`.
  - S'assurer que cette policy s'appuie sur `is_tenant_member(tenant_id)`.

## Phase 2 : Script Python (Backend Worker)

- [ ] **2.1. Modification de `arbitrage_radar_poc.py`** :
  - Lire la variable `DEFAULT_TENANT_ID`.
  - Après l'insertion (avec la Service Role Key) des lots dans `market_alerts`, récupérer les IDs des alertes insérées.
  - Préparer un lot de lignes pour `tenant_alert_access` associant chaque `alert_id` au `DEFAULT_TENANT_ID` (avec `entitled_via_tier`).
  - Insérer ce lot dans `tenant_alert_access`.

## Phase 3 : Frontend Dashboard

- [ ] **3.1. Nettoyage de l'accès direct (Service Role Key)** :
  - Dans `web/app/dashboard/page.tsx`, supprimer l'import et l'utilisation de `getServiceRoleSupabase`.
  - Utiliser exclusivement le client standard via `createClient()`.

- [ ] **3.2. Récupération du tenant actif** :
  - Après la récupération de `user`, requêter `app_users` pour obtenir `default_tenant_id`.
  - Assigner ce tenant comme `activeTenantId`. (Gérer le cas de repli si le tenant n'existe pas).

- [ ] **3.3. Requête des alertes sous RLS** :
  - Modifier l'appel à `.from("market_alerts")`.
  - Ajouter la jointure `tenant_alert_access!inner(read_at, tenant_id)`.
  - Filtrer par `tenant_alert_access.tenant_id = activeTenantId`.
  - S'assurer que les données s'affichent correctement dans le dashboard sans erreur.

## Phase 4 : Finalisation

- [ ] **4.1. Mise à jour de la spec** :
  - Mettre à jour `specs/rls-tenant-dashboard/spec.md` avec le statut "fait".
