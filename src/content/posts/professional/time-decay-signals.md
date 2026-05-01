---
title: "Time-Decay Signals in Real-Time Trading Systems"
description: "A signal from 5 minutes ago might be noise now. Here's how I built a time-decay scoring system that separates actionable intelligence from stale data."
publishDate: 2026-05-01
author: j-martin
tier: professional
postType: project-walkthrough
difficulty: advanced
estimatedMinutes: 17
prerequisites: ["api-basics", "javascript-basics"]
category: javascript-typescript
tags: ["trading", "signals", "sse", "real-time", "algorithms"]
heroImage: "/images/posts/time-decay-signals.webp"
featured: false
draft: false
---

A signal that was relevant 5 minutes ago might be noise now. Time-decay is the difference between actionable intelligence and stale data.

I learned this the hard way. I built a market data service that pulls from half a dozen APIs — equities, crypto, metals, macro indicators, sentiment indexes, even on-chain whale transfers — and computes a weighted composite score every two minutes. The score was useful. Until it wasn't. Because VIX data that's 45 minutes old looks exactly like VIX data that's 2 minutes old if you don't track when it arrived.

The system was making decisions on stale inputs without knowing they were stale. That's worse than having no data at all, because stale data carries the confidence of fresh data with none of the accuracy.

This post walks through the time-decay scoring system I built to fix that. The architecture covers four concerns: tracking data freshness per signal component, applying mathematical decay functions when data goes stale, recomputing weighted scores after decay, and broadcasting updates over SSE so downstream consumers always know what they're working with.

---

## The Signal Architecture

Before getting into decay, here's what the signal engine actually computes. The system pulls live market data from multiple sources and computes eight individual "sliders" — each a 0-100 score representing a different dimension of market state:

```javascript
const sliders = {
  trendDirection:     72,  // BTC price vs SMA(200) + golden/death cross
  trendStrength:      58,  // ADX normalized to 0-100
  volatility:         41,  // VIX + Bollinger Band width
  sentiment:          63,  // Fear & Greed index passthrough
  correlation:        50,  // BTC/Gold direction agreement
  liquidity:          44,  // 24h volume vs 30-day average
  celestialInfluence: 50,  // External overlay score
  whaleActivity:      67,  // On-chain whale transfer analysis
};
```

Each slider gets a weight. The weights sum to 1.0 and represent how much each dimension contributes to the final composite:

```javascript
const DEFAULT_WEIGHTS = {
  trendDirection:      0.24,
  trendStrength:       0.19,
  volatility:          0.14,
  sentiment:           0.17,
  correlation:         0.08,
  liquidity:           0.08,
  celestialInfluence:  0.04,
  whaleActivity:       0.06,
};
```

The composite score is a straightforward weighted sum:

```javascript
function compositeScore(sliders, weights) {
  let total = 0;
  for (const [key, weight] of Object.entries(weights)) {
    total += (sliders[key] ?? 50) * weight;
  }
  return Math.round(total);
}
```

Notice the `?? 50` fallback. 50 is the neutral value — if a slider is missing, it contributes zero directional bias. This is important for decay: as data gets stale, it should drift toward 50, not toward 0 or 100.

The composite drives a trading mode decision:

```javascript
let mode;
if (composite > thresholds.longAbove) mode = 'TREND_LONG';
else if (composite < thresholds.shortBelow) mode = 'TREND_SHORT';
else if (adx < thresholds.standbyAdxBelow) mode = 'STANDBY';
else mode = 'RANGE';
```

The problem is clear: if the VIX slider was computed from data that's 3 hours old, that slider is still contributing its full 14% weight to the composite. The mode decision trusts it just as much as the trend direction slider that was refreshed 30 seconds ago.

---

## Why Time-Decay Matters

Each data source refreshes on its own schedule, and each source has different tolerance for staleness:

| Slider | Source | Refresh Rate | Staleness Threshold |
|--------|--------|-------------|-------------------|
| Trend Direction | Price vs SMA | ~2 min | 30 min |
| Trend Strength | ADX | ~2 min | 30 min |
| Volatility | VIX + Bollinger | ~2 min | 10 min |
| Sentiment | Fear & Greed | 1x/day | 3 hours |
| Correlation | BTC/Gold | 1x/day | 36 hours |
| Liquidity | Volume ratio | ~2 min | 36 hours |
| Celestial Influence | External API | ~3 hours | 3 hours |
| Whale Activity | On-chain scan | 10 min | 60 min |

The staleness thresholds aren't arbitrary. Volatility has a 10-minute threshold because VIX can move dramatically in that window — a 10-minute-old VIX reading during a selloff could be off by several points. Sentiment, on the other hand, is measured daily and changes slowly — 3 hours of staleness is tolerable because the Fear & Greed index doesn't oscillate intraday.

These thresholds define the contract: "I trust this data for this long. After that, start reducing its influence."

```javascript
const STALE_MINUTES = {
  trendDirection: 30,
  trendStrength: 30,
  volatility: 10,
  sentiment: 180,
  correlation: 2160,   // 36 hours
  liquidity: 2160,
  celestialInfluence: 180,
  whaleActivity: 60,
};
```

---

## The Decay Functions

There are two common approaches to time-decay: linear and exponential. I use exponential, and here's why.

### Linear Decay

Linear decay subtracts a fixed amount per unit of time. If a slider has value 80 and you decay it linearly toward 50 over 4 hours, you'd compute:

```javascript
// Linear: constant rate of change
function linearDecay(value, hoursElapsed, halfLifeHours) {
  const rate = (value - 50) / (halfLifeHours * 2);
  const decayed = value - (rate * hoursElapsed);
  return Math.round(Math.max(50, Math.min(value, decayed)));
}
```

The problem with linear decay is that it's too aggressive in the early period and too generous in the late period. A signal that's 10 minutes stale is almost certainly still directionally correct — linear decay starts pulling it toward neutral immediately. And a signal that's been stale for 6 hours is probably worthless — but linear decay might still have it at 55 instead of at 50 where it belongs.

### Exponential Decay

Exponential decay preserves most of the signal's value in the early period and then drops it off sharply. The half-life parameter controls how fast: after one half-life, the signal has lost half of its deviation from neutral.

```javascript
function decaySlider(value, minutesSinceUpdate, staleAfterMinutes, halfLifeHours = 4) {
  // No decay if data is still within freshness window
  if (minutesSinceUpdate <= staleAfterMinutes) return value;

  // Decay only the time elapsed AFTER the staleness threshold
  const hoursStale = (minutesSinceUpdate - staleAfterMinutes) / 60;

  // Exponential decay toward neutral (50)
  return Math.round(50 + (value - 50) * Math.pow(0.5, hoursStale / halfLifeHours));
}
```

Let's trace through what happens to a slider with value 80 (strong bullish signal), a staleness threshold of 30 minutes, and a 4-hour half-life:

| Minutes Since Update | Stale? | Decayed Value | % Signal Remaining |
|---------------------|--------|--------------|-------------------|
| 15 | No | 80 | 100% |
| 30 | No | 80 | 100% |
| 90 | Yes (1h stale) | 77 | 90% |
| 150 | Yes (2h stale) | 74 | 80% |
| 270 | Yes (4h stale) | 65 | 50% |
| 510 | Yes (8h stale) | 57 | 25% |
| 750 | Yes (12h stale) | 53 | 12% |

The key insight is in the first two rows: there's zero penalty during the freshness window. The staleness threshold acts as a grace period. Data doesn't start decaying the instant it arrives — it starts decaying after it's been sitting around longer than expected.

The second insight is the approach to neutral. The decay formula is `50 + (value - 50) * decay_factor`. This means:

- A bullish signal (80) decays toward 50 from above
- A bearish signal (20) decays toward 50 from below
- A neutral signal (50) is unaffected by decay — `50 + (50-50) * anything = 50`

This is exactly right. When you don't know if a signal is still valid, the safest assumption is "no opinion." Not bullish, not bearish — neutral.

### Per-Slider Half-Life Overrides

Not all sliders should decay at the same rate. Whale activity data — based on on-chain transactions that physically happened on a blockchain — ages faster than sentiment data. If whale transfers showed heavy exchange inflows 2 hours ago and you haven't seen any since, the signal has genuinely degraded. The market may have already absorbed that selling pressure.

```javascript
const HALF_LIFE_HOURS = {
  whaleActivity: 1,  // Aggressive: blockchain data ages fast
  // Everything else defaults to 4 hours
};
```

A 1-hour half-life means the whale activity slider loses half its deviation from neutral every hour after it goes stale. So a strong whale signal (score 80) that goes stale at minute 60 decays to 65 by the 2-hour mark and is practically at neutral (53) by hour 4.

The default 4-hour half-life is more conservative — appropriate for macro indicators like trend direction, where the underlying market structure changes slowly.

---

## Staleness Detection: The Freshness Map

Every time the signal endpoint runs, it tracks when each slider's underlying data was last successfully refreshed. These timestamps are stored in Redis with a simple naming convention:

```javascript
// After a successful data fetch, record the timestamp
await redis.set('slider:lastUpdated:volatility', String(Date.now()));
await redis.set('slider:lastUpdated:whaleActivity', String(Date.now()));
```

On the next signal computation, the system reads all timestamps in parallel and computes a freshness map:

```javascript
function computeFreshness(sliderTimestamps) {
  const now = Date.now();
  const freshness = {};

  for (const [slider, staleMinutes] of Object.entries(STALE_MINUTES)) {
    const ts = sliderTimestamps[slider];
    if (!ts) {
      // No timestamp at all — assume stale
      freshness[slider] = { stale: true, minutesAgo: null, threshold: staleMinutes };
    } else {
      const minutesAgo = Math.round((now - ts) / 60000);
      freshness[slider] = {
        stale: minutesAgo > staleMinutes,
        minutesAgo,
        threshold: staleMinutes,
      };
    }
  }
  return freshness;
}
```

The freshness map is included in every signal response. Downstream consumers — the alert engine, the SSE feed, the newsletter pipeline — can see exactly which components are stale and by how much. A typical response includes:

```json
{
  "composite": 62,
  "mode": "TREND_LONG",
  "sliders": {
    "trendDirection": 72,
    "trendStrength": 58,
    "volatility": 38,
    "sentiment": 63,
    "correlation": 50,
    "liquidity": 44,
    "celestialInfluence": 50,
    "whaleActivity": 55
  },
  "freshness": {
    "trendDirection": { "stale": false, "minutesAgo": 2, "threshold": 30 },
    "volatility": { "stale": true, "minutesAgo": 14, "threshold": 10 },
    "whaleActivity": { "stale": false, "minutesAgo": 8, "threshold": 60 },
    "sentiment": { "stale": false, "minutesAgo": 90, "threshold": 180 }
  },
  "sources": {
    "overview": true,
    "indicators": true,
    "cryptoPrice": true,
    "whaleScore": true
  },
  "timestamp": "2026-04-15T14:32:01.000Z"
}
```

Notice how the volatility slider is marked stale (14 minutes old, threshold is 10). Its value of 38 has already been decayed from whatever the raw computation returned. The `sources` map shows which upstream fetches succeeded on this cycle — useful for debugging when a slider's freshness is degrading because its API is returning errors.

---

## Applying Decay in the Signal Pipeline

The decay logic sits between raw computation and response delivery. Here's the flow:

```
Raw data fetches (parallel)
    ↓
8 slider computations (raw scores)
    ↓
Read Redis timestamps (per-slider freshness)
    ↓
Apply decaySlider() to each raw score
    ↓
Recompute composite with decayed sliders
    ↓
Recompute mode from decayed composite
    ↓
Attach freshness map
    ↓
Return signal + broadcast via SSE
```

The critical step is recomputing the composite *after* decay. If you apply decay to individual sliders but use the pre-decay composite, the mode decision is based on stale data. The implementation looks like this:

```javascript
router.get('/signal', cached(120), async (req, res) => {
  // 1. Parallel data fetches — 10 sources at once
  const results = await Promise.allSettled([
    fetchInternal(req, '/market/overview'),
    fetchInternal(req, '/indicators/summary?symbol=BTC/USD&interval=4h'),
    fetchInternal(req, '/indicators/ta?symbol=BTC/USD&indicator=adx&interval=4h'),
    fetchInternal(req, '/crypto/price?symbol=bitcoin'),
    fetchAstroSight(),
    readRedisKey(redis, 'gold:previous_close'),
    readRedisKey(redis, 'btc:volume_avg_30d'),
    readRedisKey(redis, 'trading:config'),
    readRedisKey(redis, 'whale:score'),
    readRedisKey(redis, 'whale:lastUpdated'),
  ]);

  // 2. Assemble market data object from settled results
  const marketData = assembleMarketData(results);

  // 3. Compute raw signal (before decay)
  const signal = computeSignal(marketData, config.weights, config.thresholds);

  // 4. Read slider timestamps and apply per-slider decay
  const sliderTimestamps = await readRedisSliderTimestamps(redis);
  const now = Date.now();

  for (const [slider, staleMinutes] of Object.entries(STALE_MINUTES)) {
    const ts = sliderTimestamps[slider];
    if (ts) {
      const minutesSince = (now - ts) / 60000;
      const halfLife = HALF_LIFE_HOURS[slider] || 4;
      signal.sliders[slider] = decaySlider(
        signal.sliders[slider], minutesSince, staleMinutes, halfLife
      );
    }
  }

  // 5. Recompute composite AFTER decay
  signal.composite = compositeScore(signal.sliders, config.weights);

  // 6. Recompute mode AFTER decay
  if (signal.composite > thresholds.longAbove) signal.mode = 'TREND_LONG';
  else if (signal.composite < thresholds.shortBelow) signal.mode = 'TREND_SHORT';
  else if ((marketData.adx ?? 50) < thresholds.standbyAdxBelow) signal.mode = 'STANDBY';
  else signal.mode = 'RANGE';

  // 7. Attach freshness metadata
  signal.freshness = computeFreshness(sliderTimestamps);

  res.json(signal);
});
```

The `Promise.allSettled` pattern is important. We don't want one API failure to tank the entire signal computation. If CoinGecko is down, the liquidity slider falls back to 50 (neutral). If the AstroSight service doesn't respond, the celestial influence slider falls back to 50. The composite still computes — it's just less confident, which is exactly what decay-toward-neutral achieves.

---

## Whale Activity: A Case Study in Aggressive Decay

The whale monitoring system is a good example of why per-slider decay tuning matters. The system scans the Bitcoin mempool and recent blocks every 10 minutes, looking for transactions over 200 BTC:

```javascript
const MIN_WHALE_SATS = 20_000_000_000; // 200 BTC

function filterWhaleTransactions(rawTxs) {
  const seen = new Set();
  const results = [];
  for (const tx of rawTxs) {
    if (seen.has(tx.txid)) continue;
    seen.add(tx.txid);
    const filtered = filterChangeOutputs(tx.vout || []);
    const maxOutput = filtered.reduce((max, o) =>
      o.value > max ? o.value : max, 0);
    if (maxOutput < MIN_WHALE_SATS) continue;
    results.push(classifyTransaction({ ...tx, vout: filtered }));
  }
  return results;
}
```

Each qualifying transaction gets classified by exchange address mapping: `EXCHANGE_INFLOW` (coins moving to an exchange — bearish signal), `EXCHANGE_OUTFLOW` (coins leaving an exchange — bullish), `WALLET_TO_WALLET` (neutral), or `EXCHANGE_INTERNAL` (filtered out as noise). The whale score is then computed from three components:

```javascript
function computeWhaleScore(transfers) {
  const scorable = transfers.filter(t => t.type !== 'EXCHANGE_INTERNAL');

  // Activity Intensity (40% weight)
  // How many whale transfers, and how large?
  const intensity = normalizedCountAndVolume(scorable);

  // Net Exchange Flow Direction (40% weight)
  // Are whales depositing to exchanges (bearish) or withdrawing (bullish)?
  const direction = normalizedNetFlow(scorable);

  // Velocity (20% weight)
  // How fast are transfers arriving?
  const velocity = normalizedTransferRate(scorable);

  return Math.round(intensity * 0.4 + direction * 0.4 + velocity * 0.2);
}
```

Whale data ages fast for a specific reason: it represents market *intent*. A flurry of 500+ BTC transfers to exchanges two hours ago might mean that selling pressure has already been absorbed. The market moved. The information is priced in. That's why whale activity gets a 1-hour half-life instead of the default 4:

```javascript
const HALF_LIFE_HOURS = {
  whaleActivity: 1,
};
```

With a 60-minute staleness threshold and a 1-hour half-life, a whale score of 80 (strong bullish — heavy exchange outflows) behaves like this:

| Minutes Since Scan | Whale Score | What It Means |
|-------------------|-------------|--------------|
| 10 | 80 | Fresh. Full signal. |
| 60 | 80 | At threshold. Still trusted. |
| 90 | 70 | 30 min stale. Half-life kicked in. |
| 120 | 65 | 1 hour stale. Half the deviation gone. |
| 180 | 57 | 2 hours stale. Approaching neutral. |
| 240 | 53 | 3 hours stale. Essentially neutral. |

Compare this with a trend direction score of 80 using the default 4-hour half-life:

| Minutes Since Update | Trend Score | What It Means |
|---------------------|------------|--------------|
| 30 | 80 | At threshold. Still trusted. |
| 90 | 77 | 1 hour stale. 90% signal preserved. |
| 270 | 65 | 4 hours stale. Half the deviation gone. |
| 510 | 57 | 8 hours stale. 25% signal. |

Trend direction decays slowly because the underlying SMA(200) doesn't change dramatically hour to hour. Whale activity decays aggressively because on-chain behavior is event-driven and transient.

---

## The Composite Score Decay Function

There's also a simpler decay function for the composite score itself, used in contexts where you have a pre-computed composite and just need to age it:

```javascript
function decayScore(rawScore, hoursElapsed) {
  const decayed = 50 + (rawScore - 50) * Math.pow(0.5, hoursElapsed / 4);
  return Math.round(decayed);
}
```

This is the same exponential decay formula, hardcoded to a 4-hour half-life with no staleness grace period. It's useful for the snapshot endpoint and historical replays — contexts where you're displaying a score that was computed in the past and want to indicate its current relevance.

---

## Threshold Alerts with Decay Awareness

The alert engine evaluates 10 trigger rules every 2 minutes against the current signal state. Each trigger is a pure function that compares current state to previous state and returns an alert or null:

```javascript
function evaluateRegimeChange(current, previous) {
  if (!previous.regime || current.regime === previous.regime) return null;
  return makeAlert('EMERGENCY', 'regimeChange',
    `Market regime shifted from ${previous.regime} to ${current.regime}.`,
    { from: previous.regime, to: current.regime }
  );
}

function evaluateRapidChange(current, previous) {
  const scores = previous.recentScores || [];
  if (scores.length < 3) return null;
  const oldest = scores[0];
  const delta = Math.abs(current.composite - oldest);
  const minutesSpan = scores.length * 2;
  const perHourRate = (delta / minutesSpan) * 60;
  if (perHourRate <= 25) return null;
  const direction = current.composite > oldest ? 'up' : 'down';
  return makeAlert('EMERGENCY', 'rapidChange',
    `Composite moving ${direction}: ${Math.round(perHourRate)} pts/hr.`,
    { rate: Math.round(perHourRate), direction }
  );
}
```

Because the alert engine consumes the *decayed* composite (not the raw one), decay directly influences when alerts fire. If trend data goes stale and the composite decays from 62 to 55, a mode change from `TREND_LONG` to `RANGE` might fire — even though no new market data arrived. This is correct behavior: the system is saying "I'm no longer confident enough in this position to maintain it."

The 10 triggers are organized into three tiers:

```javascript
// EMERGENCY — bypass all fatigue controls
// regimeChange, extremeScore, rapidChange

// NOTABLE — subject to daily cap + cooldown
// modeChange, scoreCrossing, vixSpike, whaleEvent,
// whaleNetFlow, correlationBreakdown

// LOW — informational
// celestialAlert
```

EMERGENCY alerts always send. NOTABLE and LOW alerts are subject to fatigue controls: a per-subscriber daily cap (5 alerts/day) and a per-trigger cooldown (1 hour). This prevents the system from spamming subscribers during volatile periods when thresholds are being crossed repeatedly.

I learned the fatigue lesson from production. During a period of regime oscillation, the alert engine was firing uncapped EMERGENCY alerts and burning through the email delivery quota — over 1,000 failed sends in 72 hours. The fix was adding fatigue controls for NOTABLE/LOW and realizing that even EMERGENCY alerts should have some form of deduplication.

---

## SSE: Real-Time Delivery

The signal and alerts are delivered to subscribers over Server-Sent Events. SSE is the right tool here because the communication is unidirectional (server to client) and needs automatic reconnection. WebSockets would be overkill for a system that pushes updates every 2 minutes.

The SSE endpoint validates the subscriber, opens a persistent connection, and keeps it alive with heartbeats:

```javascript
router.get('/feed/stream', async (req, res) => {
  const email = req.query.email;
  if (!await validateSubscriberEmail(email)) {
    return res.status(403).json({ error: 'Invalid or inactive subscriber' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Set retry interval for auto-reconnect
  res.write('retry: 5000\n\n');

  const conn = { res, email };
  sseConnections.add(conn);

  // Heartbeat every 30 seconds to keep connection alive
  const heartbeat = setInterval(() => {
    try {
      res.write(`event: heartbeat\ndata: ${JSON.stringify({
        timestamp: new Date().toISOString()
      })}\n\n`);
    } catch {
      clearInterval(heartbeat);
      sseConnections.delete(conn);
    }
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseConnections.delete(conn);
  });
});
```

The `X-Accel-Buffering: no` header is important. Without it, Nginx (which sits in front of the service in production) will buffer the SSE responses and deliver them in bursts instead of streaming them. The `retry: 5000` directive tells the browser's EventSource to reconnect after 5 seconds if the connection drops.

When the alert engine fires, it broadcasts to all active SSE connections:

```javascript
// Push alerts
for (const alert of alerts) {
  const eventData = `event: alert\ndata: ${JSON.stringify(alert)}\n\n`;
  for (const conn of sseConnections) {
    try { conn.res.write(eventData); } catch {}
  }
}

// Push signal update (every cycle, not just on alerts)
const signalData = `event: signal\ndata: ${JSON.stringify({
  composite: current.composite,
  mode: current.mode,
  sliders: current.sliders,
  timestamp: new Date().toISOString(),
})}\n\n`;
for (const conn of sseConnections) {
  try { conn.res.write(signalData); } catch {}
}
```

Two event types — `alert` and `signal` — let the client filter. A dashboard might render both; a notification system might only care about alerts. The silent `try/catch` on write handles stale connections that haven't been cleaned up yet.

For subscribers who can't maintain an SSE connection (mobile browsers, intermittent connectivity), there's a snapshot endpoint that returns the same data as a single JSON response:

```javascript
router.get('/feed/snapshot', async (req, res) => {
  const [signalRaw, alertsRaw, prefs] = await Promise.all([
    redis.get('alert:previousState'),
    redis.lRange('alert:log', 0, 19),
    getAlertPreferences(email),
  ]);

  res.json({
    signal: parseSignal(signalRaw),
    alerts: parseAlerts(alertsRaw),
    preferences: prefs || { alertPreset: 'medium' },
  });
});
```

The snapshot is a fallback, not a replacement. SSE connections receive updates within seconds of computation; snapshot consumers get whatever was last computed.

---

## The Full Pipeline: Ingestion to Delivery

Putting it all together, the system runs on a cron-based pipeline:

```
┌──────────────────────────────────────────────────────────┐
│                    Data Ingestion                        │
│                                                          │
│  Every 10 min:  Whale mempool scan → Redis sorted set    │
│  Every 2 min:   Signal computation trigger               │
│  Daily 22:30:   Gold previous close → Redis              │
│  Daily 00:00:   BTC 30d volume average → Redis           │
│                                                          │
├──────────────────────────────────────────────────────────┤
│                Signal Computation                        │
│                                                          │
│  10 parallel fetches (Promise.allSettled)                 │
│  → 8 raw slider computations                             │
│  → Per-slider staleness check                            │
│  → Exponential decay on stale sliders                    │
│  → Weighted composite recomputation                      │
│  → Mode determination                                   │
│  → Freshness map attachment                              │
│                                                          │
├──────────────────────────────────────────────────────────┤
│                Alert Evaluation                          │
│                                                          │
│  10 trigger rules (current vs previous state)            │
│  → EMERGENCY / NOTABLE / LOW tier classification         │
│  → Fatigue controls (daily cap, per-trigger cooldown)    │
│  → Alert log to Redis (capped at 500)                    │
│                                                          │
├──────────────────────────────────────────────────────────┤
│                    Delivery                               │
│                                                          │
│  SSE broadcast → active subscriber connections           │
│  Email dispatch → subscribers matching tier threshold    │
│  Snapshot API → on-demand JSON for polling clients       │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

The Redis layer is the glue. Slider timestamps, whale transfers (as a sorted set), the previous alert state, the alert log, fatigue counters, and cooldown flags all live in Redis with appropriate TTLs. This means the service is stateless — you can restart it and the signal computation picks up exactly where it left off because all temporal state is externalized.

---

## Engineering Tradeoffs

### How Aggressive Should Decay Be?

This is the fundamental tuning question. Too aggressive and you're throwing away useful information — a trend direction reading that's 2 hours old is still highly relevant if markets are ranging. Too conservative and stale data contaminates your signal — a whale activity reading from 4 hours ago is probably noise.

The answer depends on the volatility of the underlying data source. I settled on a simple heuristic: **the more event-driven the data, the shorter the half-life.** On-chain whale transfers are events — they happen, they get absorbed, and the market moves on. A 1-hour half-life captures this. Macro indicators like BTC-gold correlation change over days, not hours. A 4-hour half-life (the default) is conservative enough to preserve useful signal while still degrading if the data source goes completely dark.

If you're building a similar system, start with a 4-hour half-life for everything and then tune individual sliders based on observed behavior. Look at how often each data source actually updates, how volatile its readings are intraday, and how quickly the information gets priced in by the market.

### What's the Right Staleness Window?

The staleness threshold defines the grace period before decay kicks in. Set it too short and you're penalizing data that's perfectly fine — the Fear & Greed index updates once a day, so a 30-minute staleness threshold on sentiment would cause it to be permanently decaying. Set it too long and truly stale data gets a free pass.

My rule of thumb: **set the staleness threshold to 2-3x the expected refresh interval.** If the data source refreshes every 10 minutes, a 30-minute staleness threshold gives you a buffer for three missed cycles before decay starts. If the source refreshes daily, a 3-hour threshold handles timezone offsets and API delays.

### The Neutral Fallback: 50 vs. Last Known Value

A design choice that might not be obvious: decay targets 50 (neutral), not the last known value. An alternative approach would be to freeze the slider at its last value and only start decaying it toward neutral after a longer period. I rejected this because freezing preserves a directional bias that may no longer be justified.

If the whale activity slider was at 85 (very bullish, heavy exchange outflows) two hours ago and the mempool scanner has failed for the last 4 scans, should the system still be biased bullish on whale activity? No. The correct answer is "I don't know" — which is what 50 represents. Decaying toward 50 is an explicit statement: "My confidence in this signal is degrading, and my best guess converges on having no opinion."

### Cache TTL vs. Staleness Threshold

The signal endpoint has a 120-second cache TTL (via Redis). This means two requests within 2 minutes get the same response. The cache TTL must be shorter than the shortest staleness threshold (10 minutes for volatility) or you'd serve cached responses that should have started decaying.

In practice, the 120-second cache is fine because the signal engine runs on a 2-minute cron cycle. Between cron ticks, the signal doesn't change, so caching the result is correct.

---

## Lessons from Production

**Decay-induced mode changes are features, not bugs.** When I first saw the system shift from `TREND_LONG` to `RANGE` because data went stale (not because the market actually moved), my instinct was to suppress it. I was wrong. If you can't confirm the market is still in a trend, you should exit the trend. The decay is saying exactly what it should: "confidence has degraded below the threshold for maintaining this position."

**The alert engine burns through email quotas fast.** During regime oscillation (composite bouncing between 39 and 41, crossing the `shortBelow: 40` threshold repeatedly), the engine was firing regime change alerts every 2 minutes. The fix was the fatigue system: daily caps, per-trigger cooldowns, and the recognition that even EMERGENCY alerts need deduplication within a time window.

**Stale data is worse than missing data.** When a data source fails, the slider falls back to 50 (the `?? 50` default in `computeSignal`). This is correct and transparent — the freshness map shows `minutesAgo: null` and `stale: true`. But when a data source returns data that's technically valid but hours old (because *its* upstream is stale), the system treats it as fresh unless you explicitly track ingestion timestamps. This is why every successful fetch writes a timestamp to Redis — without that timestamp, you'd have no way to know that the VIX reading in the API response is actually from 3 hours ago.

**Per-slider decay tuning is essential.** The first version of the system applied a uniform 4-hour half-life to everything. This was wrong in both directions: whale activity was retaining too much influence for too long, and correlation was decaying too fast (it's a daily-scale metric). The current per-slider configuration emerged from watching the system in production and asking "is this slider's influence still justified given how old its data is?"

---

## Wrapping Up

Time-decay transforms a static scoring system into one that degrades gracefully. Instead of making decisions on data of unknown age, the system explicitly tracks freshness, applies mathematical decay when data goes stale, and converges on neutral when confidence drops.

The core formula is simple: `50 + (value - 50) * 0.5^(hours/halfLife)`. Everything else — per-slider staleness thresholds, half-life overrides, freshness metadata, the recompute-after-decay pattern — is engineering around that formula to make it work in a production system with multiple data sources, different update frequencies, and downstream consumers that need to know what they're working with.

If you're building any system that makes decisions on time-sensitive data from multiple sources, the pattern applies whether you're doing market signals, IoT sensor fusion, or real-time monitoring dashboards. Track when your data arrived. Define how long you trust it. Decay it toward "no opinion" when trust expires. And always recompute your aggregate after decaying the components — never the other way around.
