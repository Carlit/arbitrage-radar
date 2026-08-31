# Wedge — Moteur de veille d'arbitrage (Spécification technique V1)

## 1. Contexte et vision

Wedge (nom de marque public ; nom de projet interne : Arbitrage Radar) n'est pas conçu comme un simple scanner de prix crypto, mais comme un **moteur de veille automatisé agnostique**, structuré autour d'une architecture multi-agents (SMA), destiné à transformer des scripts de scraping en micro-SaaS commercialisable. La crypto est le premier terrain d'application, choisi pour la disponibilité de données publiques et la liquidité des marchés — pas la finalité du produit.

Le différenciateur du produit face à la concurrence existante (ArbitrageScanner, Coinrule, ArbitraDAR, ArbitrageRadar PRO, ArbitRadar) n'est pas la couverture d'exchanges ni le prix, mais la **qualification** des écarts détectés : la V1 ne se contente pas de signaler un écart de prix, elle le filtre et le score avant de le remonter à l'utilisateur.

## 2. Logique de détection et scoring

### 2.1 Filtres et indicateurs (V1)

| Ordre | Critère | Rôle | Statut |
|---|---|---|---|
| 1 | Filtre de liquidité / volume minimal | Éliminer les spreads artificiels créés par des micro-ordres non exécutables (volume 24h + profondeur Top 3–10 du carnet) | Bloquant |
| 2 | Seuil de persistance temporelle | Filtrer les micro-spikes (~200 ms) déjà captés par les market makers ; ne garder que les écarts qui survivent sur plusieurs cycles | Bloquant |
| 3 | Moyennes mobiles (MM5 / MM20) | Qualité de confiance du signal, pas un filtre d'exclusion | Secondaire (Quality Score) |

### 2.2 Normalisation temporelle inter-sources

Les sources n'ont pas toutes la même fréquence de rafraîchissement (WebSocket ≈ 10 s, fallback REST ≈ 60 s). Comparer un écart entre deux sources sans en tenir compte fausse la mesure de persistance.

**Règle de calcul** : pour toute paire d'exchanges (A, B) impliqués dans un écart, le seuil de persistance appliqué est dynamique :

```
seuil_cycles = MAX(exchange_A.update_frequency_seconds, exchange_B.update_frequency_seconds)
persistance_validée = écart observé sur ≥ 2 à 3 cycles de seuil_cycles
```

Un écart entre deux sources WS (10 s) exige donc une persistance de 20–30 s ; un écart impliquant une source REST fallback (60 s) exige une persistance de 2–3 minutes. La fenêtre est toujours dictée par la source la plus lente de la paire.

## 3. Architecture d'ingestion

Deux voies d'ingestion coexistent, choisies par exchange selon la disponibilité d'un flux WebSocket public stable.

**Liste des exchanges V1 — décision figée** : Binance, Kraken, Coinbase Advanced et Bybit (toutes les quatre via WebSocket, aucun fallback REST nécessaire en V1). Bybit a été préféré à OKX pour ses limites de requêtes WebSocket plus permissives sur les comptes non-VIP, critère jugé décisif pour la stabilité continue du flux d'ingestion en MVP.

**Ingestion primaire — WebSocket (Binance, Kraken, Coinbase Advanced, Bybit)**
- Worker persistant (Node.js ou Python), hébergé hors Edge Functions (Fly.io, Railway, ou VPS dédié) — les Edge Functions Supabase sont stateless et ne peuvent pas maintenir une connexion WS ouverte en continu.
- Récupère un snapshot REST initial du carnet, puis applique les deltas poussés par le WS pour reconstruire l'état du Top 5–10 en mémoire (avec resync périodique en cas de désynchronisation détectée).
- `INSERT` par lots dans `raw_market_ticks` toutes les ~10 secondes.

**Ingestion secondaire — Fallback REST (exchanges sans WS public fiable)**
- Edge Functions Supabase, orchestrées par `pg_cron` à la minute.
- Interrogent l'endpoint `ticker` (Best Bid / Best Ask), couplé à un contrôle du volume échangé sur les 5 dernières minutes en absence de profondeur de carnet disponible.
- Non utilisée en V1 (les 4 exchanges retenus passent tous par WebSocket) — conservée dans le modèle pour une extension future.

**Détection et scoring**
- Procédures stockées PL/pgSQL, déclenchées de façon asynchrone par `pg_cron` — aucun appel HTTP synchrone, donc aucun risque de timeout lié au traitement de gros volumes de ticks.
- Filtrent le bruit (liquidité, persistance normalisée) et injectent les anomalies confirmées dans `market_alerts`.

**Rétention (TTL)**
- Tâche `pg_cron` quotidienne (ex. 03h00) : purge des lignes de `raw_market_ticks` de plus de 24–48h.
- `market_alerts` (signal qualifié) n'est pas concerné par cette purge — c'est la trace de valeur générée par le système, conservée indépendamment du bruit brut.

> **Décision figée** : les instances Supabase managées (Pro et gratuites) brident `pg_cron` à une fréquence minimale d'1 minute — impossible de descendre à 10-30 s via la syntaxe cron classique. En conséquence, `pg_cron` est réservé exclusivement à l'ingestion de secours (REST), au déclenchement du scoring (à la minute, sur les lots déjà insérés) et à la purge quotidienne (TTL). L'ingestion WebSocket est pilotée en dehors de `pg_cron`, par le worker persistant décrit ci-dessus.
>
> **Note de vérification (`/plan`)** : la documentation Supabase et l'inspection directe du projet hébergé `arbitrage-radar` (Postgres 17.6.1.166, `pg_cron` 1.6.4 disponible) indiquent que la syntaxe seconde (`'10 seconds'`) est en fait supportée depuis Postgres ≥ 15.1.1.61, y compris sur les instances managées. Cette correction factuelle ne remet pas en cause la décision opérationnelle ci-dessus : l'ingestion WS ne dépend de toute façon pas de `pg_cron`, et la précision de la mesure de persistance vient des timestamps `observed_at` des ticks (écrits toutes les ~10 s par le worker), pas de la cadence du job de scoring. Voir `plan.md` §3.

**Hébergement du worker WS — décision figée : Railway.** Déploiement continu direct depuis le dépôt Git (`Carlit/arbitrage-radar`), sans friction de configuration CLI (contrairement à Fly.io qui demanderait un `fly.toml` et un choix de régions pour un gain de performance non prioritaire en V1).

## 4. Modèle de données

| Table | Rôle |
|---|---|
| `app_users` | Profils utilisateurs (`user_id`) |
| `tenant_memberships` | Espaces de travail, rôles et accès applicatifs (multi-tenant) |
| `exchange_sources` | Référentiel des plateformes : `update_frequency_seconds`, type d'ingestion (`WS` / `REST`) |
| `raw_market_ticks` | Tampon de données brutes, lié à `exchange_sources` via `exchange_id`, purgé automatiquement (TTL) |
| `market_alerts` | Anomalies validées par le scoring — historique de la valeur produite, non purgé |

> **Tranché en `/plan`** : pas de table `exchange_sources` séparée — `public.venues` (existant) est étendu avec `update_frequency_seconds` et `ingestion_type`, et `raw_market_ticks` référence `asset_listings.id` plutôt qu'un `exchange_id` dédié. Détail et justification dans `plan.md` §1.1. Cette spec fige l'intention fonctionnelle de la ligne `exchange_sources` ci-dessus, pas le nom de table final.

## 5. Statut

- Vision produit, logique de scoring et architecture d'ingestion validées et figées dans cet échange.
- PoC existant : 13 opportunités déjà détectées, à rapprocher du nouveau modèle de scoring lors de la migration. Confirmé (`/plan`) : `arbitrage_radar_poc.py` est une simulation pure (venues et prix synthétiques, seed fixe) sans connexion aux exchanges réels — ces 13 lignes sont à traiter comme un historique legacy, pas comme des données à recalculer avec le nouveau scoring.
- Décisions arrêtées : granularité `pg_cron` (1 min, WS piloté hors cron), hébergement du worker (Railway), exchanges V1 (Binance, Kraken, Coinbase Advanced, Bybit).
- Prêt pour la phase plan/tasks côté implémentation.

## 6. Relation avec les chantiers existants

- **`stripe-billing`** (T1–T10 implémentés) reste inchangé : ce chantier ajoute une couche de collecte/scoring en amont de `market_alerts`, il ne touche ni au webhook Stripe, ni aux colonnes de facturation sur `tenants`, ni à la policy RLS `can_access_alert`. Cette dernière continue de s'appliquer telle quelle aux alertes produites par le nouveau moteur.
- Le modèle de données §4 réutilise `app_users` / `tenant_memberships` tels qu'existants, et `market_alerts` tel que déjà défini dans `supabase/migrations/20260830172129_initial_schema.sql` (colonnes `min_subscription_tier`, `status`, etc.) — pas de renommage de schéma prévu ici. Nouveau côté DB : extension de `venues` (2 colonnes) et création de `raw_market_ticks` — **pas** de table `exchange_sources` séparée (tranché en `/plan`, cf. §4).
