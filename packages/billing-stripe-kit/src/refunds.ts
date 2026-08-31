import type Stripe from "stripe";

export function createRefundsModule(stripe: Stripe) {
  async function refundPayment(
    paymentIntentId: string,
    amount?: number,
    reason?: Stripe.RefundCreateParams.Reason,
  ): Promise<Stripe.Refund> {
    return stripe.refunds.create({
      payment_intent: paymentIntentId,
      ...(amount !== undefined ? { amount } : {}),
      ...(reason !== undefined ? { reason } : {}),
    });
  }

  return { refundPayment };
}
