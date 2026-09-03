import type Stripe from "stripe";

export interface CreateCheckoutSessionOptions {
  trialPeriodDays?: number;
  discounts?: Stripe.Checkout.SessionCreateParams.Discount[];
}

export function createCheckoutModule(stripe: Stripe) {
  async function createCheckoutSession(
    priceId: string,
    accountId: string,
    successUrl: string,
    cancelUrl: string,
    metadata: Record<string, string> = {},
    options: CreateCheckoutSessionOptions = {},
  ): Promise<Stripe.Checkout.Session> {
    // Un nouveau Customer est créé à chaque appel (pas de recherche/déduplication —
    // dette assumée, cf. plan.md §2 : un checkout abandonné puis retenté peut laisser
    // un Customer Stripe orphelin, sans impact côté produit).
    const customer = await stripe.customers.create({
      metadata: { account_id: accountId },
    });

    return stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customer.id,
      client_reference_id: accountId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata,
      ...(options.trialPeriodDays !== undefined
        ? { subscription_data: { trial_period_days: options.trialPeriodDays } }
        : {}),
      ...(options.discounts !== undefined ? { discounts: options.discounts } : {}),
    });
  }

  return { createCheckoutSession };
}
