# Tâches : Moteur de veille d'arbitrage (Détection & Scoring V1)

Statut : à implémenter. Référence : `spec.md` (besoin, figé), `plan.md` (architecture, validée
sur les 2 points ouverts : extension de `venues`, worker en Node.js).
Ordre d'exécution = ordre de la liste, sauf mention contraire. Ne pas lancer `/implement`
avant validation de ce fichier (même rythme que le chantier `stripe-billing`).

## T1 — Migration : extension de `venues` + seed des 4 exchanges V1
- `alter table public.venues add column update_frequency_seconds integer, add column ingestion_type text check (ingestion_type in ('WS','REST'));`
- Seed (upsert par `code`) : `binance`, `kraken`, `coinbase_advanced`, `bybit`, tous
  `update_frequency_seconds = 10`, `ingestion_type = 'WS'`.
- Ne touche pas aux venues PoC existantes (`alpha_ex`, `beta_flow`, `gamma_book`,
  `delta_swap`) — traitées en T16.
- **Test** : `select code, update_frequency_seconds, ingestion_type from venues where code in ('binance','kraken','coinbase_advanced','bybit');` → 4 lignes, valeurs correctes. Policy
  `venues_select_authenticated` déjà en place, pas de modification RLS nécessaire ici.

## T2 — Migration : `raw_market_ticks`
- Table + index tels que décrits en `plan.md` §1.2 (`asset_listing_id` → `asset_listings.id`,
  `id bigint generated always as identity`).
- `alter table public.raw_market_ticks enable row level security;` — **aucune policy créée**
  (refus par défaut voulu, cf. `plan.md` §1.3).
- **Test** : en tant qu'utilisateur authentifié (clé anon + session), `select * from
  raw_market_ticks limit 1;` → 0 ligne retournée (RLS bloque, pas d'erreur). En Service Role,
  un insert de test réussit.

## T3 — Asset listings pour les paires V1 (⚠️ liste à confirmer)
- **Proposition par défaut** (à valider, pas encore confirmée par toi) : réutiliser les 3
  assets déjà en base (`ETH-USD`, `SOL-USD`, `ARB-USD` — hérités du PoC mais ce sont de vraies
  paires cotées sur Binance/Coinbase Advanced/Bybit ; à vérifier au cas par cas si Kraken les
  liste toutes) et créer les lignes `asset_listings` manquantes pour chacun des 4 exchanges V1.
- Sans confirmation explicite de la liste de paires, cette tâche reste **bloquante** pour T5
  (le worker a besoin d'une liste concrète à écouter) — à trancher avant `/implement`, pas
  une simple préférence d'implémentation.
- **Test** : `select count(*) from asset_listings al join venues v on v.id = al.venue_id where v.code in ('binance','kraken','coinbase_advanced','bybit');` → correspond au nombre
  (paires × exchanges qui les listent réellement).

## T4 — Scaffold worker Node.js (`worker/`)
- Nouveau dossier `worker/` à la racine du monorepo (sibling de `web/`), `package.json`
  dédié (pas de dépendance vers `web/`).
- Dépendances : `@supabase/supabase-js`, clients WS par exchange (à choisir en `/implement` —
  ex. `ws` brut + implémentation des protocoles Binance/Kraken/Coinbase Advanced/Bybit, ou
  librairies dédiées si elles existent et sont maintenues).
- Variables d'environnement : `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` uniquement — aucune
  clé d'API exchange nécessaire (flux publics).
- **Test** : `npm install` sans erreur, script `start` qui boot sans crash (même sans logique
  métier encore branchée).

## T5 — Client WS + reconstruction du carnet, par exchange
- Un module par exchange (`worker/src/exchanges/{binance,kraken,coinbase-advanced,bybit}.ts`
  ou équivalent), interface commune (snapshot REST initial + application des deltas WS →
  état Top 5–10 en mémoire).
- Dépend de T3 (liste de paires confirmée) pour savoir quoi souscrire.
- **Test** : en local, connexion réelle à chaque exchange (flux public, pas de clé requise),
  vérifier que le Top 5 reconstruit correspond à ce que l'UI publique de l'exchange affiche
  pour la même paire au même instant (contrôle manuel, à faire une fois par exchange).

## T6 — Écriture par lots dans `raw_market_ticks`
- Toutes les ~10 s, `INSERT` en lot (un ou plusieurs batchs) via le client Service Role.
- **Test** : après quelques minutes de run local, `select count(*), min(observed_at), max(observed_at) from raw_market_ticks;` → volume et espacement temporel cohérents avec un
  insert toutes les ~10 s par exchange/paire suivie.
- Dépend de T2, T5.

## T7 — Résilience : reconnexion et isolation par connexion
- Backoff exponentiel sur perte de connexion WS, par exchange indépendamment (la perte d'un
  flux ne doit pas interrompre les 3 autres).
- **Test** : couper artificiellement une connexion (ex. bloquer le endpoint le temps du test)
  → le worker continue d'écrire pour les 3 autres exchanges, puis reprend l'écriture pour le
  4ème après reconnexion, sans redémarrage du process.

## T8 — Déploiement Railway
- Nouveau service Railway, déploiement continu depuis `Carlit/arbitrage-radar`, root
  directory `worker/`.
- Variables d'environnement configurées côté Railway (`SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`) — jamais commitées.
- **Test** : déploiement réussi, logs Railway montrant des inserts réguliers dans
  `raw_market_ticks` (vérifiable via Supabase).
- **Statut attendu à la revue** : aucun projet Railway encore vérifié dans cette session — à
  faire par toi ou en `/implement` avec accès à ton compte Railway.

## T9 — PL/pgSQL : filtre de liquidité
- Fonction évaluant volume 24h + profondeur Top 3–10 minimale (seuils configurables, pas codés
  en dur — table de config ou paramètres de la fonction, détail à trancher en `/implement`).
- **Test** : jeu de ticks de test avec un volume artificiellement bas → filtre rejette ;
  volume suffisant → filtre laisse passer.

## T10 — PL/pgSQL : filtre de persistance (seuil dynamique)
- Implémente `seuil_cycles = MAX(update_frequency_seconds A, B)` et `persistance_validée`
  sur la fenêtre `observed_at` (cf. `plan.md` §3 — la précision vient des timestamps des
  ticks, pas de la cadence du job).
- **Test** : écart simulé qui disparaît après 10 s → rejeté (micro-spike) ; écart simulé qui
  persiste 25 s entre deux sources WS → validé.
- Dépend de T6 (il faut des ticks réels/simulés en base pour tester).

## T11 — PL/pgSQL : Quality Score (MM5/MM20)
- Calcul de moyennes mobiles sur `raw_market_ticks`, alimente le score de confiance —
  stocké dans `market_alerts.confidence_score` (colonne déjà existante) ou détail additionnel
  dans `market_alerts.payload` (jsonb déjà existant, pas de migration nécessaire).
- **Test** : vérifier que `confidence_score` varie de façon cohérente selon la stabilité
  simulée des prix en amont (signal stable → score plus haut).

## T12 — PL/pgSQL : procédure d'orchestration `run_market_scoring()`
- Enchaîne T9 → T10 → T11, insère les anomalies confirmées dans `market_alerts` avec les
  colonnes existantes (`buy_listing_id`, `sell_listing_id`, `fair_price`, `buy_price`,
  `sell_price`, `gross_edge_bps`, `net_edge_bps`, `net_edge_pct`, `confidence_score`,
  `liquidity_score`, `observed_at`).
- **Ne crée aucune nouvelle colonne sur `market_alerts`** — si un besoin apparaît en cours
  d'implémentation, le signaler explicitement plutôt que d'élargir le schéma silencieusement
  (cf. constitution, principe « pas de contournement silencieux »).
- **Test** : exécution manuelle (`call public.run_market_scoring();`) sur un jeu de ticks
  préparé → ligne `market_alerts` correcte créée, visible via `can_access_alert` pour un
  tenant entitled (même test que T10 côté `stripe-billing`, réutilisable).
- Dépend de T9, T10, T11.

## T13 — `pg_cron` : activation + job de scoring (1 min)
- Activer l'extension sur le projet hébergé (`installed_version` actuellement `null` sur
  `arbitrage-radar`, vérifié via l'outillage Supabase — l'extension est disponible mais pas
  encore installée) : `create extension if not exists pg_cron;` (migration dédiée).
- `select cron.schedule('score-market-alerts', '* * * * *', 'call public.run_market_scoring()');`
- **Test** : job visible dans `cron.job`, `cron.job_run_details` montre des exécutions
  réussies toutes les minutes après activation.
- Dépend de T12.

## T14 — `pg_cron` : purge TTL quotidienne
- `select cron.schedule('purge-raw-market-ticks', '0 3 * * *', $$ delete from public.raw_market_ticks where observed_at < now() - interval '48 hours' $$);`
- **Test** : insérer manuellement une ligne avec `observed_at` > 48h dans le passé, déclencher
  le job manuellement (`select cron.schedule_in_database(...)` ou exécution directe de la
  requête), vérifier sa suppression ; une ligne récente n'est pas supprimée.
- `market_alerts` non concerné — vérifier qu'aucune requête de purge ne le touche.

## T15 — Validation end-to-end
- Avec le worker qui tourne (local ou Railway) et le scoring actif : provoquer ou attendre un
  écart réel qualifié entre deux des 4 exchanges → vérifier son apparition dans
  `market_alerts`, puis sa visibilité côté tenant `pro`/`active` via `can_access_alert`
  (RLS **inchangée**, même test que T10 côté `stripe-billing`).
- Dépend de T13.

## T16 — Nettoyage du PoC de simulation
- Désactiver les venues PoC (`alpha_ex`, `beta_flow`, `gamma_book`, `delta_swap`) :
  `is_active = false` plutôt que suppression — elles restent référencées par les 13
  `market_alerts` historiques (pas de `on delete cascade` à déclencher involontairement).
- Documenter `arbitrage_radar_poc.py` comme script legacy (commentaire en tête de fichier ou
  déplacement vers un dossier `legacy/`) — **ne pas le supprimer** avant que T15 soit validé
  en conditions réelles, même logique que T11 côté `stripe-billing` pour `stripe_webhook_fastify.mjs`.
- **Test** : les 13 `market_alerts` historiques restent lisibles (pas de cascade de
  suppression), les nouvelles alertes produites par T12 utilisent exclusivement les 4 venues
  réelles.

## T17 — Mise à jour du statut de la spec
- Après implémentation complète (T1–T16), mettre à jour `spec.md` §5 avec le statut réel,
  conformément à `.trae/rules/project_rules.md`.

---

## Suivi explicite (hors périmètre V1 — tracé, pas fusionné silencieusement)

## T18 — [FOLLOW-UP] Ingestion fallback REST
- Aucun exchange V1 ne nécessite le fallback REST (les 4 sont 100% WS). L'infrastructure est
  prête côté modèle de données (`venues.ingestion_type = 'REST'` possible, `raw_market_ticks`
  n'est pas structurellement limité au WS), mais aucune Edge Function de fallback n'est
  implémentée dans ce chantier. À spécifier séparément si un 5ème exchange sans WS fiable
  devient nécessaire.
