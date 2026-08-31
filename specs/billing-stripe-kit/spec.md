# Spécification : Extraction du module de facturation Stripe en package réutilisable

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
- **Validation de non-régression (T20)** : les 9 scénarios V1 (script existant, mocks) rejoués
  sans modification → tous passent. Les 7 scénarios T14 (DB réelle, stack Supabase local)
  rejoués sans modification → tous passent, y compris la fidélité `subscription_current_period_ends_at`
  sur annulation (le fix trouvé pendant l'implémentation V1). 9 nouveaux scénarios ajoutés pour
  `refundPayment` (omission propre de `amount`/`reason`, passthrough correct),
  `createCheckoutSession` (aucune régression sans `options`, `trialPeriodDays` seul, `discounts`
  seul, les deux ensemble sans logique d'interaction), et `payment.failed` (mapping correct,
  erreur si metadata absente, idempotence) — tous passent.
- **Reste à faire, tracé explicitement (T22/T23, hors périmètre de ce chantier)** : aucune
  route/UI côté `web/` ne consomme `refundPayment`, les nouvelles options de checkout, ou ne
  réagit à `payment.failed` — capacités livrées côté kit, pas branchées côté produit. Un
  paiement qui échoue réellement en prod ne déclenche aujourd'hui aucune action côté tenant.
