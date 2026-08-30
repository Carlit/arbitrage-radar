-- ============================================================================
-- Supabase PostgreSQL schema
-- MVP SaaS radar d'arbitrage de prix
-- Exécutable tel quel dans l'éditeur SQL Supabase
-- ============================================================================

begin;

create extension if not exists pgcrypto;
create extension if not exists citext;

-- ============================================================================
-- Types
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('owner', 'admin', 'member');
  end if;

  if not exists (select 1 from pg_type where typname = 'subscription_tier') then
    create type public.subscription_tier as enum ('free', 'pro', 'elite');
  end if;

  if not exists (select 1 from pg_type where typname = 'subscription_status') then
    create type public.subscription_status as enum (
      'trialing',
      'active',
      'past_due',
      'canceled',
      'unpaid',
      'incomplete',
      'incomplete_expired',
      'paused'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'alert_status') then
    create type public.alert_status as enum ('open', 'suppressed', 'expired', 'resolved');
  end if;
end
$$;

-- ============================================================================
-- Fonctions utilitaires
-- ============================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create or replace function public.subscription_tier_rank(p_tier public.subscription_tier)
returns integer
language sql
immutable
as $$
  select case p_tier
    when 'free' then 0
    when 'pro' then 10
    when 'elite' then 20
    else -1
  end;
$$;

create or replace function public.subscription_tier_gte(
  p_current public.subscription_tier,
  p_required public.subscription_tier
)
returns boolean
language sql
immutable
as $$
  select public.subscription_tier_rank(p_current) >= public.subscription_tier_rank(p_required);
$$;

create or replace function public.subscription_is_entitled(
  p_status public.subscription_status
)
returns boolean
language sql
immutable
as $$
  select p_status in ('trialing', 'active');
$$;

-- ============================================================================
-- Tables coeur multi-tenant
-- ============================================================================

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug citext not null unique,
  stripe_customer_id text not null unique,
  stripe_subscription_id text unique,
  subscription_tier public.subscription_tier not null default 'free',
  subscription_status public.subscription_status not null default 'trialing',
  subscription_current_period_ends_at timestamptz,
  billing_email citext,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.app_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email citext not null unique,
  full_name text,
  default_tenant_id uuid references public.tenants(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.tenant_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.app_users(user_id) on delete cascade,
  role public.app_role not null default 'member',
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (tenant_id, user_id)
);

create index if not exists idx_tenant_memberships_user_id
  on public.tenant_memberships(user_id);

create index if not exists idx_tenant_memberships_tenant_id_active
  on public.tenant_memberships(tenant_id, is_active);

-- ============================================================================
-- Référentiel global du marché
-- ============================================================================

create table if not exists public.venues (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  venue_type text not null default 'exchange',
  country_code text,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  symbol text not null unique,
  base_currency text not null,
  quote_currency text not null,
  asset_class text not null default 'spot',
  canonical_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.asset_listings (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  venue_id uuid not null references public.venues(id) on delete cascade,
  external_symbol text not null,
  fee_bps numeric(10,4) not null default 0,
  maker_fee_bps numeric(10,4),
  taker_fee_bps numeric(10,4),
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (asset_id, venue_id)
);

create index if not exists idx_asset_listings_asset_id
  on public.asset_listings(asset_id);

create index if not exists idx_asset_listings_venue_id
  on public.asset_listings(venue_id);

-- ============================================================================
-- Anomalies / alertes
-- ============================================================================

create table if not exists public.market_alerts (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete restrict,
  buy_listing_id uuid not null references public.asset_listings(id) on delete restrict,
  sell_listing_id uuid not null references public.asset_listings(id) on delete restrict,
  min_subscription_tier public.subscription_tier not null default 'pro',
  status public.alert_status not null default 'open',
  headline text not null,
  anomaly_kind text not null default 'cross_venue_arbitrage',
  fair_price numeric(20,8) not null,
  buy_price numeric(20,8) not null,
  sell_price numeric(20,8) not null,
  gross_edge_bps numeric(12,4) not null,
  net_edge_bps numeric(12,4) not null,
  net_edge_pct numeric(12,6) not null,
  confidence_score numeric(10,4) not null,
  liquidity_score numeric(10,4) not null,
  payload jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null,
  expires_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint market_alerts_buy_sell_distinct check (buy_listing_id <> sell_listing_id),
  constraint market_alerts_confidence_range check (confidence_score >= 0 and confidence_score <= 100)
);

create index if not exists idx_market_alerts_asset_observed_at
  on public.market_alerts(asset_id, observed_at desc);

create index if not exists idx_market_alerts_status_observed_at
  on public.market_alerts(status, observed_at desc);

create index if not exists idx_market_alerts_min_subscription_tier
  on public.market_alerts(min_subscription_tier);

create table if not exists public.tenant_alert_access (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  alert_id uuid not null references public.market_alerts(id) on delete cascade,
  entitled_via_tier public.subscription_tier not null,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  unique (tenant_id, alert_id)
);

create index if not exists idx_tenant_alert_access_tenant_id
  on public.tenant_alert_access(tenant_id, created_at desc);

create index if not exists idx_tenant_alert_access_alert_id
  on public.tenant_alert_access(alert_id);

-- ============================================================================
-- Fonctions de sécurité
-- ============================================================================

create or replace function public.is_tenant_member(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tenant_memberships tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = auth.uid()
      and tm.is_active = true
  );
$$;

create or replace function public.is_tenant_admin(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tenant_memberships tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = auth.uid()
      and tm.is_active = true
      and tm.role in ('owner', 'admin')
  );
$$;

create or replace function public.current_tenant_subscription_tier(p_tenant_id uuid)
returns public.subscription_tier
language sql
stable
security definer
set search_path = public
as $$
  select t.subscription_tier
  from public.tenants t
  where t.id = p_tenant_id;
$$;

create or replace function public.current_tenant_subscription_status(p_tenant_id uuid)
returns public.subscription_status
language sql
stable
security definer
set search_path = public
as $$
  select t.subscription_status
  from public.tenants t
  where t.id = p_tenant_id;
$$;

create or replace function public.tenant_has_alert_entitlement(
  p_tenant_id uuid,
  p_required_tier public.subscription_tier
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_tenant_member(p_tenant_id)
    and public.subscription_is_entitled(public.current_tenant_subscription_status(p_tenant_id))
    and public.subscription_tier_gte(public.current_tenant_subscription_tier(p_tenant_id), p_required_tier);
$$;

create or replace function public.can_access_alert(p_alert_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tenant_alert_access taa
    join public.tenants t
      on t.id = taa.tenant_id
    where taa.alert_id = p_alert_id
      and public.is_tenant_member(taa.tenant_id)
      and public.subscription_is_entitled(t.subscription_status)
      and public.subscription_tier_gte(t.subscription_tier, taa.entitled_via_tier)
  );
$$;

create or replace function public.validate_tenant_alert_access()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_min_tier public.subscription_tier;
begin
  select ma.min_subscription_tier
  into v_min_tier
  from public.market_alerts ma
  where ma.id = new.alert_id;

  if v_min_tier is null then
    raise exception 'market_alert % introuvable', new.alert_id;
  end if;

  if not public.subscription_tier_gte(new.entitled_via_tier, v_min_tier) then
    raise exception
      'entitled_via_tier (%) inférieur au minimum requis (%) pour l''alerte %',
      new.entitled_via_tier, v_min_tier, new.alert_id;
  end if;

  return new;
end;
$$;

-- ============================================================================
-- Triggers updated_at
-- ============================================================================

drop trigger if exists trg_tenants_set_updated_at on public.tenants;
create trigger trg_tenants_set_updated_at
before update on public.tenants
for each row
execute function public.set_updated_at();

drop trigger if exists trg_app_users_set_updated_at on public.app_users;
create trigger trg_app_users_set_updated_at
before update on public.app_users
for each row
execute function public.set_updated_at();

drop trigger if exists trg_tenant_memberships_set_updated_at on public.tenant_memberships;
create trigger trg_tenant_memberships_set_updated_at
before update on public.tenant_memberships
for each row
execute function public.set_updated_at();

drop trigger if exists trg_venues_set_updated_at on public.venues;
create trigger trg_venues_set_updated_at
before update on public.venues
for each row
execute function public.set_updated_at();

drop trigger if exists trg_assets_set_updated_at on public.assets;
create trigger trg_assets_set_updated_at
before update on public.assets
for each row
execute function public.set_updated_at();

drop trigger if exists trg_asset_listings_set_updated_at on public.asset_listings;
create trigger trg_asset_listings_set_updated_at
before update on public.asset_listings
for each row
execute function public.set_updated_at();

drop trigger if exists trg_market_alerts_set_updated_at on public.market_alerts;
create trigger trg_market_alerts_set_updated_at
before update on public.market_alerts
for each row
execute function public.set_updated_at();

drop trigger if exists trg_tenant_alert_access_validate on public.tenant_alert_access;
create trigger trg_tenant_alert_access_validate
before insert or update on public.tenant_alert_access
for each row
execute function public.validate_tenant_alert_access();

-- ============================================================================
-- RLS
-- ============================================================================

alter table public.tenants enable row level security;
alter table public.app_users enable row level security;
alter table public.tenant_memberships enable row level security;
alter table public.venues enable row level security;
alter table public.assets enable row level security;
alter table public.asset_listings enable row level security;
alter table public.market_alerts enable row level security;
alter table public.tenant_alert_access enable row level security;

-- Nettoyage si relance du script
drop policy if exists tenants_select_member on public.tenants;
drop policy if exists tenants_insert_creator on public.tenants;
drop policy if exists tenants_update_admin on public.tenants;

drop policy if exists app_users_select_self on public.app_users;
drop policy if exists app_users_insert_self on public.app_users;
drop policy if exists app_users_update_self on public.app_users;

drop policy if exists tenant_memberships_select_member on public.tenant_memberships;
drop policy if exists tenant_memberships_insert_admin_or_creator on public.tenant_memberships;
drop policy if exists tenant_memberships_update_admin on public.tenant_memberships;
drop policy if exists tenant_memberships_delete_admin on public.tenant_memberships;

drop policy if exists venues_select_authenticated on public.venues;
drop policy if exists assets_select_authenticated on public.assets;
drop policy if exists asset_listings_select_authenticated on public.asset_listings;

drop policy if exists market_alerts_select_entitled on public.market_alerts;
drop policy if exists tenant_alert_access_select_entitled on public.tenant_alert_access;

-- Tenants
create policy tenants_select_member
on public.tenants
for select
to authenticated
using (public.is_tenant_member(id));

create policy tenants_insert_creator
on public.tenants
for insert
to authenticated
with check (created_by = auth.uid());

create policy tenants_update_admin
on public.tenants
for update
to authenticated
using (public.is_tenant_admin(id))
with check (public.is_tenant_admin(id));

-- Utilisateurs applicatifs
create policy app_users_select_self
on public.app_users
for select
to authenticated
using (user_id = auth.uid());

create policy app_users_insert_self
on public.app_users
for insert
to authenticated
with check (user_id = auth.uid());

create policy app_users_update_self
on public.app_users
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Memberships
create policy tenant_memberships_select_member
on public.tenant_memberships
for select
to authenticated
using (public.is_tenant_member(tenant_id));

create policy tenant_memberships_insert_admin_or_creator
on public.tenant_memberships
for insert
to authenticated
with check (
  public.is_tenant_admin(tenant_id)
  or (
    user_id = auth.uid()
    and role = 'owner'
    and exists (
      select 1
      from public.tenants t
      where t.id = tenant_id
        and t.created_by = auth.uid()
    )
  )
);

create policy tenant_memberships_update_admin
on public.tenant_memberships
for update
to authenticated
using (public.is_tenant_admin(tenant_id))
with check (public.is_tenant_admin(tenant_id));

create policy tenant_memberships_delete_admin
on public.tenant_memberships
for delete
to authenticated
using (public.is_tenant_admin(tenant_id));

-- Référentiel marché global
create policy venues_select_authenticated
on public.venues
for select
to authenticated
using (true);

create policy assets_select_authenticated
on public.assets
for select
to authenticated
using (true);

create policy asset_listings_select_authenticated
on public.asset_listings
for select
to authenticated
using (true);

-- Alertes
create policy market_alerts_select_entitled
on public.market_alerts
for select
to authenticated
using (public.can_access_alert(id));

create policy tenant_alert_access_select_entitled
on public.tenant_alert_access
for select
to authenticated
using (
  public.tenant_has_alert_entitlement(tenant_id, entitled_via_tier)
);

commit;
