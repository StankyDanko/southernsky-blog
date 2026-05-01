---
title: "Building a Production API Proxy: Rate Limiting, Caching, and SSRF Protection"
description: "OMNI proxies 13+ external APIs through Next.js API routes. Here's how I built rate limiting, response caching, and SSRF protection into the proxy layer."
publishDate: 2026-03-12
author: j-martin
tier: professional
postType: tutorial
difficulty: advanced
estimatedMinutes: 16
prerequisites: ["node", "api-design"]
category: cybersecurity
tags: ["api-proxy", "security", "rate-limiting", "caching", "ssrf", "nextjs"]
certTracks: ["comptia-security-plus"]
featured: false
heroImage: "/images/posts/production-api-proxy.webp"
draft: false
---

## Why Should You Care?

OMNI proxies 13 external APIs: AIS vessel tracking, ADS-B aircraft positions, OpenSky flight data, USGS earthquakes, NASA FIRMS wildfires, GDELT global events, OpenWeatherMap radar, NOAA buoy data, MarineTraffic, FlightAware, UN OCHA humanitarian data, Global Fishing Watch, and OpenCelliD cell tower data.

If you call any of these directly from the browser, you have at minimum a key exposure problem. If users can supply arbitrary URLs to your proxy, you have an SSRF problem. If every page load triggers a fresh upstream API call, you have a cost problem. If a single user can hammer your server tier, you have an availability problem.

Every one of those problems is solvable at the proxy layer — and building it correctly once means every layer in your application gets the protection for free.

---

## The Architecture

```
Browser                        Next.js Server               External APIs
  │                                │                              │
  │  GET /api/layers/ais           │                              │
  ├──────────────────────────────► │                              │
  │                                │  1. Authenticate user        │
  │                                │  2. Check rate limit         │
  │                                │  3. Check cache              │
  │                                │     └─ HIT: return cached    │
  │                                │     └─ MISS: fetch upstream  │
  │                                │  4. Validate URL (SSRF)      │
  │                                │  5. Fetch upstream           ├──────────────────────────────►
  │                                │                              │  GET /v0/vessels
  │                                │                              │  Authorization: Bearer $KEY
  │                                │◄─────────────────────────────┤
  │                                │                              │  { vessels: [...] }
  │                                │  6. Cache response           │
  │                                │  7. Transform + return       │
  │◄────────────────────────────── │                              │
  │  { vessels: [...] }            │                              │
```

API keys live only on the server. The client gets a proxied response with no credentials in sight.

---

## Part 1: SSRF Protection

Server-Side Request Forgery (SSRF) happens when an attacker tricks your server into making a request to an unintended target — typically an internal service (metadata APIs, databases, other microservices) that's accessible from your server but not from the public internet.

In a static proxy (one URL per route), SSRF is less of a concern because the target URL is hardcoded. But OMNI has a generic proxy mechanism for user-defined data sources — and that's where SSRF becomes critical.

The defense: validate every outbound URL against an allowlist and explicitly block private IP ranges.

```typescript
// lib/ssrf-protection.ts
import { URL } from 'url'

const PRIVATE_IP_RANGES = [
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^127\.\d+\.\d+\.\d+$/,
  /^169\.254\.\d+\.\d+$/,   // link-local
  /^::1$/,                   // IPv6 loopback
  /^fc00:/,                  // IPv6 unique local
  /^fe80:/,                  // IPv6 link-local
]

// Hardcoded allowlist for OMNI's known external data sources
const ALLOWED_HOSTNAMES = new Set([
  'api.aisstream.io',
  'opensky-network.org',
  'earthquake.usgs.gov',
  'firms.modaps.eosdis.nasa.gov',
  'api.gdeltproject.org',
  'api.openweathermap.org',
  'www.ndbc.noaa.gov',
  'globalfishingwatch.org',
])

export function validateProxyTarget(rawUrl: string): URL {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`)
  }

  // Protocol check — only HTTPS in production
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new Error(`Non-HTTPS URL rejected: ${rawUrl}`)
  }

  // Hostname allowlist check
  if (!ALLOWED_HOSTNAMES.has(parsed.hostname)) {
    throw new Error(`Hostname not in allowlist: ${parsed.hostname}`)
  }

  // Private IP range check
  const isPrivate = PRIVATE_IP_RANGES.some(range => range.test(parsed.hostname))
  if (isPrivate) {
    throw new Error(`Private IP range rejected: ${parsed.hostname}`)
  }

  return parsed
}
```

For the static routes (hardcoded upstream URL per route), you don't need the allowlist check — the target is already baked in. But you should still perform the private IP check if you're doing any URL construction from user input (query params, path segments). Attackers are creative about using decimal encoding, IPv6, and other tricks to sneak private IPs past naive checks.

---

## Part 2: Rate Limiting

OMNI uses a token bucket implementation. Each user (identified by their auth session) gets a bucket per route. Each request costs one token. Tokens refill at a constant rate. No bucket = rate limited.

```typescript
// lib/rate-limiter.ts
interface Bucket {
  tokens: number
  lastRefill: number
}

const buckets = new Map<string, Bucket>()

interface RateLimitConfig {
  max: number       // max tokens in the bucket
  window: number    // refill interval in seconds
}

export const rateLimiter = {
  check(key: string, config: RateLimitConfig): boolean {
    const now = Date.now()
    let bucket = buckets.get(key)

    if (!bucket) {
      bucket = { tokens: config.max, lastRefill: now }
      buckets.set(key, bucket)
    }

    // Refill based on elapsed time
    const elapsed = (now - bucket.lastRefill) / 1000
    const refillAmount = (elapsed / config.window) * config.max
    bucket.tokens = Math.min(config.max, bucket.tokens + refillAmount)
    bucket.lastRefill = now

    if (bucket.tokens < 1) {
      return true  // rate limited
    }

    bucket.tokens -= 1
    return false   // not limited
  }
}
```

In production you'd replace the in-memory `Map` with Redis to persist limits across server instances and survive restarts. For a single Next.js process, the in-memory implementation is fine and has zero latency overhead.

Rate limits are configured per-route based on the upstream API's own limits and the expected use pattern:

```typescript
// Rate limit configs per layer (requests per user per window)
const RATE_LIMITS: Record<string, { max: number; window: number }> = {
  ais:          { max: 20, window: 60 },   // 20 req/min — upstream allows 30
  earthquakes:  { max: 5,  window: 60 },   // USGS is generous but no need to hammer
  wildfires:    { max: 3,  window: 300 },  // NASA FIRMS updates every 5 min; 3 req/5min is plenty
  gdelt:        { max: 2,  window: 900 },  // GDELT updates every 15 min
  weather:      { max: 10, window: 60 },   // OpenWeatherMap
}
```

The route handler:

```typescript
// app/api/layers/[layer]/route.ts
export async function GET(
  req: NextRequest,
  { params }: { params: { layer: string } }
) {
  const layer = params.layer as LayerId
  const userId = getUserIdFromSession(req) ?? req.ip ?? 'anonymous'
  const rateLimitKey = `${layer}:${userId}`
  const rateLimitConfig = RATE_LIMITS[layer]

  if (!rateLimitConfig) {
    return NextResponse.json({ error: 'Unknown layer' }, { status: 404 })
  }

  const isLimited = rateLimiter.check(rateLimitKey, rateLimitConfig)
  if (isLimited) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', layer },
      {
        status: 429,
        headers: { 'Retry-After': String(rateLimitConfig.window) },
      }
    )
  }

  // ... proceed to cache check and fetch
}
```

Always return a `Retry-After` header on 429 responses. Well-behaved clients will respect it; it also signals to monitoring tools how long to wait before re-alerting.

---

## Part 3: Response Caching

The most cost-effective change in the entire proxy: cache upstream responses and serve them to all users during the TTL window.

Without caching, 50 concurrent users on the earthquake layer = 50 USGS API calls per poll cycle. With a 120-second cache, it's 1 USGS call per 2 minutes regardless of concurrent users.

```typescript
// lib/layer-cache.ts
interface CacheEntry {
  data: unknown
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()

export const layerCache = {
  get(key: string): unknown | null {
    const entry = cache.get(key)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      cache.delete(key)
      return null
    }
    return entry.data
  },

  set(key: string, data: unknown, options: { ttl: number }): void {
    cache.set(key, {
      data,
      expiresAt: Date.now() + options.ttl * 1000,
    })
  },

  invalidate(key: string): void {
    cache.delete(key)
  },
}
```

TTL values per layer, tuned to data volatility:

```typescript
const CACHE_TTLS: Record<LayerId, number> = {
  ais:            30,    // seconds — vessels move fast
  adsb:           10,    // aircraft move very fast
  opensky:        15,
  earthquakes:    120,   // USGS updates every 1-5 minutes
  wildfires:      300,   // NASA FIRMS: 5-minute updates
  gdelt:          900,   // GDELT: 15-minute event batches
  weather_radar:  300,
  ocean_currents: 3600,  // Near-real-time but slow-changing
}
```

The full route handler with all three protections assembled:

```typescript
// app/api/layers/[layer]/route.ts
export async function GET(
  req: NextRequest,
  { params }: { params: { layer: string } }
) {
  const layer = params.layer as LayerId
  const userId = getUserIdFromSession(req) ?? req.ip ?? 'anonymous'

  // 1. Rate limit
  const isLimited = rateLimiter.check(
    `${layer}:${userId}`,
    RATE_LIMITS[layer]
  )
  if (isLimited) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  // 2. Cache check
  const cached = layerCache.get(layer)
  if (cached) {
    return NextResponse.json(cached, {
      headers: { 'X-Cache': 'HIT', 'X-Layer': layer },
    })
  }

  // 3. Fetch upstream
  const config = LAYER_UPSTREAM_CONFIG[layer]
  try {
    const upstream = await fetch(config.url, {
      headers: config.headers,
      signal: AbortSignal.timeout(8000),  // 8-second timeout
    })

    if (!upstream.ok) {
      throw new Error(`Upstream ${upstream.status}: ${config.url}`)
    }

    const data = await upstream.json()
    const transformed = config.transform ? config.transform(data) : data

    // 4. Cache and return
    layerCache.set(layer, transformed, { ttl: CACHE_TTLS[layer] })
    return NextResponse.json(transformed, {
      headers: { 'X-Cache': 'MISS', 'X-Layer': layer },
    })
  } catch (err) {
    console.error(`[proxy] ${layer} fetch failed:`, err)
    return NextResponse.json(
      { error: 'Upstream fetch failed', layer },
      { status: 502 }
    )
  }
}
```

The `AbortSignal.timeout(8000)` is important. Without a timeout, a slow upstream API can hold your server connection open indefinitely, eventually exhausting your serverless function concurrency or connection pool.

---

## The Full Proxy Map

For reference, OMNI's 13 proxied data sources and their upstream origins:

| Layer | Upstream Source | Auth | TTL |
|-------|----------------|------|-----|
| AIS vessels | AISstream.io | API key | 30s |
| ADS-B aircraft | ADSB.lol (public) | None | 10s |
| OpenSky flights | OpenSky Network | Basic auth | 15s |
| USGS earthquakes | earthquake.usgs.gov | None | 120s |
| NASA wildfires | FIRMS VIIRS/MODIS | API key | 300s |
| GDELT events | gdeltproject.org | None | 900s |
| Weather radar | OpenWeatherMap | API key | 300s |
| NOAA buoys | ndbc.noaa.gov | None | 600s |
| Ocean currents | Copernicus Marine | API key | 3600s |
| MarineTraffic | marinetraffic.com | API key | 60s |
| Global Fishing Watch | globalfishingwatch.org | API key | 300s |
| Cell towers | OpenCelliD | API key | 86400s |
| UN OCHA | data.humdata.org | None | 3600s |

Several of these (USGS earthquakes, ADS-B, NOAA, GDELT, UN OCHA) are genuinely free and keyless. Still worth proxying to centralize caching and add rate limiting for your own protection.

---

## Monitoring the Proxy

Add `X-Cache` headers to every response (shown in the code above). Then log them at the edge:

```typescript
// Middleware to log proxy cache performance
export function middleware(req: NextRequest) {
  const response = NextResponse.next()
  response.headers.set('X-Request-Id', crypto.randomUUID())
  return response
}
```

Check cache hit rates in production logs:

```bash
# From Vercel/cloudflare/nginx access logs
grep '/api/layers/' access.log | awk '{print $NF}' | sort | uniq -c | sort -rn

# Expected output (good cache configuration):
# 2841 HIT
#   67 MISS
# Cache hit rate: ~97%
```

If your hit rate is below 80%, your TTLs are probably too short, or you have a cache invalidation bug sending more MISSes than necessary.

---

## What You Learned

- SSRF protection requires validating both the URL format and the resolved hostname against private IP ranges — attackers can use decimal encoding, redirects, and IPv6 tricks to bypass naive checks.
- Token bucket rate limiting is the right algorithm for API proxies: it handles burst traffic gracefully (empty bucket) and refills smoothly rather than resetting at hard time boundaries.
- Proxy-layer response caching is the highest-leverage cost reduction available — a 120-second cache on USGS earthquakes converts N concurrent user calls to 1 upstream call per 2 minutes.
- Always set timeouts on upstream fetch calls. Without them, a slow external API can exhaust your function concurrency or connection pool.
- Add `X-Cache: HIT/MISS` headers to every proxied response. Cache hit rate is the key metric to monitor — a well-tuned proxy should be 90%+ hits in steady state.
