import { test } from "node:test";
import assert from "node:assert/strict";

import { createRefundsModule } from "./refunds.ts";
import { createMockStripe } from "./test-helpers/mock-stripe.ts";

test("T17 — refundPayment('pi_123') sans amount/reason : seule payment_intent est envoyée", async () => {
  const { stripe, refundsCreate } = createMockStripe();
  const { refundPayment } = createRefundsModule(stripe);

  await refundPayment("pi_123");

  assert.equal(refundsCreate.mock.calls.length, 1);
  const params = refundsCreate.mock.calls[0].arguments[0] as Record<string, unknown>;
  assert.deepEqual(Object.keys(params).sort(), ["payment_intent"]);
  assert.equal(params.payment_intent, "pi_123");
});

test("T17 — refundPayment('pi_123', 500, 'requested_by_customer') : les 3 champs sont transmis", async () => {
  const { stripe, refundsCreate } = createMockStripe();
  const { refundPayment } = createRefundsModule(stripe);

  await refundPayment("pi_123", 500, "requested_by_customer");

  assert.equal(refundsCreate.mock.calls.length, 1);
  const params = refundsCreate.mock.calls[0].arguments[0] as Record<string, unknown>;
  assert.deepEqual(params, {
    payment_intent: "pi_123",
    amount: 500,
    reason: "requested_by_customer",
  });
});

test("T17 — refundPayment renvoie le Stripe.Refund retourné par le SDK", async () => {
  const { stripe } = createMockStripe();
  const { refundPayment } = createRefundsModule(stripe);

  const refund = await refundPayment("pi_123");

  assert.equal(refund.id, "re_mock");
});

// Écart constaté par rapport à tasks.md T17 : le "test type" y était décrit comme
// devant vérifier que `tsc` rejette une valeur hors union sans `as any`. En
// pratique, `Stripe.RefundCreateParams.Reason` (stripe@22) est défini comme
// `'duplicate' | 'fraudulent' | 'requested_by_customer' | OtherString`, où
// `OtherString = string & Record<never, never>` (node_modules/stripe/cjs/shared.d.ts) —
// un échappatoire volontaire du SDK Stripe pour accepter toute chaîne (compat
// avant de nouvelles valeurs d'API), pas une union littérale stricte. Une chaîne
// arbitraire type-check donc sans erreur ; `@ts-expect-error` sur un tel appel
// échouerait la compilation (directive inutilisée), donc pas committable ici.
// Le typage reste utile pour l'autocomplétion des 3 valeurs connues, mais ne
// bloque pas une faute de frappe à la compilation — ce n'est pas un bug du kit,
// c'est une limite du typage upstream à connaître.
