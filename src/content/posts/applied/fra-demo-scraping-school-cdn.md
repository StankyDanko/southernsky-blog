---
title: "Scraping a School's CDN for Real Photos — FRA Demo Build"
description: "I needed real photos from a school's website for a demo project. Here's how I found their CDN, downloaded the images, and built a professional showcase."
publishDate: 2026-04-29
author: j-martin
tier: applied
postType: project-walkthrough
difficulty: intermediate
estimatedMinutes: 14
prerequisites: []
category: web-development
tags: ["web-scraping", "react", "vite", "cdn", "github-pages", "demo"]
certTracks: []
featured: false
draft: false
---

## Why Should You Care?

Demo projects die on placeholder images. "Image 1", grey boxes, and Unsplash stock photos all send the same signal: this isn't the real thing. When you're building a showcase for someone — a school, a business, a nonprofit — using their actual photos changes how seriously they take the demo.

This is the story of building the FRA Demo: a rebuilt website for a private school in Georgia. The project needed real campus photos, real program information, and real visual identity — not Lorem ipsum and placeholder avatars.

## The Project Context

Franklin Road Academy (FRA) is a small private school in Woodbury, GA. A contact was applying for a teaching position there and wanted a web portfolio that showed what a modern version of their website could look like. The school's existing site wasn't winning any design awards.

The goal: build a professional demo site using the school's real content and photos, deploy it publicly, and make it something the contact could point to in an application conversation. No backend required — just a polished React frontend deployed to GitHub Pages.

## Step 1: Finding the CDN Through DevTools

Schools, nonprofits, and small businesses often use website builders — Squarespace, Wix, WordPress — that host assets on a CDN. The builder handles the CMS; the CDN serves the images. This CDN URL is public. It has to be — your browser has to download those images.

Open the school's existing website in Chrome. Open DevTools with `F12`, click the **Network** tab, then reload the page. Filter by `Img`:

The images load from a URL pattern like:

```
https://images.squarespace-cdn.com/content/v1/<site-id>/
```

Every image on the site comes from this base URL. Click any image request to see the full URL, including the path and filename. Right-click the request → **Copy** → **Copy URL**.

Now you have the CDN base. The question is: what else is in there?

## Step 2: Enumerating Available Images

Squarespace CDN paths follow a predictable structure. The image URL usually looks like:

```
https://images.squarespace-cdn.com/content/v1/<site-id>/<folder>/<filename>
```

You can't list the CDN directory (no directory indexing), but you can find all referenced images by parsing the page HTML. Download the page source:

```bash
curl -s "https://www.fra-school.org" -o fra-homepage.html
curl -s "https://www.fra-school.org/about" -o fra-about.html
curl -s "https://www.fra-school.org/athletics" -o fra-athletics.html
# ... and a few more pages
```

Extract all image URLs from the HTML:

```bash
grep -oP 'https://images\.squarespace-cdn\.com[^"'\'')\s]+' fra-*.html \
  | sort -u \
  > image-urls.txt

wc -l image-urls.txt
```

```
127 image-urls.txt
```

127 unique image URLs across the pages you scraped. That's a solid catalog to work with.

## Step 3: Downloading the Images

With the URL list in hand, use `wget` in batch mode. The `--content-disposition` flag tells wget to use the server's suggested filename rather than making one up:

```bash
mkdir -p fra-images/

wget \
  --input-file=image-urls.txt \
  --directory-prefix=fra-images/ \
  --content-disposition \
  --no-clobber \
  --wait=0.5 \
  --random-wait \
  2>&1 | tee wget-log.txt
```

The `--wait=0.5 --random-wait` flags add a half-second average delay between requests. This is polite scraping — you're not hammering their CDN, and you're less likely to trigger rate limiting or IP blocks. It's worth doing even for a small batch.

After the download:

```bash
ls fra-images/ | wc -l
```

```
82
```

82 images downloaded. Some of the 127 URLs were duplicates with different query strings (CDN image transforms like `?format=1500w`). After deduplication, you have 82 unique source images.

## Step 4: Curating What's Actually Useful

Not all 82 images are usable. CDN scrapes often include:

- Tiny icons (16x16, 32x32) used for favicon or nav decorations
- Sponsor logos in unusual aspect ratios
- Social sharing images that look bad cropped
- Staff headshots that require consent consideration before use in a demo

Do a quick audit in a file browser. Delete anything that won't display well in a photo gallery. I ended up with about 45 high-quality campus and athletics photos.

Sort them into folders:

```bash
mkdir -p fra-images/{campus,athletics,academics,events}
# Manually sort — 45 images takes about 10 minutes
```

Rename them predictably:

```bash
cd fra-images/campus
ls *.jpg | nl -v 0 | while read n file; do
  mv "$file" "campus-$(printf '%02d' $n).jpg"
done
```

Now you have `campus-00.jpg` through `campus-12.jpg`. Predictable names make importing into the React component clean.

## Step 5: The React + Vite Site

The demo site is a single-page React app. The photo gallery is the centerpiece, but it also includes sections for academics, athletics, and an about page — all using real copy from the school's existing site.

Project setup:

```bash
npm create vite@latest fra-demo -- --template react-ts
cd fra-demo
npm install
npm install -D tailwindcss @tailwindcss/typography
```

The image gallery component:

```tsx
// src/components/PhotoGallery.tsx
import { useState } from 'react';

// Import images statically so Vite includes them in the build
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
            className="aspect-square overflow-hidden rounded-lg hover:opacity-90 transition-opacity"
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
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50"
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

`import.meta.glob` is a Vite-specific feature. It generates a module map of all files matching the glob pattern at build time. `eager: true` means they're bundled directly into the chunk rather than lazy-loaded as separate modules. For a gallery of 45 images, lazy loading the module metadata (not the images themselves) isn't necessary — but `loading="lazy"` on the `<img>` tags still defers the actual image fetches.

## Step 6: The Video Montage

The FRA project also included a 94-second highlight montage assembled from photos. The montage was built with ffmpeg using a slideshow technique:

```bash
# Generate a file list with duration per image
for img in fra-images/athletics/*.jpg; do
  echo "file '$img'"
  echo "duration 2.5"
done > slideshow.txt

# Build the video
ffmpeg \
  -f concat \
  -safe 0 \
  -i slideshow.txt \
  -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2" \
  -c:v libx264 \
  -pix_fmt yuv420p \
  -r 30 \
  fra-montage.mp4
```

The video embeds in the React site with a poster frame (a still image shown before the video plays):

```tsx
<video
  controls
  poster="/fra-poster.jpg"
  className="w-full rounded-xl shadow-lg"
>
  <source src="/fra-montage.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>
```

The poster frame is the first image from the montage, exported separately:

```bash
ffmpeg -i fra-montage.mp4 -vframes 1 -q:v 2 fra-poster.jpg
```

## Step 7: Deploying to GitHub Pages

GitHub Pages is the right choice for a demo that needs a public URL with no backend. The `gh-pages` npm package handles the deploy:

```bash
npm install -D gh-pages
```

Add to `package.json`:

```json
{
  "scripts": {
    "build": "vite build",
    "deploy": "npm run build && gh-pages -d dist"
  },
  "homepage": "https://stankydanko.github.io/fra-demo"
}
```

Update `vite.config.ts` with the base path:

```typescript
export default defineConfig({
  base: '/fra-demo/',
  // ...
});
```

Deploy:

```bash
npm run deploy
```

```
Published
```

The site is live at `https://stankydanko.github.io/fra-demo` within about 30 seconds.

The VPS also hosts it at `fra-demo.southernsky.cloud` on port 4005 for a more professional URL to share — same static files, served by an nginx container.

## Ethics of Using Publicly Available Images

This comes up whenever you scrape images from an existing site, so it's worth addressing directly.

What makes this acceptable:
- Every image was already publicly accessible — no authentication, no scraping around a login wall
- The use is non-commercial: a portfolio demo, not a competing product
- The content was used to showcase the school positively, not to misrepresent or harm
- No staff personal information or student-identifiable photos were used in the public demo

What to be thoughtful about:
- Staff headshots imply consent for use in the school's own context, not in a third-party demo. Use only campus and facilities photos if there's any question
- If this were a commercial project, you'd need explicit permission or a licensing arrangement
- If the school asked you to take it down, you would

The standard for demo/portfolio use of publicly available institutional photos is similar to the press fair use standard: transformative (you built something new), non-commercial, and not harming the original creator's market. The demo drove positive attention to the school — the net effect was promotional, not extractive.

## What You Learned

- Browser DevTools Network tab → filter by Img → reveals CDN base URLs for any public website
- `grep -oP` with a URL pattern extracts all image references from downloaded HTML in one command
- `wget --input-file` with `--wait` and `--random-wait` handles batch downloads politely
- `import.meta.glob` in Vite generates a compile-time module map from a file glob — cleaner than maintaining a manual import list for large image sets
- `gh-pages -d dist` deploys any Vite build to GitHub Pages in one command; the `base` config in `vite.config.ts` must match the repository name
