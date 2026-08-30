# Arbitrage Radar MVP

## Vue d'ensemble

Ce dépôt documente l'état actuel du MVP SaaS de radar d'arbitrage de prix. À ce stade, le backend est gelé et le dépôt contient principalement des artefacts d'architecture, le schéma SQL Supabase, les scripts de facturation Stripe, ainsi qu'un POC Python capable de simuler un marché, détecter des anomalies et écrire les alertes dans Supabase.

Le produit visé est un micro-SaaS qui détecte des anomalies de prix inter-plateformes, qualifie les opportunités d'arbitrage et revend l'accès aux alertes via des abonnements `Free`, `Pro` et `Elite`.

## Architecture retenue

### Stack technique

La cible technique retenue est la suivante :

| Couche | Choix | Rôle |
|---|---|---|
| Frontend | `Next.js 15`, `React 19`, `TypeScript`, `Tailwind CSS 4`, `shadcn/ui` | Interface SaaS, dashboard, gestion du compte et des abonnements |
| API / services | `Node.js 22`, `Fastify`, `TypeScript`, `Zod` | API applicative, webhooks, orchestration backend |
| Base de données | `Supabase Postgres` | Stockage transactionnel, auth, RLS, persistance des alertes |
| Auth / multi-tenant | `Supabase Auth` + politiques `RLS` | Isolation stricte des données par tenant |
| Facturation | `Stripe Billing` | Produits, prix, abonnements, événements de cycle de vie |
| POC détection | `Python`, `NumPy`, `Polars`, `supabase-py` | Simulation des flux de marché, scoring et insertion des alertes |
| Buffer / temps réel cible | `Upstash Redis` | File légère, anti-doublons, cache temps réel |

### Découpage logique

L'architecture est pensée en deux plans :

- `control plane` : comptes, tenants, abonnement Stripe, configuration, dashboard
- `data plane` : ingestion marché, normalisation, calcul de cote dynamique, scoring, alerting

Ce découpage évite de mélanger la logique produit SaaS avec le pipeline temps réel.

### Pipeline de données

Le pipeline visé suit ce flux :

1. ingestion de transactions ou de snapshots depuis plusieurs plateformes
2. normalisation des symboles et enrichissement des coûts d'exécution
3. construction d'une cote dynamique par actif
4. calcul des prix d'achat et de vente nets après frais, spread et slippage
5. détection des écarts exploitables
6. attribution d'un score de confiance et d'un niveau de souscription minimal
7. persistance des alertes et distribution selon les droits du tenant

## Modèle de données et RLS

### Principes

Le modèle de données sépare les données globales de marché des données applicatives liées aux tenants.

- données globales : `venues`, `assets`, `asset_listings`, `market_alerts`
- données multi-tenant : `tenants`, `app_users`, `tenant_memberships`, `tenant_alert_access`

L'isolation repose sur trois mécanismes :

1. rattachement des utilisateurs à un `tenant` via `tenant_memberships`
2. stockage des informations d'abonnement Stripe directement sur `tenants`
3. contrôle d'accès aux alertes via `tenant_alert_access` et vérification du niveau d'abonnement

### Tables principales

| Table | Rôle |
|---|---|
| `tenants` | Entité de facturation et de sécurité principale ; porte `stripe_customer_id`, `stripe_subscription_id`, `subscription_tier`, `subscription_status` |
| `app_users` | Profil applicatif adossé à `auth.users` |
| `tenant_memberships` | Liaison utilisateur ↔ tenant avec rôle `owner`, `admin`, `member` |
| `venues` | Référentiel global des plateformes suivies |
| `assets` | Référentiel global des actifs suivis |
| `asset_listings` | Association actif ↔ plateforme avec paramètres de frais |
| `market_alerts` | Alertes globales générées par le moteur de détection |
| `tenant_alert_access` | Table d'entitlement qui matérialise quelles alertes sont visibles par quels tenants |

### Logique RLS

Le schéma SQL implémente une logique RLS stricte :

- un utilisateur peut lire un `tenant` seulement s'il en est membre
- un utilisateur ne lit ses propres données `app_users` que sur son `auth.uid()`
- un membre d'un tenant peut lire les `tenant_memberships` de son tenant
- seuls les admins ou owners peuvent modifier certaines entités de tenant
- le référentiel de marché global est lisible par les utilisateurs authentifiés
- l'accès à `market_alerts` n'est autorisé que si une ligne correspondante existe dans `tenant_alert_access`
- `tenant_alert_access` impose en plus que le tenant ait un abonnement éligible et un niveau au moins égal à `entitled_via_tier`

En pratique, une alerte n'est pas lisible simplement parce qu'elle existe. Elle doit être explicitement attribuée à un tenant et ce tenant doit encore disposer d'un abonnement compatible au moment de la requête.

## État du dépôt

Le dossier contient actuellement les fichiers suivants :

| Fichier | Rôle exact |
|---|---|
| `.gitignore` | Fichier d'ignorés Git existant dans le dépôt |
| `mvp_blueprint.md` | Note d'architecture du MVP, stack retenue, schéma conceptuel et logique de pipeline |
| `supabase_schema.sql` | Schéma SQL principal pour Supabase PostgreSQL avec tables, fonctions, triggers et politiques RLS |
| `supabase_schema_ready.sql` | Copie du schéma SQL principal pour contourner un problème d'aperçu rencontré plus tôt |
| `stripe_bootstrap_billing.mjs` | Script Node.js qui crée ou retrouve les produits et prix Stripe `Free`, `Pro`, `Elite` |
| `stripe_webhook_fastify.mjs` | Serveur Fastify minimal exposant le webhook Stripe signé et synchronisant les statuts d'abonnement vers `tenants` via Supabase Admin |
| `.env.billing.example` | Exemple de variables d'environnement nécessaires aux scripts Stripe |
| `arbitrage_radar_poc.py` | POC Python de simulation de marché, détection d'anomalies, seed du référentiel Supabase et insertion des alertes dans `market_alerts` |
| `requirements-poc.txt` | Dépendances Python minimales du POC (`numpy`, `polars`, `supabase`) |
| `.env.supabase-poc.example` | Exemple de variables d'environnement minimales pour connecter le POC Python à Supabase |

## Détail des scripts existants

### `supabase_schema.sql`

Ce script crée :

- les types `app_role`, `subscription_tier`, `subscription_status`, `alert_status`
- les tables multi-tenant et marché
- les fonctions de sécurité `is_tenant_member`, `is_tenant_admin`, `tenant_has_alert_entitlement`, `can_access_alert`
- les triggers `updated_at`
- les politiques RLS sur les tables exposées

Il inclut aussi une vérification empêchant d'attribuer une alerte à un tenant avec un niveau inférieur au niveau minimal requis par l'alerte.

### `stripe_bootstrap_billing.mjs`

Ce script :

- lit `STRIPE_SECRET_KEY`
- crée ou retrouve les produits Stripe pour `free`, `pro`, `elite`
- crée ou retrouve les prix mensuels associés
- attache des métadonnées `app_tier` et `app_family`
- retourne un JSON contenant les `productId` et `priceId`

Il est conçu pour être idempotent au niveau logique de bootstrap.

### `stripe_webhook_fastify.mjs`

Ce script :

- démarre un serveur Fastify
- capte le corps brut HTTP pour vérifier la signature Stripe
- vérifie `stripe-signature` avec `STRIPE_WEBHOOK_SECRET`
- traite `customer.subscription.created`
- traite `customer.subscription.updated`
- traite `customer.subscription.deleted`
- met à jour `tenants.stripe_subscription_id`
- met à jour `tenants.subscription_tier`
- met à jour `tenants.subscription_status`
- met à jour `tenants.subscription_current_period_ends_at`

Le mapping du niveau d'abonnement se fait d'abord via `price.metadata.app_tier`, puis via `lookup_key` en repli.

### `arbitrage_radar_poc.py`

Ce script :

- simule un historique de transactions multi-venues
- calcule une cote dynamique pondérée par qualité de venue
- calcule les prix exécutables nets
- détecte les anomalies inter-plateformes
- se connecte à Supabase avec `supabase-py`
- seed `assets`, `venues` et `asset_listings`
- transforme les anomalies retenues en lignes SQL compatibles avec `market_alerts`
- insère les alertes dans Supabase

Le périmètre simulé actuel porte sur :

- `ETH-USD`
- `SOL-USD`
- `ARB-USD`

## Variables d'environnement

### Pour les scripts Stripe

Créer un fichier `.env` local ou exporter les variables suivantes :

```env
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_CURRENCY=eur
STRIPE_PRICE_FREE_MONTHLY=0
STRIPE_PRICE_PRO_MONTHLY=4900
STRIPE_PRICE_ELITE_MONTHLY=19900

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

PORT=8080
HOST=0.0.0.0
```

Référence : `.env.billing.example`.

### Pour le POC Python

Variables minimales :

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Référence : `.env.supabase-poc.example`.

### Notes de sécurité

- `SUPABASE_SERVICE_ROLE_KEY` ne doit jamais être exposée côté client
- `STRIPE_SECRET_KEY` et `STRIPE_WEBHOOK_SECRET` doivent rester côté serveur
- les scripts présents dans ce dépôt sont pensés pour une exécution backend locale ou serveur, pas dans le navigateur

## Exécution locale

### 1. Appliquer le schéma Supabase

Ouvrir l'éditeur SQL de Supabase et exécuter :

- `supabase_schema.sql`

Ou, si vous préférez utiliser la copie livrée :

- `supabase_schema_ready.sql`

### 2. Installer les dépendances Python du POC

```bash
python -m pip install -r requirements-poc.txt
```

### 3. Exécuter le POC Python

Avec les variables `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` définies :

```bash
python arbitrage_radar_poc.py
```

Résultat attendu :

- seed du référentiel `assets`
- seed du référentiel `venues`
- seed des `asset_listings`
- insertion des alertes détectées dans `market_alerts`
- affichage console d'un résumé des opportunités retenues

### 4. Installer les dépendances Node pour Stripe

Il n'y a pas encore de `package.json` dans ce dépôt. À ce stade, l'installation se fait manuellement dans le dossier si vous souhaitez tester les scripts :

```bash
npm install stripe fastify @fastify/raw-body @supabase/supabase-js dotenv
```

### 5. Initialiser les produits et prix Stripe

```bash
node stripe_bootstrap_billing.mjs
```

Résultat attendu :

- création ou récupération des produits `Free`, `Pro`, `Elite`
- création ou récupération des prix mensuels
- sortie JSON contenant les IDs Stripe

### 6. Démarrer le webhook Stripe localement

```bash
node stripe_webhook_fastify.mjs
```

Le webhook expose :

```text
POST /webhooks/stripe
```

Il faut ensuite relayer les événements Stripe vers ce point d'entrée, par exemple avec le CLI Stripe si vous l'utilisez dans votre environnement local.

## Dépendances actuellement connues

### Python

Contenues dans `requirements-poc.txt` :

```text
numpy>=2.1
polars>=1.10
supabase>=2.7
```

### Node

Nécessaires aux scripts existants :

- `stripe`
- `fastify`
- `@fastify/raw-body`
- `@supabase/supabase-js`
- `dotenv`

## Limitations actuelles

- aucune interface web n'est encore implémentée dans ce dépôt
- aucun `package.json`, aucune app `Next.js` ni service `Fastify` complet n'ont encore été générés
- le webhook Stripe et le bootstrap sont livrés comme scripts autonomes
- le POC Python écrit dans `market_alerts`, mais ne gère pas encore l'attribution vers `tenant_alert_access`
- le contrôle RLS est documenté et modélisé, mais le test E2E avec tenants réels n'est pas encore documenté dans ce dépôt

## Prochaine étape naturelle

Quand le gel backend sera levé, la suite logique sera :

- générer le squelette `Next.js`
- exposer les routes applicatives de lecture sécurisée
- brancher la lecture d'alertes via RLS
- connecter l'interface de pricing et de provisioning Stripe

Pour l'instant, ce dépôt doit être considéré comme une base documentaire et technique de préparation, avec un schéma de données prêt, des scripts Stripe prêts à tester et un pipeline POC Python capable d'alimenter Supabase.
