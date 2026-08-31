import type Stripe from "stripe";

import type { BillingEvent, IdempotencyStore, OnBillingEvent } from "./types";

export class SignatureVerificationError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "SignatureVerificationError";
  }
}

export class MissingAccountIdError extends Error {
  constructor(readonly stripeCustomerId: string) {
    super(`Customer Stripe ${stripeCustomerId} sans metadata.account_id exploitable.`);
    this.name = "MissingAccountIdError";
  }
}

function verifyEvent(
  stripe: Stripe,
  rawBody: string,
  signature: string,
  webhookSecret: string,
): Stripe.Event {
  try {
    return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    throw new SignatureVerificationError("Signature Stripe invalide.", error);
  }
}

async function resolveAccountId(stripe: Stripe, stripeCustomerId: string): Promise<string> {
  const customer = await stripe.customers.retrieve(stripeCustomerId);

  const accountId =
    !("deleted" in customer && customer.deleted) && customer.metadata?.account_id
      ? customer.metadata.account_id
      : undefined;

  if (!accountId) {
    throw new MissingAccountIdError(stripeCustomerId);
  }

  return accountId;
}

async function mapStripeEventToBillingEvent(
  stripe: Stripe,
  event: Stripe.Event,
): Promise<BillingEvent | null> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const accountId = session.client_reference_id;
      const stripeCustomerId =
        typeof session.customer === "string" ? session.customer : session.customer?.id;

      if (!accountId || !stripeCustomerId) {
        return null;
      }

      return { type: "account.linked", accountId, stripeCustomerId, raw: session };
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const stripeCustomerId =
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer?.id;

      if (!stripeCustomerId) {
        return null;
      }

      const accountId = await resolveAccountId(stripe, stripeCustomerId);

      if (event.type === "customer.subscription.deleted") {
        return { type: "subscription.cancelled", accountId, stripeCustomerId, raw: subscription };
      }

      return {
        type: event.type === "customer.subscription.created" ? "subscription.activated" : "subscription.updated",
        accountId,
        stripeCustomerId,
        stripeSubscriptionId: subscription.id,
        raw: subscription,
      };
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const stripeCustomerId =
        typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;

      if (!stripeCustomerId) {
        return null;
      }

      const accountId = await resolveAccountId(stripe, stripeCustomerId);

      return { type: "payment.failed", accountId, stripeCustomerId, raw: invoice };
    }

    default:
      return null;
  }
}

export function createWebhookModule(
  stripe: Stripe,
  webhookSecret: string,
  onEvent: OnBillingEvent,
  idempotencyStore?: IdempotencyStore,
) {
  async function handleRequest(rawBody: string, signature: string): Promise<void> {
    const event = verifyEvent(stripe, rawBody, signature, webhookSecret);

    if (idempotencyStore && (await idempotencyStore.has(event.id))) {
      return;
    }

    const billingEvent = await mapStripeEventToBillingEvent(stripe, event);

    if (!billingEvent) {
      return;
    }

    await onEvent(billingEvent);

    if (idempotencyStore) {
      await idempotencyStore.record(event.id);
    }
  }

  return { handleRequest };
}
