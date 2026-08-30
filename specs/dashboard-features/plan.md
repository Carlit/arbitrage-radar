# Plan — Dashboard complet : filtres, statut, vue tableau, Realtime

## 1. Base de données & Realtime (Migration SQL)

Pour que Supabase pousse les événements Realtime en respectant la RLS, les tables doivent être ajoutées à la publication `supabase_realtime`. 
Afin de garantir que l'opération est rejouable (idempotente), nous vérifierons systématiquement si la table est déjà dans la publication avant de l'ajouter.

**Migration SQL prévue :**
```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'market_alerts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE market_alerts;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'tenant_alert_access'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE tenant_alert_access;
  END IF;
END
$$;
```

## 2. Architecture Frontend (Server to Client)

Actuellement, `web/app/dashboard/page.tsx` est un composant serveur pur (Server Component). 
Pour supporter les filtres interactifs, l'abonnement Realtime et la bascule Grille/Tableau sans rechargement, nous allons séparer les responsabilités :
- `page.tsx` (Server Component) : Gère l'authentification, récupère le `activeTenantId` et effectue la requête initiale pour un rendu SSR performant.
- `AlertsDashboard.tsx` (Client Component) : Nouveau composant qui reçoit les données initiales, gère l'état local (filtres, mode de vue) et s'abonne au canal Realtime Supabase.

### 2.1. Requête enrichie (Jointure Asset)
Pour l'export CSV et un affichage rigoureux, nous n'utiliserons pas la colonne `headline`. Nous allons joindre la table `assets` pour récupérer le vrai `symbol` (ex: "BTC-USD").
**Requête mise à jour :**
```javascript
.select(`
  *,
  assets (symbol),
  tenant_alert_access!inner(read_at, tenant_id)
`)
```

## 3. Fonctionnalités Interactives (Composant Client)

### 3.1. Filtres
Un panneau de filtres basé sur l'état React, s'appliquant sur la liste des alertes :
- **Paire (Asset)** : Recherche textuelle ou sélecteur basé sur `assets.symbol`.
- **Exchange** : Recherche textuelle ou sélecteur filtrant sur `payload.buy_venue` ou `payload.sell_venue`.
- **Statut** : Bascule entre "Non traité" (défaut, `read_at IS NULL`) et "Traité" (`read_at IS NOT NULL`).

### 3.2. Bascule Vue Grille / Vue Tableau
- État local `viewMode: 'grid' | 'table'`.
- **Vue Grille** : Affichage actuel avec le composant `<Card>`.
- **Vue Tableau** : Nouveau composant shadcn/ui `<Table>` listant les colonnes essentielles de façon compacte.

### 3.3. Marquage comme Traité (Alerte par Alerte)
- Ajout d'un bouton d'action contextuel sur chaque carte et chaque ligne du tableau (ex: "Marquer comme lu").
- Au clic : Appel via le client Supabase `update({ read_at: new Date().toISOString() })` sur `tenant_alert_access` (filtré par `alert_id` et `tenant_id`). Conformément à la spec, **pas de marquage en masse** pour cette itération.

### 3.4. Abonnement Realtime (Filtrage Explicite)
**Contrainte architecturale critique (Realtime + RLS avec Jointure) :**
Supabase Realtime évalue la RLS au moment exact où la ligne est insérée dans le WAL (Write-Ahead Log). Puisque le script Python insère l'alerte dans `market_alerts`, puis insère l'accès dans `tenant_alert_access`, la RLS de `market_alerts` (qui dépend de `tenant_alert_access`) échouera systématiquement pour l'événement `INSERT` de `market_alerts` (car le lien tenant n'existe pas encore à la milliseconde de l'insertion de l'alerte).
**Solution :**
Le frontend ne s'abonnera **pas** à `market_alerts`. Il s'abonnera **uniquement** à `tenant_alert_access`, en filtrant explicitement sur son propre tenant.
```javascript
supabase
  .channel('dashboard-alerts')
  .on(
    'postgres_changes', 
    { event: '*', schema: 'public', table: 'tenant_alert_access', filter: `tenant_id=eq.${activeTenantId}` }, 
    handleAccessChanges
  )
  .subscribe()
```
Lorsqu'un événement `INSERT` est reçu sur `tenant_alert_access`, le frontend possède l'`alert_id`. Il déclenchera alors un simple `select()` ciblé sur `market_alerts` pour récupérer le contenu complet de la nouvelle alerte (qui est désormais accessible car le lien tenant existe). Cette approche garantit une **isolation parfaite du canal Realtime par tenant** et contourne le problème du délai de jointure RLS.

### 3.5. Export CSV
L'export sera généré dynamiquement côté client à partir du tableau des alertes actuellement filtrées et visibles.
**Colonnes strictes pour l'export :**
- `Date/Heure` (`observed_at`)
- `Paire` (`assets.symbol` au lieu de `headline`)
- `Achat` (`payload.buy_venue`)
- `Prix Achat` (`buy_price`)
- `Vente` (`payload.sell_venue`)
- `Prix Vente` (`sell_price`)
- `Marge Brute (bps)` (`gross_edge_bps`)
- `Marge Nette (%)` (`net_edge_pct`)
*(Les UUIDs internes, le confidence_score, et le headline seront exclus de l'export).*

**Note technique :**
Le filtre "Exchange" (Achat/Vente) reposera sur les champs `payload.buy_venue` et `payload.sell_venue`. Le champ `payload` étant du JSONB non indexé spécifiquement pour ces clés, ce filtrage sera géré en mémoire côté client pour ce MVP (ce qui est parfaitement performant pour les volumes actuels). Si, à l'avenir, une pagination côté serveur devient nécessaire, il faudra envisager de rajouter des colonnes dédiées ou un index GIN sur le `payload`.