-- ============================================================================
-- Stripe billing : stripe_customer_id devient nullable
-- Un tenant peut désormais exister sans customer Stripe (avant paiement / plan
-- free) au lieu d'un placeholder "cus_pending_<uuid>" qui ne matchait jamais
-- de vrai customer Stripe.
-- ============================================================================

begin;

alter table public.tenants
  alter column stripe_customer_id drop not null;

-- Le placeholder "cus_pending_" || new.id contournait la contrainte NOT NULL
-- mais empêchait tout matching réel avec un customer Stripe (webhook
-- customer.subscription.* filtre sur stripe_customer_id). On laisse la
-- colonne à null jusqu'à ce que checkout.session.completed la renseigne.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_tenant_id uuid;
begin
  insert into public.app_users (user_id, email, full_name)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name'
  );

  insert into public.tenants (name, slug, billing_email, created_by)
  values (
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)) || ' Workspace',
    regexp_replace(lower(coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))), '[^a-z0-9]+', '-', 'g') || '-' || substr(md5(random()::text), 1, 6),
    new.email,
    new.id
  )
  returning id into v_tenant_id;

  insert into public.tenant_memberships (tenant_id, user_id, role)
  values (
    v_tenant_id,
    new.id,
    'owner'
  );

  update public.app_users
  set default_tenant_id = v_tenant_id
  where user_id = new.id;

  return new;
end;
$$;

commit;
