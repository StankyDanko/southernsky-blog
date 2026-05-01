---
title: "Imperative vs Declarative 3D: Why CesiumJS Crashes at Scale"
description: "CesiumJS has a React wrapper called Resium. It works fine for demos. It will destroy your production app. Here's why I went fully imperative."
publishDate: 2026-03-01
author: j-martin
tier: professional
postType: today-i-learned
difficulty: advanced
estimatedMinutes: 12
prerequisites: ["react", "cesium"]
category: web-development
tags: ["cesium", "resium", "react", "performance", "3d-rendering", "imperative"]
certTracks: []
featured: false
draft: false
---

## Why Should You Care?

Resium is the official-ish React wrapper for CesiumJS. It lets you write 3D geospatial code that looks like this:

```tsx
<Viewer>
  {vessels.map(v => (
    <Entity key={v.mmsi} position={fromDegrees(v.lon, v.lat)}>
      <PointGraphics pixelSize={6} color={Color.CYAN} />
    </Entity>
  ))}
</Viewer>
```

That is genuinely nice to look at. It feels idiomatic. It composes well with the rest of your React tree. I used it in OMNI for the first two months of development.

Then I enabled the AIS vessel layer.

At 500 vessels, frame times climbed to 40ms. At 1,000 vessels, the UI became visibly sluggish. At 3,000 vessels — a modest number for a busy shipping lane — the browser tab froze for 8 seconds on every data refresh and then resumed at about 4 fps. At 5,000 vessels I stopped trying and rewrote the rendering layer entirely.

This post explains why Resium melts at scale, what's actually happening under the hood, and how to fix it.

---

## What Resium Actually Does

Resium maps Cesium's imperative API to React components. When you render `<Entity position={...}>`, Resium's reconciler creates a `Cesium.Entity` and calls `viewer.entities.add()`. When that entity's props change, Resium calls the appropriate setter on the entity. When the component unmounts, Resium calls `viewer.entities.remove()`.

That mapping sounds clean, but it forces every entity update through React's reconciliation algorithm. React's reconciler does not know or care that these are Cesium entities — it treats them exactly like DOM elements. So when 4,000 vessel positions change on a 30-second AIS poll:

1. React re-renders your component tree
2. The reconciler diffs 4,000 `<Entity>` children
3. For each changed entity, Resium's wrapper fires prop update callbacks
4. Each callback calls a Cesium setter

Step 2 is the killer. React's diffing algorithm is O(n) on the children array, but "O(n)" with 4,000 elements and JavaScript overhead means tens of milliseconds of main-thread work before any GPU work happens. During that time, the browser can't paint, respond to input, or run your scroll handler.

---

## Benchmarking the Cliff

Here are actual numbers from Chrome DevTools performance traces on OMNI, Resium vs. imperative, measured as main-thread scripting time per AIS poll cycle:

```
Entity count    Resium (ms)    Imperative (ms)    Ratio
─────────────────────────────────────────────────────
100             8              2                  4×
500             42             3                  14×
1,000           95             4                  24×
3,000           310            6                  52×
5,000           580+           8                  72×+
```

The imperative column is nearly flat because it bypasses React reconciliation entirely. The Resium column is roughly linear — exactly what you'd expect from O(n) reconciliation plus constant Cesium overhead.

The crossover point where Resium becomes "noticeably bad" is around 300-400 entities, which means Resium works fine for most tutorial use cases (map pins, a handful of markers) and fails completely for real production geospatial applications.

---

## The Fix: Go Fully Imperative

The core idea: take Cesium completely outside of React's rendering cycle. React manages the component lifecycle (mount/unmount), but Cesium entities are created, updated, and destroyed imperatively through a ref.

### Step 1: Get the Viewer into a Ref

```tsx
// components/Globe.tsx
import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'

export function Globe() {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<Cesium.Viewer | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const viewer = new Cesium.Viewer(containerRef.current, {
      animation: false,
      baseLayerPicker: false,
      fullscreenButton: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      navigationHelpButton: false,
      sceneModePicker: false,
      timeline: false,
      selectionIndicator: false,
    })

    viewerRef.current = viewer

    return () => {
      viewer.destroy()
      viewerRef.current = null
    }
  }, [])

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}
```

The viewer is created once on mount, destroyed on unmount, and never participates in React re-renders. The div it lives in is just a mount point — a stable DOM node React won't touch.

### Step 2: Share the Viewer via Context (Not Props)

You need the viewer reference in layer hooks scattered across the component tree. Pass it through context, not props:

```tsx
// contexts/CesiumViewerContext.tsx
import { createContext, useContext, RefObject } from 'react'
import * as Cesium from 'cesium'

const CesiumViewerContext = createContext<RefObject<Cesium.Viewer | null> | null>(null)

export function CesiumViewerProvider({ viewerRef, children }) {
  return (
    <CesiumViewerContext.Provider value={viewerRef}>
      {children}
    </CesiumViewerContext.Provider>
  )
}

export function useCesiumViewer(): Cesium.Viewer {
  const ref = useContext(CesiumViewerContext)
  if (!ref?.current) throw new Error('Cesium viewer not initialized')
  return ref.current
}
```

Note the hook returns `Cesium.Viewer` directly, not the ref. Layer hooks call `useCesiumViewer()` once and use the viewer imperatively. They never cause a re-render by reading from state — they just call methods on the viewer object.

### Step 3: Manage Entities Imperatively

Before (Resium):

```tsx
// Re-renders 4,000 React components on every AIS poll. Do not do this.
function AisLayer({ vessels }: { vessels: AisVessel[] }) {
  return (
    <>
      {vessels.map(vessel => (
        <Entity
          key={vessel.mmsi}
          position={Cesium.Cartesian3.fromDegrees(vessel.lon, vessel.lat)}
        >
          <PointGraphics pixelSize={6} color={Cesium.Color.CYAN} />
        </Entity>
      ))}
    </>
  )
}
```

After (imperative):

```tsx
// Zero React re-renders. Cesium handles its own diff.
function useAisLayer(enabled: boolean) {
  const viewer = useCesiumViewer()
  const pool = useRef<Map<string, Cesium.Entity>>(new Map())

  useEffect(() => {
    if (!enabled) {
      pool.current.forEach(e => viewer.entities.remove(e))
      pool.current.clear()
      return
    }

    async function poll() {
      const vessels: AisVessel[] = await fetch('/api/layers/ais').then(r => r.json())

      // Update existing entities, create new ones
      const seen = new Set<string>()
      for (const vessel of vessels) {
        seen.add(vessel.mmsi)
        const existing = pool.current.get(vessel.mmsi)
        if (existing) {
          // Mutate position in place — no allocation, no GC pressure
          existing.position = new Cesium.ConstantPositionProperty(
            Cesium.Cartesian3.fromDegrees(vessel.lon, vessel.lat)
          )
        } else {
          const entity = viewer.entities.add({
            id: `ais-${vessel.mmsi}`,
            position: Cesium.Cartesian3.fromDegrees(vessel.lon, vessel.lat),
            point: { pixelSize: 6, color: Cesium.Color.CYAN },
          })
          pool.current.set(vessel.mmsi, entity)
        }
      }

      // Remove entities that disappeared from the feed
      pool.current.forEach((entity, mmsi) => {
        if (!seen.has(mmsi)) {
          viewer.entities.remove(entity)
          pool.current.delete(mmsi)
        }
      })
    }

    poll()
    const interval = setInterval(poll, 30_000)
    return () => clearInterval(interval)
  }, [enabled, viewer])
}
```

The critical difference: `useAisLayer` is a hook, not a component. It doesn't render anything. It just manages Cesium entities as a side effect. React doesn't know those entities exist. Reconciliation never runs.

---

## The Mindset Shift

The hardest part of going fully imperative isn't the code — it's accepting that some of your app lives outside React.

React developers are trained to think in components and props: state changes, components re-render, DOM updates. That model breaks for scene graphs. A scene graph is a stateful, mutable data structure that knows how to render itself. You don't re-render a scene graph; you mutate it and it updates.

The right mental model is: **React manages your UI shell, Cesium manages its own world.** React handles your sidebar, your toolbar, your modal dialogs. Cesium handles the 3D scene. They communicate through events (user clicks an entity → fire a callback → update Zustand state → React re-renders the info panel), but they do not share a rendering model.

Once you accept this, the imperative pattern feels natural rather than dirty. You're not fighting React's model — you're using it correctly for what it's good at, and using Cesium's model for what it's good at.

---

## When Resium Is Fine

Resium isn't bad software — it's good software for a different use case. If you have:

- Fewer than 200 entities that update infrequently
- A demo, prototype, or tutorial application
- Static data or low-frequency updates (once per minute or less)

Then Resium's declarative API gives you a nicer developer experience with no meaningful performance cost. The problems only appear at production scale with real-time data feeds.

If you're building a production geospatial application with live data, plan for imperative from day one. Retrofitting it later is painful.

---

## What You Learned

- Resium maps Cesium entities to React components, which forces every entity update through React's reconciler — catastrophic at 1,000+ entities with real-time data.
- The fix is to take Cesium completely outside React's rendering cycle: create the Viewer once in a ref, share it via context, manage entities imperatively in hooks.
- Update entity properties in place (`entity.position = ...`) rather than removing and re-adding entities. This eliminates GC pressure during poll cycles.
- The right mental model: React owns the UI shell, Cesium owns the 3D scene. They communicate through callbacks and shared state, but their rendering models are independent.
- Resium is fine for demos and low-entity-count applications. Plan for imperative from day one if you're building production geospatial software.
