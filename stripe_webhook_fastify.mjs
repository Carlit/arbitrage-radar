import 'dotenv/config';
import Fastify from 'fastify';
import rawBody from '@fastify/raw-body';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const requiredEnv = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
];

for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`La variable d'environnement ${key} est requise.`);
  }
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2026-07-29.dahlia',
});

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);

const app = Fastify({
  logger: true,
});

await app.register(rawBody, {
  field: 'rawBody',
  global: false,
  encoding: false,
  runFirst: true,
});

function normalizeStripeStatus(status) {
  const allowed = new Set([
    'trialing',
    'active',
    'past_due',
    'canceled',
    'unpaid',
    'incomplete',
    'incomplete_expired',
    'paused',
  ]);

  return allowed.has(status) ? status : 'incomplete';
}

function extractTierFromSubscription(subscription) {
  const primaryItem = subscription.items?.data?.[0];
  const price = primaryItem?.price;

  if (!price) {
    return 'free';
  }

  const metadataTier = price.metadata?.app_tier?.toLowerCase();
  if (metadataTier === 'free' || metadataTier === 'pro' || metadataTier === 'elite') {
    return metadataTier;
  }

  const lookupKey = (price.lookup_key ?? '').toLowerCase();
  if (lookupKey.includes('elite')) return 'elite';
  if (lookupKey.includes('pro')) return 'pro';
  if (lookupKey.includes('free')) return 'free';

  return 'free';
}

function toIsoTimestamp(unixSeconds) {
  if (!unixSeconds) {
    return null;
  }

  return new Date(unixSeconds * 1000).toISOString();
}

async function updateTenantFromSubscription(subscription, options = {}) {
  const customerId =
    typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer?.id;

  if (!customerId) {
    throw new Error(`Subscription ${subscription.id} sans customer Stripe exploitable.`);
  }

  const subscriptionTier = options.forceTier ?? extractTierFromSubscription(subscription);
  const subscriptionStatus = options.forceStatus ?? normalizeStripeStatus(subscription.status);
  const stripeSubscriptionId = options.clearSubscriptionId ? null : subscription.id;
  const subscriptionCurrentPeriodEndsAt = options.clearPeriodEnd
    ? null
    : toIsoTimestamp(subscription.current_period_end);

  const payload = {
    stripe_subscription_id: stripeSubscriptionId,
    subscription_tier: subscriptionTier,
    subscription_status: subscriptionStatus,
    subscription_current_period_ends_at: subscriptionCurrentPeriodEndsAt,
  };

  const { data, error } = await supabaseAdmin
    .from('tenants')
    .update(payload)
    .eq('stripe_customer_id', customerId)
    .select('id, stripe_customer_id, subscription_tier, subscription_status')
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error(`Aucun tenant trouvé pour stripe_customer_id=${customerId}.`);
  }

  return data;
}

async function handleSubscriptionEvent(event) {
  /** @type {Stripe.Subscription} */
  const subscription = event.data.object;

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      return updateTenantFromSubscription(subscription);

    case 'customer.subscription.deleted':
      return updateTenantFromSubscription(subscription, {
        forceTier: 'free',
        forceStatus: 'canceled',
        clearSubscriptionId: true,
        clearPeriodEnd: false,
      });

    default:
      return null;
  }
}

app.post(
  '/webhooks/stripe',
  {
    config: {
      rawBody: true,
    },
  },
  async (request, reply) => {
    const signature = request.headers['stripe-signature'];

    if (!signature) {
      reply.code(400);
      return { error: 'En-tête stripe-signature manquant.' };
    }

    let event;

    try {
      event = stripe.webhooks.constructEvent(
        request.rawBody,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET,
      );
    } catch (error) {
      request.log.error({ err: error }, 'Signature Stripe invalide');
      reply.code(400);
      return { error: 'Signature Stripe invalide.' };
    }

    try {
      switch (event.type) {
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted': {
          const tenant = await handleSubscriptionEvent(event);
          request.log.info(
            {
              eventType: event.type,
              tenantId: tenant?.id,
            },
            'Tenant synchronisé depuis Stripe',
          );
          break;
        }

        default:
          request.log.info({ eventType: event.type }, 'Événement Stripe ignoré');
      }

      reply.code(200);
      return { received: true };
    } catch (error) {
      request.log.error(
        {
          err: error,
          eventType: event.type,
          eventId: event.id,
        },
        'Échec du traitement du webhook Stripe',
      );

      reply.code(500);
      return { error: 'Échec du traitement du webhook Stripe.' };
    }
  },
);

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? '0.0.0.0';

app
  .listen({ port, host })
  .then(() => {
    app.log.info(`Webhook Stripe Fastify démarré sur http://${host}:${port}`);
  })
  .catch((error) => {
    app.log.error(error, 'Impossible de démarrer le serveur Fastify');
    process.exit(1);
  });
