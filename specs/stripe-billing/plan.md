# Plan : Intégration Stripe (Abonnements & Paiements)

Statut : proposé — en attente de validation avant `/tasks` et `/implement`.

## 0. Décisions issues de `/clarify`

1. `tenants.stripe_customer_id` devient nullable (migration).
2. La logique webhook migre de `stripe_webhook_fastify.mjs` vers une API Route Next.js
   (`web/app/api/webhook/stripe/route.ts`) ; le serveur Fastify est supprimé une fois la
   migration validée en conditions réelles.
3. Le `subscription_tier` est mappé via la metadata Stripe portée par les **Price**
   (`price.metadata.app_tier`), pas par les Products — pour supporter plusieurs prix par tier
   (ex : mensuel/annuel).

Ces trois décisions sont déjà reflétées dans le code existant (`stripe_bootstrap_billing.mjs`
attache `app_tier` aux Products *et* aux Prices ; `extractTierFromSubscription` lit déjà
`price.metadata.app_tier` en priorité), ce qui simplifie la migration : il s'agit surtout de
déplacer la logique, pas de la réécrire.

## 1. Base de données (Migration)

- Nouvelle migration : `npx supabase migration new make_stripe_customer_id_nullable`.
- SQL :
  ```sql
  alter table public.tenants alter column stripe_customer_id drop not null;
  ```
- **Effet de bord à corriger dans la même migration** : la fonction
  `public.handle_new_user()` (dans `20260830172129_initial_schema.sql`) insère aujourd'hui
  un placeholder `'cus_pending_' || new.id` dans `stripe_customer_id` pour contourner la
  contrainte `NOT NULL UNIQUE`. Si on ne touche que la contrainte, ce placeholder continue
  d'être écrit et **aucun tenant n'aura jamais de `stripe_customer_id` réel** tant que rien
  ne le corrige explicitement — le webhook ne pourra jamais matcher
  `tenants.stripe_customer_id` contre un vrai customer Stripe.
  → La migration doit aussi `create or replace function public.handle_new_user()` avec
  `stripe_customer_id` omis de l'`insert` (donc `null` par défaut) au lieu du placeholder.
- Isolation multi-tenant : aucun changement de RLS nécessaire ici (colonne technique sur
  `tenants`, déjà protégée par les policies existantes `tenants_select_member` /
  `tenants_update_admin`). La mise à jour de cette colonne par le webhook se fait via
  Service Role Key (voir §3), donc hors RLS par construction — c'est le cas d'usage attendu,
  pas un contournement d'une requête utilisateur.

## 2. Lien Tenant ↔ Stripe Customer (gap non couvert par la spec initiale)

**Constat** : avec le placeholder supprimé, plus rien ne relie un tenant à un `customer`
Stripe. Or aucune route de création de Checkout Session / Customer n'existe encore dans
`web/` (vérifié : aucun fichier ne référence `checkout` ou `stripe` côté `web/app`). Sans ce
lien, les événements `customer.subscription.*` ne matcheront jamais aucun tenant
(`stripe_customer_id` restera `null` pour tout le monde) et la synchro sera silencieusement
inopérante — ce qui contredit le principe constitution §3 (« pas de contournement
silencieux »).

**Décision proposée pour ce chantier** (à valider) : traiter aussi l'événement
`checkout.session.completed` dans la même API Route webhook, en s'appuyant sur
`client_reference_id` = `tenant_id` (à passer lors de la création future de la Checkout
Session, hors périmètre ici) pour écrire `stripe_customer_id` sur le tenant correspondant.
C'est un ajout mineur au webhook (même fichier, même mécanisme de vérification de
signature), donc cohérent avec le périmètre « webhook Stripe » de la spec.

**Reste explicitement hors périmètre** (à documenter comme dette de suivi, pas à coder
silencieusement) : la route/le bouton qui crée réellement la Checkout Session côté produit
(ex. `web/app/api/billing/checkout/route.ts`) et passe `client_reference_id`. Sans cette
pièce, personne ne peut encore payer depuis l'app — ce chantier rend la synchro *possible*,
pas le parcours d'achat complet. Une tâche de suivi explicite doit être créée (`tasks.md`)
plutôt que fusionnée sans elle, conformément à la règle « pas de contournement silencieux ».

## 3. Webhook Stripe (API Route Next.js)

- Fichier : `web/app/api/webhook/stripe/route.ts` (`export const runtime = 'nodejs'` pour
  garder le corps brut nécessaire à `stripe.webhooks.constructEvent`).
- Dépendance à ajouter à `web/package.json` : `stripe` (actuellement absente de `web/`, elle
  n'existe que via le script racine `stripe_webhook_fastify.mjs`).
- **Sécurité** :
  - Lire le corps de la requête en texte brut (`await request.text()`), vérifier la
    signature via `stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET)`
    — rejeter (400) toute requête sans signature valide, avant tout accès DB.
  - Utiliser un client Supabase **Service Role** dédié côté serveur (jamais le client
    `web/lib/supabase/server.ts` utilisé pour les requêtes utilisateur authentifiées) pour
    écrire sur `tenants`. Ce contournement de RLS est nécessaire (le webhook n'a pas de
    session `auth.uid()`) et **signalé ici explicitement** : la signature Stripe fait office
    de frontière de confiance à la place de RLS, et l'écriture reste strictement scopée aux
    colonnes de facturation (`stripe_customer_id`, `stripe_subscription_id`,
    `subscription_tier`, `subscription_status`, `subscription_current_period_ends_at`).
  - Variables d'environnement requises côté `web/` (`.env.local` ou secrets Vercel) :
    `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`,
    `NEXT_PUBLIC_SUPABASE_URL` (ou équivalent serveur) — distinctes de `.env.billing` qui
    reste utilisé uniquement par le script `stripe_bootstrap_billing.mjs`.
- **Logique métier** (portage direct de `stripe_webhook_fastify.mjs`, quasi inchangée) :
  - `customer.subscription.created` / `.updated` → `updateTenantFromSubscription` :
    - `stripe_subscription_id` = `subscription.id`
    - `subscription_tier` = `subscription.items.data[0].price.metadata.app_tier`
      (fallback `lookup_key`, puis `free` — logique déjà existante, portée telle quelle)
    - `subscription_status` = statut normalisé (whitelist déjà définie, sinon `incomplete`)
    - `subscription_current_period_ends_at` = `items.data[0].current_period_end` converti
      en ISO
    - `UPDATE tenants ... WHERE stripe_customer_id = :customerId`
  - `customer.subscription.deleted` → force `tier=free`, `status=canceled`,
    `stripe_subscription_id=null`.
  - `checkout.session.completed` (nouveau, voir §2) → `UPDATE tenants SET
    stripe_customer_id = :customerId WHERE id = :tenantId` (`tenantId` =
    `session.client_reference_id`), idempotent si déjà rempli.
  - Tout autre type d'événement : `200 { received: true }` sans effet (ne pas faire échouer
    Stripe sur des events non gérés).
  - Erreur de traitement (tenant introuvable, etc.) → logguer et retourner `500` pour que
    Stripe retente (comportement déjà présent côté Fastify, à conserver).

## 4. Configuration des Prix (Stripe Bootstrap)

- `stripe_bootstrap_billing.mjs` respecte déjà la décision #3 (`app_tier` sur les Prices,
  via `ensurePrice`). Aucune réécriture nécessaire, seulement une vérification manuelle que
  les Prices actifs en environnement Stripe (test puis prod) portent bien cette metadata
  avant de basculer le webhook en prod.
- Le script reste un outil d'admin ponctuel exécuté depuis la racine (`.env.billing`), hors
  du serveur applicatif — cohérent avec la règle constitution sur l'usage de la Service Role
  Key pour des scripts serveur ponctuels.

## 5. Nettoyage

- Supprimer `stripe_webhook_fastify.mjs` **seulement après** validation en local (Stripe CLI)
  et idéalement un cycle de test en environnement de staging/preview, pas avant.
- Retirer les dépendances devenues inutiles du `package.json` racine si elles n'étaient
  utilisées que par ce serveur (`fastify`, `@fastify/raw-body`) — à vérifier qu'aucun autre
  script ne s'en sert avant suppression.
- Conserver `.env.billing` uniquement pour les variables du bootstrap script
  (`STRIPE_SECRET_KEY`, `STRIPE_CURRENCY`, `STRIPE_PRICE_*`) ; retirer `PORT`/`HOST` devenus
  inutiles une fois Fastify supprimé.

## 6. Validation

- Local : `stripe listen --forward-to localhost:3000/api/webhook/stripe`.
- Scénarios à couvrir manuellement avant suppression du serveur Fastify :
  1. `checkout.session.completed` simulé → `stripe_customer_id` du tenant se remplit.
  2. `customer.subscription.created` (tier `pro`) → `subscription_tier=pro`,
     `subscription_status` cohérent avec le statut Stripe.
  3. Changement de Price vers `elite` → `subscription.updated` → tier mis à jour.
  4. Annulation (`subscription.deleted`) → tier retombe à `free`, statut `canceled`,
     `stripe_subscription_id` vidé.
  5. Requête sans signature / signature invalide → `400`, aucune écriture DB.
  6. Vérifier via une requête authentifiée (client anon key, utilisateur membre du tenant)
     que `can_access_alert` reflète bien le nouveau statut — confirme que la RLS existante
     s'appuie correctement sur les colonnes mises à jour par le webhook.

## 7. Risques / dette explicitement signalée

- **Parcours d'achat incomplet** (§2) : ce chantier ne crée pas la Checkout Session côté
  produit. Sans elle, `stripe_customer_id` ne sera jamais renseigné en usage réel, même si
  le webhook est correct. À traiter comme tâche de suivi obligatoire, pas comme un détail
  optionnel.
- **Service Role Key dans l'API Route** (§3) : usage légitime et documenté, pas un
  contournement silencieux — mais toute évolution qui élargirait les colonnes/tables
  modifiables par ce endpoint doit repasser par une revue explicite.
- **Double source de vérité env** : `.env.billing` (script racine) vs variables Next.js
  (`web/.env.local` ou secrets de déploiement) doivent rester synchronisées manuellement tant
  qu'il n'y a pas de gestion centralisée des secrets.
