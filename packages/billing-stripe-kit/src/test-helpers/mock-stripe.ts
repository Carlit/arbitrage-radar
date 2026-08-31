import { mock } from "node:test";
import RealStripe from "stripe";
import type Stripe from "stripe";

export const WEBHOOK_SECRET = "whsec_test_mock";

/**
 * Stripe pour les tests unitaires du kit : une vraie instance du SDK (donc
 * `webhooks.constructEvent`/`generateTestHeaderString` font une vérification
 * HMAC réelle, pas mockée — cf. T5) sur laquelle on remplace uniquement les
 * méthodes de ressources réellement appelées par les modules du kit
 * (`customers`, `checkout.sessions`, `refunds`) par des mocks `node:test`.
 * Aucun appel réseau n'est fait : ni la construction de `Stripe`, ni
 * `constructEvent`/`generateTestHeaderString` n'en nécessitent.
 */
export function createMockStripe(overrides?: {
  customersRetrieve?: (id: string) => Promise<unknown>;
}) {
  const stripe = new RealStripe("sk_test_mock", { apiVersion: "2026-08-26.dahlia" });

  const customersCreate = mock.fn(async (params: unknown) => ({
    id: "cus_mock",
    ...(typeof params === "object" && params !== null ? params : {}),
  }));

  const customersRetrieve = mock.fn(
    overrides?.customersRetrieve ??
      (async (id: string) => ({ id, deleted: false, metadata: {} })),
  );

  const checkoutSessionsCreate = mock.fn(async (_params: unknown) => ({
    id: "cs_mock",
    url: "https://checkout.stripe.com/mock",
  }));

  const refundsCreate = mock.fn(async (_params: unknown) => ({ id: "re_mock", status: "succeeded" }));

  stripe.customers.create = customersCreate as unknown as Stripe["customers"]["create"];
  stripe.customers.retrieve = customersRetrieve as unknown as Stripe["customers"]["retrieve"];
  stripe.checkout.sessions.create =
    checkoutSessionsCreate as unknown as Stripe["checkout"]["sessions"]["create"];
  stripe.refunds.create = refundsCreate as unknown as Stripe["refunds"]["create"];

  return { stripe, customersCreate, customersRetrieve, checkoutSessionsCreate, refundsCreate };
}

/** Signe un event de test avec la même vérification HMAC que Stripe utilise réellement. */
export function signEvent(stripe: Stripe, event: Record<string, unknown>, secret = WEBHOOK_SECRET) {
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
  return { payload, signature };
}
