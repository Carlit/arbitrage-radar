# Tâches : Extraction du module de facturation Stripe (`billing-stripe-kit`)

Statut : **T1–T15 implémentées et validées le 2026-08-31** (T14 : 7 scénarios de non-régression
exécutés contre le code réel, cf. `spec.md` §8). T16 (statut spec) fait dans la foulée. Reste
non fait : test HTTP réel via Stripe CLI (pas de clés Stripe test dans cet environnement, même
limite que `stripe-billing`). Référence : `spec.md` (besoin, clarifié), `plan.md` (architecture,
validée le 2026-08-30, y compris le Customer orphelin accepté comme dette différée).

## T1 — Scaffold `packages/billing-stripe-kit/`
- `package.json` (nom `billing-stripe-kit`, `private: true`, pas de publication), `tsconfig.json`
  (mêmes cibles TS que `web/` — `strict: true`), `src/` vide avec les 5 fichiers prévus en
  `plan.md` §1.
- **Test** : `npm install` dans le package (deps : `stripe` uniquement — pas de dépendance
  Supabase, le kit ne doit jamais importer `@supabase/*`) sans erreur.

## T2 — `types.ts` : `BillingEvent` + `IdempotencyStore`
- Union discriminée `BillingEvent` (`account.linked`, `subscription.activated`,
  `subscription.updated`, `subscription.cancelled`) telle que `plan.md` §4.4.
- Interface `IdempotencyStore { has(eventId): Promise<boolean>; record(eventId): Promise<void> }`.
- **Test** : `tsc --noEmit` passe, aucun import de type produit (`tenant`, `venue`, etc.).

## T3 — `checkout.ts` : `createCheckoutSession`
- Implémentation telle que `plan.md` §2 : crée un `Customer` avec `metadata.account_id`,
  `client_reference_id` sur la session, `mode: subscription`, `metadata` passée telle quelle.
- **Ne pas** ajouter de logique de recherche/déduplication de Customer (dette assumée,
  confirmée non bloquante).
- **Test** : appel avec un `priceId` de test Stripe (mode test) → session créée, `url` valide,
  `client_reference_id` = `accountId` passé, Customer créé avec la bonne metadata (vérifiable
  via `stripe.customers.retrieve`).

## T4 — `portal.ts` : `createPortalSession`
- Implémentation directe (`plan.md` §3), aucune logique additionnelle.
- **Test** : appel avec un `stripeCustomerId` de test → session portail créée, `url` valide.
  Pas de consommateur à câbler dans ce chantier (rappel : hors périmètre, capacité livrée pour
  un usage futur).

## T5 — `webhook.ts` : vérification de signature
- `verifyEvent(rawBody, signature, webhookSecret): Stripe.Event`, lève
  `SignatureVerificationError` (classe exportée par le kit) si invalide/absente.
- **Test** : signature valide → event retourné ; signature invalide/absente → l'erreur typée
  est levée, pas une erreur Stripe générique non catégorisée.

## T6 — `webhook.ts` : mapping événements bruts → génériques
- Table de mapping `plan.md` §4.3. Pour `customer.subscription.*`, appel
  `stripe.customers.retrieve(customerId)` pour lire `metadata.account_id`.
- Cas `metadata.account_id` absent sur le Customer (customer créé hors du kit) : lever une
  erreur explicite (pas de `BillingEvent` silencieusement mal formé) — à catcher par
  l'adaptateur pour un `500` (retry Stripe), comme convenu en `plan.md` §7 scénario 6.
- **Test** : un event `checkout.session.completed` de test → `account.linked` avec le bon
  `accountId`/`stripeCustomerId`. Un event `customer.subscription.updated` de test (Customer
  avec metadata correcte) → `subscription.updated` avec le bon `accountId`. Un event
  `customer.subscription.created` sur un Customer sans `metadata.account_id` → erreur levée,
  pas de `BillingEvent` retourné.
- Dépend de T2.

## T7 — Idempotence dans le dispatch
- Avant dispatch : `store.has(event.id)` (si `idempotencyStore` fourni) → si vrai, skip
  silencieux, pas d'appel à `onEvent`. Après succès de `onEvent` (pas avant, cf. `plan.md`
  §4.2) : `store.record(event.id)`.
- Sans `idempotencyStore` fourni : dispatch direct, pas de déduplication (comportement
  documenté, pas une erreur).
- **Test** : avec un store en mémoire de test, rejouer deux fois le même `event.id` → `onEvent`
  appelé une seule fois. `onEvent` qui lève une erreur → `record` n'est **pas** appelé (rejeu
  possible ensuite).
- Dépend de T5, T6.

## T8 — `index.ts` : `createBillingKit(config)`
- Assemble `checkout`, `portal`, `webhook.handleRequest(rawBody, signature)` (combine T5+T6+T7
  en une seule fonction appelée par l'adaptateur).
- Signature `config = { stripeSecretKey, webhookSecret, onEvent, idempotencyStore? }` —
  signature élargie confirmée (`plan.md` §4.5).
- **Test** : instanciation du kit avec un `onEvent` de test capturant les appels → un appel
  `handleRequest` avec un payload de checkout signé (Stripe CLI ou signature construite en
  test) déclenche bien un seul appel à `onEvent` avec le bon `BillingEvent`.
- Dépend de T3, T4, T7.

## T9 — Câblage `web/` → consommation du package
- `web/package.json` : `"billing-stripe-kit": "file:../packages/billing-stripe-kit"`.
- `web/next.config.ts` : `transpilePackages: ["billing-stripe-kit"]`.
- **Test** : `npm install` dans `web/` résout le package local (symlink), `import { createBillingKit } from "billing-stripe-kit"` type-check sans erreur (`tsc --noEmit`).
- Dépend de T8.

## T10 — Migration : `processed_stripe_events`
- Table + RLS activée sans policy, telle que `plan.md` §4.2 / §6.
- **Test** : appliquée sur le stack Supabase local (`supabase migration up --local`), insert/
  select en Service Role fonctionne, en anon/authenticated bloqué par défaut (même test que
  T2 côté `stripe-billing` pour `raw_market_ticks`).

## T11 — `web/lib/billing/idempotency-store.ts`
- Implémentation `IdempotencyStore` backée par `processed_stripe_events`, utilisant
  `createSupabaseServiceRoleClient()` (réutilisation de `web/lib/supabase/service-role.ts`,
  **aucun nouveau client Service Role créé** — un seul fichier fait autorité, cf. contrainte
  posée lors du chantier `stripe-billing`).
- **Test** : `has()` sur un `event_id` jamais vu → `false` ; `record()` puis `has()` sur le même
  id → `true`. Rejeu d'un `record()` sur un id déjà présent → pas d'erreur (idempotent côté
  store lui-même, `on conflict do nothing` ou équivalent).
- Dépend de T10.

## T12 — `web/lib/billing/tenant-sync.ts`
- Portage **exact** (pas de réécriture) de la logique actuelle de `route.ts` :
  `linkTenantToCustomer(accountId, stripeCustomerId)`,
  `syncTenantSubscription(stripeCustomerId, subscription)`,
  `cancelTenantSubscription(stripeCustomerId)` — mêmes fonctions `extractTierFromPrice`,
  `normalizeStripeStatus`, `toIsoTimestamp`, même update conditionnel
  `WHERE stripe_customer_id IS NULL` pour le linking, même erreur levée si tenant introuvable.
- **Test** : rejouer les scénarios déjà validés en T6–T10 de `stripe-billing/tasks.md`
  (payloads simulés directement sur le stack Supabase local) contre ces nouvelles fonctions →
  mêmes résultats en DB qu'avant le refactor.
- Dépend de T10 (le tenant existe déjà, migration `stripe-billing` T1 déjà appliquée).
- **Écart repéré pendant l'implémentation** : `cancelTenantSubscription` a dû prendre
  `(stripeCustomerId, subscription)` et non `(stripeCustomerId)` seul comme esquissé en
  `plan.md` §5 — le code original recalcule `subscription_current_period_ends_at` depuis
  l'abonnement supprimé, il ne le laisse pas inchangé. `plan.md` §5 corrigé en conséquence.

## T13 — Bascule de `web/app/api/webhook/stripe/route.ts` en adaptateur fin
- Remplace le contenu actuel par l'assemblage `plan.md` §5 : instancie le kit une fois,
  `onEvent` dispatch vers T12, `POST` appelle `kit.webhook.handleRequest`, mappe
  `SignatureVerificationError` → 400, toute autre erreur → 500, succès → 200.
- **`route.ts` n'importe plus `stripe` directement** — vérifier qu'aucun `import Stripe from
  "stripe"` ne subsiste dans ce fichier après bascule.
- **Test** : `tsc --noEmit` passe. Comportement HTTP identique à avant (voir T14).
- Dépend de T8, T9, T11, T12.
- **Écart technique non anticipé** : `web/` et le kit installent chacun leur propre copie de
  `stripe` (pas de workspace) — TypeScript refusait `Stripe.Subscription` du kit comme
  argument des fonctions de `tenant-sync.ts` (types structurellement identiques mais
  nominalement distincts). Corrigé en ré-exportant `Stripe` depuis `billing-stripe-kit`
  (`export type { Stripe }` dans `index.ts`) comme source unique de vérité pour ce type côté
  `web/`. Conséquence positive : `web/package.json` n'a plus besoin de `stripe` du tout,
  retiré.

## T14 — Validation de non-régression complète
- Reproduit les 7 scénarios de `plan.md` §7 (les 4 déjà couverts côté `stripe-billing` +
  les 3 nouveaux : rejeu d'event idempotent, `account.linked`, Customer sans metadata).
- Revalidation RLS `can_access_alert` inchangée (même test qu'en T10 `stripe-billing`).
- **Test** : tous les scénarios passent sur le stack Supabase local, résultats identiques à
  ceux déjà obtenus avant le refactor (mêmes codes HTTP, mêmes états finaux en DB).
- Dépend de T13.

## T15 — Nettoyage
- Supprimer les fonctions désormais mortes dans `route.ts` si des résidus subsistent après
  T13 (ne devrait rester que l'assemblage du kit + le dispatch `onEvent`).
- Vérifier que `process.env.SUPABASE_SERVICE_ROLE_KEY` n'est lu **que** dans
  `service-role.ts` — conformément à T11 (« aucun nouveau client Service Role créé »),
  `idempotency-store.ts` et `tenant-sync.ts` doivent uniquement importer et appeler
  `createSupabaseServiceRoleClient()`, jamais lire la variable d'env directement.
- **Test** : `grep -R "SUPABASE_SERVICE_ROLE_KEY" web/lib web/app` → une seule occurrence,
  dans `service-role.ts`.

## T16 — Mise à jour du statut de la spec
- Après T1–T15, mettre à jour `spec.md` §8 avec le statut réel, conformément à
  `.trae/rules/project_rules.md`.

---

# Tâches V2 (2026-08-31) — 3 nouvelles capacités

Référence : `spec.md` §9-§11 (clarifié), `plan.md` V2 (validé). T1–T16 ci-dessus déjà en
production, testées via Stripe CLI réel (cf. `spec.md` §8) — ne pas les retoucher sauf
régression détectée en T20.

Statut : **T17–T21 implémentées et validées le 2026-08-31.** T22/T23 non faites
(volontairement, suivi tracé).

## T17 — `refunds.ts` : `refundPayment`
- Nouveau fichier `packages/billing-stripe-kit/src/refunds.ts`, implémentation `plan.md` V2.1.
- Câblé dans `index.ts` : `refunds: createRefundsModule(stripe)`.
- **Test** : mock Stripe — `refundPayment("pi_123")` → `stripe.refunds.create` appelé avec
  `{ payment_intent: "pi_123" }` seulement (pas de clé `amount`/`reason` présente, même en
  `undefined` explicite). `refundPayment("pi_123", 500, "requested_by_customer")` → les 3
  champs présents avec les bonnes valeurs.
- **Test type** : `refundPayment("pi_123", 500, "invalid_reason" as any)` — confirmer que sans
  le `as any`, TypeScript rejette une valeur hors de l'union littérale (`tsc --noEmit` doit
  échouer sur un fichier de test dédié si on retire le cast — à vérifier manuellement, pas
  committé tel quel).

## T18 — `createCheckoutSession` : `options.trialPeriodDays` / `options.discounts`
- Étendre la signature avec le 4ᵉ paramètre `options` (`plan.md` V2.2). `metadata` garde son
  défaut `{}` existant — signature backward-compatible (aucun appelant existant dans `web/`,
  vérifié en `plan.md` V2.2).
- **Test — non-régression** : `createCheckoutSession("price_1", "acct_1", {})` (sans `options`,
  comportement V1 exact) → même requête `stripe.checkout.sessions.create` qu'avant cet ajout
  (rejouer le test T3 de la V1 tel quel).
- **Test — nouveau** : `options.trialPeriodDays = 14` → `subscription_data.trial_period_days:
  14` dans la requête. `options.discounts = [{ coupon: "XYZ" }]` → `discounts` transmis
  identique. Les deux ensemble dans le même appel → les deux présents simultanément, aucune
  erreur ni logique d'exclusion (conforme à `plan.md` V2.0 point 4).
- **Statut : ✅ fait.** `CreateCheckoutSessionOptions` déclarée localement dans `checkout.ts`
  (pas dans `types.ts`) et ré-exportée depuis `index.ts` — cohérent avec le fait que ce type
  n'a de sens que pour `createCheckoutSession`, contrairement à `BillingEvent`/`IdempotencyStore`
  qui sont partagés entre plusieurs modules.

## T19 — `webhook.ts` : mapping `invoice.payment_failed` → `payment.failed`
- `types.ts` : nouvelle branche `BillingEvent` (`plan.md` V2.3).
- `webhook.ts` : nouveau `case` dans `mapStripeEventToBillingEvent`, même mécanisme que
  `customer.subscription.*` (résolution `accountId` via `stripe.customers.retrieve`, erreur
  `MissingAccountIdError` si `metadata.account_id` absent).
- **Test** : event `invoice.payment_failed` avec `customer.metadata.account_id` présent →
  `BillingEvent` de type `payment.failed`, `accountId`/`stripeCustomerId` corrects, `raw` = 
  l'objet `Stripe.Invoice` complet. Même event avec metadata absente → `MissingAccountIdError`
  levée, pas de `BillingEvent` retourné (même test que T6c en V1, adapté à ce type d'event).
- **Test — idempotence** : rejouer le même `event.id` deux fois → `onEvent` appelé une seule
  fois (même mécanisme que T7, aucune modification du dispatch nécessaire pour ce nouveau type).

## T20 — Non-régression complète (V1 + V2)
- Rejouer les 7 scénarios T14 existants tels quels (V1 doit rester identique).
- Ajouter les scénarios T17/T18/T19 ci-dessus dans la même passe.
- **Test** : `tsc --noEmit` sur le kit et sur `web/` (aucun changement attendu côté `web/`
  puisque aucun consommateur n'est câblé dans ce chantier — à vérifier explicitement, pas
  supposer).

## T21 — Mise à jour du statut de la spec
- Après T17–T20, mettre à jour `spec.md` §11 avec le statut réel.

---

## Suivi explicite (hors périmètre de ce chantier — tracé, pas fusionné silencieusement)

## T22 — [FOLLOW-UP] Câblage produit de `payment.failed`
- `web/app/api/webhook/stripe/route.ts` doit gérer le cas `payment.failed` dans son switch
  `onEvent` (ex. passer `tenants.subscription_status` à `past_due`, notifier le tenant) — non
  fait dans ce chantier (kit uniquement, cf. `plan.md` V2.0 point 7 et V2.6).
- Sans cette tâche, un vrai paiement échoué en prod ne déclenche aucune action côté produit —
  à ne pas considérer comme un détail mineur lors d'une revue future.

## T23 — [FOLLOW-UP] Câblage produit de `refunds.ts` et des options de checkout
- Aucune route/UI n'appelle `refundPayment` ni ne passe `trialPeriodDays`/`discounts` à
  `createCheckoutSession` — capacités livrées, pas branchées (même statut que `portal.ts` en
  V1, cf. T13/T23 côté `stripe-billing` pour le précédent historique de ce type de dette).
