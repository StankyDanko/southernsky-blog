---
title: "Zustand at Scale: 4-Slice Architecture for a Real-Time Platform"
description: "OMNI manages globe state, layer toggles, panel visibility, and user preferences across 25+ data sources. Here's the 4-slice Zustand architecture that keeps it sane."
publishDate: 2026-03-10
author: j-martin
tier: professional
postType: explainer
difficulty: advanced
estimatedMinutes: 16
prerequisites: ["react", "state-management"]
category: web-development
tags: ["zustand", "state-management", "react", "architecture", "typescript"]
certTracks: []
featured: false
heroImage: "/images/posts/zustand-4-slice-architecture.webp"
draft: false
---

## Why Should You Care?

State management is where complex React applications go to die. Too little structure and you end up with prop drilling and scattered useState hooks. Too much structure and you're writing Redux boilerplate at 11pm wondering why you chose frontend engineering.

OMNI has a lot of state: the current camera position on the globe, which of 25 layers are active, how many entities each layer has loaded, which info panel is open, what tab the dock is showing, the user's API tier, their display preferences. All of it needs to be accessible both inside React components (for the UI) and outside React components (in imperative Cesium hooks that manage entities without triggering re-renders).

That last requirement is what made Redux and React Context non-starters. Both require a React provider — which means you can only read state inside the React tree. Cesium hooks live partially outside that tree.

Zustand solved all of it. Here's the 4-slice architecture that evolved over OMNI's development.

---

## Why Zustand Over the Alternatives

Before getting into the architecture, the quick case:

**vs. Redux Toolkit:** Redux requires providers, action creators, reducers, and selectors. For a solo project, that's a lot of ceremony. Zustand gives you stores as plain JavaScript objects with collocated state and actions.

**vs. React Context:** Context is fine for slow-moving state (auth, theme, locale). It's terrible for high-frequency state because every context update re-renders all consumers. With 25 data layers updating on different intervals, context would cause a constant cascade of re-renders.

**vs. Jotai/Recoil:** Atom-based libraries are great for fine-grained reactivity but add cognitive overhead for state that naturally groups together. Layer toggles and layer entity counts are related — they belong in the same slice.

**The decisive factor for OMNI:** Zustand stores are plain JavaScript singletons. You can read and write them from anywhere:

```typescript
// Inside a React component — normal subscription
const enabled = useLayersStore(s => s.layers.ais.enabled)

// Inside an imperative Cesium hook — direct store access, no subscription
useLayersStore.getState().setEntityCount('ais', vessels.length)

// Outside React entirely — in a service, util, or background process
const { layers } = useLayersStore.getState()
```

That last pattern is what makes the Cesium layer hooks work without triggering React re-renders. They write to the store imperatively; React components subscribe and re-render only when their specific slice of state changes.

---

## The 4-Slice Architecture

OMNI's state is split into four stores by domain. Each store is defined with Zustand's `create` function and exported as a typed hook.

```
stores/
  globe-store.ts    — Camera, selected entity, scene mode
  layers-store.ts   — 25 layer toggle states, entity counts, loading
  ui-store.ts       — Panel visibility, dock tabs, command palette
  user-store.ts     — Auth, tier, preferences, API key status
```

---

### Slice 1: Globe Store

Everything about the 3D scene state that isn't tied to a specific layer.

```typescript
// stores/globe-store.ts
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

interface SelectedEntity {
  type: 'vessel' | 'aircraft' | 'earthquake' | 'wildfire' | 'event'
  id: string
  data: unknown
}

interface GlobeStore {
  // Camera
  cameraPosition: { lon: number; lat: number; altitude: number } | null
  setCameraPosition: (pos: { lon: number; lat: number; altitude: number }) => void

  // Selection
  selectedEntity: SelectedEntity | null
  setSelectedEntity: (entity: SelectedEntity | null) => void
  clearSelection: () => void

  // Scene mode
  sceneMode: '3D' | '2D' | 'COLUMBUS'
  setSceneMode: (mode: '3D' | '2D' | 'COLUMBUS') => void

  // Tracking
  isFollowingEntity: boolean
  setFollowingEntity: (following: boolean) => void
}

export const useGlobeStore = create<GlobeStore>()(
  subscribeWithSelector((set) => ({
    cameraPosition: null,
    setCameraPosition: (pos) => set({ cameraPosition: pos }),

    selectedEntity: null,
    setSelectedEntity: (entity) => set({ selectedEntity: entity }),
    clearSelection: () => set({ selectedEntity: null, isFollowingEntity: false }),

    sceneMode: '3D',
    setSceneMode: (mode) => set({ sceneMode: mode }),

    isFollowingEntity: false,
    setFollowingEntity: (following) => set({ isFollowingEntity: following }),
  }))
)
```

The `subscribeWithSelector` middleware is important. It enables `useGlobeStore.subscribe(selector, callback)` — so the Cesium camera sync hook can subscribe to `sceneMode` changes and call the appropriate Cesium API without going through React at all:

```typescript
// In a camera sync hook
useEffect(() => {
  const unsub = useGlobeStore.subscribe(
    s => s.sceneMode,
    (mode) => {
      const sceneModeMap = {
        '3D': Cesium.SceneMode.SCENE3D,
        '2D': Cesium.SceneMode.SCENE2D,
        'COLUMBUS': Cesium.SceneMode.COLUMBUS_VIEW,
      }
      viewer.scene.mode = sceneModeMap[mode]
    }
  )
  return unsub
}, [viewer])
```

No React re-render. No useEffect dependency on the scene mode value. Pure imperative reaction to store changes.

---

### Slice 2: Layers Store

The largest slice, and the most performance-sensitive. 25 layers × multiple state fields per layer.

```typescript
// stores/layers-store.ts
export type LayerId =
  | 'ais' | 'adsb' | 'opensky' | 'earthquakes' | 'wildfires'
  | 'gdelt' | 'weather-radar' | 'weather-stations' | 'ocean-currents'
  // ... 16 more

interface LayerState {
  enabled: boolean
  loading: boolean
  error: string | null
  entityCount: number
  lastUpdated: number | null
}

interface LayersStore {
  layers: Record<LayerId, LayerState>
  vesselMetadata: Record<string, VesselInfo>       // mmsi → vessel data
  aircraftMetadata: Record<string, AircraftInfo>   // hex → aircraft data

  toggleLayer: (id: LayerId) => void
  enableLayer: (id: LayerId) => void
  disableLayer: (id: LayerId) => void
  setLayerLoading: (id: LayerId, loading: boolean) => void
  setLayerError: (id: LayerId, error: string | null) => void
  setEntityCount: (id: LayerId, count: number) => void
  setLastUpdated: (id: LayerId) => void

  setVesselMetadata: (data: Record<string, VesselInfo>) => void
  setAircraftMetadata: (data: Record<string, AircraftInfo>) => void
}

const defaultLayerState: LayerState = {
  enabled: false,
  loading: false,
  error: null,
  entityCount: 0,
  lastUpdated: null,
}

export const useLayersStore = create<LayersStore>()((set, get) => ({
  layers: Object.fromEntries(
    ALL_LAYER_IDS.map(id => [id, { ...defaultLayerState }])
  ) as Record<LayerId, LayerState>,

  vesselMetadata: {},
  aircraftMetadata: {},

  toggleLayer: (id) =>
    set(state => ({
      layers: {
        ...state.layers,
        [id]: { ...state.layers[id], enabled: !state.layers[id].enabled },
      },
    })),

  enableLayer: (id) =>
    set(state => ({
      layers: { ...state.layers, [id]: { ...state.layers[id], enabled: true } },
    })),

  setLayerLoading: (id, loading) =>
    set(state => ({
      layers: { ...state.layers, [id]: { ...state.layers[id], loading } },
    })),

  setEntityCount: (id, entityCount) =>
    set(state => ({
      layers: { ...state.layers, [id]: { ...state.layers[id], entityCount } },
    })),

  setLastUpdated: (id) =>
    set(state => ({
      layers: {
        ...state.layers,
        [id]: { ...state.layers[id], lastUpdated: Date.now() },
      },
    })),

  setVesselMetadata: (data) => set({ vesselMetadata: data }),
  setAircraftMetadata: (data) => set({ aircraftMetadata: data }),
}))
```

A critical design decision: `vesselMetadata` and `aircraftMetadata` live in the layers store, not spread across individual layer slices. The click handler (see the race-conditions post) needs to look up entity metadata regardless of which layer type was clicked. A flat lookup from a single store is faster and simpler than a multi-store lookup.

---

### Slice 3: UI Store

Panel visibility, dock state, and overlay UX. This store changes frequently but is read by UI components only — no imperative code reads it.

```typescript
// stores/ui-store.ts
type DockTab = 'layers' | 'search' | 'alerts' | 'history'
type InfoPanel = 'vessel' | 'aircraft' | 'earthquake' | 'event' | null

interface UIStore {
  // Info panel (right side)
  activeInfoPanel: InfoPanel
  setActiveInfoPanel: (panel: InfoPanel) => void

  // Dock (left side)
  isDockOpen: boolean
  activeDockTab: DockTab
  setIsDockOpen: (open: boolean) => void
  setActiveDockTab: (tab: DockTab) => void
  toggleDock: () => void

  // Command palette
  isCommandPaletteOpen: boolean
  openCommandPalette: () => void
  closeCommandPalette: () => void

  // Overlay
  activeOverlay: string | null
  setActiveOverlay: (overlay: string | null) => void

  // Settings sheet
  isSettingsOpen: boolean
  setIsSettingsOpen: (open: boolean) => void
}

export const useUIStore = create<UIStore>()((set) => ({
  activeInfoPanel: null,
  setActiveInfoPanel: (panel) => set({ activeInfoPanel: panel }),

  isDockOpen: true,
  activeDockTab: 'layers',
  setIsDockOpen: (open) => set({ isDockOpen: open }),
  setActiveDockTab: (tab) => set({ activeDockTab: tab }),
  toggleDock: () => set(state => ({ isDockOpen: !state.isDockOpen })),

  isCommandPaletteOpen: false,
  openCommandPalette: () => set({ isCommandPaletteOpen: true }),
  closeCommandPalette: () => set({ isCommandPaletteOpen: false }),

  activeOverlay: null,
  setActiveOverlay: (overlay) => set({ activeOverlay: overlay }),

  isSettingsOpen: false,
  setIsSettingsOpen: (open) => set({ isSettingsOpen: open }),
}))
```

No middleware needed here — this store is read-only from Cesium's perspective, and it doesn't need subscription-based reactions.

---

### Slice 4: User Store

Auth state, subscription tier, and preferences. The tier field gates which layers are available — pro-only layers check `useUserStore(s => s.tier)` before enabling.

```typescript
// stores/user-store.ts
type Tier = 'free' | 'pro' | 'enterprise'

interface Preferences {
  globeImagery: 'satellite' | 'terrain' | 'dark' | 'minimal'
  coordinateFormat: 'decimal' | 'dms'
  distanceUnit: 'km' | 'nm' | 'mi'
  clockFormat: '12h' | '24h'
  timezone: string
}

interface UserStore {
  userId: string | null
  email: string | null
  tier: Tier
  isAuthenticated: boolean

  preferences: Preferences
  setPreferences: (prefs: Partial<Preferences>) => void
  setTier: (tier: Tier) => void

  // API key status (keys stored server-side, only status on client)
  apiKeyStatus: Record<string, 'active' | 'invalid' | 'missing'>
  setApiKeyStatus: (service: string, status: 'active' | 'invalid' | 'missing') => void

  hydrate: (user: { id: string; email: string; tier: Tier }) => void
  logout: () => void
}

const defaultPreferences: Preferences = {
  globeImagery: 'satellite',
  coordinateFormat: 'decimal',
  distanceUnit: 'nm',
  clockFormat: '24h',
  timezone: 'UTC',
}

export const useUserStore = create<UserStore>()(
  persist(
    (set) => ({
      userId: null,
      email: null,
      tier: 'free',
      isAuthenticated: false,
      preferences: defaultPreferences,
      apiKeyStatus: {},

      setPreferences: (prefs) =>
        set(state => ({ preferences: { ...state.preferences, ...prefs } })),

      setTier: (tier) => set({ tier }),

      setApiKeyStatus: (service, status) =>
        set(state => ({
          apiKeyStatus: { ...state.apiKeyStatus, [service]: status },
        })),

      hydrate: (user) =>
        set({ userId: user.id, email: user.email, tier: user.tier, isAuthenticated: true }),

      logout: () =>
        set({ userId: null, email: null, tier: 'free', isAuthenticated: false }),
    }),
    {
      name: 'omni-user',
      partialize: (state) => ({ preferences: state.preferences }),
      // Only persist preferences — never persist auth state to localStorage
    }
  )
)
```

The `persist` middleware with `partialize` is doing something important: it persists only `preferences` to localStorage, not auth state or tier. Auth state is hydrated from the server on each load. Persisting tier to localStorage would create a gap where a user's subscription lapses but their local app still thinks they're pro.

---

## Selective Subscriptions for Performance

The most important Zustand performance pattern: never subscribe to more state than you need.

```typescript
// BAD — subscribes to entire layers store, re-renders on any change
const { layers, toggleLayer } = useLayersStore()

// GOOD — subscribes only to AIS layer state
const aisEnabled = useLayersStore(s => s.layers.ais.enabled)
const aisCount = useLayersStore(s => s.layers.ais.entityCount)
const toggleLayer = useLayersStore(s => s.toggleLayer)
```

When `layers.adsb.entityCount` updates (4,000 aircraft positions changed), components subscribing to `layers.ais.enabled` don't re-render. The selector returns the same value, Zustand's shallow equality check passes, no re-render.

For derived state across multiple slices, use Zustand's `combine` or write a custom hook:

```typescript
// Custom hook: aggregate entity count across all active layers
export function useTotalEntityCount() {
  return useLayersStore(
    s => Object.values(s.layers)
           .filter(l => l.enabled)
           .reduce((sum, l) => sum + l.entityCount, 0),
    shallow  // Zustand shallow equality for object/array returns
  )
}
```

The `shallow` import from `zustand/shallow` is needed when your selector returns a new object or array — without it, Zustand falls back to reference equality and always re-renders.

---

## Cross-Store Coordination

Sometimes one store action needs to trigger state in another. In OMNI, selecting an entity (globe store) should automatically open the appropriate info panel (UI store) and set the dock to the right tab.

The pattern: side effects in custom hooks, not in store actions.

```typescript
// hooks/useEntitySelectionSync.ts
// Runs once at the app root, syncs globe selection → UI state
export function useEntitySelectionSync() {
  const selectedEntity = useGlobeStore(s => s.selectedEntity)
  const setActiveInfoPanel = useUIStore(s => s.setActiveInfoPanel)

  useEffect(() => {
    if (!selectedEntity) {
      setActiveInfoPanel(null)
      return
    }
    setActiveInfoPanel(selectedEntity.type as InfoPanel)
  }, [selectedEntity, setActiveInfoPanel])
}
```

This keeps the store actions clean and single-purpose. Store actions set state. Hooks coordinate between stores as side effects of state changes. The separation makes the data flow readable.

---

## What You Learned

- Zustand's flat singleton pattern enables state access from both React components (via hooks) and imperative code (via `getState()`), which is essential when mixing React with libraries like CesiumJS.
- Splitting into four stores by domain (Globe, Layers, UI, User) keeps each store focused and makes it clear where new state belongs — rather than one monolithic store that becomes a grab-bag.
- Selective subscriptions are non-negotiable at scale. Subscribe only to the specific state fields each component needs; never destructure the whole store.
- The `subscribeWithSelector` middleware enables imperative reactions to state changes without React re-renders — the right tool for syncing Cesium scene properties to Zustand state.
- Persist auth only what's safe to persist. Use `partialize` to whitelist specific fields; never persist auth tokens or subscription tier to localStorage.
