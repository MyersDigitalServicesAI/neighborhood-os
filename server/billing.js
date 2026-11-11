import { Problem } from './supabase.js';

export const vettingFee = 25000;
const utf8 = new TextEncoder();
const decode = new TextDecoder();
export async function verifyStripeEvent(raw, signature, secret, seconds = Date.now() / 1000) {
  const pairs = String(signature ?? '').split(',').map((pair) => pair.trim().split('='));
  const stamped = pairs.find(([key]) => key === 't')?.[1];
  if (!/^\d+$/.test(stamped ?? '') || Math.abs(seconds - Number(stamped)) > 300) throw new Problem(400, 'Invalid signature.');
  const prefix = utf8.encode(stamped + '.');
  const content = new Uint8Array(prefix.length + raw.length);
  content.set(prefix);
  content.set(raw,prefix.length);
  const key = await crypto.subtle.importKey('raw',utf8.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  for (const [kind,value] of pairs) {
    if (kind !== 'v1' || !/^[0-9a-f]{64}$/i.test(value ?? '')) continue;
    const hash = Uint8Array.from(value.match(/../g),pair=>parseInt(pair,16));
    if (await crypto.subtle.verify('HMAC',key,hash,content)) {
      try { return JSON.parse(decode.decode(raw)); } catch { throw new Problem(400, 'Invalid event.'); }
    }
  }
  throw new Problem(400,'Invalid signature.');
}

// The one-time vetting fee counts only when the provider's own copy of the Checkout Session says the
// full, undiscounted amount was collected for the business and reservation recorded in its metadata.
export function paymentState(session, observedAt) {
  const payment = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
  return {
    business: session.metadata?.neighborhood_business,
    checkoutKey: session.metadata?.neighborhood_checkout,
    payment,
    customer: typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null,
    paid: !!(session.mode === 'payment' && session.status === 'complete' && session.payment_status === 'paid' &&
      session.currency === 'usd' && session.amount_subtotal === vettingFee && session.amount_total >= vettingFee &&
      /^pi_[A-Za-z0-9]+$/.test(payment ?? '')),
    observedAt
  };
}

export function billingAdapter(env, database, request = fetch) {
  const { STRIPE_SECRET_KEY: key, STRIPE_PRICE_ID: priceId, STRIPE_WEBHOOK_SECRET: webhookSecret, APP_ORIGIN: origin } = env;
  const enabled = !!(key && priceId && webhookSecret && origin && env.SUPABASE_SECRET_KEY);
  async function stripe(path, params, idempotency) {
    const response = await request('https://api.stripe.com/v1/' + path, {
      method: params ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + key, 'Stripe-Version': '2025-09-30.clover',
        ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...(idempotency ? { 'Idempotency-Key': idempotency } : {}) },
      body: params ? new URLSearchParams(params) : undefined, signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Problem(502, 'Billing provider is temporarily unavailable.');
    return response.json();
  }
  return {
    enabled,
    async checkout(approval) {
      const price = await stripe('prices/' + encodeURIComponent(priceId));
      if (!price.active || price.unit_amount !== vettingFee || price.currency !== 'usd' || price.type !== 'one_time' || price.recurring) {
        throw new Problem(503, 'The vetting fee is unavailable.');
      }
      const session = await stripe('checkout/sessions', {
        mode: 'payment', 'line_items[0][price]': priceId, 'line_items[0][quantity]': '1',
        'metadata[neighborhood_business]': approval.id, 'metadata[neighborhood_checkout]': approval.key,
        'payment_intent_data[metadata][neighborhood_business]': approval.id,
        'payment_intent_data[metadata][neighborhood_checkout]': approval.key,
        success_url: origin + '/#manage', cancel_url: origin + '/#manage',
        ...(approval.customer ? { customer: approval.customer } : {})
      }, 'neighborhood-checkout-' + approval.key);
      if (!session.url) throw new Problem(409, 'Checkout is already complete or expired. Check your vetting status.');
      return { url: session.url };
    },
    async webhook(raw, signature) {
      if (!enabled) throw new Problem(503, 'Billing is disabled.');
      const event = await verifyStripeEvent(raw, signature, webhookSecret);
      if (event.livemode !== key.startsWith('sk_live_')) throw new Problem(400, 'Billing mode mismatch.');
      const obj = event.data?.object;
      const observedAt = new Date().toISOString();
      if (event.type === 'charge.refunded') {
        const intent = typeof obj?.payment_intent === 'string' ? obj.payment_intent : '';
        if (!/^pi_[A-Za-z0-9]+$/.test(intent)) return;
        const current = await stripe('payment_intents/' + encodeURIComponent(intent) + '?expand[]=latest_charge');
        if (current.latest_charge?.refunded !== true || !current.metadata?.neighborhood_business) return;
        await database.syncBilling({ business: current.metadata.neighborhood_business, payment: current.id, refunded: true, observedAt });
        return;
      }
      if (!['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.expired'].includes(event.type) ||
          !/^cs_[A-Za-z0-9_]+$/.test(obj?.id ?? '')) return;
      const session = await stripe('checkout/sessions/' + encodeURIComponent(obj.id));
      const state = paymentState(session, observedAt);
      if (!state.business || !state.checkoutKey) return;
      if (session.status === 'expired') {
        await database.syncBilling({ business: state.business, checkoutKey: state.checkoutKey, expired: true, observedAt });
      } else if (state.paid) {
        await database.syncBilling(state);
      }
    }
  };
}
