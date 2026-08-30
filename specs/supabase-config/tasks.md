# Tâches : Reproductibilité du schéma Supabase

- [ ] **1. Génération des fichiers de migration**
  - Exécuter `npx supabase migration new initial_schema`
  - Exécuter `npx supabase migration new add_update_policy`
  - Exécuter `npx supabase migration new enable_realtime`

- [ ] **2. Découpage du SQL**
  - Remplir la migration `initial_schema` avec tout le contenu de base de `supabase_schema_ready.sql`.
  - Remplir la migration `add_update_policy` avec le `CREATE POLICY` pour l'update sur `tenant_alert_access`.
  - Remplir la migration `enable_realtime` avec le bloc `ALTER PUBLICATION`.

- [ ] **3. Génération du fichier Seed**
  - Extraire les données existantes de la base de données de développement locale (`auth.users`, `public.tenants`, `public.app_users`, `public.tenant_memberships`) pour les comptes `test@local.dev` et `test2@local.dev`.
  - Écrire ces données sous forme d'instructions `INSERT` dans `supabase/seed.sql`.

- [ ] **4. Nettoyage de l'existant**
  - Supprimer les fichiers `supabase_schema.sql`, `supabase_schema_ready.sql` et `supabase_auto_provisioning.sql` à la racine du projet.

- [ ] **5. Validation**
  - Exécuter `npx supabase db reset`.
  - Vérifier que la commande réussit sans erreur.
  - S'assurer que le Dashboard charge correctement et que la RLS + Realtime fonctionnent toujours.

- [ ] **6. Clôture**
  - Mettre à jour `specs/supabase-config/spec.md` avec le statut "Fait".