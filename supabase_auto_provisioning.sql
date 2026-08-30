-- ============================================================================
-- Supabase Triggers d'Auto-provisioning
-- Création automatique du profil app_users et du Tenant à l'inscription
-- A exécuter dans l'éditeur SQL Supabase
-- ============================================================================

-- 1. Fonction de provisionnement
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_tenant_id uuid;
begin
  -- A. Créer le profil app_users
  insert into public.app_users (user_id, email, full_name)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name'
  );

  -- B. Créer un Tenant par défaut (Organisation)
  insert into public.tenants (name, slug, stripe_customer_id, billing_email, created_by)
  values (
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)) || ' Workspace',
    -- Slug généré de façon basique et sécurisée pour éviter les conflits
    regexp_replace(lower(coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))), '[^a-z0-9]+', '-', 'g') || '-' || substr(md5(random()::text), 1, 6),
    'cus_pending_' || new.id, -- ID temporaire, sera mis à jour par le webhook Stripe
    new.email,
    new.id
  )
  returning id into v_tenant_id;

  -- C. Lier l'utilisateur à son Tenant (Membership en tant que Owner)
  insert into public.tenant_memberships (tenant_id, user_id, role)
  values (
    v_tenant_id,
    new.id,
    'owner'
  );

  -- D. Mettre à jour le default_tenant_id dans app_users
  update public.app_users 
  set default_tenant_id = v_tenant_id 
  where user_id = new.id;

  return new;
end;
$$;

-- 2. Création du Trigger sur auth.users
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
