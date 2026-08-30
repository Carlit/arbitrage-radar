# Plan : Reproductibilité du schéma Supabase

## 1. Découpage Logique des Migrations
Plutôt que d'avoir une seule migration monolithique, nous allons refléter l'historique logique de l'évolution du schéma. Nous utiliserons la commande `npx supabase migration new <nom>` pour générer des fichiers avec un horodatage CLI réel.

Le découpage sera le suivant :
1. **Migration 1 : `initial_schema`** : 
   - Types, tables de base (`tenants`, `app_users`, `market_alerts`, `tenant_alert_access`, `assets`).
   - Fonctions et triggers de provisioning (`handle_new_user`, `is_tenant_member`).
   - Toutes les policies RLS initiales (lecture, insertion par service role, etc.).
2. **Migration 2 : `add_update_policy`** :
   - Ajout spécifique de la policy `tenant_alert_access_update_member` permettant le marquage comme lu.
3. **Migration 3 : `enable_realtime`** :
   - Le bloc PL/pgSQL idempotent activant la publication `supabase_realtime` sur `market_alerts` et `tenant_alert_access`.

## 2. Génération du Seed (`supabase/seed.sql`)
Nous allons extraire l'état actuel pour recréer exactement les deux utilisateurs de test et leurs environnements isolés. Le script `seed.sql` effectuera les `INSERT` suivants avec les UUIDs explicites récupérés de la base actuelle :
1. **auth.users** : `test@local.dev` et `test2@local.dev`.
2. **public.tenants** : Les deux espaces de travail correspondants.
3. **public.app_users** : Les profils avec le `default_tenant_id` assigné.
4. **public.tenant_memberships** : Les liaisons utilisateur-tenant avec le rôle `owner`.

## 3. Nettoyage de l'existant
Les anciens fichiers SQL manuels à la racine (`supabase_schema.sql`, `supabase_schema_ready.sql`, `supabase_auto_provisioning.sql`) seront **supprimés définitivement**. 
L'unique source de vérité pour le schéma sera le dossier `supabase/migrations/`.

## 4. Validation 
- Lancement de `npx supabase db reset`.
- Vérification que la commande s'exécute sans erreur.
- Vérification (visuelle ou par script) que le frontend accepte la connexion avec `test@local.dev` et `test2@local.dev` et que la base est correctement initialisée et prête à recevoir des données.

---

## Leçons Apprises (Auth & Seed)
Lors de l'écriture d'un script de seed impliquant `auth.users`, il est crucial de se rappeler que :
1. **Hash Bcrypt** : Les mots de passe générés extérieurement ou modifiés à la main (`$2a$10$...`) peuvent échouer silencieusement lors du login si Supabase attend un coût spécifique (ex: `$2a$06$...`). **Toujours** générer un hash de seed via `select crypt('mon_mdp', gen_salt('bf'));` dans l'éditeur SQL de Supabase.
2. **GoTrue et Identities** : Une ligne dans `auth.users` ne suffit pas pour s'authentifier par mot de passe. Il faut **impérativement** une entrée correspondante dans `auth.identities` (avec le champ `identity_data` contenant le `sub` et l'`email`).
3. **Triggers concurrents** : Si des triggers insèrent des profils/tenants à la création d'un utilisateur, le script de seed doit utiliser `ON CONFLICT (...) DO UPDATE` pour réécraser les données orphelines, puis purger les tables annexes (ex: `tenants` fantômes) générées par le trigger.
4. **Champs tokens NULL** : Il est recommandé de forcer les champs de token (`confirmation_token`, `recovery_token`, etc.) à `''` (chaîne vide) lors du seed pour éviter des erreurs internes de GoTrue.