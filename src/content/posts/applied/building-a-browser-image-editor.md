---
title: "Building a Browser-Based Image Editor in a Single HTML File"
description: "I needed an OG image for the blog. Instead of opening Photoshop, I built a canvas-based image editor with layers, snapping, background removal, and project files — zero dependencies."
publishDate: 2026-05-01
author: j-martin
tier: applied
postType: project-walkthrough
difficulty: intermediate
estimatedMinutes: 18
prerequisites: []
category: javascript-typescript
tags: ["canvas-api", "javascript", "browser-tools", "image-editing", "html5"]
certTracks: []
featured: false
heroImage: "/images/posts/building-a-browser-image-editor.webp"
draft: false
---

## Why Should You Care?

Every developer eventually needs to create a branded image. An Open Graph card for a blog post. A social media banner. A hero graphic. And every time, the same decision tree: open Figma (overkill), fire up Photoshop (subscription), use Canva (cloud dependency), or hand-position elements in CSS and screenshot (fragile).

I was finishing up a 48-post tech education blog and realized I didn't have an OG image — the 1200x630 card that shows up when someone shares a link on Twitter or Slack. I needed text, a logo, an avatar, accent lines, all on a dark branded background. And I needed it in the next twenty minutes.

So I built an image editor. In the browser. A single HTML file, zero dependencies, zero build step. I named it **dedit** — Dead Simple Editor — and what started as "just render some text on a canvas" turned into a genuine tool I keep reaching for.

This post walks through how it works, the Canvas API fundamentals that power it, and the bugs that taught me the most.

---

## Architecture: One File, Three Panels

The entire editor is a single `index.html` — roughly 970 lines of HTML, CSS, and JavaScript. No framework, no bundler, no npm install. Open the file in a browser and you're editing.

The layout is a classic three-panel design:

```
┌─────────────┬──────────────────────────┬──────────────┐
│  LAYERS     │                          │  PROPERTIES  │
│             │                          │              │
│  Logo (SVG) │                          │  Position    │
│  Title      │        CANVAS            │  X: 270      │
│  Accent     │      1200 x 630          │  Y: 230      │
│  Subtitle   │                          │  Font Size   │
│  Tagline    │                          │  Color       │
│  Avatar     │                          │  Opacity     │
│  Author     │                          │              │
│             │                          │  [Remove BG] │
│  [+Text]    │  [Grid] [Snap] [Guides]  │              │
│  [+Rect]    │  [Save] [Load] [Export]  │              │
└─────────────┴──────────────────────────┴──────────────┘
```

**Left panel** — layer list with visibility toggles, reordering, duplicate, delete.
**Center** — the canvas with toolbar (zoom, grid, snap, guides, save/load/export).
**Right panel** — context-sensitive property inspector for the selected layer.

Everything renders to a single `<canvas>` element. The UI panels are plain HTML with inline event handlers. State lives in one object. There is no reactivity system — when something changes, call `draw()` and `updateLayerList()`.

---

## Foundation: The Canvas API

If you've never worked with the Canvas API, here's the mental model: it's a pixel buffer with a drawing context. You get a reference, then issue imperative drawing commands.

```javascript
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// Clear everything
ctx.clearRect(0, 0, canvas.width, canvas.height);

// Fill with background color
ctx.fillStyle = '#0f172a';
ctx.fillRect(0, 0, canvas.width, canvas.height);
```

Canvas has no concept of objects, layers, or hit regions. Every `fillRect()` or `drawImage()` call paints pixels directly onto the buffer. Once painted, those pixels don't know they came from a rectangle — they're just colored squares. This is the fundamental constraint that shapes the entire editor architecture: **you need to maintain your own object model and redraw everything from scratch on every change.**

Drawing text:

```javascript
ctx.font = '800 64px Inter, system-ui, sans-serif';
ctx.fillStyle = '#e2e8f0';
ctx.textBaseline = 'top';
ctx.fillText('SouthernSky Engineering', 270, 230);
```

Drawing images:

```javascript
ctx.drawImage(logoImg, 60, 180, 180, 140);
```

Drawing shapes:

```javascript
// Accent line — just a thin rectangle
ctx.fillStyle = '#3b82f6';
ctx.fillRect(270, 310, 80, 3);
```

That's the entire rendering vocabulary for this editor. Text, images, and rectangles. No Bezier curves, no filters, no blend modes. Dead simple.

---

## The Layer System

Since canvas has no built-in object model, you build your own. Each layer is a plain JavaScript object in an array:

```javascript
const state = {
  bgColor: '#0f172a',
  layers: [],
  selected: -1,
  // ... drag state, zoom, guides, etc.
};
```

A text layer looks like:

```javascript
{
  type: 'text',
  name: 'Title',
  text: 'SouthernSky Engineering',
  x: 270, y: 230,
  fontSize: 64,
  fontWeight: '800',
  color: '#e2e8f0',
  opacity: 100,
  visible: true,
}
```

An image layer:

```javascript
{
  type: 'image',
  name: 'Logo (SVG)',
  img: /* HTMLImageElement */,
  x: 60, y: 180,
  w: 180, h: 140,
  scale: 100,
  opacity: 100,
  visible: true,
}
```

The `draw()` function iterates the array in order and renders each layer based on its type. Selection is tracked as an index into the array. Reordering swaps array positions. Visibility is a boolean flag that skips the render call.

```javascript
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = state.bgColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  state.layers.forEach((layer, i) => {
    if (!layer.visible) return;
    ctx.globalAlpha = (layer.opacity ?? 100) / 100;

    if (layer.type === 'image') {
      const s = (layer.scale || 100) / 100;
      ctx.drawImage(layer.img, layer.x, layer.y, layer.w * s, layer.h * s);
    } else if (layer.type === 'text') {
      ctx.font = `${layer.fontWeight} ${layer.fontSize}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = layer.color;
      ctx.textBaseline = 'top';
      ctx.fillText(layer.text, layer.x, layer.y);
    } else if (layer.type === 'rect' || layer.type === 'line') {
      ctx.fillStyle = layer.color;
      ctx.fillRect(layer.x, layer.y, layer.w, layer.h);
    }

    ctx.globalAlpha = 1;
  });
}
```

This is the entire rendering pipeline. Every user action — dragging, typing, changing a slider — ends with a call to `draw()`. No diffing, no dirty rectangles, no optimization. For a 1200x630 canvas with a dozen layers, full redraws are effectively instant.

---

## Hit Testing: Which Layer Did I Click?

Canvas doesn't have click events on drawn objects. You get `mousedown` on the canvas element with pixel coordinates, and you have to figure out which layer (if any) those coordinates fall inside.

This means computing bounding boxes from the layer data:

```javascript
function getLayerBounds(layer) {
  if (layer.type === 'text') {
    ctx.font = `${layer.fontWeight} ${layer.fontSize}px Inter, system-ui, sans-serif`;
    const m = ctx.measureText(layer.text);
    return { x: layer.x, y: layer.y, w: m.width, h: layer.fontSize * 1.2 };
  } else if (layer.type === 'line' || layer.type === 'rect') {
    return { x: layer.x, y: layer.y, w: layer.w, h: layer.h };
  } else {
    const s = (layer.scale || 100) / 100;
    return { x: layer.x, y: layer.y, w: layer.w * s, h: layer.h * s };
  }
}
```

**Gotcha: text bounding boxes.** Canvas has no built-in text bounding box. `ctx.measureText()` gives you the width, but the height? There's no `measureText().height`. I approximate it as `fontSize * 1.2` — the standard line-height multiplier for Latin text. It's not pixel-perfect, but it's close enough for hit testing with a 6px padding margin.

Hit testing walks the layer array in reverse (top layer first, since that's what's visually on top):

```javascript
function hitTest(mx, my) {
  for (let i = state.layers.length - 1; i >= 0; i--) {
    if (!state.layers[i].visible) continue;
    const b = getLayerBounds(state.layers[i]);
    if (mx >= b.x - 6 && mx <= b.x + b.w + 6 &&
        my >= b.y - 6 && my <= b.y + b.h + 6) {
      return i;
    }
  }
  return -1;
}
```

The 6px padding on each side is important — tiny elements (a 3px-tall accent line) would be nearly impossible to click without it.

One more subtlety: canvas coordinates and DOM coordinates aren't the same when the canvas is zoomed. You need to convert mouse events:

```javascript
function canvasCoords(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (canvas.width / rect.width),
    y: (e.clientY - rect.top) * (canvas.height / rect.height),
  };
}
```

The multiplier `(canvas.width / rect.width)` accounts for the CSS transform zoom — the canvas's logical resolution is 1200x630, but it might be displayed at 800x420 on screen.

---

## Smart Snapping

Drag-to-position is nice, but imprecise. Professional design tools snap elements to grids, guides, and other elements. Dedit has all three.

The snap system runs on every `mousemove` during a drag. It collects snap targets, compares them against the moving layer's edges and center, and applies the closest snap within a threshold.

```javascript
const SNAP_THRESHOLD = 6; // pixels

// Snap points for the moving layer: left edge, center, right edge
const b = getLayerBounds(state.layers[state.selected]);
const xPoints = [b.x, b.x + b.w / 2, b.x + b.w];
const yPoints = [b.y, b.y + b.h / 2, b.y + b.h];

// Target snap lines: canvas edges + center
const xTargets = [0, canvas.width / 2, canvas.width];
const yTargets = [0, canvas.height / 2, canvas.height];

// Add user-placed guides
state.guides.v.forEach(gx => xTargets.push(gx));
state.guides.h.forEach(gy => yTargets.push(gy));

// Add other layers' edges and centers
state.layers.forEach((other, i) => {
  if (i === state.selected || !other.visible) return;
  const ob = getLayerBounds(other);
  xTargets.push(ob.x, ob.x + ob.w / 2, ob.x + ob.w);
  yTargets.push(ob.y, ob.y + ob.h / 2, ob.y + ob.h);
});
```

Now find the best snap. This was the source of a bug that took me twenty minutes to track down.

### The Snap Bug

My first implementation checked each snap point and applied the correction immediately:

```javascript
// BROKEN: cumulative snapping
for (const point of xPoints) {
  for (const target of xTargets) {
    if (Math.abs(point - target) < SNAP_THRESHOLD) {
      layer.x += target - point;  // Mutates position before checking next point!
    }
  }
}
```

The problem: after snapping the left edge, the center and right edge points are now in different positions. You'd get double or triple snaps stacking on top of each other, causing the layer to jump erratically.

The fix is to find the single best snap per axis *without* mutating anything, then apply it once:

```javascript
function findBestSnap(points, targets) {
  let best = null;
  for (let pi = 0; pi < points.length; pi++) {
    for (const t of targets) {
      const dist = Math.abs(points[pi] - t);
      if (dist < SNAP_THRESHOLD) {
        const isCenter = pi === 1;  // Center snaps get priority
        if (!best || (isCenter && !best.isCenter) || dist < best.dist) {
          best = { dist, delta: t - points[pi], snapPos: t, isCenter };
        }
      }
    }
  }
  return best;
}

const xSnap = findBestSnap(xPoints, xTargets);
if (xSnap) {
  state.layers[state.selected].x += xSnap.delta;
  state.activeSnaps.push({ axis: 'v', pos: xSnap.snapPos });
}
```

The key insight: **find the best snap, store the delta, apply once.** Center snaps get priority over edge snaps (when you're centering an element, that's almost always what you want).

Active snap lines render as bright cyan dashes across the full canvas — immediate visual feedback showing exactly what you snapped to.

---

## Background Removal

This was the feature I didn't plan to build but needed immediately. I had a PNG logo with a white background that needed to be transparent. Opening GIMP for one operation felt wrong.

The approach is simple: sample corner pixels to auto-detect the background color, then iterate every pixel and zero the alpha channel for any color within tolerance.

```javascript
function removeColorFromLayer(tolerance) {
  const layer = state.layers[state.selected];
  if (!layer || layer.type !== 'image') return;

  // Render image to an offscreen canvas to get pixel data
  const offscreen = document.createElement('canvas');
  const s = (layer.scale || 100) / 100;
  offscreen.width = Math.round(layer.w * s);
  offscreen.height = Math.round(layer.h * s);
  const offCtx = offscreen.getContext('2d');
  offCtx.drawImage(layer.img, 0, 0, offscreen.width, offscreen.height);

  const imageData = offCtx.getImageData(0, 0, offscreen.width, offscreen.height);
  const d = imageData.data;

  // Sample 8 corner pixels (corners + 1px inset) to detect background color
  const corners = [
    [0, 0], [offscreen.width - 1, 0],
    [0, offscreen.height - 1], [offscreen.width - 1, offscreen.height - 1],
    [1, 1], [offscreen.width - 2, 1],
    [1, offscreen.height - 2], [offscreen.width - 2, offscreen.height - 2],
  ];

  let rSum = 0, gSum = 0, bSum = 0, count = 0;
  for (const [cx, cy] of corners) {
    const idx = (cy * offscreen.width + cx) * 4;
    rSum += d[idx]; gSum += d[idx + 1]; bSum += d[idx + 2];
    count++;
  }
  const bgR = Math.round(rSum / count);
  const bgG = Math.round(gSum / count);
  const bgB = Math.round(bSum / count);

  // Zero alpha for pixels within tolerance of the detected background
  const tol = tolerance || 30;
  for (let i = 0; i < d.length; i += 4) {
    const dr = Math.abs(d[i] - bgR);
    const dg = Math.abs(d[i + 1] - bgG);
    const db = Math.abs(d[i + 2] - bgB);
    if (dr <= tol && dg <= tol && db <= tol) {
      d[i + 3] = 0;  // Set alpha to 0 (transparent)
    }
  }

  offCtx.putImageData(imageData, 0, 0);

  // Replace the layer's image with the cleaned version
  const cleanImg = new Image();
  cleanImg.onload = () => {
    layer.img = cleanImg;
    draw();
  };
  cleanImg.src = offscreen.toDataURL('image/png');
}
```

Why sample 8 corners instead of just 4? Aliasing. Some image formats have a 1px border artifact from compression. Sampling both the true corner and 1px inset gives a more stable average.

The tolerance slider (5-100) controls how aggressively pixels are matched. A tolerance of 30 works for most solid-color backgrounds. For gradients or noisy backgrounds, you'd need a smarter algorithm — flood fill, edge detection, or an actual ML segmentation model. But for "remove the white background from a PNG logo," pixel matching is all you need.

---

## Project Serialization

The `.dedit` format is JSON with embedded images. Saving a project converts each image layer to a data URL and dumps the full state:

```javascript
function saveProject() {
  const project = {
    format: 'dedit-v1',
    canvas: { width: canvas.width, height: canvas.height },
    bgColor: state.bgColor,
    guides: state.guides,
    gridSize: state.gridSize,
    layers: state.layers.map(layer => {
      const l = { ...layer };
      if (l.img) {
        // Render image to offscreen canvas, then export as data URL
        const offscreen = document.createElement('canvas');
        offscreen.width = l.img.naturalWidth || l.img.width;
        offscreen.height = l.img.naturalHeight || l.img.height;
        offscreen.getContext('2d').drawImage(l.img, 0, 0, offscreen.width, offscreen.height);
        l.imgData = offscreen.toDataURL('image/png');
        delete l.img;
      }
      return l;
    }),
  };

  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.download = 'project.dedit';
  link.href = URL.createObjectURL(blob);
  link.click();
  URL.revokeObjectURL(link.href);
}
```

**Gotcha: cross-origin images.** If you load an image from a different domain, `canvas.toDataURL()` throws a security error. The fix is to set `crossOrigin = 'anonymous'` on the `Image` element before setting `src`:

```javascript
function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
```

This tells the browser to make a CORS request. The server still needs to send `Access-Control-Allow-Origin` headers — if it doesn't, the image loads but remains "tainted" and `toDataURL()` will still fail. For local files and data URLs, this isn't an issue.

Loading a project reverses the process: parse JSON, convert data URLs back to `Image` elements, rebuild the state:

```javascript
async function handleProjectLoad(e) {
  const file = e.target.files[0];
  const text = await file.text();
  const project = JSON.parse(text);

  if (!project.format || !project.format.startsWith('dedit')) {
    alert('Not a valid .dedit project file');
    return;
  }

  canvas.width = project.canvas.width;
  canvas.height = project.canvas.height;
  state.bgColor = project.bgColor;
  state.guides = project.guides || { h: [], v: [] };

  state.layers = [];
  for (const l of project.layers) {
    if (l.imgData) {
      l.img = await loadImage(l.imgData);
      delete l.imgData;
    }
    state.layers.push(l);
  }

  zoomFit();
  updateLayerList();
  draw();
}
```

The `.dedit` files are self-contained — embedded images, guide positions, grid settings, everything. You can email a `.dedit` file to someone and they open it in the same `index.html`. No server, no account, no sync service.

---

## SVG vs. PNG: Progressive Enhancement for Logos

One design decision worth calling out: the editor loads SVG logos through a special path. SVGs render as vector graphics at any resolution, which means they naturally have transparent backgrounds. PNGs might have a solid background baked in that requires the background removal tool.

```javascript
function svgToImage(svgText, width, height) {
  return new Promise((resolve) => {
    const blob = new Blob([svgText], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}
```

This converts an SVG string into a renderable `Image` element via a Blob URL. The SVG retains its transparency, composites cleanly over any background, and scales without pixelation. If you have both SVG and PNG versions of a logo, always use the SVG.

---

## The Gotcha You'll Hit If You Build This

If you're building DOM-based UI around a canvas tool and using Tailwind CSS, you'll run into this: **Tailwind purges classes from dynamically-created DOM elements.**

The layer list, property panel, and toolbar buttons are all generated by JavaScript at runtime. Tailwind's build step scans your source files for class names at compile time. If a class only appears in a JavaScript string — `div.className = 'flex items-center gap-2'` — the scanner might miss it, and the class gets purged from the final CSS.

The fix for dedit was simple: skip Tailwind entirely. The editor uses a `<style>` block with plain CSS. Every dynamic element uses inline styles or CSS classes defined in that block. No build step means no purging. For a single-file tool, this is the right call.

But if you're building a canvas tool inside a larger Tailwind project — say, a React app — use inline styles for any DOM elements created by JavaScript:

```javascript
// BAD: Tailwind class gets purged
div.className = 'bg-slate-900 p-2 rounded';

// GOOD: inline styles survive any build process
div.style.background = '#0f172a';
div.style.padding = '8px';
div.style.borderRadius = '4px';
```

---

## Export: Clean Render Without UI Artifacts

The export function needs to render the canvas without selection boxes, grid lines, or guide overlays. The approach is surgical: temporarily clear the UI state, draw, export, then restore.

```javascript
function exportImage(format) {
  // Save current UI state
  const prev = {
    selected: state.selected,
    showGrid: state.showGrid,
    guides: state.guides,
    activeSnaps: state.activeSnaps,
  };

  // Clear all overlays
  state.selected = -1;
  state.showGrid = false;
  state.guides = { h: [], v: [] };
  state.activeSnaps = [];
  draw();

  // Export the clean canvas
  const mime = format === 'webp' ? 'image/webp' : 'image/png';
  const link = document.createElement('a');
  link.download = `og-image.${format}`;
  link.href = canvas.toDataURL(mime, 0.92);
  link.click();

  // Restore overlays
  Object.assign(state, prev);
  draw();
}
```

WebP export with quality 0.92 produces significantly smaller files than PNG for photographic content. For graphics with sharp text and flat colors — like an OG image — the difference is less dramatic, but WebP is still the better default for web delivery.

---

## What I'd Build Next

Dedit solves the problem it was built for: quick branded graphics in a browser. But using it surfaced two adjacent problems that want similar tools:

**deditp (photos)** — A photo-focused variant with crop, resize, basic adjustments (brightness, contrast, saturation), and batch export. The canvas API already supports pixel-level manipulation through `ImageData` — the same mechanism that powers background removal. Adding brightness is literally `d[i] = Math.min(255, d[i] + amount)` for each RGB channel. The architecture is already there.

**deditv (video)** — Frame-by-frame video editing. Extract frames with `<video>` + `canvas.drawImage(video)`, edit individual frames with the same layer system, reassemble with MediaRecorder or ffmpeg.wasm. This one's a bigger lift, but the foundation — canvas rendering, layer management, hit testing, serialization — transfers directly.

---

## The Takeaway

The entire editor is 970 lines in one file. No dependencies, no build step, no framework. It loads in 50ms and works offline forever.

Sometimes the right tool is the one you build in twenty minutes because you needed it right now. The Canvas API is underappreciated for this kind of work — it's not just for games and data visualization. It's a full pixel-level drawing surface that ships in every browser, and combining it with a simple JavaScript object model gives you a surprisingly capable editor.

The OG image for this blog? Made in dedit. The tool built itself a purpose.
