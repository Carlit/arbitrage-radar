-- Seed file generated automatically

-- 1. auth.users
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, is_sso_user, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES ('3cdb1ab3-28b1-464a-91cd-f3db24272f2b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test2@local.dev', '$2a$06$bxWilPZS6mS4r70ZvZ50eOqpngap/PPbbK5jYMyqtUhBhbZ/KoaNS', '2026-08-30T15:51:01.580Z', '2026-08-30T11:39:13.554Z', '2026-08-30T16:53:26.695Z', '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Test User 2","email_verified":true}'::jsonb, null, false, '', '', '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, is_sso_user, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES ('539cae10-b3d7-449f-98a5-1e301ce931b7', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test@local.dev', '$2a$06$bxWilPZS6mS4r70ZvZ50eOqpngap/PPbbK5jYMyqtUhBhbZ/KoaNS', '2026-08-30T15:51:01.580Z', '2026-08-30T11:19:54.804Z', '2026-08-30T16:58:14.422Z', '{"provider":"email","providers":["email"]}'::jsonb, '{"email_verified":true}'::jsonb, null, false, '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- 1.b. auth.identities
INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
VALUES (
  'ae3e3b87-a52c-4bf7-8f6a-e85bf7400e86',
  '3cdb1ab3-28b1-464a-91cd-f3db24272f2b',
  '3cdb1ab3-28b1-464a-91cd-f3db24272f2b',
  '{"sub": "3cdb1ab3-28b1-464a-91cd-f3db24272f2b", "email": "test2@local.dev", "email_verified": true}'::jsonb,
  'email',
  '2026-08-30T17:58:27.677Z',
  '2026-08-30T17:58:27.677Z',
  '2026-08-30T17:58:27.677Z'
) ON CONFLICT (provider_id, provider) DO NOTHING;

INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
VALUES (
  'fe707549-b0a1-4d90-8be0-a4b9c296d73d',
  '539cae10-b3d7-449f-98a5-1e301ce931b7',
  '539cae10-b3d7-449f-98a5-1e301ce931b7',
  '{"sub": "539cae10-b3d7-449f-98a5-1e301ce931b7", "email": "test@local.dev", "email_verified": true}'::jsonb,
  'email',
  '2026-08-30T17:58:02.183Z',
  '2026-08-30T17:58:02.183Z',
  '2026-08-30T17:58:02.183Z'
) ON CONFLICT (provider_id, provider) DO NOTHING;

-- 2. public.tenants
INSERT INTO public.tenants (id, name, slug, stripe_customer_id, stripe_subscription_id, subscription_tier, subscription_status, billing_email, created_by, created_at, updated_at)
VALUES ('2ef3cd63-2b63-4b2a-8868-064836f39e28', 'Tenant de test', 'tenant-de-test', 'cus_test_local', NULL, 'elite', 'active', 'null', '539cae10-b3d7-449f-98a5-1e301ce931b7', '2026-08-30T11:20:21.652Z', '2026-08-30T11:29:20.182Z')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, slug = EXCLUDED.slug, stripe_customer_id = EXCLUDED.stripe_customer_id, subscription_tier = EXCLUDED.subscription_tier, subscription_status = EXCLUDED.subscription_status, billing_email = EXCLUDED.billing_email, updated_at = EXCLUDED.updated_at;

INSERT INTO public.tenants (id, name, slug, stripe_customer_id, stripe_subscription_id, subscription_tier, subscription_status, billing_email, created_by, created_at, updated_at)
VALUES ('1ba902af-a9fc-46c8-b107-ef65d1b9e7d0', 'Tenant de test 2', 'tenant-de-test-2', 'cus_test_local_2', NULL, 'free', 'trialing', 'test2@local.dev', '3cdb1ab3-28b1-464a-91cd-f3db24272f2b', '2026-08-30T11:39:57.101Z', '2026-08-30T11:39:57.101Z')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, slug = EXCLUDED.slug, stripe_customer_id = EXCLUDED.stripe_customer_id, subscription_tier = EXCLUDED.subscription_tier, subscription_status = EXCLUDED.subscription_status, billing_email = EXCLUDED.billing_email, updated_at = EXCLUDED.updated_at;

-- 3. public.app_users
INSERT INTO public.app_users (user_id, email, full_name, default_tenant_id, is_active, created_at, updated_at)
VALUES ('539cae10-b3d7-449f-98a5-1e301ce931b7', 'test@local.dev', NULL, '2ef3cd63-2b63-4b2a-8868-064836f39e28', true, '2026-08-30T11:22:07.229Z', '2026-08-30T11:22:07.229Z')
ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, full_name = EXCLUDED.full_name, default_tenant_id = EXCLUDED.default_tenant_id, is_active = EXCLUDED.is_active, updated_at = EXCLUDED.updated_at;

INSERT INTO public.app_users (user_id, email, full_name, default_tenant_id, is_active, created_at, updated_at)
VALUES ('3cdb1ab3-28b1-464a-91cd-f3db24272f2b', 'test2@local.dev', 'Test User 2', '1ba902af-a9fc-46c8-b107-ef65d1b9e7d0', true, '2026-08-30T11:39:57.124Z', '2026-08-30T11:39:57.124Z')
ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, full_name = EXCLUDED.full_name, default_tenant_id = EXCLUDED.default_tenant_id, is_active = EXCLUDED.is_active, updated_at = EXCLUDED.updated_at;

-- 4. public.tenant_memberships
INSERT INTO public.tenant_memberships (id, tenant_id, user_id, role, is_active, created_at, updated_at)
VALUES ('c8bcb83d-e0f1-482f-a2cb-3d82bd7634ab', '2ef3cd63-2b63-4b2a-8868-064836f39e28', '539cae10-b3d7-449f-98a5-1e301ce931b7', 'owner', true, '2026-08-30T11:22:18.951Z', '2026-08-30T11:22:18.951Z')
ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, user_id = EXCLUDED.user_id, role = EXCLUDED.role, is_active = EXCLUDED.is_active, updated_at = EXCLUDED.updated_at;

INSERT INTO public.tenant_memberships (id, tenant_id, user_id, role, is_active, created_at, updated_at)
VALUES ('5e1eb3bf-071a-4976-a230-65c7bd380f94', '1ba902af-a9fc-46c8-b107-ef65d1b9e7d0', '3cdb1ab3-28b1-464a-91cd-f3db24272f2b', 'owner', true, '2026-08-30T11:39:57.144Z', '2026-08-30T11:39:57.144Z')
ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, user_id = EXCLUDED.user_id, role = EXCLUDED.role, is_active = EXCLUDED.is_active, updated_at = EXCLUDED.updated_at;

-- 5. Nettoyage des tenants fantômes générés automatiquement par le trigger
DELETE FROM public.tenant_memberships WHERE tenant_id NOT IN ('2ef3cd63-2b63-4b2a-8868-064836f39e28', '1ba902af-a9fc-46c8-b107-ef65d1b9e7d0');
DELETE FROM public.tenants WHERE id NOT IN ('2ef3cd63-2b63-4b2a-8868-064836f39e28', '1ba902af-a9fc-46c8-b107-ef65d1b9e7d0');
