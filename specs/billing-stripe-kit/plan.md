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
