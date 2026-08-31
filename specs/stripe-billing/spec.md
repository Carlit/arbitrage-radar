# Spécification : Intégration Stripe (Abonnements & Paiements)

## 1. Quoi (Le besoin)
Synchroniser les abonnements Stripe avec l'état des tenants dans la base de données Supabase.
Il s'agit d'utiliser les scripts existants (`stripe_bootstrap_billing.mjs`, `stripe_webhook_fastify.mjs`) et la configuration `.env.billing` pour :
- Écouter les événements Stripe (finalisation de paiement, création, mise à jour, annulation d'abonnement).
- Établir et maintenir le lien entre un tenant et son `customer` Stripe (`checkout.session.completed`), condition nécessaire pour que les événements d'abonnement puissent ensuite être rattachés au bon tenant.
- Mettre à jour automatiquement les colonnes de la table `tenants` : `stripe_customer_id`, `stripe_subscription_id`, `subscription_tier`, `subscription_status`, et `subscription_current_period_ends_at`.
- Garantir que la policy RLS `can_access_alert` s'appuie sur le véritable statut financier du tenant pour accorder ou révoquer l'accès aux opportunités de marché.

## 2. Pourquoi (Le problème à résoudre)
- **Monétisation du MVP** : Actuellement, le statut de l'abonnement (`subscription_tier` / `subscription_status`) est géré manuellement ou fixé par défaut.
- **Automatisation de l'accès** : La policy RLS limitant l'accès aux alertes dépend de ces colonnes. Sans mise à jour automatique via les webhooks Stripe, un client ayant annulé ou échoué son paiement continuerait d'avoir accès au service, ou inversement, un nouveau client payant serait bloqué.

## 3. Pour qui
- **Les utilisateurs finaux (Tenants)** : Pour que leur accès au Dashboard s'active ou se désactive en temps réel en fonction de leurs paiements.
- **L'administrateur / Le business** : Pour garantir que seules les personnes en règle financièrement consomment les alertes (qui ont une forte valeur ajoutée).

## 4. Hors périmètre
- **Modification de la RLS** : La policy `can_access_alert` est déjà conditionnée par le statut et le tier. On ne la modifie pas, on s'assure juste que les données sur lesquelles elle repose sont exactes.
- **Facturation complexe** : Pas de gestion de prorata, de facturation à l'usage (metered billing) ou d'add-ons complexes pour ce MVP. On reste sur un abonnement récurrent simple.
- **Parcours d'achat / Checkout Session** : Ce chantier rend la synchro webhook fonctionnelle (y compris le lien tenant↔customer via `checkout.session.completed`), mais ne crée pas la route ni le bouton qui déclenchent réellement une Checkout Session côté produit. Tant que cette pièce n'existe pas (suivi tracé séparément), aucun tenant ne peut effectivement s'abonner depuis l'app.

## 5. Statut (mis à jour après `/implement`)

- **Fait et vérifié en local** : migration `stripe_customer_id` nullable + fix de
  `handle_new_user()` (T1) ; client Supabase Service Role dédié (T2) ; dépendance `stripe`
  côté `web/` (T3) ; documentation des variables d'environnement avec avertissement
  `NEXT_PUBLIC_` (T4) ; route webhook `web/app/api/webhook/stripe/route.ts` couvrant
  `checkout.session.completed`, `customer.subscription.created|updated|deleted` et les
  événements non gérés (T5–T9, code écrit et logique DB rejouée manuellement sur le stack
  Supabase local) ; vérification bout-en-bout que la policy RLS `can_access_alert` réagit
  correctement aux colonnes mises à jour par le webhook (T10).
- **Reste à faire** : validation du webhook via un vrai event Stripe signé (`stripe listen` /
  `stripe trigger`, nécessite des clés Stripe test réelles — non disponibles dans
  l'environnement d'implémentation) ; suppression de `stripe_webhook_fastify.mjs` une fois
  cette validation faite (T11) ; route de création de Checkout Session (T13, hors périmètre
  de ce chantier, tracée comme suivi explicite).