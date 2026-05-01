---
title: "Building a Professional Demo Site for a School in One Weekend"
description: "I rebuilt a school's outdated website as a polished React demo — photo gallery, video montage, and GitHub Pages deploy. Here's the full build."
publishDate: 2026-04-29
author: j-martin
tier: applied
postType: project-walkthrough
difficulty: intermediate
estimatedMinutes: 14
prerequisites: []
category: web-development
tags: ["react", "vite", "tailwind", "github-pages", "demo", "ffmpeg"]
certTracks: []
featured: false
heroImage: "/images/posts/fra-demo-site-build.webp"
draft: false
---

## Why Should You Care?

Sometimes the best portfolio piece isn't an app you built for yourself — it's something you built for someone else. A school, a nonprofit, a local business. The kind of project where you take a dated, hard-to-navigate website and show what it could look like with modern tools.

This is the story of the FRA Demo: a weekend project where I rebuilt a private school's website as a polished React showcase. Real photos, real programs, a video montage, and a live deployment anyone could visit.

## The Goal

Flint River Academy (FRA) is a small private school in Woodbury, Georgia. I wanted to demonstrate what a modern version of their web presence could look like — something an administrator could actually see and evaluate, not just a mockup in Figma.

Requirements:
- **Real content** — school photos, program descriptions, team information
- **Photo gallery** with lightbox interaction
- **Video highlight reel** assembled from campus photos
- **Public URL** that works on any device
- **Zero backend** — pure static files, no hosting costs

## Project Setup

React + Vite + Tailwind — the fastest path to a polished static site:

```bash
npm create vite@latest fra-demo -- --template react-ts
cd fra-demo
npm install
npm install -D tailwindcss @tailwindcss/typography
```

Organize the project assets:

```
fra-demo/
├── public/
│   ├── fra-montage.mp4     # Video highlight reel
│   └── images/
│       └── video-poster.jpg
├── src/
│   ├── assets/
│   │   └── campus/          # School photos
│   ├── components/
│   │   ├── Hero.tsx
│   │   ├── Programs.tsx
│   │   ├── PhotoGallery.tsx
│   │   └── Showcase.tsx     # Video player
│   └── App.tsx
└── vite.config.ts
```

## The Photo Gallery Component

The gallery is the centerpiece. Vite's `import.meta.glob` generates a compile-time module map from a file pattern — no manual import list to maintain:

```tsx
// src/components/PhotoGallery.tsx
import { useState } from 'react';

const images = import.meta.glob('../assets/campus/*.jpg', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

const imageList = Object.values(images);

export function PhotoGallery() {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
        {imageList.map((src, i) => (
          <button
            key={i}
            onClick={() => setLightboxSrc(src)}
            className="aspect-square overflow-hidden rounded-lg
                       hover:opacity-90 transition-opacity"
          >
            <img
              src={src}
              alt={`Campus photo ${i + 1}`}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          </button>
        ))}
      </div>

      {lightboxSrc && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center
                     justify-center z-50 cursor-pointer"
          onClick={() => setLightboxSrc(null)}
        >
          <img
            src={lightboxSrc}
            alt="Campus photo"
            className="max-w-4xl max-h-screen object-contain p-4"
          />
        </div>
      )}
    </>
  );
}
```

`eager: true` bundles the image references into the chunk at build time. The images themselves still load lazily via `loading="lazy"` on the `<img>` tags — `eager` controls module resolution, not network fetching.

Drop photos into `src/assets/campus/` and they appear in the gallery automatically. Add ten more? Just drop them in the folder and rebuild. No imports to update.

## Building the Video Montage

A highlight reel sells the demo better than any static page. I used `ffmpeg` to turn campus photos into a 94-second slideshow video with smooth transitions:

```bash
# Generate an ffmpeg concat file
for img in images/athletics/*.jpg images/campus/*.jpg; do
  echo "file '$img'"
  echo "duration 2.5"
done > slideshow.txt

# Build the video at 1080p
ffmpeg \
  -f concat \
  -safe 0 \
  -i slideshow.txt \
  -vf "scale=1920:1080:force_original_aspect_ratio=decrease,\
       pad=1920:1080:(ow-iw)/2:(oh-ih)/2" \
  -c:v libx264 \
  -pix_fmt yuv420p \
  -r 30 \
  fra-montage.mp4
```

The `-vf` filter chain handles images of different sizes: scale to fit 1920x1080 while preserving aspect ratio, then pad with black bars if needed. Every photo becomes a 2.5-second frame at 30fps.

Extract a poster frame (the still image shown before the video plays):

```bash
ffmpeg -i fra-montage.mp4 -vframes 1 -q:v 2 public/images/video-poster.jpg
```

The video player component:

```tsx
<video
  controls
  preload="metadata"
  poster={`${import.meta.env.BASE_URL}images/video-poster.jpg`}
  className="w-full aspect-video bg-black rounded-xl shadow-lg"
>
  <source
    src={`${import.meta.env.BASE_URL}fra-montage.mp4`}
    type="video/mp4"
  />
</video>
```

`import.meta.env.BASE_URL` is critical for GitHub Pages — it resolves to the repo subpath (`/fra-demo/`) so asset URLs work correctly.

## Deploying to GitHub Pages

GitHub Pages gives you a free public URL with HTTPS — perfect for demos. The `gh-pages` package handles the deploy workflow:

```bash
npm install -D gh-pages
```

Configure `vite.config.ts` with the repo base path:

```typescript
export default defineConfig({
  base: '/fra-demo/',
  plugins: [react()],
});
```

Add the deploy script to `package.json`:

```json
{
  "scripts": {
    "deploy": "npm run build && gh-pages -d dist"
  }
}
```

Deploy:

```bash
$ npm run deploy
Published
```

Live in under 30 seconds at `https://stankydanko.github.io/fra-demo`.

For a more professional URL, the same static files also run on a VPS at `fra-demo.southernsky.cloud` — an nginx container on port 4005 behind a Caddy reverse proxy with automatic HTTPS.

## Large Files and GitHub

The montage video was 73MB — below GitHub's 100MB hard limit but above the 50MB warning threshold. It pushed successfully, but for larger videos you'd need Git LFS or host the video externally (S3, Cloudflare R2) and link to it.

```bash
$ git push origin main
remote: warning: File public/fra-montage.mp4 is 73.07 MB;
  this is larger than GitHub's recommended maximum file size of 50.00 MB
```

For demo projects where the video is the whole point, pushing it directly is fine. For production, host media assets separately.

## What You Learned

- `import.meta.glob` in Vite auto-discovers files at build time — add images to a folder instead of maintaining import lists
- `ffmpeg -f concat` turns a list of images into a slideshow video with one command
- GitHub Pages deploys any static build for free via `gh-pages -d dist`
- Vite's `base` config must match the GitHub repo name for asset paths to resolve
- `preload="metadata"` on `<video>` loads just the duration and poster, not the full file
