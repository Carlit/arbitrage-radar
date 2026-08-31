import type Stripe from "stripe";

export type BillingEvent =
  | {
      type: "account.linked";
      accountId: string;
      stripeCustomerId: string;
      raw: Stripe.Checkout.Session;
    }
  | {
      type: "subscription.activated" | "subscription.updated";
      accountId: string;
      stripeCustomerId: string;
      stripeSubscriptionId: string;
      raw: Stripe.Subscription;
    }
  | {
      type: "subscription.cancelled";
      accountId: string;
      stripeCustomerId: string;
      raw: Stripe.Subscription;
    }
  | {
      type: "payment.failed";
      accountId: string;
      stripeCustomerId: string;
      raw: Stripe.Invoice;
    };

export interface IdempotencyStore {
  has(eventId: string): Promise<boolean>;
  record(eventId: string): Promise<void>;
}

export type OnBillingEvent = (event: BillingEvent) => Promise<void> | void;
