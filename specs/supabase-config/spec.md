# Spécification : Reproductibilité du schéma Supabase (CLI & Migrations)

## 1. Quoi (Le besoin)
Remplacer l'application manuelle des scripts SQL (`supabase_schema.sql`, `supabase_schema_ready.sql`, `supabase_auto_provisioning.sql`) par une structure de projet Supabase officielle et reproductible. Cela implique :
- L'initialisation d'une configuration Supabase complète (`supabase/config.toml`).
- La conversion de l'état actuel de la base de données en fichiers de migration (`supabase/migrations/`).
- La validation que la commande `npx supabase db reset` recrée l'intégralité du schéma, des policies RLS, des triggers (provisioning) et de la configuration Realtime à partir de zéro, de manière fiable.

- **Génération du fichier `seed.sql`** : Celui-ci recréera automatiquement et exactement les deux environnements de test existants (tenant 1 et tenant 2) avec les utilisateurs associés (`test@local.dev` et `test2@local.dev`), en conservant rigoureusement leurs UUIDs actuels. Ainsi, `supabase db reset` restaurera un environnement de développement 100% prêt à l'emploi en une seule commande.

## 2. Pourquoi (Le problème à résoudre)
- **Reproductibilité** : Actuellement, un nouveau développeur ou un environnement de CI/CD ne peut pas instancier la base de données de manière déterministe sans exécuter manuellement plusieurs fichiers dans le bon ordre.
- **Traçabilité** : L'évolution du schéma n'est pas versionnée de manière incrémentale. En cas de modification future, il est impossible d'appliquer un "diff" proprement.
- **Bonnes pratiques** : Utiliser les migrations permet d'adopter le standard de l'industrie (et de Supabase) pour la gestion du cycle de vie des bases de données (Database as Code).

## 3. Pour qui
- **Les développeurs** : Simplification de l'onboarding (un simple `supabase start` ou `supabase db reset` suffira) et de la collaboration.
- **L'infrastructure (futur)** : Préparation du terrain pour les déploiements automatisés (CI/CD) vers des environnements de staging ou de production.

## 4. Hors périmètre
- **Modification de la logique métier** : Aucune nouvelle table, aucune nouvelle policy RLS, aucune modification du script Python ou du frontend n'est prévue dans ce chantier. Le but est un refactoring iso-fonctionnel du déploiement de la base.
- **Déploiement vers un projet Supabase distant (Cloud)** : Ce chantier se concentre sur la structure locale du projet et sa validation via la CLI locale. Le déploiement effectif sur le cloud Supabase de production fera l'objet d'un autre chantier.

## 5. Statut
- [x] Fait