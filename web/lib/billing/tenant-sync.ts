import type { Stripe } from "billing-stripe-kit";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";

type SubscriptionTier = "free" | "pro" | "elite";
type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete"
  | "incomplete_expired"
  | "paused";

const ALLOWED_STATUSES = new Set<SubscriptionStatus>([
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
]);

function normalizeStripeStatus(status: string): SubscriptionStatus {
  return ALLOWED_STATUSES.has(status as SubscriptionStatus)
    ? (status as SubscriptionStatus)
    : "incomplete";
}

function extractTierFromPrice(price: Stripe.Price | null | undefined): SubscriptionTier {
  if (!price) {
    return "free";
  }

  const metadataTier = price.metadata?.app_tier?.toLowerCase();
  if (metadataTier === "free" || metadataTier === "pro" || metadataTier === "elite") {
    return metadataTier;
  }

  const lookupKey = (price.lookup_key ?? "").toLowerCase();
  if (lookupKey.includes("elite")) return "elite";
  if (lookupKey.includes("pro")) return "pro";

  return "free";
}

function toIsoTimestamp(unixSeconds: number | null | undefined): string | null {
  if (!unixSeconds) {
    return null;
  }

  return new Date(unixSeconds * 1000).toISOString();
}

export async function linkTenantToCustomer(accountId: string, stripeCustomerId: string): Promise<void> {
  const supabaseAdmin = createSupabaseServiceRoleClient();

  // Idempotent : ne recouvre jamais un stripe_customer_id déjà posé (rejeu de
  // webhook, ou tenant déjà lié).
  const { error } = await supabaseAdmin
    .from("tenants")
    .update({ stripe_customer_id: stripeCustomerId })
    .eq("id", accountId)
    .is("stripe_customer_id", null);

  if (error) {
    throw error;
  }
}

export async function syncTenantSubscription(
  stripeCustomerId: string,
  subscription: Stripe.Subscription,
): Promise<void> {
  const primaryItem = subscription.items?.data?.[0];

  const subscriptionTier = extractTierFromPrice(primaryItem?.price);
  const subscriptionStatus = normalizeStripeStatus(subscription.status);
  const subscriptionCurrentPeriodEndsAt = toIsoTimestamp(primaryItem?.current_period_end);

  const supabaseAdmin = createSupabaseServiceRoleClient();

  const { data, error } = await supabaseAdmin
    .from("tenants")
    .update({
      stripe_subscription_id: subscription.id,
      subscription_tier: subscriptionTier,
      subscription_status: subscriptionStatus,
      subscription_current_period_ends_at: subscriptionCurrentPeriodEndsAt,
    })
    .eq("stripe_customer_id", stripeCustomerId)
    .select("id")
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error(`Aucun tenant trouvé pour stripe_customer_id=${stripeCustomerId}.`);
  }
}

export async function markTenantPaymentFailed(stripeCustomerId: string): Promise<void> {
  const supabaseAdmin = createSupabaseServiceRoleClient();

  const { data, error } = await supabaseAdmin
    .from("tenants")
    .update({ subscription_status: "past_due" satisfies SubscriptionStatus })
    .eq("stripe_customer_id", stripeCustomerId)
    .select("id")
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error(`Aucun tenant trouvé pour stripe_customer_id=${stripeCustomerId}.`);
  }
}

export async function cancelTenantSubscription(
  stripeCustomerId: string,
  subscription: Stripe.Subscription,
): Promise<void> {
  // Fidélité avec le comportement T1-T10 d'origine : subscription_current_period_ends_at
  // est bien recalculé depuis l'abonnement supprimé (pas laissé tel quel), même si tier et
  // statut sont forcés à free/canceled.
  const primaryItem = subscription.items?.data?.[0];
  const subscriptionCurrentPeriodEndsAt = toIsoTimestamp(primaryItem?.current_period_end);

  const supabaseAdmin = createSupabaseServiceRoleClient();

  const { data, error } = await supabaseAdmin
    .from("tenants")
    .update({
      stripe_subscription_id: null,
      subscription_tier: "free" satisfies SubscriptionTier,
      subscription_status: "canceled" satisfies SubscriptionStatus,
      subscription_current_period_ends_at: subscriptionCurrentPeriodEndsAt,
    })
    .eq("stripe_customer_id", stripeCustomerId)
    .select("id")
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error(`Aucun tenant trouvé pour stripe_customer_id=${stripeCustomerId}.`);
  }
}
