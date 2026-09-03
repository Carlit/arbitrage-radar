import { test } from "node:test";
import assert from "node:assert/strict";

import { createCheckoutModule } from "./checkout.ts";
import { createMockStripe } from "./test-helpers/mock-stripe.ts";

const SUCCESS_URL = "https://app.example.com/billing/success";
const CANCEL_URL = "https://app.example.com/billing/cancel";

test("T3/V1 (rejoué) — createCheckoutSession sans options : Customer + session conformes", async () => {
  const { stripe, customersCreate, checkoutSessionsCreate } = createMockStripe();
  const { createCheckoutSession } = createCheckoutModule(stripe);

  const session = await createCheckoutSession("price_1", "acct_1", SUCCESS_URL, CANCEL_URL);

  assert.equal(customersCreate.mock.calls.length, 1);
  assert.deepEqual(customersCreate.mock.calls[0].arguments[0], {
    metadata: { account_id: "acct_1" },
  });

  assert.equal(checkoutSessionsCreate.mock.calls.length, 1);
  const params = checkoutSessionsCreate.mock.calls[0].arguments[0] as Record<string, unknown>;
  assert.deepEqual(params, {
    mode: "subscription",
    customer: "cus_mock",
    client_reference_id: "acct_1",
    line_items: [{ price: "price_1", quantity: 1 }],
    success_url: SUCCESS_URL,
    cancel_url: CANCEL_URL,
    metadata: {},
  });
  assert.equal(session.id, "cs_mock");
});

test("T26 — successUrl/cancelUrl transmis tels quels dans la requête", async () => {
  const { stripe, checkoutSessionsCreate } = createMockStripe();
  const { createCheckoutSession } = createCheckoutModule(stripe);

  await createCheckoutSession("price_1", "acct_1", SUCCESS_URL, CANCEL_URL);

  const params = checkoutSessionsCreate.mock.calls[0].arguments[0] as Record<string, unknown>;
  assert.equal(params.success_url, SUCCESS_URL);
  assert.equal(params.cancel_url, CANCEL_URL);
});

test("T18 — non-régression : createCheckoutSession(..., {}) sans options est identique à l'appel V1", async () => {
  const { stripe, checkoutSessionsCreate } = createMockStripe();
  const { createCheckoutSession } = createCheckoutModule(stripe);

  await createCheckoutSession("price_1", "acct_1", SUCCESS_URL, CANCEL_URL, {});

  const params = checkoutSessionsCreate.mock.calls[0].arguments[0] as Record<string, unknown>;
  assert.ok(!("subscription_data" in params), "subscription_data ne doit pas apparaître sans trialPeriodDays");
  assert.ok(!("discounts" in params), "discounts ne doit pas apparaître sans options.discounts");
});

test("T18 — options.trialPeriodDays seul : subscription_data.trial_period_days transmis, discounts absent", async () => {
  const { stripe, checkoutSessionsCreate } = createMockStripe();
  const { createCheckoutSession } = createCheckoutModule(stripe);

  await createCheckoutSession("price_1", "acct_1", SUCCESS_URL, CANCEL_URL, {}, { trialPeriodDays: 14 });

  const params = checkoutSessionsCreate.mock.calls[0].arguments[0] as Record<string, unknown>;
  assert.deepEqual(params.subscription_data, { trial_period_days: 14 });
  assert.ok(!("discounts" in params));
});

test("T18 — options.discounts seul : discounts transmis tel quel, subscription_data absent", async () => {
  const { stripe, checkoutSessionsCreate } = createMockStripe();
  const { createCheckoutSession } = createCheckoutModule(stripe);

  const discounts = [{ coupon: "XYZ" }];
  await createCheckoutSession("price_1", "acct_1", SUCCESS_URL, CANCEL_URL, {}, { discounts });

  const params = checkoutSessionsCreate.mock.calls[0].arguments[0] as Record<string, unknown>;
  assert.deepEqual(params.discounts, discounts);
  assert.ok(!("subscription_data" in params));
});

test("T18 — trialPeriodDays et discounts ensemble : les deux présents simultanément, aucune exclusion", async () => {
  const { stripe, checkoutSessionsCreate } = createMockStripe();
  const { createCheckoutSession } = createCheckoutModule(stripe);

  const discounts = [{ coupon: "XYZ" }];
  await createCheckoutSession("price_1", "acct_1", SUCCESS_URL, CANCEL_URL, {}, { trialPeriodDays: 14, discounts });

  const params = checkoutSessionsCreate.mock.calls[0].arguments[0] as Record<string, unknown>;
  assert.deepEqual(params.subscription_data, { trial_period_days: 14 });
  assert.deepEqual(params.discounts, discounts);
});
