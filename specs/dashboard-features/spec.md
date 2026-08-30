# Spec — Dashboard complet : filtres, statut, vue tableau, Realtime

## Quoi

Compléter le dashboard d'alertes d'arbitrage (actuellement une grille de cartes en lecture
seule) avec :
- des filtres pour affiner l'affichage,
- une action pour marquer une alerte comme traitée,
- une vue tableau alternative à la grille de cartes,
- une mise à jour en temps réel des nouvelles alertes.

## Pourquoi

Le dashboard actuel affiche les alertes de façon statique, sans possibilité de les trier,
filtrer, ni de suivre lesquelles ont déjà été consultées. Avec l'isolation multi-tenant
maintenant sécurisée ([[rls-tenant-dashboard]]), on peut construire ces fonctionnalités sur
une base saine.

## Pour qui

- L'utilisateur `owner`/membre d'un tenant, qui consulte régulièrement le dashboard pour
  repérer de nouvelles opportunités et suivre celles déjà traitées.

## Portée

1. **Filtres** : par paire (asset), par exchange (achat et/ou vente), par plage de dates,
   par statut (traité/non traité). Les filtres s'appliquent à la fois à la grille de cartes
   et à la vue tableau, sans rechargement de page.
2. **Action "Marquer comme traité"** : bouton par alerte, qui met à jour
   `tenant_alert_access.read_at` (déjà décidé dans [[rls-tenant-dashboard]] comme le bon
   niveau de granularité — par tenant, pas global). Une alerte traitée est visuellement
   distinguée ou masquée selon le filtre de statut actif.
3. **Vue tableau** : bascule (toggle) entre la grille de cartes actuelle et une vue tableau
   triable, avec les colonnes : paire, achat/prix, vente/prix, marge brute, marge nette,
   score, timestamp, statut. Les deux vues partagent les mêmes filtres et données.
4. **Realtime** : abonnement Supabase (`postgres_changes`) sur `market_alerts` et
   `tenant_alert_access`, pour que les nouvelles alertes et les changements de statut
   apparaissent sans rechargement manuel.
5. **Export CSV** : bouton qui exporte les alertes actuellement affichées (respectant les
   filtres actifs), côté client.

## Hors périmètre (pour cette spec)

- L'intégration Stripe / gestion des abonnements (spec séparée).
- Les rôles et permissions avancées au sein d'un tenant (au-delà de `owner`).
- Les graphiques/courbes de prix (évoqué au tout début du cadrage, à réévaluer plus tard
  si besoin — la grille de cartes et le tableau suffisent pour cette itération).

## Questions à clarifier avant `/plan`

1. **Realtime et RLS** : les abonnements Realtime de Supabase respectent-ils bien la même
   policy RLS que les requêtes classiques (`can_access_alert`), ou faut-il une configuration
   spécifique côté Supabase pour que le canal Realtime soit lui aussi scopé par tenant ?
2. **Marquage en masse** : le bouton "Marquer comme traité" s'applique-t-il uniquement
   alerte par alerte, ou faut-il aussi une action groupée (ex: "tout marquer comme traité"
   sur les alertes actuellement filtrées) dès cette itération ?
3. **Export CSV** : doit-il inclure toutes les colonnes visibles dans le tableau, ou un
   sous-ensemble pensé pour un usage externe (par ex. sans le `score` interne) ?
