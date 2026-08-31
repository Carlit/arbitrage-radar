import { NextResponse } from "next/server";
import { createBillingKit, SignatureVerificationError } from "billing-stripe-kit";

import { createSupabaseIdempotencyStore } from "@/lib/billing/idempotency-store";
import {
  cancelTenantSubscription,
  linkTenantToCustomer,
  syncTenantSubscription,
} from "@/lib/billing/tenant-sync";

export const runtime = "nodejs";

const kit = createBillingKit({
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  idempotencyStore: createSupabaseIdempotencyStore(),
  onEvent: async (event) => {
    switch (event.type) {
      case "account.linked":
        return linkTenantToCustomer(event.accountId, event.stripeCustomerId);

      case "subscription.activated":
      case "subscription.updated":
        return syncTenantSubscription(event.stripeCustomerId, event.raw);

      case "subscription.cancelled":
        return cancelTenantSubscription(event.stripeCustomerId, event.raw);
    }
  },
});

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "En-tête stripe-signature manquant." }, { status: 400 });
  }

  const rawBody = await request.text();

  try {
    await kit.webhook.handleRequest(rawBody, signature);
  } catch (error) {
    if (error instanceof SignatureVerificationError) {
      console.error("Signature Stripe invalide", error);
      return NextResponse.json({ error: "Signature Stripe invalide." }, { status: 400 });
    }

    console.error("Échec du traitement du webhook Stripe", error);
    return NextResponse.json(
      { error: "Échec du traitement du webhook Stripe." },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
