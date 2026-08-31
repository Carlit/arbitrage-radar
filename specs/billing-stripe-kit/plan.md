# Plan : Extraction du module de facturation Stripe (`billing-stripe-kit`)

Statut : validé (2026-08-30) — les 4 points signalés en §8 ont été confirmés tels quels,
y compris le Customer Stripe orphelin (§2), explicitement accepté comme dette différée pour
le MVP, non bloquante. Prêt pour `/tasks`.
Référence : `spec.md` (besoin + décisions `/clarify`).

## 0. Décisions actées

1. **Contenu du kit** : `webhook.ts`, `checkout.ts`, `portal.ts`, point d'entrée
   `createBillingKit(...)`. Le kit ne connaît ni `tenant`, ni `venues`.
2. **`accountId`** propagé via `customer.metadata.account_id` (Stripe Customer), lu de façon
   uniforme sur tous les événements. Un 4ᵉ événement générique `account.linked` est ajouté aux
   3 listés dans la demande initiale (`subscription.activated|updated|cancelled`).
3. **Idempotence** : store injectable, implémentation Postgres côté Wedge (nouvelle table
   `processed_stripe_events`).
4. **Aucune régression** sur `web/app/api/webhook/stripe/route.ts` — comportement HTTP externe
   identique (codes 400/500/200) à ce qui a été validé pour T1–T10 le 2026-08-30.
5. **Hors périmètre confirmé** : `specs/detection-scoring-engine/` et le moteur crypto ne sont
   pas touchés par ce chantier.

## 1. Structure du package

```
packages/billing-stripe-kit/
  package.json          # nom : billing-stripe-kit, pas de publication externe prévue
  tsconfig.json
  src/
    index.ts            # createBillingKit(config) — point d'entrée unique
    types.ts             # BillingEvent (union discriminée), IdempotencyStore
    checkout.ts           # createCheckoutSession
    portal.ts             # createPortalSession
    webhook.ts             # verifyEvent + mapping + dispatch + idempotence
```

**Consommation depuis `web/`** (décision d'implémentation, pas de workspace npm/pnpm à mettre
en place pour un seul package — trop de surface pour ce chantier) :
- `web/package.json` ajoute `"billing-stripe-kit": "file:../packages/billing-stripe-kit"`.
- `web/next.config.ts` ajoute `transpilePackages: ["billing-stripe-kit"]` (Next.js compile
  alors directement les sources TS du kit, pas de build/watch séparé à maintenir pour ce
  chantier).
- Pas de modification du `package.json` racine (celui-ci reste dédié aux scripts `.mjs`
  existants) — le kit est un package autonome, découvert uniquement via le `file:` dependency
  de `web/`.

## 2. `checkout.ts` — `createCheckoutSession(priceId, accountId, metadata)`

```ts
async function createCheckoutSession(priceId: string, accountId: string, metadata: Record<string, string> = {}) {
  const customer = await stripe.customers.create({
    metadata: { account_id: accountId },
  });

  return stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customer.id,
    client_reference_id: accountId, // redondant avec metadata, utile au support Stripe Dashboard
    line_items: [{ price: priceId, quantity: 1 }],
    metadata,
  });
}
```

- **Simplification V1 assumée et signalée** : un nouveau `Customer` Stripe est créé à **chaque**
  appel, sans recherche d'un `Customer` existant pour cet `accountId` (pas de déduplication via
  `stripe.customers.search`, dont la cohérence différée poserait un risque de doublon sur des
  appels rapprochés). Un checkout abandonné puis retenté peut donc laisser un `Customer` Stripe
  orphelin. **Sans impact côté Wedge** : `tenants.stripe_customer_id` n'est renseigné qu'une
  seule fois, via l'update conditionnel `WHERE stripe_customer_id IS NULL` déjà en place — le
  premier checkout complété gagne, les autres `Customer` restent simplement inutilisés côté
  Stripe. À revisiter uniquement si ces doublons deviennent une gêne opérationnelle réelle.
- `priceId` n'est pas validé par le kit (pas d'appel `stripe.prices.retrieve` avant checkout) —
  une erreur Stripe sur un `priceId` invalide remonte telle quelle à l'appelant.

## 3. `portal.ts` — `createPortalSession(stripeCustomerId, returnUrl)`

```ts
async function createPortalSession(stripeCustomerId: string, returnUrl: string) {
  return stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: returnUrl,
  });
}
```
Aucune ambiguïté : le kit reçoit déjà le `stripeCustomerId`, pas de résolution `accountId` à
faire ici. Pas de route Next.js consommant ce module dans ce chantier (aucune UI de portail
n'existe encore côté produit) — le module est livré prêt à l'emploi, câblé plus tard.

## 4. `webhook.ts` — vérification, idempotence, mapping, dispatch

### 4.1 Vérification de signature
`stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)` — identique au comportement
actuel de `route.ts`. Une signature absente/invalide lève une erreur typée
(`SignatureVerificationError`), que l'adaptateur traduit en `400` (comme aujourd'hui).

### 4.2 Idempotence (store injectable)
```ts
interface IdempotencyStore {
  has(eventId: string): Promise<boolean>;
  record(eventId: string): Promise<void>;
}
```
`createBillingKit` accepte un `idempotencyStore` optionnel. Si fourni : avant dispatch,
`has(event.id)` → si déjà vu, skip silencieux (retour normal, pas d'appel à `onEvent`). Sinon,
dispatch puis `record(event.id)` **après** succès de `onEvent` (pas avant — si `onEvent` échoue,
Stripe doit pouvoir retenter, donc l'événement ne doit pas être marqué "traité" tant qu'il a
réellement échoué). Si aucun store n'est fourni, le kit fonctionne sans garantie d'idempotence
et le documente (commentaire + type marquant le paramètre comme fortement recommandé).

**Implémentation côté Wedge** (`web/lib/billing/idempotency-store.ts`, pas dans le kit) :
```sql
create table public.processed_stripe_events (
  event_id text primary key,
  processed_at timestamptz not null default timezone('utc', now())
);
alter table public.processed_stripe_events enable row level security;
-- aucune policy : accès Service Role uniquement, même traitement que raw_market_ticks
```
Table technique, pas de donnée utilisateur, pas de scoping tenant à prévoir (même raisonnement
que `plan.md` §1.3 du chantier `detection-scoring-engine` pour `raw_market_ticks`).

### 4.3 Mapping événements Stripe → événements génériques

| Événement Stripe brut | Événement générique | Résolution `accountId` |
|---|---|---|
| `checkout.session.completed` | `account.linked` | `session.client_reference_id` (seul moment où on l'utilise) |
| `customer.subscription.created` | `subscription.activated` | `stripe.customers.retrieve(customerId).metadata.account_id` |
| `customer.subscription.updated` | `subscription.updated` | idem |
| `customer.subscription.deleted` | `subscription.cancelled` | idem |
| tout autre type | *(ignoré)* | — |

- Pour les événements `subscription.*`, `subscription.customer` n'est qu'un identifiant string
  dans le payload webhook (pas d'objet `Customer` développé) — le kit fait un appel
  `stripe.customers.retrieve` supplémentaire pour lire `metadata.account_id`. Coût : un aller-
  retour API Stripe de plus par événement, acceptable pour un traitement webhook (pas un chemin
  chaud).
- `price.metadata` (convention `app_tier` de Wedge) reste directement disponible sur
  `subscription.items.data[0].price.metadata` dans l'objet `raw` transmis par l'événement
  générique — le kit ne l'interprète pas, il transmet l'objet Stripe brut tel quel.

### 4.4 Forme des événements génériques (`types.ts`)
```ts
type BillingEvent =
  | { type: "account.linked"; accountId: string; stripeCustomerId: string; raw: Stripe.Checkout.Session }
  | { type: "subscription.activated" | "subscription.updated"; accountId: string; stripeCustomerId: string; stripeSubscriptionId: string; raw: Stripe.Subscription }
  | { type: "subscription.cancelled"; accountId: string; stripeCustomerId: string; raw: Stripe.Subscription };
```

### 4.5 Écart assumé par rapport à la signature littérale de la demande

`createBillingKit(stripeSecretKey, onEvent)` (2 arguments positionnels, tel que demandé) devient
`createBillingKit(config)` avec `config = { stripeSecretKey, webhookSecret, onEvent, idempotencyStore? }`.
Nécessaire car `webhookSecret` est requis pour la vérification de signature (§4.1) et
`idempotencyStore` pour l'idempotence (§4.2, décision `/clarify` #2) — deux responsabilités que
la spec assigne explicitement à `webhook.ts`/`createBillingKit`, mais qu'une signature à 2
arguments positionnels ne peut pas porter proprement. Signalé ici plutôt qu'appliqué en
silence — à confirmer en revue.

## 5. Adaptateur : `web/app/api/webhook/stripe/route.ts` (fin)

```ts
const kit = createBillingKit({
  stripeSecretKey: process.env.STRIPE_SECRET_KEY!,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
  idempotencyStore: createSupabaseIdempotencyStore(), // web/lib/billing/idempotency-store.ts
  onEvent: async (event) => {
    switch (event.type) {
      case "account.linked":
        return linkTenantToCustomer(event.accountId, event.stripeCustomerId);
      case "subscription.activated":
      case "subscription.updated":
        return syncTenantSubscription(event.stripeCustomerId, event.raw);
      case "subscription.cancelled":
        return cancelTenantSubscription(event.stripeCustomerId, event.raw);
        // event.raw : corrigé en /implement — le code original recalcule
        // subscription_current_period_ends_at depuis l'abonnement supprimé plutôt que de le
        // laisser inchangé ; cancelTenantSubscription a donc besoin de l'objet Subscription,
        // pas seulement du customerId, pour rester fidèle au comportement T1-T10.
    }
  },
});

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "..." }, { status: 400 });

  const rawBody = await request.text();

  try {
    await kit.webhook.handleRequest(rawBody, signature);
  } catch (error) {
    if (error instanceof SignatureVerificationError) {
      return NextResponse.json({ error: "Signature Stripe invalide." }, { status: 400 });
    }
    console.error("Échec du traitement du webhook Stripe", error);
    return NextResponse.json({ error: "..." }, { status: 500 });
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
```

- `linkTenantToCustomer` / `syncTenantSubscription` / `cancelTenantSubscription` reprennent
  **exactement** la logique actuelle de `handleCheckoutSessionCompleted` /
  `updateTenantFromSubscription` (extraction de tier via `price.metadata.app_tier`, update
  conditionnel `WHERE stripe_customer_id IS NULL`, etc.) — déplacées telles quelles dans
  `web/lib/billing/` (nouveaux fichiers, pas de changement de comportement).
- `route.ts` n'importe plus `stripe` directement (tout passe par le kit) — seul le kit connaît
  le SDK Stripe.
- Un tenant introuvable pour un `customer.subscription.*` (aujourd'hui : `throw` → 500 → Stripe
  retente) doit continuer à produire une erreur qui remonte jusqu'à `route.ts` → 500. À vérifier
  explicitement en test de non-régression (§7).

## 6. Migration DB

Une seule migration pour ce chantier : `processed_stripe_events` (§4.2). Ne touche pas à
`tenants` ni aux tables du chantier `detection-scoring-engine`.

## 7. Validation de non-régression (avant `/tasks` détaillées)

Reprendre exactement les scénarios déjà validés pour T6–T10 de `stripe-billing/tasks.md`
(simulation directe sur le stack Supabase local + payloads Stripe simulés), après le
refactor :
1. `checkout.session.completed` (désormais via `account.linked`) → `stripe_customer_id` posé,
   idempotent sur rejeu.
2. `customer.subscription.created/updated` → tier/statut/`stripe_subscription_id` corrects.
3. `customer.subscription.deleted` → reset `free`/`canceled`.
4. Requête sans signature / signature invalide → `400`, aucune écriture.
5. **Nouveau** : rejouer le même `event.id` deux fois → `onEvent` n'est appelé qu'une fois
   (vérifie `processed_stripe_events`).
6. **Nouveau** : `customer.subscription.updated` reçu alors que `customer.metadata.account_id`
   est absent (customer créé hors du kit, cas limite) → comportement à définir explicitement en
   `/tasks` (probablement : log + `500` pour retry, jamais un crash silencieux).
7. Revalidation RLS `can_access_alert` (même test qu'en T10 stripe-billing) — doit rester
   identique, rien dans ce chantier ne touche `market_alerts`/`tenant_alert_access`.

## 8. Risques / dette explicitement signalée

- **Customers Stripe orphelins** (§2) — assumé, sans impact correctness côté Wedge.
- **Signature `createBillingKit` élargie** (§4.5) — déviation vs la demande initiale, à
  confirmer en revue plutôt qu'appliquée silencieusement.
- **Appel Stripe API supplémentaire par événement `subscription.*`** (§4.3) — coût réseau
  mineur, pas de cache prévu en V1.
- **Pas de workspace npm/pnpm** (§1) — le `file:` dependency est plus simple pour un seul
  package mais moins standard qu'un vrai monorepo ; à reconsidérer si d'autres packages
  apparaissent.
- **`portal.ts` livré sans consommateur** — aucune route/UI ne l'appelle dans ce chantier (hors
  périmètre de la demande), pur ajout de capacité au kit.

---

# Plan V2 (2026-08-31) — 3 nouvelles capacités

Statut : validé — la seule ambiguïté réelle (type de `reason`) tranchée en `/clarify` (§10 de
`spec.md`), l'autre point signalé (`discounts`/`trialPeriodDays`) résolu par recherche
factuelle (aucun conflit Stripe documenté). Prêt pour `/tasks`.
Référence : `spec.md` §9-§11.

## V2.0 Décisions actées

1. **`refunds.ts`** : nouveau module, `refundPayment(paymentIntentId, amount?, reason?)`,
   wrapper direct de `stripe.refunds.create`. Aucun `accountId` — un remboursement se fait par
   `paymentIntentId` seul, cohérent avec « aucun lien avec tenant ».
2. **`reason`** typé `'duplicate' | 'fraudulent' | 'requested_by_customer'` (union littérale
   Stripe) — confirmé en `/clarify`.
3. **`createCheckoutSession`** : `trialPeriodDays?`/`discounts?` regroupés dans un **4ᵉ
   paramètre optionnel `options`** plutôt que 2 paramètres positionnels supplémentaires — détail
   et justification en V2.2.
4. **`discounts`/`trialPeriodDays`** : passthrough indépendant, aucune logique d'interaction
   (pas de conflit Stripe documenté entre les deux — cf. `spec.md` §10.1).
5. **`invoice.payment_failed`** → événement générique `payment.failed`, même mécanisme exact
   que `subscription.*` (résolution `accountId` via `customer.metadata`, idempotence, erreur si
   metadata absente).
6. **Aucune migration DB, aucun changement de schéma** — ces 3 ajouts sont strictement internes
   au kit.
7. **Aucun consommateur `web/` mis à jour dans ce chantier** — ni `refunds.ts`, ni les nouveaux
   paramètres de `createCheckoutSession`, ni `payment.failed` n'ont de route/logique tenant
   câblée côté produit (même statut que `portal.ts` en V1 — capacité livrée, pas branchée).
   `route.ts`'s `onEvent` switch n'a pas de `default`/exhaustiveness check : un event
   `payment.failed` reçu en prod sera silencieusement ignoré tant que personne ne l'ajoute au
   switch — comportement sûr (pas de crash), mais à garder en tête, pas un oubli caché (cf.
   V2.6 Risques).

## V2.1 `refunds.ts`

```ts
export function createRefundsModule(stripe: Stripe) {
  async function refundPayment(
    paymentIntentId: string,
    amount?: number,
    reason?: Stripe.RefundCreateParams.Reason,
  ): Promise<Stripe.Refund> {
    return stripe.refunds.create({
      payment_intent: paymentIntentId,
      ...(amount !== undefined ? { amount } : {}),
      ...(reason !== undefined ? { reason } : {}),
    });
  }

  return { refundPayment };
}
```
`Stripe.RefundCreateParams.Reason` est le type déjà exposé par le SDK Stripe lui-même (union
littérale des 3 valeurs) — pas un type inventé par le kit, même logique que le ré-export
`Stripe` existant (V1 §8). Câblé dans `index.ts` : `refunds: createRefundsModule(stripe)`.

## V2.2 `createCheckoutSession` — options

```ts
interface CreateCheckoutSessionOptions {
  trialPeriodDays?: number;
  discounts?: Stripe.Checkout.SessionCreateParams.Discount[];
}

async function createCheckoutSession(
  priceId: string,
  accountId: string,
  metadata: Record<string, string> = {},
  options: CreateCheckoutSessionOptions = {},
): Promise<Stripe.Checkout.Session> {
  const customer = await stripe.customers.create({ metadata: { account_id: accountId } });

  return stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customer.id,
    client_reference_id: accountId,
    line_items: [{ price: priceId, quantity: 1 }],
    metadata,
    ...(options.trialPeriodDays !== undefined
      ? { subscription_data: { trial_period_days: options.trialPeriodDays } }
      : {}),
    ...(options.discounts !== undefined ? { discounts: options.discounts } : {}),
  });
}
```
**Décision d'implémentation signalée** (pas dans la demande initiale) : `trialPeriodDays` et
`discounts` sont regroupés dans un objet `options` (4ᵉ paramètre), pas ajoutés comme 2
paramètres positionnels supplémentaires après `metadata`. Justification : évite d'avoir à
passer `undefined` positionnellement pour `metadata` quand on veut seulement `discounts` sans
metadata custom ; cohérent avec le pattern déjà établi (`createBillingKit(config)`). Aucun
appelant existant dans `web/` (le follow-up T13 « route de Checkout Session » n'a jamais été
implémenté) — zéro risque de régression sur un appel existant.

## V2.3 `webhook.ts` — `invoice.payment_failed`

Ajout dans `mapStripeEventToBillingEvent` :
```ts
case "invoice.payment_failed": {
  const invoice = event.data.object as Stripe.Invoice;
  const stripeCustomerId =
    typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;

  if (!stripeCustomerId) {
    return null;
  }

  const accountId = await resolveAccountId(stripe, stripeCustomerId);

  return { type: "payment.failed", accountId, stripeCustomerId, raw: invoice };
}
```
`types.ts` — nouvelle branche de l'union `BillingEvent` :
```ts
| { type: "payment.failed"; accountId: string; stripeCustomerId: string; raw: Stripe.Invoice }
```
Même comportement d'erreur que `subscription.*` si `customer.metadata.account_id` absent
(`MissingAccountIdError`, propagée, adaptateur → `500`, retry Stripe). Même passage par le
store d'idempotence (aucun changement dans `webhook.ts` au niveau dispatch — la nouvelle branche
suit le chemin déjà générique).

## V2.4 Sécurité / RLS / multi-tenant

N/A — aucune nouvelle table, aucune colonne, aucun accès Supabase dans ces 3 ajouts. Le kit
reste sans notion de tenant (`refunds.ts` n'a même pas de `accountId`). Rien à revoir côté RLS.

## V2.5 Validation de non-régression

Reprendre le script T14 existant (7 scénarios déjà validés + revalidation `can_access_alert`)
tel quel pour confirmer qu'aucune régression n'a été introduite sur les 4 événements/fonctions
existants, puis ajouter :
1. `refundPayment` : appel avec mock Stripe, vérifie que `stripe.refunds.create` reçoit
   `payment_intent`, `amount` (si fourni) et `reason` (si fourni) correctement, et que l'appel
   sans `amount`/`reason` ne les inclut pas du tout dans la requête (pas de `undefined` explicite
   envoyé à Stripe).
2. `createCheckoutSession` avec `options.trialPeriodDays` : vérifie
   `subscription_data.trial_period_days` dans l'appel à `stripe.checkout.sessions.create`.
3. `createCheckoutSession` avec `options.discounts` : vérifie `discounts` transmis tel quel.
4. `createCheckoutSession` sans `options` (comportement V1) : vérifie qu'aucune régression —
   toujours aucun `subscription_data`/`discounts` dans l'appel, résultat identique à avant.
5. Mapping `invoice.payment_failed` → `payment.failed`, avec `customer.metadata.account_id`
   présent (succès) et absent (`MissingAccountIdError`, même test que T6c en V1).
6. Test réel via Stripe CLI si possible (`stripe trigger invoice.payment_failed`,
   `stripe trigger charge.refunded` n'est pas un remboursement déclenché par nous — pour tester
   `refundPayment` en conditions réelles, il faudra appeler la fonction directement contre un
   `PaymentIntent` de test existant, pas via `stripe trigger` qui ne simule pas un appel sortant
   de notre côté).

## V2.6 Risques / dette explicitement signalée

- **`payment.failed` non consommé côté `web/`** (V2.0 point 7) — le switch `onEvent` de
  `route.ts` n'a pas de branche pour ce nouveau type et n'est pas exhaustif au sens TypeScript
  (pas de `never` check) : un vrai paiement échoué en prod ne déclenchera **aucune action**
  (pas de passage en `past_due`, pas de notification) tant qu'une tâche de suivi explicite ne
  câble pas cette logique côté produit. À tracer comme tâche de suivi, pas un détail — un
  paiement qui échoue silencieusement sans que le tenant repasse `past_due` est exactement le
  genre de trou que `stripe-billing` visait à combler à l'origine.
- **`refunds.ts` et les nouveaux paramètres de checkout n'ont aucun test Stripe CLI réel** —
  contrairement aux 4 événements existants (bouclé le 2026-08-31), `refundPayment` n'est
  testable en conditions réelles qu'en l'appelant directement (pas via `stripe trigger`), et les
  nouveaux paramètres de `createCheckoutSession` n'ont pas de consommateur pour les exercer
  au-delà des tests par mock.

# Plan V3 (2026-08-31) — Câblage T22/T23

Référence : `tasks.md` T22/T23 (suivi explicite, V2), `spec.md` (bandeau de statut). Décisions
ci-dessous actées avec l'utilisateur après vérification du code réel — pas de suppositions.

## V3.0 Décisions actées

1. **`payment.failed` → `route.ts`** : le handler force `tenants.subscription_status` à
   `'past_due'` directement, sans période de grâce. Constat vérifié avant décision :
   `subscription_is_entitled()` (migration initiale, `supabase/migrations/20260830172129_initial_schema.sql`)
   n'autorise que `'trialing'`/`'active'` — `past_due` coupe donc l'accès **immédiatement**, tout
   comme `canceled` aujourd'hui. Il n'existe aucune grâce réelle au niveau RLS/entitlement, et ce
   chantier n'en introduit pas. Autre nuance vérifiée : Stripe positionne généralement déjà lui-même
   `subscription.status` à `past_due` lors d'un échec de paiement, et émet un
   `customer.subscription.updated` déjà câblé depuis T1–T10 (`syncTenantSubscription`) — le
   câblage de `payment.failed` est donc en partie défensif/redondant avec ce chemin existant, pas
   le seul mécanisme qui produirait ce statut en pratique. Décision explicite malgré cette
   redondance : le câblage direct reste plus fiable que de compter sur un événement Stripe
   différent qui pourrait ne pas arriver dans tous les cas (ex. configuration Smart Retries qui
   retarde le passage en `past_due` côté `Subscription`).
2. **`refundPayment`** : reste sans point d'entrée produit dans ce chantier. Vérifié avant
   décision : `web/app/` ne contient que landing, auth, dashboard et la route webhook — aucune
   UI ni route admin/support. Le seul concept de rôle du schéma (`app_role`:
   `owner`/`admin`/`member`) est un rôle **par tenant**, pas un rôle staff plateforme — construire
   un point d'entrée nécessiterait d'abord ce chantier de rôle staff, hors périmètre ici. `T23`
   reste donc en dette explicite pour cette partie, avec cette justification informée plutôt que
   la mention générique précédente.
3. **Options de checkout (`trialPeriodDays`/`discounts`)** : différées explicitement. Vérifié
   avant décision : `createCheckoutSession`/`createPortalSession` (T13) n'ont strictement aucun
   appelant dans `web/` — pas de pricing page, pas de bouton "S'abonner". Ajouter des options à
   un appel qui n'existe nulle part n'a pas de sens produit. Repris uniquement quand un vrai flux
   d'abonnement self-serve existera. `T23` reste donc aussi en dette explicite pour cette partie.

Conséquence : ce chantier ne résout que le premier tiers de T22/T23 (`payment.failed`). `T23`
dans son intégralité reste non fait à l'issue de ce chantier, mais avec une justification
informée (vérifiée sur le code réel), pas juste "pas encore fait par manque de temps".

## V3.1 `route.ts` — case `payment.failed`

- `web/lib/billing/tenant-sync.ts` : nouvelle fonction `markTenantPaymentFailed(stripeCustomerId)`
  — même pattern que `syncTenantSubscription`/`cancelTenantSubscription` (update conditionnel sur
  `stripe_customer_id`, erreur levée si aucun tenant trouvé). Met à jour uniquement
  `subscription_status` à `'past_due'` — ni `subscription_tier` ni
  `subscription_current_period_ends_at` ne sont touchés : un `Stripe.Invoice` ne porte pas
  l'information de fin de période courante (contrairement à un `Stripe.Subscription`), donc rien
  de fiable à y recalculer.
- `web/app/api/webhook/stripe/route.ts` : nouveau `case "payment.failed"` dans le switch
  `onEvent`, appelle `markTenantPaymentFailed(event.stripeCustomerId)`.
- **Pas de notification tenant** (email/in-app) dans ce chantier — vérifié avant décision :
  aucune dépendance ni infrastructure d'envoi d'email/notification n'existe dans `web/`. Ajouter
  ce mécanisme serait un chantier séparé (choix d'un provider, templates, etc.), pas une
  extension mineure de celui-ci.

## V3.2 `refunds.ts` / options de `createCheckoutSession` — confirmé non câblé

Aucun code produit ajouté pour ces deux capacités dans ce chantier — cf. V3.0 points 2 et 3 pour
la justification à jour, qui remplace la mention plus générique de `plan.md` V2.6 /
`tasks.md` T23.

## V3.3 Sécurité / RLS / multi-tenant

Aucun changement à `subscription_is_entitled()` ni aux policies RLS existantes. Le comportement
d'entitlement pour `past_due` reste identique à celui déjà en place pour
`canceled`/`unpaid`/`incomplete`/etc. (accès refusé) — cf. `can_access_alert`,
`can_access_tier_feature`.

## V3.4 Validation de non-régression

- Rejouer les scénarios T14/T20 existants tels quels (aucune régression attendue sur
  `account.linked`/`subscription.*`).
- Nouveau scénario : `invoice.payment_failed` avec `customer.metadata.account_id` correspondant
  à un tenant existant → `tenants.subscription_status` passe à `'past_due'` en base, tier et
  `subscription_current_period_ends_at` inchangés. Même event sans tenant correspondant
  (`stripe_customer_id` orphelin côté `tenants`) → erreur levée, `500` côté `route.ts` (retry
  Stripe), même pattern que `syncTenantSubscription`/`cancelTenantSubscription`.
- `tsc --noEmit` sur le kit et sur `web/`.
- Test HTTP réel via Stripe CLI : même limite déjà documentée (pas de clés Stripe test dans cet
  environnement) — non fait ici, à faire par l'utilisateur en local s'il le souhaite (comme pour
  la dette T13 bis, déjà bouclée par ailleurs).

## V3.5 Risques / dette explicitement signalée (mise à jour)

- **`T23` reste non fait, avec justification informée** (V3.0 points 2–3) plutôt que "pas encore
  fait" : `refundPayment` n'a pas de surface produit où exister (pas d'UI admin/support, pas de
  rôle staff plateforme) ; les options de checkout n'ont pas de flux d'abonnement où s'insérer
  (pas de pricing page, pas de bouton "S'abonner"). Les deux restent des capacités livrées côté
  kit, non consommées côté produit — à réévaluer quand ces surfaces existeront.
- **`past_due` ne donne aucune grâce réelle** — décision actée en V3.0.1, pas un oubli. Si un
  vrai mécanisme de grâce (accès maintenu N jours après échec de paiement) est souhaité un jour,
  ça nécessite de modifier `subscription_is_entitled()` (migration SQL) en plus du câblage
  applicatif — chantier séparé, non fait ici.
- **Pas de notification tenant** — aucune infra email/notification n'existe dans le produit ;
  `payment.failed` reste silencieux côté utilisateur final (visible seulement s'il consulte son
  dashboard après coup, où RLS lui refuse déjà l'accès sans lui expliquer pourquoi). Signalé
  comme risque UX, pas corrigé dans ce chantier.
