import type Stripe from "stripe";

export function createPortalModule(stripe: Stripe) {
  async function createPortalSession(
    stripeCustomerId: string,
    returnUrl: string,
  ): Promise<Stripe.BillingPortal.Session> {
    return stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: returnUrl,
    });
  }

  return { createPortalSession };
}
