import Stripe from "stripe";

import { createCheckoutModule } from "./checkout";
import { createPortalModule } from "./portal";
import { createRefundsModule } from "./refunds";
import { createWebhookModule, SignatureVerificationError, MissingAccountIdError } from "./webhook";
import type { IdempotencyStore, OnBillingEvent } from "./types";

export interface BillingKitConfig {
  stripeSecretKey: string;
  webhookSecret: string;
  onEvent: OnBillingEvent;
  idempotencyStore?: IdempotencyStore;
}

export function createBillingKit(config: BillingKitConfig) {
  const stripe = new Stripe(config.stripeSecretKey, {
    apiVersion: "2026-08-26.dahlia",
  });

  return {
    checkout: createCheckoutModule(stripe),
    portal: createPortalModule(stripe),
    refunds: createRefundsModule(stripe),
    webhook: createWebhookModule(stripe, config.webhookSecret, config.onEvent, config.idempotencyStore),
  };
}

export { SignatureVerificationError, MissingAccountIdError };
export type { BillingEvent, IdempotencyStore, OnBillingEvent } from "./types";
export type { CreateCheckoutSessionOptions } from "./checkout";

// Ré-exporté pour que les consommateurs (ex. web/lib/billing/tenant-sync.ts) référencent le
// même identifiant de type Stripe que celui utilisé par BillingEvent — sans workspace
// npm/pnpm, web/ et le kit installent chacun leur propre copie de "stripe" ; importer "stripe"
// séparément dans web/ produirait un second identifiant de type structurellement identique
// mais nominalement distinct pour TypeScript (ex. Stripe.Subscription non assignable à
// Stripe.Subscription), d'où ce ré-export explicite comme unique source de vérité.
export type { Stripe };
