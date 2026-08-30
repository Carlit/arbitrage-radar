# Spec — Accès multi-tenant sécurisé sur les alertes d'arbitrage

**Statut : Fait**

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

## Questions clarifiées et décisions retenues

1. **Tenant par défaut pour le script Python** : le script `arbitrage_radar_poc.py` lit une
   variable d'environnement `DEFAULT_TENANT_ID` et lie chaque alerte insérée à ce tenant
   via `tenant_alert_access`, en mode mono-tenant pour le MVP.
2. **Un seul tenant actif par utilisateur (pour le MVP)** : bien que le schéma supporte le
   multi-tenant complet (`tenant_memberships`), le frontend s'appuie sur
   `app_users.default_tenant_id` pour scoper l'accès à un seul tenant à la fois.
3. **Statut de traitement scopé par tenant** : le champ `read_at` sur `tenant_alert_access`
   porte le statut "traité/lu" par tenant, plutôt qu'un statut global sur `market_alerts`.
   `market_alerts.status` reste réservé au cycle de vie global de l'opportunité de marché
   (open/suppressed/expired/resolved).

## Validation

- Isolation multi-tenant testée et confirmée : un deuxième tenant de test, sans accès
  configuré, ne voit aucune alerte d'un autre tenant sur le dashboard.
- Suppression confirmée de toute utilisation de la Service Role Key côté frontend
  (`web/app/dashboard/page.tsx` utilise désormais le client authentifié standard).