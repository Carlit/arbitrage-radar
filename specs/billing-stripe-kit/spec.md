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
- **Reste à faire (T13 bis / dette non bloquante déjà signalée en `stripe-billing`)** : test
  HTTP réel via `stripe listen`/`stripe trigger` avec de vraies clés Stripe test — non
  disponibles dans cet environnement d'implémentation, comme pour le chantier `stripe-billing`
  à l'origine.
- `web/.env.local.example` reste à compléter avec `STRIPE_WEBHOOK_SECRET` si ce n'est pas déjà
  fait (déjà présent depuis `stripe-billing`, vérifié inchangé).
