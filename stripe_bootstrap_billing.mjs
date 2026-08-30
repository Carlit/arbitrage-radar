import 'dotenv/config';
import Stripe from 'stripe';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

if (!stripeSecretKey) {
  throw new Error("La variable d'environnement STRIPE_SECRET_KEY est requise.");
}

const stripe = new Stripe(stripeSecretKey, {
  apiVersion: '2026-07-29.dahlia',
});

const currency = (process.env.STRIPE_CURRENCY ?? 'eur').toLowerCase();

const plans = [
  {
    tier: 'free',
    productName: 'Arbitrage Radar Free',
    description: 'Accès découverte avec volume limité et alertes basiques.',
    lookupKey: 'arbitrage-radar-free-monthly',
    unitAmount: Number(process.env.STRIPE_PRICE_FREE_MONTHLY ?? 0),
  },
  {
    tier: 'pro',
    productName: 'Arbitrage Radar Pro',
    description: 'Accès complet aux alertes professionnelles en temps réel.',
    lookupKey: 'arbitrage-radar-pro-monthly',
    unitAmount: Number(process.env.STRIPE_PRICE_PRO_MONTHLY ?? 4900),
  },
  {
    tier: 'elite',
    productName: 'Arbitrage Radar Elite',
    description: 'Alertes premium, seuils avancés et couverture maximale.',
    lookupKey: 'arbitrage-radar-elite-monthly',
    unitAmount: Number(process.env.STRIPE_PRICE_ELITE_MONTHLY ?? 19900),
  },
];

async function findProductByTier(tier) {
  let startingAfter;

  do {
    const page = await stripe.products.list({
      active: true,
      limit: 100,
      starting_after: startingAfter,
    });

    const match = page.data.find((product) => product.metadata?.app_tier === tier);
    if (match) {
      return match;
    }

    startingAfter = page.has_more ? page.data.at(-1)?.id : undefined;
  } while (startingAfter);

  return null;
}

async function findPriceByLookupKey(lookupKey) {
  let startingAfter;

  do {
    const page = await stripe.prices.list({
      active: true,
      limit: 100,
      type: 'recurring',
      starting_after: startingAfter,
    });

    const match = page.data.find((price) => price.lookup_key === lookupKey);
    if (match) {
      return match;
    }

    startingAfter = page.has_more ? page.data.at(-1)?.id : undefined;
  } while (startingAfter);

  return null;
}

async function ensureProduct(plan) {
  const existing = await findProductByTier(plan.tier);
  if (existing) {
    return existing;
  }

  return stripe.products.create({
    name: plan.productName,
    description: plan.description,
    metadata: {
      app_tier: plan.tier,
      app_family: 'arbitrage-radar',
    },
  });
}

async function ensurePrice(plan, productId) {
  const existing = await findPriceByLookupKey(plan.lookupKey);
  if (existing) {
    return existing;
  }

  return stripe.prices.create({
    product: productId,
    currency,
    unit_amount: plan.unitAmount,
    recurring: {
      interval: 'month',
    },
    lookup_key: plan.lookupKey,
    nickname: `${plan.tier}-monthly`,
    metadata: {
      app_tier: plan.tier,
      app_family: 'arbitrage-radar',
      billing_interval: 'month',
    },
  });
}

async function bootstrap() {
  const output = {};

  for (const plan of plans) {
    const product = await ensureProduct(plan);
    const price = await ensurePrice(plan, product.id);

    output[plan.tier] = {
      productId: product.id,
      priceId: price.id,
      lookupKey: price.lookup_key,
      unitAmount: price.unit_amount,
      currency: price.currency,
    };
  }

  console.log(JSON.stringify(output, null, 2));
}

bootstrap().catch((error) => {
  console.error('Échec du bootstrap Stripe:', error);
  process.exit(1);
});
