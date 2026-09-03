import { createBillingKit } from "billing-stripe-kit";

export async function startTenantCheckout(tenantId: string): Promise<string> {
  const kit = createBillingKit({ stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "" });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const priceId = process.env.STRIPE_PRICE_PRO_ID ?? "";

  const session = await kit.checkout.createCheckoutSession(
    priceId,
    tenantId,
    `${appUrl}/billing/success`,
    `${appUrl}/billing/cancel`,
  );

  if (!session.url) {
    throw new Error("Stripe n'a pas retourné d'URL de Checkout Session.");
  }

  return session.url;
}
