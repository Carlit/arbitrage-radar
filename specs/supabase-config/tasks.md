# Tâches : Reproductibilité du schéma Supabase

- [x] **1. Génération des fichiers de migration**
  - Exécuter `npx supabase migration new initial_schema`
  - Exécuter `npx supabase migration new add_update_policy`
  - Exécuter `npx supabase migration new enable_realtime`

- [x] **2. Découpage du SQL**
  - Remplir la migration `initial_schema` avec tout le contenu de base de `supabase_schema_ready.sql`.
  - Remplir la migration `add_update_policy` avec le `CREATE POLICY` pour l'update sur `tenant_alert_access`.
  - Remplir la migration `enable_realtime` avec le bloc `ALTER PUBLICATION`.

- [x] **3. Génération du fichier Seed**
  - Extraire les données existantes de la base de données de développement locale (`auth.users`, `public.tenants`, `public.app_users`, `public.tenant_memberships`) pour les comptes `test@local.dev` et `test2@local.dev`.
  - Écrire ces données sous forme d'instructions `INSERT` dans `supabase/seed.sql`.

- [x] **4. Nettoyage de l'existant**
  - Supprimer les fichiers `supabase_schema.sql`, `supabase_schema_ready.sql` et `supabase_auto_provisioning.sql` à la racine du projet.

- [x] **5. Validation**
  - Exécuter `npx supabase db reset`.
  - Vérifier que la commande réussit sans erreur.
  - S'assurer que le Dashboard charge correctement et que la RLS + Realtime fonctionnent toujours.

- [x] **6. Clôture**
  - Mettre à jour `specs/supabase-config/spec.md` avec le statut "Fait".

---

**Incident Report & Résolution (Auth / Seed)** :
Lors de l'étape de validation (`db reset`), plusieurs problèmes successifs ont été rencontrés sur le `seed.sql`, tous liés au fonctionnement interne de l'authentification Supabase (GoTrue) et de nos triggers :
1. **Conflit avec le trigger d'auto-provisioning** : L'insertion dans `auth.users` déclenche automatiquement un trigger qui crée des lignes dans `app_users` et `tenant_memberships`. Les `INSERT` manuels qui suivaient provoquaient une erreur de clé dupliquée. *Résolution* : Remplacement des `INSERT` par des `INSERT ... ON CONFLICT (...) DO UPDATE SET ...` et ajout d'un nettoyage des tenants fantômes générés par le trigger.
2. **Identités manquantes** : GoTrue requiert une entrée dans `auth.identities` (avec le format JSON approprié) pour autoriser le login. *Résolution* : Ajout de l'insertion dans `auth.identities` pour chaque utilisateur de test.
3. **Hash Bcrypt invalide** : Le premier `seed.sql` contenait un hash bcrypt généré de manière incorrecte (ex: `$2a$10$...`), bloquant la connexion car non reconnu par l'algorithme strict attendu par Supabase (qui utilise souvent `$2a$06$...`). *Résolution* : Remplacement du hash par un hash légitime calculé via `select crypt('TestLocal123!', gen_salt('bf'));` directement dans la base de données, vérifié ensuite par une requête de comparaison.
4. **Colonnes tokens vides** : Après le reset, GoTrue bloquait parfois la session car les colonnes de token (`confirmation_token`, etc.) étaient initialisées à `NULL`. *Résolution* : Ajout explicite de ces colonnes avec des chaînes vides `''` dans l'insertion initiale.