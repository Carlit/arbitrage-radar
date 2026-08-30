# Spec — Accès multi-tenant sécurisé sur les alertes d'arbitrage

## Quoi

Permettre à un utilisateur connecté de voir, filtrer et traiter les alertes d'arbitrage
de son tenant, sans qu'aucune requête côté client ne dépende d'un contournement de la RLS.

## Pourquoi

Le MVP actuel utilise la Service Role Key côté serveur pour afficher les alertes,
car les alertes générées par le script Python ne sont pas rattachées à un tenant.
C'est un risque de sécurité (accès total à la base sans isolation) qui doit être
supprimé avant d'ajouter des fonctionnalités dessus (filtres, statut, Stripe).

## Pour qui

- L'utilisateur `owner`/membre d'un tenant, qui doit voir uniquement les alertes
  de son propre tenant.

## Hors périmètre (pour cette spec)

- L'intégration Stripe elle-même (fera l'objet d'une spec séparée).
- Le design visuel des cartes (déjà acceptable en l'état).

## Questions à clarifier avant `/plan`

1. Le script Python d'insertion connaît-il déjà un `tenant_id` cible, ou doit-on
   définir un tenant par défaut pour le MVP (mono-tenant pour l'instant) ?
2. Est-ce qu'un utilisateur peut appartenir à plusieurs tenants, ou un seul pour l'instant ?
3. Le champ `status` (traité/non traité) est-il par alerte-globale ou par
   couple (alerte, tenant) — dans le cas où une alerte serait un jour visible par
   plusieurs tenants ?
