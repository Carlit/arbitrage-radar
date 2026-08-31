import { test, mock } from "node:test";
import assert from "node:assert/strict";

import { createBillingKit } from "./index.ts";
import { createWebhookModule } from "./webhook.ts";
import { createMockStripe, signEvent, WEBHOOK_SECRET } from "./test-helpers/mock-stripe.ts";

/**
 * T20 — Non-régression V1+V2.
 *
 * Les scénarios T5-T8 (V1) et T17-T19 (V2) unitaires vivent dans
 * refunds.test.ts/checkout.test.ts/webhook.test.ts. Ce fichier couvre ce que
 * ces tests unitaires ne couvrent pas isolément :
 *   1. L'assemblage du kit (T8/T9) tient toujours après l'ajout de `refunds`
 *      et des options de checkout (aucune régression de câblage).
 *   2. Une même passe de dispatch mélange des events V1 et V2 sans
 *      contamination croisée de l'idempotence (par event.id, pas par type).
 *
 * Hors de portée ici, comme déjà documenté dans tasks.md T14/T20 : les 7
 * scénarios contre une vraie base Supabase locale + Stripe CLI. Cet
 * environnement n'a pas de clés Stripe de test ni de stack Supabase locale
 * démarrée (même limite que `stripe-billing`) — non rejoués, pas simulés.
 */

test("T20 — createBillingKit assemble toujours checkout/portal/refunds/webhook après l'ajout V2", () => {
  const kit = createBillingKit({
    stripeSecretKey: "sk_test_mock",
    webhookSecret: "whsec_test_mock",
    onEvent: async () => {},
  });

  assert.equal(typeof kit.checkout.createCheckoutSession, "function");
  assert.equal(typeof kit.portal.createPortalSession, "function");
  assert.equal(typeof kit.refunds.refundPayment, "function");
  assert.equal(typeof kit.webhook.handleRequest, "function");
});

function createInMemoryStore() {
  const seen = new Set<string>();
  return {
    has: async (id: string) => seen.has(id),
    record: mock.fn(async (id: string) => {
      seen.add(id);
    }),
  };
}

test("T20 — passe combinée V1+V2 : account.linked, subscription.updated, payment.failed dans le même dispatch, idempotence par event.id indépendante du type", async () => {
  const { stripe } = createMockStripe({
    customersRetrieve: async () => ({ id: "cus_1", deleted: false, metadata: { account_id: "acct_1" } }),
  });
  const onEvent = mock.fn(async (_event: unknown) => {});
  const store = createInMemoryStore();
  const { handleRequest } = createWebhookModule(stripe, WEBHOOK_SECRET, onEvent, store);

  const events = [
    { id: "evt_1", type: "checkout.session.completed", data: { object: { client_reference_id: "acct_1", customer: "cus_1" } } },
    { id: "evt_2", type: "customer.subscription.updated", data: { object: { id: "sub_1", customer: "cus_1" } } },
    { id: "evt_3", type: "invoice.payment_failed", data: { object: { id: "in_1", customer: "cus_1" } } },
  ];

  for (const event of events) {
    const { payload, signature } = signEvent(stripe, event);
    await handleRequest(payload, signature);
  }

  // Rejeu de evt_1 (V1) et evt_3 (V2) : ne doit rien redéclencher, sans affecter l'autre type.
  for (const event of [events[0], events[2]]) {
    const { payload, signature } = signEvent(stripe, event);
    await handleRequest(payload, signature);
  }

  assert.equal(onEvent.mock.calls.length, 3);
  const types = onEvent.mock.calls.map(
    (call: { arguments: unknown[] }) => (call.arguments[0] as { type: string }).type,
  );
  assert.deepEqual(types, ["account.linked", "subscription.updated", "payment.failed"]);
  assert.equal(store.record.mock.calls.length, 3);
});
