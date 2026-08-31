# Tâches : Intégration Stripe (Abonnements & Paiements)

Statut : T1–T10 implémentées et vérifiées en local (Supabase local stack + requêtes REST
simulant les payloads Stripe). T11–T13 restent à faire — voir statuts par tâche ci-dessous.
Référence : `spec.md` (besoin), `plan.md` (architecture validée).
Ordre d'exécution = ordre de la liste ; ne pas paralléliser T3+ tant que T1/T2 ne sont pas
posées (le webhook dépend du client Service Role dédié et du nouveau comportement DB).

## T1 — Migration DB : `stripe_customer_id` nullable + fix `handle_new_user()`
- Créer `supabase/migrations/<timestamp>_make_stripe_customer_id_nullable.sql`.
- Contenu :
  - `alter table public.tenants alter column stripe_customer_id drop not null;`
  - `create or replace function public.handle_new_user()` : retirer le placeholder
    `'cus_pending_' || new.id` de l'`insert into public.tenants`, ne plus fournir de valeur
    pour `stripe_customer_id` (donc `null`).
- **Test** : créer un nouvel utilisateur (signup) en local/staging → vérifier que le tenant
  créé a `stripe_customer_id IS NULL` (et non plus un placeholder `cus_pending_*`).
- **Ne pas** toucher aux policies RLS existantes (hors périmètre, cf. spec §4).
- **Statut : ✅ fait.** Migration `20260830190718_make_stripe_customer_id_nullable.sql`
  appliquée sur le stack Supabase local (`supabase migration up --local`). Vérifié via un
  signup réel (`/auth/v1/signup`) : le tenant créé a `stripe_customer_id = null`,
  `subscription_tier = free`, `subscription_status = trialing` — plus de placeholder
  `cus_pending_*`.

## T2 — Client Supabase Service Role dédié au webhook
- Créer `web/lib/supabase/service-role.ts` (nom distinct et explicite), **séparé** de
  `web/lib/supabase/server.ts`.
- Ce fichier exporte une factory (ex. `createServiceRoleClient()`) qui instancie
  `createClient(url, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false,
  persistSession: false } })`.
- Ne jamais importer ce fichier depuis un composant, une Server Action, ou une route qui sert
  des requêtes utilisateur authentifiées — uniquement depuis des handlers server-to-server
  vérifiés par ailleurs (ici : le webhook Stripe une fois sa signature validée).
- **Test** : revue de code / grep — aucun import de `service-role.ts` en dehors de
  `web/app/api/webhook/stripe/route.ts` à l'issue de ce chantier.
- **Statut : ✅ fait.** `web/lib/supabase/service-role.ts` créé, distinct de `server.ts`,
  utilisé uniquement dans la route webhook.

## T3 — Dépendance `stripe` côté `web/`
- Ajouter `stripe` à `web/package.json` (même génération d'API version que le script racine
  pour rester cohérent : `2026-07-29.dahlia`, à réaligner si Stripe en impose une autre au
  moment de l'implémentation).
- **Test** : `npm install` dans `web/` sans erreur, `import Stripe from 'stripe'` type-check.
- **Statut : ✅ fait.** `stripe@^22.6.0` installé. Écart noté avec les scripts racine : le SDK
  installé pin le literal type `apiVersion: "2026-08-26.dahlia"` (vs `2026-07-29.dahlia` dans
  `stripe_bootstrap_billing.mjs` / `stripe_webhook_fastify.mjs`, sur une version de `stripe`
  plus ancienne). Utilisé tel quel dans la route (`tsc --noEmit` passe sans erreur) — à
  vérifier côté compte Stripe réel que cette version d'API n'entraîne pas de changement de
  forme sur les objets `Subscription`/`Price` consommés.

## T4 — Variables d'environnement `web/`
- Documenter dans `web/.env.local.example` (ou équivalent) : `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`.
- Vérifier que `SUPABASE_SERVICE_ROLE_KEY` n'est référencée que côté serveur (jamais un
  préfixe `NEXT_PUBLIC_`).
- **Test** : `grep -R "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE"` ne retourne rien.
- **Statut : ✅ fait.** `web/.env.local.example` créé avec le commentaire explicite « Ne
  jamais préfixer NEXT_PUBLIC_ ». `web/.env.local` local complété avec les 3 clés vides
  (valeurs réelles à renseigner par le développeur — non commitées, `.env*` est gitignored).

## T5 — Webhook route : vérification de signature + dispatch
- Créer `web/app/api/webhook/stripe/route.ts`, `export const runtime = 'nodejs'`.
- `POST` : lire `await request.text()`, vérifier `stripe.webhooks.constructEvent(rawBody,
  signature, STRIPE_WEBHOOK_SECRET)`. Signature absente/invalide → `400`, aucun accès DB.
- **Test** : requête sans header `stripe-signature` → `400` ; requête avec signature falsifiée
  → `400`. Aucune ligne modifiée dans `tenants` dans les deux cas.
- **Statut : ⚠️ code fait, test HTTP réel non exécuté.** `web/app/api/webhook/stripe/route.ts`
  créé, `tsc --noEmit` passe. Pas de clés Stripe test disponibles dans cet environnement pour
  démarrer `next dev` + `stripe listen` et vérifier le rejet 400 en conditions réelles — à
  faire par le développeur avec ses clés Stripe test avant de considérer T5 pleinement validé.

## T6 — Webhook : `checkout.session.completed` (lien tenant ↔ customer)
- Dans le même handler, sur `checkout.session.completed` : lire
  `session.client_reference_id` (= `tenant_id`) et `session.customer` ; `UPDATE tenants SET
  stripe_customer_id = :customerId WHERE id = :tenantId AND stripe_customer_id IS NULL`
  (condition idempotente : ne pas écraser un `stripe_customer_id` déjà posé).
- Si `client_reference_id` absent ou tenant introuvable → logguer, retourner `200` sans
  planter (événement non exploitable, ne pas faire boucler Stripe indéfiniment sur un cas
  qui ne se résoudra jamais côté DB).
- **Test** : simuler l'event via Stripe CLI (`stripe trigger checkout.session.completed`,
  payload ajusté avec un `client_reference_id` réel) → `tenants.stripe_customer_id` se
  remplit pour le bon tenant, autres tenants inchangés.
- Dépend de T1 (colonne nullable), T2 (client service role) et T5 (route/handler existant).
- **Statut : ✅ logique DB vérifiée.** Code écrit dans la route. Logique de mise à jour
  rejouée directement sur le stack Supabase local (update conditionnel
  `WHERE stripe_customer_id IS NULL`) : premier appel remplit `stripe_customer_id`, un rejeu
  avec un customer différent est bien un no-op (idempotence confirmée). Reste à exercer via
  un vrai event Stripe signé (`stripe trigger`) une fois des clés test disponibles.

## T7 — Webhook : `customer.subscription.created` / `.updated`
- Porter `extractTierFromSubscription`, `normalizeStripeStatus`, `toIsoTimestamp` depuis
  `stripe_webhook_fastify.mjs` (logique inchangée, priorité à `price.metadata.app_tier`).
- `UPDATE tenants SET stripe_subscription_id, subscription_tier, subscription_status,
  subscription_current_period_ends_at WHERE stripe_customer_id = :customerId`.
- Tenant introuvable (`stripe_customer_id` ne matche rien, ex. T6 pas encore passé) → logguer
  et retourner `500` pour que Stripe retente (le retry laisse une chance à
  `checkout.session.completed` d'arriver/être rejoué avant).
- **Test** : abonnement `pro` créé pour un customer déjà lié (post-T6) → tier/status/
  `stripe_subscription_id` corrects en DB. Changement de Price vers `elite` → `.updated` met
  à jour le tier.
- Dépend de T6.
- **Statut : ✅ logique DB vérifiée.** Update rejoué directement (tier `pro`, statut `active`,
  `subscription_current_period_ends_at` renseigné) sur le tenant lié en T6 → confirmé en DB.
  Reste à exercer via un vrai event Stripe signé.

## T8 — Webhook : `customer.subscription.deleted`
- Force `subscription_tier=free`, `subscription_status=canceled`,
  `stripe_subscription_id=null` (garder `stripe_customer_id` intact — le customer existe
  toujours côté Stripe).
- **Test** : annulation simulée → tenant repasse à `free`/`canceled`, `stripe_customer_id`
  inchangé.
- Dépend de T7.
- **Statut : ✅ logique DB vérifiée.** Update rejoué (tier `free`, statut `canceled`,
  `stripe_subscription_id = null`) → confirmé en DB, `stripe_customer_id` intact. Reste à
  exercer via un vrai event Stripe signé.

## T9 — Webhook : événements non gérés
- `default` → `200 { received: true }`, log info, aucune écriture.
- **Test** : envoyer un event Stripe hors liste (ex. `invoice.paid`) → `200`, aucune requête
  DB déclenchée (vérifiable via logs).
- **Statut : ⚠️ code fait (relecture), test HTTP réel non exécuté** — même limite que T5
  (pas de clés Stripe test dans cet environnement).

## T10 — Vérification bout-en-bout de la policy RLS `can_access_alert`
- Avec un utilisateur authentifié membre d'un tenant passé `pro` via T7 : requêter les
  `market_alerts` avec `min_subscription_tier = 'pro'` → accès accordé.
- Repasser le tenant à `free` via T8 → même requête → accès refusé.
- **Test** : ce sont des requêtes RLS réelles (clé anon + session utilisateur), pas Service
  Role — confirme que la policy existante (non modifiée, cf. spec §4) réagit correctement aux
  colonnes mises à jour par le webhook.
- Ne modifie aucune policy — validation uniquement.
- **Statut : ✅ fait.** Testé de bout en bout sur le stack local : utilisateur authentifié
  (signup réel + `/auth/v1/token`), alerte de test `min_subscription_tier=pro` +
  `tenant_alert_access`. Tenant `pro`/`active` → l'alerte apparaît dans `GET
  /rest/v1/market_alerts`. Même requête après passage `free`/`canceled` → tableau vide.
  Confirme que `can_access_alert` réagit correctement aux colonnes mises à jour par le
  webhook, sans aucune modification de policy. Données de test nettoyées après coup (l'alerte
  et son accès ; le tenant/user de test restent en base locale — `created_by` est en
  `ON DELETE RESTRICT`, suppression volontairement non forcée).

## T11 — Nettoyage : suppression du serveur Fastify
- **Bloqué tant que T5–T10 ne sont pas validés** en local (Stripe CLI) et idéalement un cycle
  de staging.
- Supprimer `stripe_webhook_fastify.mjs`.
- Retirer `fastify` / `@fastify/raw-body` du `package.json` racine si aucun autre script ne
  les utilise (vérifier avant suppression).
- Nettoyer `.env.billing` : retirer `PORT`/`HOST` (n'ont plus d'usage), garder
  `STRIPE_SECRET_KEY`, `STRIPE_CURRENCY`, `STRIPE_PRICE_*` pour `stripe_bootstrap_billing.mjs`.
- **Test** : `stripe_bootstrap_billing.mjs` s'exécute toujours correctement après nettoyage de
  `.env.billing`.
- **Statut : 🚫 non fait, volontairement bloquée.** T5–T9 n'ont été validées qu'au niveau
  logique DB (payloads Stripe simulés directement sur les tables), pas via un vrai event
  Stripe signé (`stripe listen` / `stripe trigger`), faute de clés Stripe test dans cet
  environnement. Supprimer Fastify maintenant serait prématuré — à faire par le développeur
  une fois ce test réel passé.

## T12 — Mise à jour du statut de la spec
- Après implémentation complète (T1–T11), mettre à jour `spec.md` avec le statut réel
  (fait / partiellement fait / reste à faire), conformément à la règle du projet
  (`.trae/rules/project_rules.md`).
- **Statut : ✅ fait (partiellement, cf. T11 non terminée)** — `spec.md` mis à jour avec un
  statut réel reflétant que la synchro est codée et vérifiée en logique DB, mais pas encore
  testée via un vrai webhook Stripe signé, et que Fastify n'est pas encore retiré.

---

## Suivi explicite (hors périmètre de ce chantier — ne pas fusionner sans cette tâche tracée)

## T13 — [FOLLOW-UP, autre chantier] Route de création de Checkout Session
- Créer une route (ex. `web/app/api/billing/checkout/route.ts`) + un point d'entrée UI
  ("s'abonner") qui crée une Stripe Checkout Session avec `client_reference_id = tenant_id`
  et redirige l'utilisateur vers `session.url`.
- Sans cette tâche, T6 ne sera jamais déclenché en usage réel : le webhook sera correct mais
  personne ne pourra effectivement lier son tenant à un customer Stripe depuis l'app.
- À spécifier via un `/specify` dédié (choix UX : où proposer l'abonnement, gestion des tiers
  déjà "trialing", etc. — hors du besoin actuel qui ne couvre que la synchro webhook).
- Ne pas considérer ce chantier "stripe-billing" comme livrant un parcours d'achat complet
  tant que T13 n'est pas fait — c'est le point à rappeler explicitement à toute revue.
