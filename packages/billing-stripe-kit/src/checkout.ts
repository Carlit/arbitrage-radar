import type Stripe from "stripe";

export function createCheckoutModule(stripe: Stripe) {
  async function createCheckoutSession(
    priceId: string,
    accountId: string,
    metadata: Record<string, string> = {},
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
      metadata,
    });
  }

  return { createCheckoutSession };
}
