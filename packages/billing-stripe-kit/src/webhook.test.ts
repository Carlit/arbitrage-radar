import { test, mock } from "node:test";
import assert from "node:assert/strict";

import { createWebhookModule, MissingAccountIdError, SignatureVerificationError } from "./webhook.ts";
import { createMockStripe, signEvent, WEBHOOK_SECRET } from "./test-helpers/mock-stripe.ts";

function checkoutCompletedEvent(overrides?: Partial<{ accountId: string | null; customerId: string | null }>) {
  return {
    id: "evt_checkout_1",
    type: "checkout.session.completed",
    data: {
      object: {
        client_reference_id: overrides?.accountId === undefined ? "acct_1" : overrides.accountId,
        customer: overrides?.customerId === undefined ? "cus_1" : overrides.customerId,
      },
    },
  };
}

function subscriptionEvent(type: string, id = "evt_sub_1") {
  return {
    id,
    type,
    data: {
      object: {
        id: "sub_1",
        customer: "cus_1",
      },
    },
  };
}

function paymentFailedEvent(id = "evt_invoice_1") {
  return {
    id,
    type: "invoice.payment_failed",
    data: {
      object: {
        id: "in_1",
        customer: "cus_1",
      },
    },
  };
}

// --- T5 : vérification de signature (SDK réel, sans mock, HMAC locale) ---

test("T5 — signature valide : l'event Stripe est retourné à mapStripeEventToBillingEvent", async () => {
  const { stripe } = createMockStripe({ customersRetrieve: async () => ({ id: "cus_1", deleted: false, metadata: { account_id: "acct_1" } }) });
  const onEvent = mock.fn(async (_event: unknown) => {});
  const { handleRequest } = createWebhookModule(stripe, WEBHOOK_SECRET, onEvent);

  const { payload, signature } = signEvent(stripe, subscriptionEvent("customer.subscription.updated"));

  await handleRequest(payload, signature);

  assert.equal(onEvent.mock.calls.length, 1);
  assert.equal((onEvent.mock.calls[0].arguments[0] as { type: string }).type, "subscription.updated");
});

test("T5 — signature absente/invalide : SignatureVerificationError levée, pas une erreur Stripe brute", async () => {
  const { stripe } = createMockStripe();
  const onEvent = mock.fn(async (_event: unknown) => {});
  const { handleRequest } = createWebhookModule(stripe, WEBHOOK_SECRET, onEvent);

  const { payload } = signEvent(stripe, subscriptionEvent("customer.subscription.updated"));

  await assert.rejects(() => handleRequest(payload, "signature_invalide"), SignatureVerificationError);
  assert.equal(onEvent.mock.calls.length, 0);
});

// --- T6 : mapping événements bruts -> BillingEvent ---

test("T6 — checkout.session.completed -> account.linked avec accountId/stripeCustomerId corrects", async () => {
  const { stripe } = createMockStripe();
  const onEvent = mock.fn(async (_event: unknown) => {});
  const { handleRequest } = createWebhookModule(stripe, WEBHOOK_SECRET, onEvent);

  const { payload, signature } = signEvent(stripe, checkoutCompletedEvent());
  await handleRequest(payload, signature);

  assert.equal(onEvent.mock.calls.length, 1);
  const event = onEvent.mock.calls[0].arguments[0] as { type: string; accountId: string; stripeCustomerId: string };
  assert.equal(event.type, "account.linked");
  assert.equal(event.accountId, "acct_1");
  assert.equal(event.stripeCustomerId, "cus_1");
});

test("T6 — customer.subscription.updated avec metadata.account_id correcte -> subscription.updated", async () => {
  const { stripe } = createMockStripe({
    customersRetrieve: async () => ({ id: "cus_1", deleted: false, metadata: { account_id: "acct_42" } }),
  });
  const onEvent = mock.fn(async (_event: unknown) => {});
  const { handleRequest } = createWebhookModule(stripe, WEBHOOK_SECRET, onEvent);

  const { payload, signature } = signEvent(stripe, subscriptionEvent("customer.subscription.updated"));
  await handleRequest(payload, signature);

  const event = onEvent.mock.calls[0].arguments[0] as { type: string; accountId: string };
  assert.equal(event.type, "subscription.updated");
  assert.equal(event.accountId, "acct_42");
});

test("T6 — customer.subscription.deleted -> subscription.cancelled", async () => {
  const { stripe } = createMockStripe({
    customersRetrieve: async () => ({ id: "cus_1", deleted: false, metadata: { account_id: "acct_42" } }),
  });
  const onEvent = mock.fn(async (_event: unknown) => {});
  const { handleRequest } = createWebhookModule(stripe, WEBHOOK_SECRET, onEvent);

  const { payload, signature } = signEvent(stripe, subscriptionEvent("customer.subscription.deleted"));
  await handleRequest(payload, signature);

  const event = onEvent.mock.calls[0].arguments[0] as { type: string };
  assert.equal(event.type, "subscription.cancelled");
});

test("T6 — customer.subscription.created sur Customer sans metadata.account_id -> MissingAccountIdError, pas de BillingEvent", async () => {
  const { stripe } = createMockStripe({
    customersRetrieve: async () => ({ id: "cus_1", deleted: false, metadata: {} }),
  });
  const onEvent = mock.fn(async (_event: unknown) => {});
  const { handleRequest } = createWebhookModule(stripe, WEBHOOK_SECRET, onEvent);

  const { payload, signature } = signEvent(stripe, subscriptionEvent("customer.subscription.created"));

  await assert.rejects(() => handleRequest(payload, signature), MissingAccountIdError);
  assert.equal(onEvent.mock.calls.length, 0);
});

// --- T7 : idempotence ---

function createInMemoryStore() {
  const seen = new Set<string>();
  return {
    has: mock.fn(async (id: string) => seen.has(id)),
    record: mock.fn(async (id: string) => {
      seen.add(id);
    }),
  };
}

test("T7 — rejeu du même event.id deux fois : onEvent appelé une seule fois", async () => {
  const { stripe } = createMockStripe();
  const onEvent = mock.fn(async (_event: unknown) => {});
  const store = createInMemoryStore();
  const { handleRequest } = createWebhookModule(stripe, WEBHOOK_SECRET, onEvent, store);

  const { payload, signature } = signEvent(stripe, checkoutCompletedEvent());

  await handleRequest(payload, signature);
  await handleRequest(payload, signature);

  assert.equal(onEvent.mock.calls.length, 1);
  assert.equal(store.record.mock.calls.length, 1);
});

test("T7 — onEvent qui lève une erreur : record n'est pas appelé (rejeu possible ensuite)", async () => {
  const { stripe } = createMockStripe();
  const onEvent = mock.fn(async () => {
    throw new Error("échec applicatif");
  });
  const store = createInMemoryStore();
  const { handleRequest } = createWebhookModule(stripe, WEBHOOK_SECRET, onEvent, store);

  const { payload, signature } = signEvent(stripe, checkoutCompletedEvent());

  await assert.rejects(() => handleRequest(payload, signature), /échec applicatif/);
  assert.equal(store.record.mock.calls.length, 0);
});

// --- T19 : invoice.payment_failed -> payment.failed ---

test("T19 — invoice.payment_failed avec metadata.account_id présente -> BillingEvent payment.failed avec raw = Invoice complet", async () => {
  const rawInvoice = { id: "in_1", customer: "cus_1" };
  const { stripe } = createMockStripe({
    customersRetrieve: async () => ({ id: "cus_1", deleted: false, metadata: { account_id: "acct_9" } }),
  });
  const onEvent = mock.fn(async (_event: unknown) => {});
  const { handleRequest } = createWebhookModule(stripe, WEBHOOK_SECRET, onEvent);

  const { payload, signature } = signEvent(stripe, paymentFailedEvent());
  await handleRequest(payload, signature);

  assert.equal(onEvent.mock.calls.length, 1);
  const event = onEvent.mock.calls[0].arguments[0] as {
    type: string;
    accountId: string;
    stripeCustomerId: string;
    raw: unknown;
  };
  assert.equal(event.type, "payment.failed");
  assert.equal(event.accountId, "acct_9");
  assert.equal(event.stripeCustomerId, "cus_1");
  assert.deepEqual(event.raw, rawInvoice);
});

test("T19 — invoice.payment_failed sans metadata.account_id -> MissingAccountIdError, pas de BillingEvent", async () => {
  const { stripe } = createMockStripe({
    customersRetrieve: async () => ({ id: "cus_1", deleted: false, metadata: {} }),
  });
  const onEvent = mock.fn(async (_event: unknown) => {});
  const { handleRequest } = createWebhookModule(stripe, WEBHOOK_SECRET, onEvent);

  const { payload, signature } = signEvent(stripe, paymentFailedEvent());

  await assert.rejects(() => handleRequest(payload, signature), MissingAccountIdError);
  assert.equal(onEvent.mock.calls.length, 0);
});

test("T19 — idempotence : rejeu du même event.id payment.failed deux fois -> onEvent appelé une seule fois", async () => {
  const { stripe } = createMockStripe({
    customersRetrieve: async () => ({ id: "cus_1", deleted: false, metadata: { account_id: "acct_9" } }),
  });
  const onEvent = mock.fn(async (_event: unknown) => {});
  const store = createInMemoryStore();
  const { handleRequest } = createWebhookModule(stripe, WEBHOOK_SECRET, onEvent, store);

  const { payload, signature } = signEvent(stripe, paymentFailedEvent());

  await handleRequest(payload, signature);
  await handleRequest(payload, signature);

  assert.equal(onEvent.mock.calls.length, 1);
});
