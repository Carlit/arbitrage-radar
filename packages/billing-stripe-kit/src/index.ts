import Stripe from "stripe";

import { createCheckoutModule } from "./checkout.js";
import { createPortalModule } from "./portal.js";
import { createWebhookModule, SignatureVerificationError, MissingAccountIdError } from "./webhook.js";
import type { IdempotencyStore, OnBillingEvent } from "./types.js";

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
    webhook: createWebhookModule(stripe, config.webhookSecret, config.onEvent, config.idempotencyStore),
  };
}

export { SignatureVerificationError, MissingAccountIdError };
export type { BillingEvent, IdempotencyStore, OnBillingEvent } from "./types.js";

// Ré-exporté pour que les consommateurs (ex. web/lib/billing/tenant-sync.ts) référencent le
// même identifiant de type Stripe que celui utilisé par BillingEvent — sans workspace
// npm/pnpm, web/ et le kit installent chacun leur propre copie de "stripe" ; importer "stripe"
// séparément dans web/ produirait un second identifiant de type structurellement identique
// mais nominalement distinct pour TypeScript (ex. Stripe.Subscription non assignable à
// Stripe.Subscription), d'où ce ré-export explicite comme unique source de vérité.
export type { Stripe };
