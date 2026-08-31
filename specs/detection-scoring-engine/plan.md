# Plan : Moteur de veille d'arbitrage (Détection & Scoring V1)

Statut : proposé — en attente de validation avant `/tasks` et `/implement`.
Référence : `spec.md` (besoin, figé après clarification).

## 0. Décisions actées (issues de `/clarify`)

1. **`pg_cron`** : réservé au scoring (1 min), au fallback REST (non utilisé en V1) et à la purge TTL quotidienne. L'ingestion WS ne dépend jamais de `pg_cron`.
   - Correction factuelle sans impact opérationnel (cf. `spec.md` §3) : `pg_cron` 1.6.4, disponible sur le projet hébergé `arbitrage-radar` (Postgres 17.6.1.166), supporte en réalité la syntaxe seconde depuis PG ≥ 15.1.1.61. Non exploité ici car inutile : la précision de la persistance vient des timestamps `observed_at` des ticks, pas de la cadence du job de scoring (détail en §3 ci-dessous).
2. **Hébergement worker WS** : Railway, déploiement continu depuis `Carlit/arbitrage-radar` (= ce dépôt — confirmé via `git remote -v`).
3. **Exchanges V1** : Binance, Kraken, Coinbase Advanced, Bybit — 100% WebSocket, aucun fallback REST en V1.
4. **Langage du worker** : **Node.js** — confirmé en revue de ce plan. Même runtime que `web/` (Next.js/TS) et les scripts racine (`.mjs`), écosystème de clients WS mûr pour Binance/Kraken/Coinbase/Bybit.
5. **Référentiel des exchanges** : **extension de `venues`** (pas de `exchange_sources` séparée) — confirmé en revue de ce plan. Détail en §1.1.

## 1. Modèle de données

### 1.1 Écart entre le nom des tables de la spec et le schéma existant (tranché — confirmé en revue)

`spec.md` §4 nomme une nouvelle table `exchange_sources`. Le schéma existant a déjà `public.venues` (id, code, name, venue_type, country_code, is_active) qui représente exactement le même concept — un exchange/une plateforme. Créer `exchange_sources` en parallèle dupliquerait la notion d'« exchange » sous deux identités différentes et forcerait soit un mapping manuel entre les deux, soit deux référentiels divergents dans le temps.

**Décision** : pas de `exchange_sources`. `public.venues` est étendu avec les deux colonnes que la spec attend :
```sql
alter table public.venues
  add column update_frequency_seconds integer,
  add column ingestion_type text check (ingestion_type in ('WS', 'REST'));
```
`raw_market_ticks` référence alors `asset_listing_id` (→ `public.asset_listings.id`), qui porte déjà la paire (asset, venue) — pas un `exchange_id` + `asset_id` séparés. C'est cohérent avec le reste du schéma (`market_alerts.buy_listing_id` / `sell_listing_id` référencent déjà `asset_listings`), et évite d'introduire une deuxième façon de désigner « quel exchange, pour quel asset ».

`spec.md` §4 est annoté en conséquence pour ne pas rester en contradiction avec cette décision.

### 1.2 Migrations proposées

- **Extension de `venues`** (colonnes ci-dessus) + seed des 4 exchanges V1 :
  ```sql
  insert into public.venues (code, name, venue_type, update_frequency_seconds, ingestion_type)
  values
    ('binance', 'Binance', 'exchange', 10, 'WS'),
    ('kraken', 'Kraken', 'exchange', 10, 'WS'),
    ('coinbase_advanced', 'Coinbase Advanced', 'exchange', 10, 'WS'),
    ('bybit', 'Bybit', 'exchange', 10, 'WS')
  on conflict (code) do update set update_frequency_seconds = excluded.update_frequency_seconds, ingestion_type = excluded.ingestion_type;
  ```
  Les venues PoC existantes (`alpha_ex`, `beta_flow`, `gamma_book`, `delta_swap`) restent en base (`is_active` reste `true` pour l'instant) — leur désactivation est traitée en §6, pas dans cette migration.
- **`raw_market_ticks`** :
  ```sql
  create table public.raw_market_ticks (
    id bigint generated always as identity primary key,
    asset_listing_id uuid not null references public.asset_listings(id) on delete cascade,
    best_bid numeric(20,8) not null,
    best_ask numeric(20,8) not null,
    bid_depth_top numeric(20,8),
    ask_depth_top numeric(20,8),
    volume_24h numeric(24,8),
    observed_at timestamptz not null default timezone('utc', now()),
    created_at timestamptz not null default timezone('utc', now())
  );

  create index idx_raw_market_ticks_listing_observed_at
    on public.raw_market_ticks(asset_listing_id, observed_at desc);
  ```
  `id bigint identity` plutôt que `uuid` : volume élevé, purgé sous 24-48h, aucune référence externe entrante — un identifiant compact suffit et coûte moins cher en index.
- **Asset listings** pour les 4 exchanges × paires suivies : réutiliser `public.assets` / `public.asset_listings` existants (déjà `unique(asset_id, venue_id)`), ajouter les lignes manquantes pour les paires réellement suivies en V1 (liste précise = tâche `/tasks`, dépend des paires que le worker doit écouter — pas encore définie dans la spec, à confirmer avant l'implémentation du worker).

### 1.3 RLS et isolation multi-tenant (obligatoire — constitution §Sécurité)

- `venues` : RLS déjà active, policy `venues_select_authenticated` (`using (true)`) déjà en place — aucune modification nécessaire, les 2 nouvelles colonnes sont couvertes par la policy existante.
- `raw_market_ticks` : **RLS activée, aucune policy de lecture**. C'est un tampon interne — seul le worker (Service Role Key) y écrit, et seule la procédure de scoring (exécutée par `pg_cron`, propriétaire de la table donc hors RLS) le lit. Aucun tenant, aucun utilisateur authentifié n'a de raison d'y accéder directement. Refus par défaut = comportement voulu, pas un oubli.
- `market_alerts` / `tenant_alert_access` : schéma et policies **inchangés** (hors périmètre, cf. `spec.md` §6). Le nouveau moteur alimente `market_alerts` par les mêmes colonnes que l'ancien pipeline (`buy_listing_id`, `sell_listing_id`, `min_subscription_tier`, etc.) — `can_access_alert` continue de s'appliquer sans modification.
- **Isolation multi-tenant** : `venues`, `asset_listings`, `raw_market_ticks` et `market_alerts` sont un référentiel de marché **global**, non scopé par tenant — exactement le même statut que le schéma existant (`asset_listings` est déjà partagé entre tous les tenants). Le scoping par tenant reste exclusivement porté par `tenant_alert_access`, qui n'est pas touché par ce chantier. Rien de nouveau ici ne contourne l'isolation multi-tenant : il n'y a pas de notion de tenant à ce niveau, avant `market_alerts`.

## 2. Ingestion — Worker WS persistant

- **Stack** : Node.js (voir §0.4), déployé sur Railway depuis ce dépôt (sous-dossier proposé : `worker/`, sibling de `web/`).
- **Authentification vers Supabase** : Service Role Key, exactement le pattern déjà sanctionné par `memory/constitution.md` (« La Service Role Key est réservée aux scripts serveur ponctuels, ex : le pipeline Python d'insertion ») — ici un script serveur persistant plutôt que ponctuel, mais même nature : aucune session utilisateur, écriture dans un tampon technique non exposé (`raw_market_ticks`), pas de contournement d'une requête utilisateur.
- **Connexions WS** : un client WS par exchange (Binance, Kraken, Coinbase Advanced, Bybit), flux publics de carnet d'ordres — **aucune clé API exchange requise** pour des données de marché publiques (ticker/order book), donc le worker ne détient qu'un seul secret sensible (`SUPABASE_SERVICE_ROLE_KEY`).
- **Reconstruction du carnet** : snapshot REST initial (Top 5–10) puis application des deltas WS ; resync périodique (ex. toutes les 5–10 min ou sur détection de désynchronisation via checksum/sequence number, selon ce que chaque exchange expose).
- **Écriture** : `INSERT` par lots dans `raw_market_ticks` toutes les ~10 s (un batch par exchange ou un batch global — détail d'implémentation en `/tasks`).
- **Résilience** : reconnexion automatique avec backoff sur perte de connexion WS ; le worker doit survivre à la perte d'un exchange sans interrompre les 3 autres (isolation par connexion, pas un seul point de défaillance global).
- **Déploiement Railway** : build/déploiement continu depuis la branche principale du monorepo, avec un root directory pointé sur `worker/`. Configuration exacte (Nixpacks vs Dockerfile, variables d'env sur Railway) à détailler en `/tasks` — pas de compte/projet Railway encore vérifié dans cette session, à confirmer par toi.

## 3. Détection et scoring (PL/pgSQL, déclenché par `pg_cron`)

- **Cadence du job** : 1 fois par minute (`pg_cron`), conformément à la décision figée §0.1.
- **Pourquoi 1 min n'affaiblit pas la précision de persistance** : le seuil de persistance (§2.2 de la spec) se calcule en comparant les timestamps `observed_at` des lignes de `raw_market_ticks` déjà écrites par le worker toutes les ~10 s — pas en comptant les exécutions du job de scoring. À chaque exécution (toutes les 60 s), la procédure dispose d'environ 6 ticks récents par exchange et peut évaluer si un écart a persisté ≥ 20–30 s (paire WS/WS — le seul cas en V1, tous les exchanges étant WS) en filtrant sur `observed_at`. Le seul coût réel du cadencement à 1 min est jusqu'à ~50 s de latence supplémentaire avant que le job ne *remonte* un signal déjà qualifié — pas une perte de précision sur la mesure elle-même.
- **Fonctions/procédures à créer** (mêmes conventions que les fonctions de sécurité existantes — `language sql stable` ou `plpgsql`, pas de `security definer` nécessaire ici car pas de RLS à contourner en écriture propriétaire) :
  - Filtre liquidité : seuil de volume 24h + profondeur Top 3–10 minimale (valeurs seuils à définir en `/tasks`, probablement configurables plutôt que codées en dur).
  - Filtre persistance : implémente `seuil_cycles = MAX(update_frequency_seconds A, B)` et `persistance_validée = écart observé sur ≥ 2–3 cycles`, sur la fenêtre `observed_at`.
  - Quality Score (MM5/MM20) : calcul de moyennes mobiles sur `raw_market_ticks`, alimente un score de confiance (nouvelle colonne sur `market_alerts` ou dans `payload jsonb` existant — `payload` est déjà prévu à cet effet dans le schéma actuel, pas de migration nécessaire pour ça).
  - Insertion finale dans `market_alerts` avec les colonnes existantes (`buy_listing_id`, `sell_listing_id`, `fair_price`, `buy_price`, `sell_price`, `gross_edge_bps`, `net_edge_bps`, `net_edge_pct`, `confidence_score`, `liquidity_score`, `observed_at`) — pas de nouvelle colonne obligatoire pour la V1 du scoring décrite dans la spec.
- **Trigger** : `select cron.schedule('score-market-alerts', '* * * * *', 'call public.run_market_scoring()');` (nom de procédure indicatif).

## 4. Rétention (TTL)

```sql
select cron.schedule(
  'purge-raw-market-ticks',
  '0 3 * * *',
  $$ delete from public.raw_market_ticks where observed_at < now() - interval '48 hours' $$
);
```
`market_alerts` non concerné, conformément à la spec.

## 5. Legacy — PoC de simulation

- `arbitrage_radar_poc.py` génère des venues et des prix **synthétiques** (seed fixe, pas de connexion aux exchanges réels) — confirmé par lecture du script. Les 13 `market_alerts` existantes qu'il a produites sont un historique de démonstration, pas des données à recalculer avec le nouveau scoring.
- **Ne pas supprimer immédiatement** (même prudence que pour `stripe_webhook_fastify.mjs` dans le chantier `stripe-billing`) : le script et les venues PoC (`alpha_ex`, `beta_flow`, `gamma_book`, `delta_swap`, déjà en base locale) restent en place jusqu'à ce que le nouveau pipeline soit validé en conditions réelles. Une tâche de nettoyage explicite (désactiver ces venues via `is_active = false`, archiver ou retirer le script) sera ajoutée en fin de `tasks.md`, sur le même modèle que T11 côté Stripe.

## 6. Risques / dette explicitement signalée

- **Nom de table `exchange_sources` vs extension de `venues`** (§1.1) : déviation assumée par rapport au texte littéral de `spec.md` §4, confirmée en revue de ce plan.
- **Choix Node.js pour le worker** (§0.4) : confirmé en revue de ce plan — engage la structure du dépôt (`worker/`).
- **Paires d'actifs précises à suivre par exchange** : la spec fige la liste des 4 exchanges, pas la liste des paires (BTC-USD, ETH-USD, etc.) ni leur mapping vers `asset_listings`. À trancher avant l'implémentation du worker — sinon le worker n'a rien de concret à écouter.
- **Config Railway** : aucun projet Railway encore vérifié dans cette session (pas d'accès outillé équivalent au MCP Supabase) — le détail de déploiement (root dir, variables d'env, health checks) reste à confirmer manuellement par toi lors de `/tasks`/`/implement`.
- **Seuils de liquidité concrets** (volume minimal, profondeur minimale) non chiffrés dans la spec — à définir en `/tasks`, probablement en configuration plutôt qu'en dur dans le PL/pgSQL, pour pouvoir les ajuster sans nouvelle migration.
