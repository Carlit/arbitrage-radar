# Plan — Accès multi-tenant sécurisé sur les alertes d'arbitrage

## 1. Schéma de base de données (Migration)

L'objectif est de déplacer la notion de traitement d'une alerte du niveau global (`market_alerts`) au niveau du tenant (`tenant_alert_access`), car le fait qu'une alerte soit "traitée" ou "lue" dépend de l'utilisateur/du tenant, pas du marché.

Cependant, après analyse de `tenant_alert_access` dans [supabase_schema.sql](file:///c:/Users/charl/.trae/worktrees/feat-arbitrage-radar-mvp-Bi3ypg/python-arbitrage-radar-poc-iztwD9/supabase_schema.sql#L225-L234), nous constatons que la table possède déjà les colonnes `delivered_at` et `read_at`. 

**Décision :**
La colonne `read_at` est sémantiquement suffisante pour indiquer qu'un utilisateur du tenant a vu/traité l'alerte. Si `read_at IS NULL`, l'alerte est "non lue/non traitée" pour ce tenant. Si `read_at IS NOT NULL`, elle est considérée comme traitée/lue.
La colonne globale `status` sur `market_alerts` (qui utilise l'enum `alert_status`: 'open', 'suppressed', 'expired', 'resolved') reste pertinente pour le cycle de vie *global* de l'opportunité sur le marché (ex: l'opportunité a disparu = 'expired').

Il n'y a donc **aucune modification de schéma** requise. Nous allons simplement utiliser la colonne `read_at` existante sur `tenant_alert_access`.

## 2. Insertion des données par le script Python

Le script Python actuel [arbitrage_radar_poc.py](file:///c:/Users/charl/.trae/worktrees/feat-arbitrage-radar-mvp-Bi3ypg/python-arbitrage-radar-poc-iztwD9/arbitrage_radar_poc.py) insère uniquement dans `market_alerts`. Pour que le RLS fonctionne, il doit lier l'alerte à un tenant via `tenant_alert_access`.

**Modifications dans `arbitrage_radar_poc.py` :**
1. Ajouter la lecture d'une variable d'environnement `DEFAULT_TENANT_ID` (depuis `.env.supabase-poc`).
2. Lors de l'insertion dans `market_alerts`, récupérer les IDs générés des alertes insérées (via `.execute()` qui renvoie les données insérées par défaut, ou en effectuant un `select()`).
3. Préparer un lot de données pour `tenant_alert_access` contenant :
   - `tenant_id`: le `DEFAULT_TENANT_ID`
   - `alert_id`: l'ID de chaque alerte insérée
   - `entitled_via_tier`: la valeur de `min_subscription_tier` de l'alerte (ex: 'pro')
   - `delivered_at`: timestamp actuel (optionnel, mais propre)
4. Insérer ce lot dans `tenant_alert_access`.

*(Note explicite : Le script Python agit comme un worker backend privilégié. Il continuera donc légitimement à utiliser la **Service Role Key** pour effectuer ces insertions globales, contrairement au frontend qui est soumis à la RLS).*

## 3. Sécurité (RLS Policies)

Le fichier [supabase_schema.sql](file:///c:/Users/charl/.trae/worktrees/feat-arbitrage-radar-mvp-Bi3ypg/python-arbitrage-radar-poc-iztwD9/supabase_schema.sql) possède déjà les policies nécessaires pour lire les alertes si on est membre du tenant et que le tenant a le bon tier :
- `market_alerts_select_entitled` utilise `can_access_alert(id)`
- `can_access_alert` vérifie l'existence d'une ligne dans `tenant_alert_access` pour le tenant de l'utilisateur courant (via `is_tenant_member(taa.tenant_id)` qui utilise `auth.uid()`).

**Modifications RLS requises :**
La lecture est déjà sécurisée. Par contre, il faut permettre aux utilisateurs de mettre à jour le champ `read_at` pour marquer une alerte comme lue.
1. Ajouter une policy `UPDATE` sur `tenant_alert_access` pour permettre à un membre du tenant de modifier `read_at` (et potentiellement `status` si on l'avait ajouté, mais ici on se limite à `read_at`).
   ```sql
   create policy tenant_alert_access_update_member
   on public.tenant_alert_access
   for update
   to authenticated
   using (public.is_tenant_member(tenant_id))
   with check (public.is_tenant_member(tenant_id));
   ```
*(Cette policy sera ajoutée à `supabase_schema.sql` et un script de migration/update sera fourni ou appliqué)*.

## 4. Point d'accès Frontend (Dashboard)

Actuellement, [page.tsx](file:///c:/Users/charl/.trae/worktrees/feat-arbitrage-radar-mvp-Bi3ypg/python-arbitrage-radar-poc-iztwD9/web/app/dashboard/page.tsx) contourne la RLS avec la Service Role Key (selon la spec).

**Modifications dans `web/app/dashboard/page.tsx` :**
1. Utiliser le client Supabase standard (avec la clé `anon` et le token de l'utilisateur) au lieu de la Service Role Key.
2. Récupérer explicitement le tenant actif de l'utilisateur en croisant `getUser()` avec `app_users.default_tenant_id` via la RLS standard :
   ```javascript
   const { data: appUser } = await supabase
     .from("app_users")
     .select("default_tenant_id")
     .eq("user_id", user.id)
     .single();
   const activeTenantId = appUser?.default_tenant_id;
   ```
3. Modifier la requête pour interroger `market_alerts` en faisant une jointure (inner join) avec `tenant_alert_access`.
   ```javascript
   const { data: alerts } = await supabase
     .from('market_alerts')
     .select(`
       *,
       tenant_alert_access!inner(read_at, tenant_id)
     `)
     .eq('status', 'open')
     .eq('tenant_alert_access.tenant_id', activeTenantId)
     // .is('tenant_alert_access.read_at', null) // Optionnel: pour ne voir que les non-lues
     .order('confidence_score', { ascending: false })
     .limit(12);
   ```
4. Cette requête s'exécutera sous le contexte de l'utilisateur authentifié. La RLS garantira que seules les alertes liées au tenant de l'utilisateur (via `tenant_alert_access`) sont retournées.
5. (Optionnel pour ce MVP mais prévu) Ajouter une Action Server pour mettre à jour `read_at` lorsqu'un utilisateur clique sur "Marquer comme lu".
