---
title: "Race Conditions in Cesium Click Handlers — A Three-Week Bug Story"
description: "Clicking an entity on the OMNI globe sometimes selected the wrong one. The bug lived in a closure over stale state. It took three weeks to find."
publishDate: 2026-03-05
author: j-martin
tier: professional
postType: today-i-learned
difficulty: expert
estimatedMinutes: 14
prerequisites: ["react", "cesium", "closures"]
category: web-development
tags: ["cesium", "race-condition", "debugging", "closures", "react", "state-management"]
certTracks: []
featured: false
heroImage: "/images/posts/cesium-click-handler-race-conditions.webp"
draft: false
---

## Why Should You Care?

The bug looked like this: you click a vessel icon on the OMNI globe, and the info panel opens — but it shows the wrong vessel. Not a random vessel. A specific wrong vessel — always one that existed in the previous data fetch. Do it again and it selects correctly. Refresh the page, and it works perfectly until the next AIS poll fires.

Intermittent. Stateful. Reproducible only under specific timing conditions. The classic profile of a closure bug, though I didn't recognize it as one for three weeks.

This post tells that debugging story and explains the underlying mechanism — because this exact pattern (event handler captures stale state, fails silently) is one of the most common bugs in applications that mix React with imperative libraries like CesiumJS, Leaflet, Three.js, or D3.

---

## The Timeline

**Week 1:** I notice the wrong-entity bug in manual testing. It happens maybe 20% of the time. I assume it's a data issue — maybe two AIS feeds returning the same MMSI, or a race between the fetch and the render. I add logging. The vessel data looks correct.

**Week 2:** I add more logging, now instrumenting the entity pool. The pool always contains the correct entities. The pick result from Cesium is correct — `viewer.scene.pick()` returns the right entity. But the info panel shows the wrong vessel. The disconnect is somewhere between `pick()` and the panel rendering.

**Week 3:** I finally read the click handler carefully. Really carefully. And I see it.

---

## The Bug

Here's a simplified version of the click handler code I'd written:

```typescript
// hooks/useGlobeClickHandler.ts — THE BUGGY VERSION
export function useGlobeClickHandler() {
  const viewer = useCesiumViewer()
  const vessels = useLayersStore(s => s.vesselMetadata)  // ← Record<mmsi, VesselInfo>
  const setSelectedEntity = useGlobeStore(s => s.setSelectedEntity)

  useEffect(() => {
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)

    handler.setInputAction((event: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const picked = viewer.scene.pick(event.position)

      if (!Cesium.defined(picked) || !picked.id) return

      const entityId: string = picked.id.id   // e.g. "ais-366943530"
      const mmsi = entityId.replace('ais-', '')

      // ← THIS IS THE BUG
      const vesselInfo = vessels[mmsi]

      if (vesselInfo) {
        setSelectedEntity({ type: 'vessel', data: vesselInfo })
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    return () => handler.destroy()
  }, [viewer])   // ← vessels is NOT in the dependency array
}
```

Do you see it?

The `useEffect` dependency array only includes `viewer`. That means the effect runs once when the viewer is initialized, and the `handler` callback closes over `vessels` at the moment of that first run. When the AIS layer polls for fresh data and `vessels` updates in Zustand, the closure doesn't update. The handler still holds a reference to the old `vessels` object.

So the flow was:
1. Globe loads. `vessels` = `{ "366943530": { name: "MSC ANNA", ... }, ... }` — 100 vessels
2. Click handler is created, closes over this `vessels` snapshot
3. 30 seconds later: AIS poll fires. `vessels` is now a new object with 4,200 vessels
4. User clicks a vessel that exists in the new data but not the old snapshot
5. `picked.id.id` = `"ais-366943530"` ← correct entity
6. `vessels["366943530"]` ← **still the old snapshot**. If the vessel was in the old snapshot, you get stale data. If it wasn't, you get `undefined` and the click does nothing.

The bug wasn't a race condition in the traditional sense (two async operations clobbering each other). It was a stale closure — a snapshot of state frozen at creation time, with the handler never knowing the world had changed.

---

## Why This Is Hard to Catch

Three factors made this particularly hard to find:

**1. `pick()` succeeded.** Cesium correctly identified the entity the user clicked. The entity existed. The bug was in the metadata lookup — a separate JavaScript object not connected to the Cesium scene. So debugging the Cesium layer found nothing.

**2. It was intermittent in a predictable way.** The bug only triggered when a vessel appeared in a fresh poll that wasn't in the first poll's snapshot. Any vessel present from the initial load worked correctly. Since most vessels persist across multiple polls (ships move slowly), the majority of clicks succeeded.

**3. The missing dependency was invisible.** ESLint's `exhaustive-deps` rule would have caught this — but I'd suppressed that warning in a few hook files early in the project to avoid false positives. The exact file where the bug lived was one of them.

---

## The Fix: useRef for Always-Current State

The fix is a standard pattern in React: use a ref to hold the current value of any state that event handlers need to read. Refs are mutable and not part of the rendering model — updating a ref doesn't trigger a re-render, and reading from a ref always gives you the current value, not a closure snapshot.

```typescript
// hooks/useGlobeClickHandler.ts — FIXED VERSION
export function useGlobeClickHandler() {
  const viewer = useCesiumViewer()
  const vessels = useLayersStore(s => s.vesselMetadata)
  const setSelectedEntity = useGlobeStore(s => s.setSelectedEntity)

  // Keep a ref that always mirrors the current vessels state
  const vesselsRef = useRef(vessels)
  useEffect(() => {
    vesselsRef.current = vessels
  }, [vessels])

  useEffect(() => {
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)

    handler.setInputAction((event: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const picked = viewer.scene.pick(event.position)

      if (!Cesium.defined(picked) || !picked.id) return

      const entityId: string = picked.id.id
      const mmsi = entityId.replace('ais-', '')

      // ← Read from the ref, not the closure. Always current.
      const vesselInfo = vesselsRef.current[mmsi]

      if (vesselInfo) {
        setSelectedEntity({ type: 'vessel', data: vesselInfo })
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    return () => handler.destroy()
  }, [viewer])   // ← Dependency array is correct now — handler only needs viewer to be stable
}
```

The key change: `vesselsRef.current` is updated in a separate `useEffect` that runs whenever `vessels` changes. The click handler reads `vesselsRef.current` at the moment of the click — always the latest value, not the closure snapshot.

The outer `useEffect` dependency array correctly lists only `viewer`, because that's the only thing whose identity should trigger handler recreation. `vesselsRef` is stable (it's a ref) so it doesn't need to be there, and it wouldn't trigger recreation even if it was.

---

## The General Pattern

Anytime you create an event handler inside a `useEffect` that needs to read from React state:

```typescript
// Pattern: stale closure danger
useEffect(() => {
  someLibrary.on('event', () => {
    console.log(someState)  // ← stale if someState not in deps
  })

  return () => someLibrary.off('event')
}, [])  // ← missing someState
```

You have two options:

**Option A — Add to dependency array:**
```typescript
useEffect(() => {
  someLibrary.on('event', () => {
    console.log(someState)
  })

  return () => someLibrary.off('event')
}, [someState])  // ← re-registers handler on every state change
```

This is simple but has a cost: the handler is destroyed and recreated every time `someState` changes. For expensive handlers (like `ScreenSpaceEventHandler`), this causes jitter or brief input gaps. Also, if `someState` changes frequently (e.g., every 30 seconds with AIS), you're constantly tearing down and rebuilding the input handler.

**Option B — Use a ref (preferred for performance-sensitive handlers):**
```typescript
const someStateRef = useRef(someState)
useEffect(() => { someStateRef.current = someState }, [someState])

useEffect(() => {
  someLibrary.on('event', () => {
    console.log(someStateRef.current)  // ← always current, no stale closure
  })

  return () => someLibrary.off('event')
}, [])  // ← handler created once, never recreated
```

One handler, always reads current state. No teardown/rebuild on data changes. This is the correct pattern for Cesium event handlers, Three.js event handlers, WebSocket message handlers, or any other listener registered in a `useEffect` that needs to read from frequently-updating state.

---

## The Actual Resolution

After three weeks of intermittent wrong-entity clicks, the fix took six lines: add the ref, add the sync effect, change one lookup. The test was straightforward — enable the AIS layer, wait for two poll cycles, then rapidly click newly-appeared vessels. Zero wrong selections across 200 clicks.

I also re-enabled ESLint's `exhaustive-deps` rule across the entire codebase and fixed the twelve other places where dependencies were silently missing. None of them had manifested as visible bugs yet — but they were all time bombs.

The lesson I keep coming back to: ESLint warnings about hook dependencies aren't style feedback. They're pointing at actual runtime bugs, just ones that haven't triggered yet. Suppress them at your own risk.

---

## What You Learned

- Stale closure bugs occur when a callback captures a variable at creation time and never sees updates, because the containing `useEffect` doesn't list that variable as a dependency.
- The symptom — correct `pick()` results but wrong metadata — revealed that the Cesium scene and the React state were diverging. Bugs at the imperative/declarative boundary often manifest as this kind of split.
- The fix: use a ref that's kept in sync with current state via a separate `useEffect`. The event handler reads from the ref, not the closure.
- Adding to the dependency array is simpler but causes handler teardown/rebuild on every state change — problematic for expensive handlers like `ScreenSpaceEventHandler`.
- Treat ESLint's `exhaustive-deps` warnings as bug reports, not style notes. The bugs they point at are real; they just haven't fired yet.
