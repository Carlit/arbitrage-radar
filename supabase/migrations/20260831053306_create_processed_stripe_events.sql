-- ============================================================================
-- Idempotence du webhook Stripe (billing-stripe-kit)
-- Table technique : aucune donnée utilisateur, pas de scoping tenant. Accès
-- Service Role uniquement (même traitement que raw_market_ticks).
-- ============================================================================

begin;

create table public.processed_stripe_events (
  event_id text primary key,
  processed_at timestamptz not null default timezone('utc', now())
);

alter table public.processed_stripe_events enable row level security;
-- Aucune policy créée volontairement : refus par défaut pour anon/authenticated.

commit;
