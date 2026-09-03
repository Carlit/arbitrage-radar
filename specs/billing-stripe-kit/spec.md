# Spécification : Extraction du module de facturation Stripe en package réutilisable

> **Statut (2026-08-31)** : V1 (T1–T16) et V2 (T17–T21) implémentées et testées côté kit —
> détail en §8 et §11. **T22 résolu (Plan V3, §12)** : `payment.failed` câblé côté
> `web/app/api/webhook/stripe/route.ts`, passe `tenants.subscription_status` à `'past_due'`
> (sans période de grâce — l'entitlement RLS ne l'accorde qu'à `trialing`/`active`, inchangé).
> **`T23` partiellement résolu (Plan V4, §13)** : le checkout self-serve est câblé (bouton
> "Passer Pro" dans le dashboard → `createCheckoutSession` → Stripe Checkout hébergé → pages
> `/billing/success`/`/billing/cancel`). **Risque connu, non corrigé : le bouton s'affiche même
> pour un tenant déjà Pro/Elite** (le dashboard n'affiche aucune info d'abonnement) — relancer un
> checkout crée une nouvelle Subscription Stripe sans vérifier d'abonnement préexistant, risque
> concret de double facturation, pas seulement d'UX. **`refundPayment` reste une dette ouverte
> non résolue, avec justification informée** (pas un oubli) : aucune UI/route admin n'existe dans le
> produit actuel, et le seul rôle du schéma (`app_role`) est par tenant, pas un rôle staff
> plateforme — reporté explicitement à un futur chantier "rôles et permissions avancées". Détail
> en §12/§13 et
> `plan.md` V3.0/V4.0.

## 1. Quoi (Le besoin)

Extraire la logique Stripe actuellement codée en dur dans `web/app/api/webhook/stripe/route.ts`
(chantier `stripe-billing`, T1–T10 validés) en un package indépendant du produit :
`packages/billing-stripe-kit/` (le dossier `packages/` n'existe pas encore, à créer).

Le kit expose :
- `webhook.ts` — vérification de signature Stripe, parsing d'événement, **idempotence**.
- `checkout.ts` — `createCheckoutSession(priceId, accountId, metadata)`.
- `portal.ts` — `createPortalSession(stripeCustomerId, returnUrl)`.
- Un point d'entrée unique `createBillingKit(stripeSecretKey, onEvent)`, où `onEvent` reçoit
  des événements génériques : `subscription.activated`, `subscription.cancelled`,
  `subscription.updated`.

> **Tranché en `/clarify` + `/plan`** : la signature réelle est
> `createBillingKit({ stripeSecretKey, webhookSecret, onEvent, idempotencyStore? })` (objet de
> config, pas 2 arguments positionnels) — `webhookSecret` et `idempotencyStore` sont
> nécessaires pour que `webhook.ts` remplisse les responsabilités décrites ci-dessus
> (vérification de signature, idempotence). Un 4ᵉ événement générique, `account.linked`, est
> émis sur `checkout.session.completed`, en plus des 3 listés ci-dessus. Détail et
> justification en §7 et `plan.md` §4.5. Cette spec fige l'intention fonctionnelle de la ligne
> ci-dessus, pas la signature finale.

**Contrainte de conception non négociable** : le kit ne doit jamais connaître le concept de
"tenant" ou de "venues" (vocabulaire produit Wedge). Il parle uniquement en termes génériques
(`accountId`, événements de cycle de vie d'abonnement).

## 2. Pourquoi

Le code Stripe actuel est écrit directement dans la route Next.js du produit, couplé au
schéma `tenants`. Le rendre réutilisable permet de le packager indépendamment (autre produit,
autre client) sans réécrire la logique de vérification de signature, de checkout ou de portail
de facturation à chaque fois.

## 3. Pour qui

- **Développeurs** (interne) : réutilisation du kit sur un futur produit sans dépendance au
  schéma `tenants`/`venues` de Wedge.
- **Le produit Wedge actuel** : ne doit subir **aucune régression**. `web/app/api/webhook/stripe/route.ts`
  devient un adaptateur fin qui appelle le kit et branche `onEvent` sur la logique tenant
  existante (mise à jour de `tenants.stripe_customer_id` / `stripe_subscription_id` /
  `subscription_tier` / `subscription_status` / `subscription_current_period_ends_at`).

## 4. Contrainte non négociable

`web/app/api/webhook/stripe/route.ts` doit rester fonctionnel **exactement comme avant**
(comportement T1–T10 validé le 2026-08-30, cf. `specs/stripe-billing/tasks.md`) après son
passage en adaptateur fin. Aucune régression sur :
- la vérification de signature (400 si absente/invalide) ;
- le lien `checkout.session.completed` → `tenants.stripe_customer_id` (idempotent) ;
- la synchronisation `customer.subscription.created|updated|deleted` → tier/statut/
  `subscription_current_period_ends_at` ;
- le comportement 200 silencieux sur les événements non gérés.

## 5. Hors périmètre

- **Le moteur de détection/scoring crypto** (`specs/detection-scoring-engine/`) : en pause ce
  soir, non touché par ce chantier.
- **Migration de schéma DB liée à la facturation** : aucune nouvelle colonne sur `tenants`
  n'est prévue ici — sauf si l'idempotence (cf. `/clarify`) nécessite un store persistant, à
  trancher explicitement avant `/plan`.
- **Publication du package sur un registre npm public/privé** : reste un package local du
  monorepo (`packages/billing-stripe-kit/`) pour ce chantier, pas de publication externe.

## 6. Ambiguïtés identifiées avant `/plan` (cf. `/clarify`)

Deux points où la frontière kit/produit n'est pas tranchée par la demande initiale :

1. **Propagation de `accountId` à travers les événements Stripe** — `client_reference_id`
   n'existe que sur l'objet `Checkout Session`, pas sur `Subscription`/`Invoice`. Pour que le
   kit résolve `accountId` de façon uniforme sur les 3 événements génériques (pas seulement au
   moment du checkout), il faut soit écrire `accountId` dans la metadata du `Customer` Stripe
   (lisible sur tous les événements liés à ce client), soit limiter `client_reference_id` au
   seul événement de checkout et laisser l'adaptateur produit retrouver le tenant lui-même pour
   les événements d'abonnement ultérieurs (comme aujourd'hui).
2. **Mécanisme d'idempotence** — un `Set` en mémoire dans le kit ne protège rien en déploiement
   serverless (les routes API Next.js ne garantissent pas la persistance d'un process entre deux
   invocations). Fournir une vraie garantie nécessite un store injecté par le produit (ex. table
   Postgres légère côté Wedge), ce que la demande initiale ne précise pas.

## 7. Décisions issues de `/clarify`

1. **Propagation `accountId`** : via la metadata du `Customer` Stripe
   (`customer.metadata.account_id`), écrite par `createCheckoutSession` dès la création du
   Customer. Le kit la relit de façon uniforme sur tous les événements, et émet un 4ᵉ
   événement générique (`account.linked`) sur `checkout.session.completed` — en plus des 3
   événements `subscription.*` listés en §1. Détail en `plan.md` §4.
2. **Idempotence** : store injectable (interface minimale `has`/`record`), fourni par
   `createBillingKit(...)`. Wedge implémente ce store avec une nouvelle table Postgres légère
   (`processed_stripe_events`) — seule migration DB de ce chantier, hors `tenants`. Détail en
   `plan.md` §4.4.

## 8. Statut

- Spec rédigée à partir de la demande du 2026-08-30 (soir), clarifiée le même soir.
- **Implémenté le 2026-08-31 (T1–T15 de `tasks.md`)** :
  - `packages/billing-stripe-kit/` créé (`checkout.ts`, `portal.ts`, `webhook.ts`, `types.ts`,
    `index.ts`), consommé par `web/` via `file:` dependency + `transpilePackages`.
  - `web/app/api/webhook/stripe/route.ts` est désormais un adaptateur fin (n'importe plus
    `stripe` directement) ; `web/lib/billing/tenant-sync.ts` et
    `web/lib/billing/idempotency-store.ts` portent la logique produit.
  - Migration `processed_stripe_events` appliquée en local, RLS activée sans policy.
  - **Écart corrigé en cours d'implémentation** (non prévu dans `plan.md` §5) :
    `cancelTenantSubscription` a dû recevoir l'objet `Subscription` complet (pas seulement
    `stripeCustomerId`) pour rester fidèle au comportement T1–T10 d'origine, qui recalcule
    `subscription_current_period_ends_at` depuis l'abonnement supprimé au lieu de le laisser
    inchangé. Repéré et corrigé avant la bascule de `route.ts`, pas après.
  - **Écart technique non anticipé par le plan** : `web/` et le kit installant chacun leur
    propre copie de `stripe` (pas de workspace, décision confirmée en `/plan`), TypeScript
    traitait leurs types `Stripe.Subscription` comme non interchangeables. Corrigé en
    ré-exportant le type `Stripe` depuis `billing-stripe-kit` comme source unique, plutôt que
    d'importer `stripe` séparément côté `web/`. `web/package.json` n'a d'ailleurs plus besoin
    de dépendre de `stripe` du tout — retiré.
  - **Validation de non-régression (T14)** : les 7 scénarios de `plan.md` §7 exécutés contre
    le code réel (pas une simulation) sur le stack Supabase local — `linkTenantToCustomer`,
    `syncTenantSubscription`, `cancelTenantSubscription`, le store d'idempotence, et le
    dispatch complet de `webhook.ts` (transport Stripe mocké, logique métier et Supabase
    réels). RLS `can_access_alert` revalidée inchangée.
- **Dette T13 bis (test HTTP réel via Stripe CLI) — bouclée le 2026-08-31** : `npm run dev` +
  `stripe listen --forward-to localhost:3000/api/webhook/stripe` + `stripe trigger`, avec de
  vraies clés Stripe test, exécutés en conditions réelles. Deux vrais bugs Turbopack trouvés et
  corrigés au passage (jamais révélés par `tsc --noEmit` seul) : `turbopack.root`/
  `outputFileTracingRoot` scopés à `web/` excluaient `packages/billing-stripe-kit` (sibling,
  hors racine) de la résolution ; les imports relatifs internes du kit en `.js` (convention TS
  NodeNext) ne sont pas remappés vers `.ts` par Turbopack. Un cas piège d'environnement identifié
  et documenté pour référence : un mismatch entre le sandbox Stripe loggé côté CLI
  (`stripe config --list`) et celui de la `STRIPE_SECRET_KEY` en `.env.local` produit des `500`
  "No such customer" qui n'ont rien à voir avec le code (les deux doivent pointer sur le même
  sandbox). Une fois corrigé : `checkout.session.completed` (ignoré si pas de `customer`),
  `customer.subscription.updated`/`.deleted` (rejetés proprement si `customer.metadata.account_id`
  absent, `500` + retry Stripe) et un scénario de succès complet bout-en-bout (Customer avec
  metadata + moyen de paiement de test attaché + subscription forcée à `app_tier=pro` →
  tenant passé en `pro`/`active` en base) ont tous été validés.
- `web/.env.local.example` reste à compléter avec `STRIPE_WEBHOOK_SECRET` si ce n'est pas déjà
  fait (déjà présent depuis `stripe-billing`, vérifié inchangé).

## 9. Extension V2 (2026-08-31) — 3 nouvelles capacités

Demande faite après livraison, test et validation complète de la V1 (§8 ci-dessus, déjà en
`main`). Cette section documente l'ajout, pas une réécriture de ce qui précède.

### 9.1 `refunds.ts` — `refundPayment(paymentIntentId, amount?, reason?)`

Nouveau module, wrapper direct de `stripe.refunds.create`. Aucun lien avec `accountId`/tenant :
un remboursement se fait par `paymentIntentId`, Stripe n'a besoin de rien d'autre pour
l'identifier. `amount?` optionnel (remboursement partiel, plus petite unité de devise,
sémantique Stripe standard). Retourne `Promise<Stripe.Refund>`.

### 9.2 `createCheckoutSession` — `trialPeriodDays?` et `discounts?`

Deux paramètres optionnels supplémentaires, ajoutés à la signature existante
`createCheckoutSession(priceId, accountId, metadata)`, passés tels quels à Stripe :
- `trialPeriodDays?: number` → `subscription_data.trial_period_days`.
- `discounts?: Stripe.Checkout.SessionCreateParams.Discount[]` → `discounts` (type Stripe
  réutilisé directement, aucune interprétation côté kit).

Aucune logique d'interaction entre les deux dans le kit — passthrough pur.

### 9.3 `webhook.ts` — écoute de `invoice.payment_failed`

Même mécanisme que les événements `subscription.*` existants : `accountId` résolu via
`customer.metadata.account_id` (même appel `stripe.customers.retrieve`, même comportement si
absent — `MissingAccountIdError`, `500`, retry Stripe côté adaptateur), même passage par le
store d'idempotence. Émet un événement générique `payment.failed` vers `onEvent`, avec l'objet
`Stripe.Invoice` brut en `raw` — le kit n'interprète pas ce qu'il faut faire d'un paiement
échoué, ça reste entièrement côté produit.

## 10. Ambiguïtés identifiées avant `/plan` (V2) et décisions

1. **Interaction `discounts` / `trialPeriodDays`** — vérifié par recherche (pas une supposition) :
   Stripe interdit de combiner `discounts` avec `allow_promotion_codes` (paramètre que le kit
   n'expose pas), mais ne documente **aucun** conflit entre `discounts` et
   `subscription_data.trial_period_days` — ce sont deux paramètres orthogonaux. Pas de décision
   à prendre : passthrough indépendant des deux, sans logique d'interaction. Source :
   [stripe/stripe-node#2248](https://github.com/stripe/stripe-node/issues/2248).
2. **Type du paramètre `reason` de `refundPayment`** — Stripe n'accepte que 3 valeurs pour
   `refunds.create.reason` (`duplicate`, `fraudulent`, `requested_by_customer`), rejetées côté
   API sinon. **Décision (`/clarify`)** : typé avec l'union littérale exacte de Stripe
   (`reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer'`), réutilisant le type que
   Stripe expose déjà dans son SDK — même pattern que le ré-export `Stripe` existant (§8, écart
   technique documenté). Erreur à la compilation si mal utilisé, aucune logique métier ajoutée.

## 11. Statut (V2)

- Spec mise à jour et clarifiée le 2026-08-31. Plan et tasks validés le même jour.
- **Implémenté le 2026-08-31 (T17–T21 de `tasks.md`)** :
  - `packages/billing-stripe-kit/src/refunds.ts` créé, câblé dans `index.ts`
    (`kit.refunds.refundPayment`).
  - `checkout.ts` : `createCheckoutSession` accepte un 4ᵉ paramètre optionnel `options`
    (`trialPeriodDays?`, `discounts?`), backward-compatible (aucun appelant existant).
  - `webhook.ts`/`types.ts` : `invoice.payment_failed` → événement générique `payment.failed`,
    même mécanisme exact que `subscription.*` (résolution `accountId`, idempotence, erreur si
    metadata absente).
  - Aucun changement côté `web/` — confirmé par `tsc --noEmit` inchangé sur `web/` après ces
    ajouts (T22/T23 restent des tâches de suivi non faites, cf. `plan.md` V2.6).
- **Validation de non-régression (T20) — corrigée le 2026-08-31** : la mention initiale d'un
  "script existant" pour les 9 scénarios V1 était inexacte — aucune suite de tests n'était
  committée dans le dépôt avant ce jour, pour V1 comme pour V2 ; les passes précédentes étaient
  des scénarios manuels non reproductibles. Une vraie suite automatisée existe désormais dans
  `packages/billing-stripe-kit/src/` (`node --test`, mocks `node:test` — aucun nouveau
  framework de test) :
  - `refunds.test.ts` (T17, 3 tests) : omission propre de `amount`/`reason`, passthrough des 3
    champs, valeur de retour.
  - `checkout.test.ts` (T18, 5 tests) : rejeu du comportement V1 sans `options` (T3 d'origine),
    `trialPeriodDays` seul, `discounts` seul, les deux ensemble.
  - `webhook.test.ts` (T5–T8 rejoués + T19, 13 tests) : vérification de signature avec une
    vraie instance Stripe (HMAC réelle via `generateTestHeaderString`, pas mockée), mapping de
    tous les types d'event (`account.linked`, `subscription.*`, `payment.failed`), idempotence
    par `event.id`, `MissingAccountIdError` si metadata absente.
  - `regression.test.ts` (T20, 2 tests) : assemblage du kit (`checkout`/`portal`/`refunds`/
    `webhook`) après l'ajout V2, passe combinée V1+V2 dans un même dispatch (idempotence par
    `event.id` indépendante du type d'event).
  - **21/21 tests verts**, `tsc --noEmit` propre sur le kit et sur `web/` (aucune régression
    côté consommateur, confirmé, pas supposé).
  - **Écart trouvé en écrivant les tests** : le critère de test type de T17 (tasks.md — `tsc`
    doit rejeter une valeur hors union pour `reason` sans `as any`) est infondé. Le SDK Stripe
    (`stripe@22`) définit `RefundCreateParams.Reason` avec un échappatoire
    `OtherString = string & Record<never, never>` qui accepte n'importe quelle chaîne à la
    compilation — ce n'est pas une union littérale stricte. Documenté en commentaire dans
    `refunds.test.ts` plutôt que de committer un `@ts-expect-error` qui échouerait
    (directive inutilisée). Ce n'est pas un bug du kit, mais une limite du typage upstream.
  - **Hors de portée, comme documenté en tasks.md T14/T20** : les 7 scénarios contre une vraie
    base Supabase locale + Stripe CLI restent non rejoués — pas de clés Stripe test ni de stack
    Supabase locale démarrée dans l'environnement où cette suite a été écrite.
- **Reste à faire, tracé explicitement (T22/T23, hors périmètre de ce chantier)** : aucune
  route/UI côté `web/` ne consomme `refundPayment`, les nouvelles options de checkout, ou ne
  réagit à `payment.failed` — capacités livrées côté kit, pas branchées côté produit. Un
  paiement qui échoue réellement en prod ne déclenche aujourd'hui aucune action côté tenant.

## 12. Statut (V3 — câblage T22/T23)

- Décisions actées avec l'utilisateur le 2026-08-31, chacune vérifiée sur le code réel avant
  d'être tranchée (détail en `plan.md` Plan V3, `tasks.md` Tâches V3) :
  1. `payment.failed` → `route.ts` : câblé, force `tenants.subscription_status` à `'past_due'`
     sans période de grâce.
  2. `refundPayment` : confirmé différé — aucune UI admin/support n'existe dans le produit
     (`web/app/` n'a que landing/auth/dashboard/webhook), et le seul rôle du schéma (`app_role`)
     est par tenant, pas un rôle staff plateforme.
  3. Options de checkout (`trialPeriodDays`/`discounts`) : confirmées différées —
     `createCheckoutSession` (T13) n'a toujours aucun appelant dans `web/`.
- **Implémenté (T24)** : `web/lib/billing/tenant-sync.ts` — nouvelle fonction
  `markTenantPaymentFailed(stripeCustomerId)`, même pattern que `syncTenantSubscription`/
  `cancelTenantSubscription` (update conditionnel sur `stripe_customer_id`, erreur si tenant
  introuvable), ne touche que `subscription_status`. `web/app/api/webhook/stripe/route.ts` :
  nouveau `case "payment.failed"`, plus un `default` avec vérification `never` explicite pour
  que le switch redevienne non-exhaustif à la compilation si un futur type de `BillingEvent`
  n'est pas géré. `tsc --noEmit` propre sur le kit et sur `web/`.
- **Revue structurelle, avec un point vérifié par exécution réelle** :
  - Chemin complet tracé ligne par ligne (webhook Stripe → `route.ts` → `mapStripeEventToBillingEvent`
    → `onEvent` → `markTenantPaymentFailed` → écriture Postgres) — aucun trou.
  - Écrasement inconditionnel confirmé (aucune garde sur la valeur actuelle de
    `subscription_status`) — n'élimine pas la race last-write-wins avec `subscription.updated`
    en cas de webhooks concurrents (préexistante, pas introduite ni corrigée par ce chantier).
  - Idempotence (T5–T8) s'applique génériquement à `payment.failed` sans code spécifique.
    Distinction importante : une redélivrance Stripe du même `event.id` est dédupliquée (si le
    traitement précédent a réussi jusqu'à `record()`) ; une nouvelle tentative de paiement
    (dunning) génère un `event.id` différent, non dédupliqué, et réexécute le handler — attendu
    et sans effet de bord (écriture idempotente vers la même valeur).
  - **`subscription_is_entitled('past_due')` exécuté réellement** (conteneur Postgres jetable,
    énum + fonction copiées telles quelles depuis la migration, pas réécrites de mémoire) →
    retourne `false`, identique à `'canceled'`/`'unpaid'`/`'incomplete'`/`'incomplete_expired'`/
    `'paused'` ; seuls `'trialing'`/`'active'` retournent `true`. Confirme qu'aucune grâce
    n'existe pour `past_due`, conformément à la décision V3.0.1 — plus une supposition de lecture
    de code, une observation.
- **Non fait, dette explicite (inchangée)** : pas de test DB réel end-to-end (le worktree n'a
  jamais eu de `supabase/config.toml`, `supabase init`/`start` jugé disproportionné pour ce
  changement d'une colonne) ; pas de test HTTP réel via Stripe CLI. `T23` reste non fait dans
  son intégralité (`refundPayment`, options de checkout) — cf. point 12.2/12.3 ci-dessus.

## 13. Statut (V4 — point d'entrée checkout, T23 partie 1)

- Décisions actées avec l'utilisateur le 2026-09-03, chacune vérifiée sur le code réel avant
  d'être tranchée (détail en `plan.md` Plan V4, `tasks.md` Tâches V4) : un seul tier "Pro" pour
  ce premier MVP, pages `success`/`cancel` statiques sans vérification live, `refundPayment`
  confirmé reporté à un futur chantier rôles/permissions.
- **Deux extensions du kit nécessaires, trouvées en vérifiant le code avant d'écrire le plan**
  (T13 n'avait jamais eu de vrai appelant, donc jamais exercées) :
  - `checkout.ts` : `createCheckoutSession` prend désormais `successUrl`/`cancelUrl` comme 3ᵉ/4ᵉ
    paramètres positionnels **requis** (`metadata`/`options` restent optionnels après). L'API
    Stripe réelle exige `success_url` en `ui_mode` par défaut (hosted) — absent jusqu'ici, un
    appel réel aurait échoué côté Stripe malgré des types TS qui les déclarent optionnels.
  - `index.ts` : `BillingKitConfig.webhookSecret`/`.onEvent` sont désormais optionnels.
    `createBillingKit({ stripeSecretKey })` seul reste pleinement utilisable pour
    `.checkout`/`.portal`/`.refunds` ; `.webhook.handleRequest` appelé sans ces champs lève une
    erreur explicite (`"webhookSecret et onEvent sont requis..."`), jamais un `undefined`
    silencieux.
- **Implémenté (T28–T30)** :
  - `web/lib/billing/checkout.ts` — `startTenantCheckout(tenantId)`, instancie un kit
    "checkout seul" (sans webhook), résout `STRIPE_PRICE_PRO_ID`/`NEXT_PUBLIC_APP_URL` en
    variables d'environnement, retourne l'URL de la Checkout Session.
  - `web/app/dashboard/page.tsx` — bouton "Passer Pro" dans le header (Server Action, même
    pattern que la déconnexion existante), `tenantId` = `activeTenantId` résolu côté serveur.
  - `web/app/billing/success/page.tsx` et `web/app/billing/cancel/page.tsx` — pages statiques,
    aucune lecture DB.
- **Validation** : `tsc --noEmit` propre sur le kit et sur `web/`. `next build --turbopack`
  exécuté avec succès (`/billing/success`, `/billing/cancel` générées en statique, `/dashboard`
  compile avec la nouvelle Server Action). `checkout.test.ts` mis à jour pour la nouvelle
  signature (nouveau test dédié `successUrl`/`cancelUrl`) ; nouveau test pour
  `createBillingKit` sans `webhookSecret`/`onEvent` (`regression.test.ts`). **23/23 tests
  verts** sur le kit.
- **Non fait, dette explicite** : pas de test HTTP réel via Stripe CLI pour ce nouveau flux
  (même limite déjà documentée) ; pas de nouveau test `web/` pour `startTenantCheckout`/le
  bouton (même niveau d'effort qu'en T24) ; pont manuel entre le `lookup_key` de
  `stripe_bootstrap_billing.mjs` et la variable d'env `STRIPE_PRICE_PRO_ID`.
  **`refundPayment` reste sans point d'entrée produit** — `T23` n'est donc résolu que pour sa
  partie checkout.
- **Risque de double souscription — pas de vérification d'abonnement existant avant d'afficher
  le bouton** : le dashboard n'affiche aujourd'hui aucune information de `subscription_tier`/
  `subscription_status`, donc un tenant déjà Pro/Elite voit quand même "Passer Pro" et peut
  relancer un checkout. Rien ne l'empêche côté kit ou côté `web/` : `createCheckoutSession` crée
  un nouveau `Customer` Stripe et une nouvelle Subscription active à chaque appel, sans vérifier
  d'abonnement préexistant — risque concret de facturation en double sur le même tenant, pas
  seulement un problème d'UX. Non corrigé dans ce chantier (cf. `plan.md` V4.6) — à traiter avant
  toute mise en production réelle.
