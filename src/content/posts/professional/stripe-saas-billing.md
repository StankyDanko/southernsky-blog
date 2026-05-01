---
title: "SaaS Billing with Stripe — Checkout, Webhooks, Tier Sync"
description: "I wired Stripe into a market data service: checkout sessions, webhook handlers, and tier synchronization with Supabase. Here's the production setup."
publishDate: 2026-03-30
author: j-martin
tier: professional
postType: tutorial
difficulty: advanced
estimatedMinutes: 18
prerequisites: ["node", "api-design"]
category: web-development
tags: ["stripe", "saas", "billing", "webhooks", "supabase", "payments"]
certTracks: []
featured: false
draft: false
---

## Why Should You Care?

Billing is the part most developers avoid until they can't. The Stripe docs are comprehensive but they don't tell you how the pieces connect — checkout sessions, webhooks, subscription state, and your own database have to stay synchronized, and any gap between them means either charging users for nothing or giving access to users who've cancelled.

I built the billing integration for a market data service: $99/month, subscription gated, Supabase as the user store. This post covers the production setup — not the happy path, but the parts that actually matter: webhook idempotency, subscription state machines, and testing without hitting Stripe's servers.

---

## Architecture Overview

```
User clicks "Subscribe"
        │
        ▼
POST /api/checkout/create-session
  └─ Stripe: checkout.Session.create()
  └─ Returns: session.url
        │
        ▼
Stripe Checkout UI (Stripe-hosted)
        │
        ▼
Stripe sends webhook events
  └─ checkout.session.completed    → provision access
  └─ customer.subscription.updated → handle upgrades/downgrades
  └─ customer.subscription.deleted → revoke access
        │
        ▼
POST /api/webhooks/stripe
  └─ Verify signature
  └─ Update Supabase user metadata
  └─ Return 200
        │
        ▼
User redirected to /dashboard (success URL)
  └─ Reads Supabase session → tier = 'pro'
  └─ API gates check tier before serving data
```

The key insight: your app should never trust the checkout success redirect URL to grant access. Redirects can be replayed, modified, or missed. **Only the webhook handler changes subscription state.** The success redirect just tells the user "thanks, your account is being set up" while the webhook is already processing.

---

## Step 1: Product and Price Setup

In the Stripe dashboard: create a Product ("Market Data Pro"), then a recurring Price ($99/month, USD). Copy the Price ID — you'll hardcode it.

```typescript
// src/config/stripe.ts

export const STRIPE_CONFIG = {
  priceId: 'price_1OxK2mLkjH8s9D2NqPmR4vBc', // $99/mo recurring
  successUrl: `${process.env.BASE_URL}/dashboard?billing=success`,
  cancelUrl: `${process.env.BASE_URL}/pricing`,
} as const;
```

Don't put Price IDs in environment variables — they're not secrets and you want them version-controlled. The secret key is the only thing that goes in `.env`.

```bash
# .env
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
```

---

## Step 2: Checkout Session Creation

The checkout session is created server-side and returns a URL. Never create it client-side — the secret key must not be exposed.

```typescript
// src/app/api/checkout/create-session/route.ts

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { STRIPE_CONFIG } from '@/config/stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20',
});

export async function POST(req: NextRequest) {
  // Authenticate the user first
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const authHeader = req.headers.get('Authorization');
  const token = authHeader?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Check if they already have a Stripe customer ID
  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .single();

  let customerId = profile?.stripe_customer_id;

  // Create Stripe customer if first time
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { supabase_user_id: user.id }, // critical for webhook lookup
    });
    customerId = customer.id;

    await supabase
      .from('profiles')
      .update({ stripe_customer_id: customerId })
      .eq('id', user.id);
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ['card'],
    line_items: [{ price: STRIPE_CONFIG.priceId, quantity: 1 }],
    mode: 'subscription',
    success_url: STRIPE_CONFIG.successUrl,
    cancel_url: STRIPE_CONFIG.cancelUrl,
    subscription_data: {
      metadata: { supabase_user_id: user.id }, // also on subscription for webhook
    },
  });

  return NextResponse.json({ url: session.url });
}
```

The `metadata: { supabase_user_id: user.id }` on both the customer and the subscription is essential. When the webhook fires, you'll need to look up which user to update — that's the bridge.

---

## Step 3: Webhook Handler

The webhook handler is the source of truth. It receives events from Stripe, verifies they're authentic, and updates Supabase accordingly.

```typescript
// src/app/api/webhooks/stripe/route.ts

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20',
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  const body = await req.text(); // raw body required for signature verification
  const sig = req.headers.get('stripe-signature')!;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // Idempotency: check if we've already processed this event
  const { data: existing } = await supabase
    .from('stripe_events')
    .select('id')
    .eq('stripe_event_id', event.id)
    .single();

  if (existing) {
    // Already processed — return 200 so Stripe stops retrying
    return NextResponse.json({ received: true, duplicate: true });
  }

  // Mark event as processed before handling (prevent double-processing on retries)
  await supabase
    .from('stripe_events')
    .insert({ stripe_event_id: event.id, type: event.type, processed_at: new Date().toISOString() });

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutComplete(event.data.object as Stripe.Checkout.Session);
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      default:
        // Silently ignore events we don't handle
        break;
    }
  } catch (err) {
    console.error(`Error handling ${event.type}:`, err);
    // Return 500 — Stripe will retry with exponential backoff
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
```

**Always return 200 for events you've already processed.** If you return 500, Stripe retries. If you've already committed the state change, a retry causes a duplicate write — at best harmless, at worst corrupting subscription state.

The idempotency pattern: insert the event ID before processing, check for it before starting. This handles the case where your handler crashes mid-processing — on retry, you'll detect the event as already-seen and return 200 without re-running the handler. For truly critical operations (provisioning, billing credits), you'd want a more sophisticated pattern where you check the outcome rather than just whether the event was received.

---

## Step 4: Tier Sync Handlers

```typescript
// Event handlers — same file, below the router

async function handleCheckoutComplete(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.supabase_user_id
    ?? session.subscription_data?.metadata?.supabase_user_id;

  if (!userId) {
    throw new Error(`No supabase_user_id in session ${session.id}`);
  }

  // Fetch the full subscription object — session only has the subscription ID
  const subscription = await stripe.subscriptions.retrieve(
    session.subscription as string
  );

  await syncSubscriptionToSupabase(userId, subscription);
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const userId = subscription.metadata?.supabase_user_id;
  if (!userId) {
    // Fall back to customer metadata lookup
    const customer = await stripe.customers.retrieve(subscription.customer as string);
    if (customer.deleted) throw new Error('Customer deleted');
    const fallbackUserId = (customer as Stripe.Customer).metadata?.supabase_user_id;
    if (!fallbackUserId) throw new Error(`No user ID for subscription ${subscription.id}`);
    return syncSubscriptionToSupabase(fallbackUserId, subscription);
  }
  await syncSubscriptionToSupabase(userId, subscription);
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const userId = subscription.metadata?.supabase_user_id;
  if (!userId) throw new Error(`No user ID for deleted subscription ${subscription.id}`);

  await supabase
    .from('profiles')
    .update({
      tier: 'free',
      stripe_subscription_id: null,
      subscription_status: 'canceled',
      subscription_ends_at: null,
    })
    .eq('id', userId);
}

async function syncSubscriptionToSupabase(userId: string, subscription: Stripe.Subscription) {
  const tier = subscription.status === 'active' ? 'pro' : 'free';

  await supabase
    .from('profiles')
    .update({
      tier,
      stripe_subscription_id: subscription.id,
      subscription_status: subscription.status,
      // current_period_end is a Unix timestamp
      subscription_ends_at: new Date(subscription.current_period_end * 1000).toISOString(),
    })
    .eq('id', userId);
}
```

The Supabase `profiles` table schema for this:

```sql
alter table profiles add column if not exists tier text not null default 'free';
alter table profiles add column if not exists stripe_customer_id text;
alter table profiles add column if not exists stripe_subscription_id text;
alter table profiles add column if not exists subscription_status text;
alter table profiles add column if not exists subscription_ends_at timestamptz;

create table if not exists stripe_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text unique not null,
  type text not null,
  processed_at timestamptz not null,
  created_at timestamptz default now()
);
```

---

## Step 5: API Tier Gating

With `tier` on the profile, gating is straightforward:

```typescript
// src/lib/auth.ts

export async function requireProTier(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) throw new AuthError('Unauthenticated', 401);

  const { data: profile } = await supabase
    .from('profiles')
    .select('tier, subscription_status, subscription_ends_at')
    .eq('id', user.id)
    .single();

  if (profile?.tier !== 'pro') {
    throw new AuthError('Subscription required', 403);
  }

  // Handle grace period: subscription canceled but still within paid period
  if (profile.subscription_status === 'canceled' && profile.subscription_ends_at) {
    const endsAt = new Date(profile.subscription_ends_at);
    if (endsAt > new Date()) {
      return user; // still in paid period, allow access
    }
  }

  if (profile.subscription_status !== 'active') {
    throw new AuthError('Subscription inactive', 403);
  }

  return user;
}
```

```typescript
// src/app/api/market-data/signals/route.ts

export async function GET(req: NextRequest) {
  try {
    await requireProTier(req);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  const signals = await fetchMarketSignals();
  return NextResponse.json({ signals });
}
```

---

## Testing with Stripe CLI

The Stripe CLI forwards webhook events from Stripe to your local server. Essential for development:

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Authenticate
stripe login

# Forward webhooks to local server
stripe listen --forward-to localhost:3000/api/webhooks/stripe

# Output:
# > Ready! Your webhook signing secret is whsec_test_... (copy to .env.local)
# 2026-03-30 14:23:01 --> customer.subscription.created [evt_1OxK...]
# 2026-03-30 14:23:01 <-- [200] POST http://localhost:3000/api/webhooks/stripe
```

Trigger specific events without going through the checkout UI:

```bash
# Simulate a successful checkout
stripe trigger checkout.session.completed

# Simulate subscription cancellation
stripe trigger customer.subscription.deleted

# Simulate failed payment (subscription goes to past_due)
stripe trigger invoice.payment_failed
```

For integration tests, use `stripe-mock` — a local Stripe API simulator that returns predictable responses. Install as a Docker container:

```bash
docker run --rm -p 12111:12111 stripe/stripe-mock:latest
```

Then point your Stripe client at it:

```typescript
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20',
  ...(process.env.NODE_ENV === 'test' && {
    host: 'localhost',
    port: 12111,
    protocol: 'http',
  }),
});
```

---

## Subscription Status States

Stripe's subscription status field isn't a simple active/inactive binary. You need to handle all of these:

| Status | Meaning | Gate access? |
|--------|---------|-------------|
| `active` | Current, paid | Yes |
| `trialing` | In trial period | Yes |
| `past_due` | Payment failed, retrying | Grace period (configurable) |
| `canceled` | Explicitly canceled | Check `current_period_end` |
| `unpaid` | Retries exhausted | No |
| `incomplete` | Initial payment failed | No |
| `incomplete_expired` | Never completed | No |

The `past_due` handling is a judgment call. Stripe retries failed payments over several days (configurable in dashboard). During that time, the user's subscription is technically unpaid but the payment might succeed. Most SaaS products keep access open during `past_due` and only revoke on `unpaid` or after a configured dunning period.

```typescript
function shouldGrantAccess(status: string, endsAt: Date | null): boolean {
  if (status === 'active' || status === 'trialing') return true;
  if (status === 'past_due') return true; // generous: keep access during retry window
  if (status === 'canceled' && endsAt && endsAt > new Date()) return true; // paid through end of period
  return false;
}
```

---

## What You Learned

- **Never trust the redirect URL to grant access.** Only the webhook handler should change subscription state — redirects are for UX feedback, not authorization.
- **Idempotency is non-negotiable.** Record the Stripe event ID before processing and return 200 for duplicates. Stripe retries on 4xx/5xx — without idempotency, retries cause double-processing.
- **The metadata bridge (`supabase_user_id`) is critical.** Set it on both the Customer and the Subscription when creating them — you'll need one or the other for every webhook lookup.
- **Subscription status is a state machine, not a boolean.** Handle `past_due`, `trialing`, and the cancellation grace period explicitly — the happy path covers ~80% of users, the edge cases cover the other 20% who email support.
- **Test with `stripe listen` and `stripe trigger`.** You can exercise every billing state locally without a real card or a real checkout, which makes billing logic testable like any other code.
