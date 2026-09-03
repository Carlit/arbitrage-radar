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

Statut : **T17–T21 implémentées le 2026-08-31.** T22/T23 non faites (volontairement, suivi
tracé, dette ouverte — cf. bandeau de statut en tête de `spec.md`).

**Correction de statut (2026-08-31, commit `7b1fbbf`)** : les validations T17-T20 ci-dessous
avaient été décrites comme "testées" alors qu'aucune suite de tests n'était committée dans le
dépôt (scénarios manuels non reproductibles). Une vraie suite automatisée existe désormais —
`packages/billing-stripe-kit/src/{refunds,checkout,webhook,regression}.test.ts`, exécutée via
`npm test` (`node --test`, mocks `node:test`, aucun nouveau framework). **21/21 tests verts**,
`tsc --noEmit` propre sur le kit et sur `web/`. Détail des scénarios réels dans chaque tâche
ci-dessous et dans `spec.md` §11.

## T17 — `refunds.ts` : `refundPayment`
- Nouveau fichier `packages/billing-stripe-kit/src/refunds.ts`, implémentation `plan.md` V2.1.
- Câblé dans `index.ts` : `refunds: createRefundsModule(stripe)`.
- **Test** : mock Stripe — `refundPayment("pi_123")` → `stripe.refunds.create` appelé avec
  `{ payment_intent: "pi_123" }` seulement (pas de clé `amount`/`reason` présente, même en
  `undefined` explicite). `refundPayment("pi_123", 500, "requested_by_customer")` → les 3
  champs présents avec les bonnes valeurs.
- **Test type — critère revu, infondé tel qu'écrit (2026-08-31)** : ce critère supposait que
  `tsc --noEmit` rejette une valeur `reason` hors union sans `as any`. En écrivant
  `refunds.test.ts`, constat que `Stripe.RefundCreateParams.Reason` (`stripe@22`) est défini
  `'duplicate' | 'fraudulent' | 'requested_by_customer' | OtherString`, où
  `OtherString = string & Record<never, never>` (échappatoire volontaire du SDK Stripe pour
  accepter toute chaîne, forward-compat) — pas une union littérale stricte. Une valeur
  arbitraire type-check donc sans erreur ; committer un `@ts-expect-error` dessus ferait échouer
  la compilation (directive inutilisée). Documenté en commentaire dans `refunds.test.ts` à la
  place. Ce n'est pas un bug du kit, mais une limite du typage upstream à connaître.
- **Test — committé et vert** : `packages/billing-stripe-kit/src/refunds.test.ts` (3 tests) —
  omission propre de `amount`/`reason`, passthrough des 3 champs, valeur de retour.

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
- **Test — committé et vert** : `packages/billing-stripe-kit/src/checkout.test.ts` (5 tests) —
  rejeu du comportement V1 sans `options` (T3 d'origine), `trialPeriodDays` seul, `discounts`
  seul, les deux ensemble.

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
- **Test — committé et vert** : `packages/billing-stripe-kit/src/webhook.test.ts` (13 tests,
  T5–T8 V1 rejoués + T19) — vérification de signature avec une vraie instance Stripe (HMAC
  réelle via `generateTestHeaderString`, pas mockée), mapping de tous les types d'event
  (`account.linked`, `subscription.*`, `payment.failed`), idempotence par `event.id`,
  `MissingAccountIdError` si metadata absente.

## T20 — Non-régression complète (V1 + V2)
- Rejouer les 7 scénarios T14 existants tels quels (V1 doit rester identique).
- Ajouter les scénarios T17/T18/T19 ci-dessus dans la même passe.
- **Test** : `tsc --noEmit` sur le kit et sur `web/` (aucun changement attendu côté `web/`
  puisque aucun consommateur n'est câblé dans ce chantier — à vérifier explicitement, pas
  supposer).
- **Test — committé et vert (2026-08-31, commit `7b1fbbf`)** :
  `packages/billing-stripe-kit/src/regression.test.ts` (2 tests) — assemblage du kit
  (`checkout`/`portal`/`refunds`/`webhook`) toujours correct après l'ajout V2, et une passe
  combinée V1+V2 dans un même dispatch (`account.linked` + `subscription.updated` +
  `payment.failed`, rejeu partiel pour vérifier l'idempotence par `event.id` indépendamment du
  type d'event). **21/21 tests verts au total** sur les 4 fichiers de test du kit
  (`refunds.test.ts` + `checkout.test.ts` + `webhook.test.ts` + `regression.test.ts`),
  `tsc --noEmit` confirmé propre sur le kit et sur `web/` (aucune régression côté consommateur).
- **Hors de portée, non simulé** : les 7 scénarios contre une vraie base Supabase locale +
  Stripe CLI restent non rejoués — pas de clés Stripe test ni de stack Supabase locale démarrée
  dans l'environnement où cette suite a été écrite (même limite que documentée plus haut pour
  T1–T16).

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
- **Repris et câblé en Tâches V3 ci-dessous (T24)**, après clarification produit avec
  l'utilisateur le 2026-08-31 : `past_due` sans période de grâce, pas de notification (aucune
  infra email n'existe). Détail et justification en `plan.md` V3.0/V3.1.

## T23 — [FOLLOW-UP] Câblage produit de `refunds.ts` et des options de checkout
- Aucune route/UI n'appelle `refundPayment` ni ne passe `trialPeriodDays`/`discounts` à
  `createCheckoutSession` — capacités livrées, pas branchées (même statut que `portal.ts` en
  V1, cf. T13/T23 côté `stripe-billing` pour le précédent historique de ce type de dette).
- **Confirmé différé après clarification produit (2026-08-31)**, pas un oubli — pas de code
  ajouté pour cette tâche en Tâches V3. Vérifié avant décision : `refundPayment` n'a aucune
  surface produit où exister (`web/app/` n'a ni UI ni route admin/support, et le seul rôle du
  schéma, `app_role`, est par tenant, pas un rôle staff plateforme) ; `createCheckoutSession`
  (T13) n'a toujours strictement aucun appelant dans `web/` (pas de pricing page, pas de bouton
  "S'abonner") — ajouter des options à un appel qui n'existe pas n'a pas de sens produit.
  Détail en `plan.md` V3.0 points 2–3.

---

# Tâches V3 (2026-08-31) — Câblage T22/T23

Référence : `plan.md` Plan V3 (décisions actées après clarification produit avec l'utilisateur).
Ne résout que T22 (`payment.failed` → `route.ts`) ; `T23` reste explicitement non fait
(justification à jour en `plan.md` V3.0 points 2–3 et dans les entrées T22/T23 ci-dessus).

Statut : **T24 implémentée le 2026-08-31**, vérification partielle (choix explicite, cf.
ci-dessous) — voir T25 pour le statut spec.

## T24 — `route.ts` : case `payment.failed` → `tenants.subscription_status = 'past_due'`
- `web/lib/billing/tenant-sync.ts` : nouvelle fonction `markTenantPaymentFailed(stripeCustomerId)`
  — même pattern que `syncTenantSubscription`/`cancelTenantSubscription` (update conditionnel
  `WHERE stripe_customer_id = ...`, erreur levée si aucun tenant trouvé). Ne met à jour que
  `subscription_status` (`'past_due'`) — ni `subscription_tier` ni
  `subscription_current_period_ends_at` ne sont touchés (un `Stripe.Invoice` ne porte pas cette
  information, contrairement à un `Stripe.Subscription` — cf. `plan.md` V3.1).
- `web/app/api/webhook/stripe/route.ts` : nouveau `case "payment.failed"` dans le switch
  `onEvent`, appelle `markTenantPaymentFailed(event.stripeCustomerId)`. Ajout d'un `default` avec
  vérification `never` explicite pour que le switch redevienne non-exhaustif à la compilation si
  un futur type de `BillingEvent` est ajouté sans être géré ici.
- **Statut : ✅ code écrit.** `tsc --noEmit` propre sur le kit et sur `web/`.
- **Vérification choisie (décision explicite avec l'utilisateur, 2026-08-31)** : pas de nouvelle
  suite de tests dans `web/` (qui n'en a aucune, contrairement au kit) pour ce changement d'une
  seule colonne. `markTenantPaymentFailed` réutilise à l'identique le pattern de requête déjà
  validé en conditions réelles par T14 pour `syncTenantSubscription`/`cancelTenantSubscription`
  (même table `tenants`, même client `createSupabaseServiceRoleClient()`, même
  `.eq("stripe_customer_id", ...).select("id").maybeSingle()` + erreur si `!data`) — seule la
  colonne mise à jour diffère (`subscription_status` uniquement). Vérifié manuellement par
  lecture directe de la migration (`subscription_status public.subscription_status not null
  default 'trialing'`, table `tenants`) plutôt que par une exécution réelle.
- **Non fait, dette explicite** : test contre une vraie base (T14/T20-style) ou via Stripe CLI +
  serveur dev local (comme la dette T13 bis, déjà bouclée par ailleurs). Ce worktree n'a jamais eu
  de `supabase/config.toml` — Docker et `npx supabase` (2.116.0) sont disponibles ici (contexte
  différent de la limite "pas de clés Stripe test" déjà documentée), mais `supabase init` +
  `supabase start` n'a pas été lancé pour ce chantier (jugé disproportionné pour un changement
  d'une seule colonne suivant un pattern déjà validé). Le client Supabase n'est par ailleurs pas
  typé contre un schéma généré ici (`createClient` sans generic `Database`) — un typo de nom de
  colonne/table ne serait donc pas détecté par `tsc` non plus, seulement par une exécution réelle.
  À faire par l'utilisateur en local s'il veut une vérification DB réelle avant mise en prod.
- Dépend de T19 (le kit émet déjà `payment.failed`, en prod depuis `e85b828`).

## T25 — Mise à jour du statut de la spec
- Après T24, mettre à jour le bandeau de statut en tête de `spec.md` et sa section dédiée avec
  le résultat réel (T22 résolu, T23 confirmé différé avec justification informée).

---

# Tâches V4 (2026-09-03) — Point d'entrée checkout (T23, partie 1)

Référence : `plan.md` Plan V4 (décisions actées après clarification produit, cycle
`/clarify`→`/plan` allégé). Ne résout que la partie checkout de `T23` ; `refundPayment` reste
explicitement non fait (cf. `plan.md` V4.0 point 3).

Statut : **T26–T32 implémentées le 2026-09-03.**

## T26 — `checkout.ts` : `successUrl`/`cancelUrl` requis
- Nouvelle signature `createCheckoutSession(priceId, accountId, successUrl, cancelUrl, metadata = {}, options = {})`
  (`plan.md` V4.2.1). Passthrough vers `stripe.checkout.sessions.create({ success_url: successUrl, cancel_url: cancelUrl, ... })`.
- **Statut : ✅ fait.** `packages/billing-stripe-kit/src/checkout.test.ts` mis à jour (T3/T18
  rejoués avec la nouvelle signature) + nouveau test dédié vérifiant que `success_url`/
  `cancel_url` apparaissent tels quels dans la requête.
- Dépend de rien (T13 n'a jamais eu d'appelant à préserver).

## T27 — `index.ts` : `webhookSecret`/`onEvent` optionnels dans `BillingKitConfig`
- `createBillingKit({ stripeSecretKey })` seul reste pleinement fonctionnel pour
  `.checkout`/`.portal`/`.refunds` (`plan.md` V4.2.2).
- **Statut : ✅ fait.** `.webhook.handleRequest` appelé sans `webhookSecret`/`onEvent` fournis à
  la construction lève une erreur explicite immédiate
  (`"createBillingKit: webhookSecret et onEvent sont requis pour utiliser .webhook.handleRequest(...)"`) —
  mécanisme choisi : un stub `.webhook` dont `handleRequest` est `async` et lève systématiquement,
  plutôt qu'un `.webhook` absent (qui aurait produit un `TypeError` confus côté appelant).
- **Test** : nouveau test dans `regression.test.ts` — `createBillingKit({ stripeSecretKey })`
  sans `webhookSecret`/`onEvent` → `.checkout`/`.portal`/`.refunds` toujours utilisables,
  `.webhook.handleRequest(...)` rejette avec le message attendu. Le test T20 existant (config
  complète avec webhook) rejoué sans modification.
- Dépend de rien.

## T28 — `web/lib/billing/checkout.ts` : `startTenantCheckout(tenantId)`
- **Statut : ✅ fait.** Instancie `createBillingKit({ stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "" })`
  (sans webhook, cf. T27), appelle `kit.checkout.createCheckoutSession` avec
  `process.env.STRIPE_PRICE_PRO_ID`, `${process.env.NEXT_PUBLIC_APP_URL}/billing/success`,
  `${process.env.NEXT_PUBLIC_APP_URL}/billing/cancel` (`plan.md` V4.3.2). Retourne `session.url`,
  erreur explicite si `null`.
- `web/.env.local.example` : `STRIPE_PRICE_PRO_ID` et `NEXT_PUBLIC_APP_URL` ajoutées avec
  commentaire sur leur provenance (le premier vient de `stripe_bootstrap_billing.mjs`, pont
  manuel — cf. `plan.md` V4.6).
- Dépend de T26, T27.

## T29 — Bouton "Passer Pro" dans le dashboard
- **Statut : ✅ fait.** `web/app/dashboard/page.tsx` : `<form>` + Server Action dans le header,
  même pattern que le bouton de déconnexion existant, appelle
  `startTenantCheckout(activeTenantId)` puis `redirect(url)`.
- `tenantId` = `activeTenantId` déjà résolu côté serveur dans la page (jamais une valeur cliente)
  — cf. `plan.md` V4.4.
- Dépend de T28.

## T30 — Pages `web/app/billing/success` et `web/app/billing/cancel`
- **Statut : ✅ fait.** Deux pages statiques (`plan.md` V4.0.2) : message + lien retour
  `/dashboard`, aucune lecture DB. Confirmées générées en statique par `next build --turbopack`.
- Dépend de rien (peuvent être faites en parallèle de T28/T29).

## T31 — Validation de non-régression
- **Statut : ✅ fait.** `tsc --noEmit` propre sur le kit et sur `web/`. `next build --turbopack`
  exécuté avec succès (10 routes générées, `/billing/success`/`/billing/cancel` en statique,
  `/dashboard` compile avec la nouvelle Server Action). `checkout.test.ts`/`regression.test.ts`
  rejoués — **23/23 tests verts** sur le kit.
- **Non fait, dette explicite** : pas de test HTTP réel via Stripe CLI pour ce nouveau flux
  (même limite déjà documentée pour T13 bis/T20/T24) ; pas de nouveau test `web/` pour
  `startTenantCheckout`/le bouton (choix explicite, même niveau qu'en T24).
- **Risque de double souscription — pas de vérification d'abonnement existant avant d'afficher
  le bouton** : le dashboard n'affiche aujourd'hui aucune information de `subscription_tier`/
  `subscription_status`, donc un tenant déjà Pro/Elite voit quand même "Passer Pro" et peut
  relancer un checkout. Stripe ne rejette pas cet appel — `createCheckoutSession` crée un nouveau
  `Customer` à chaque fois (dette déjà connue depuis T3/V1) et une nouvelle Subscription active,
  potentiellement facturée en double sur le même tenant, sans erreur ni garde-fou côté kit ou
  côté `web/`. Pas corrigé dans ce chantier (cf. `plan.md` V4.6) — à traiter avant toute mise en
  production réelle, pas un détail cosmétique.

## T32 — Mise à jour du statut de la spec
- **Statut : ✅ fait.** Bandeau de statut en tête de `spec.md` et nouvelle section §13 avec le
  résultat réel (checkout câblé, `refundPayment` toujours non fait).

---

## Suivi explicite (mis à jour)

- **`refundPayment` reste sans point d'entrée produit** après ce chantier V4 — reporté à un
  chantier "rôles et permissions avancées" séparé (décision actée le 2026-09-03, cf. `plan.md`
  V4.0 point 3). Ne pas le refaire apparaître comme "oublié" dans une revue future : c'est une
  dette tracée, pas un manque de couverture.
