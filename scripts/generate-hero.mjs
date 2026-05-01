#!/usr/bin/env node
// generate-hero.mjs — Generate branded hero images for blog posts via Grok Imagine
//
// Usage:
//   node scripts/generate-hero.mjs <slug>                    # Single post
//   node scripts/generate-hero.mjs --all                     # All posts missing images
//   node scripts/generate-hero.mjs --all --force             # Regenerate all
//   node scripts/generate-hero.mjs <slug> --subject "desc"   # Override AI-generated subject

import { execSync } from 'child_process';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { resolve, basename } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const POSTS_DIR = resolve(ROOT, 'src/content/posts');
const IMAGES_DIR = resolve(ROOT, 'public/images/posts');
const GROK = resolve(process.env.HOME, 'tools/ai-scripts/grok-image.mjs');

const BRAND_STYLE = [
  'Dark tech illustration on deep slate #0f172a background,',
  'blue (#3b82f6) and green (#22c55e) neon accent lighting,',
  'cinematic volumetric rays, minimal clean composition,',
  'no text, no words, no letters, no watermarks,',
  'wide 16:9 landscape aspect ratio.'
].join(' ');

function findAllPosts() {
  const posts = [];
  for (const tier of ['foundations', 'applied', 'professional']) {
    const dir = resolve(POSTS_DIR, tier);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter(f => f.endsWith('.md'))) {
      const slug = basename(file, '.md');
      const content = readFileSync(resolve(dir, file), 'utf8');
      const titleMatch = content.match(/^title:\s*"(.+)"/m);
      const descMatch = content.match(/^description:\s*"(.+)"/m);
      posts.push({
        slug,
        tier,
        title: titleMatch ? titleMatch[1] : slug,
        description: descMatch ? descMatch[1] : '',
        hasImage: existsSync(resolve(IMAGES_DIR, `${slug}.webp`)),
      });
    }
  }
  return posts;
}

function titleToSubject(title, description) {
  const combined = `${title}. ${description}`.toLowerCase();
  const subjects = [];

  if (combined.includes('bash') || combined.includes('script') || combined.includes('terminal') || combined.includes('command'))
    subjects.push('glowing terminal window with scrolling code');
  if (combined.includes('container') || combined.includes('docker') || combined.includes('podman'))
    subjects.push('translucent container boxes with layered architecture');
  if (combined.includes('git') || combined.includes('version control'))
    subjects.push('branching tree graph of connected glowing nodes');
  if (combined.includes('audio') || combined.includes('hear') || combined.includes('sound') || combined.includes('spectrogram'))
    subjects.push('audio waveform transforming into colorful spectrogram');
  if (combined.includes('database') || combined.includes('sql') || combined.includes('sqlite'))
    subjects.push('organized grid of glowing data rows and columns');
  if (combined.includes('deploy') || combined.includes('internet') || combined.includes('hosting'))
    subjects.push('laptop connected by fiber lines through nodes to server rack');
  if (combined.includes('api') || combined.includes('rest') || combined.includes('endpoint'))
    subjects.push('two systems connected by glowing bridge with data packets');
  if (combined.includes('encrypt') || combined.includes('security') || combined.includes('credential') || combined.includes('vault'))
    subjects.push('padlock made of code with cryptographic key rays');
  if (combined.includes('network') || combined.includes('router') || combined.includes('ip'))
    subjects.push('network topology with radiating connections from central router');
  if (combined.includes('ai') || combined.includes('llm') || combined.includes('chatbot') || combined.includes('neural'))
    subjects.push('neural network brain with flowing data tokens');
  if (combined.includes('game') || combined.includes('canvas') || combined.includes('browser'))
    subjects.push('retro game screen with pixel art and code editor');
  if (combined.includes('read') && combined.includes('code'))
    subjects.push('magnifying glass over illuminated source code patterns');
  if (combined.includes('gpu') || combined.includes('nvidia') || combined.includes('power'))
    subjects.push('graphics card with thermal visualization heat map');
  if (combined.includes('typing') || combined.includes('keyboard'))
    subjects.push('mechanical keyboard with AI suggestion hologram above keys');
  if (combined.includes('email') || combined.includes('gmail') || combined.includes('newsletter'))
    subjects.push('email dashboard with charts and notification streams');
  if (combined.includes('heatmap') || combined.includes('dashboard') || combined.includes('visualization'))
    subjects.push('data dashboard with gradient heatmap grid');
  if (combined.includes('migration') || combined.includes('drive') || combined.includes('storage'))
    subjects.push('data streams flowing between storage drives');
  if (combined.includes('video') || combined.includes('film') || combined.includes('scene'))
    subjects.push('filmstrip being analyzed with AI detection markers');
  if (combined.includes('signal') || combined.includes('trading') || combined.includes('decay'))
    subjects.push('decaying signal wave with time-series markers');
  if (combined.includes('search') || combined.includes('semantic') || combined.includes('vector') || combined.includes('embedding'))
    subjects.push('document archive with semantic connection lines in vector space');
  if (combined.includes('interpretab') || combined.includes('abliter'))
    subjects.push('neural network with highlighted internal pathways and scalpel');
  if (combined.includes('memory') || combined.includes('leak') || combined.includes('debug'))
    subjects.push('browser memory graph with growing leak highlighted');
  if (combined.includes('reverse proxy') || combined.includes('caddy') || combined.includes('nginx'))
    subjects.push('traffic flowing through gateway proxy shield to servers');
  if (combined.includes('stripe') || combined.includes('billing') || combined.includes('saas'))
    subjects.push('subscription payment flow diagram with tier gates');
  if (combined.includes('agent') || combined.includes('open webui'))
    subjects.push('grid of AI agent holographic portraits');
  if (combined.includes('cesium') || combined.includes('geospatial') || combined.includes('3d'))
    subjects.push('3D globe with data layer overlays and click handlers');
  if (combined.includes('zustand') || combined.includes('state'))
    subjects.push('modular state machine with connecting slice boundaries');
  if (combined.includes('proxy') && combined.includes('api'))
    subjects.push('API gateway with rate limiting shields and caching layers');
  if (combined.includes('dungeon') || combined.includes('noita'))
    subjects.push('game controller merged with AI brain over dungeon map');
  if (combined.includes('face') || combined.includes('recognition'))
    subjects.push('face detection grid with bounding boxes and privacy blur');
  if (combined.includes('backup') || combined.includes('rsync'))
    subjects.push('tiered backup architecture with drive and cloud connections');
  if (combined.includes('demo') || combined.includes('school') || combined.includes('fra'))
    subjects.push('school website being rebuilt with modern code architecture');
  if (combined.includes('cairn') || combined.includes('ambient') || combined.includes('classif'))
    subjects.push('sound wave being classified into labeled categories');
  if (combined.includes('nlp') || combined.includes('command palette') || combined.includes('lens'))
    subjects.push('command palette search bar with NLP intent parsing rays');

  if (subjects.length === 0) subjects.push('abstract tech concept with circuit board patterns');

  return subjects[0];
}

function generateImage(slug, subject) {
  const prompt = `${BRAND_STYLE} ${subject}`;
  const outFile = resolve(IMAGES_DIR, `${slug}`);

  console.log(`  Generating: ${slug}`);
  console.log(`    Subject: ${subject}`);

  try {
    execSync(
      `node "${GROK}" --prompt "${prompt.replace(/"/g, '\\"')}" --out "${IMAGES_DIR}" --name "${slug}"`,
      { stdio: 'pipe', timeout: 30000 }
    );

    const ext = existsSync(`${outFile}.jpg`) ? 'jpg'
              : existsSync(`${outFile}.png`) ? 'png'
              : existsSync(`${outFile}.webp`) ? 'webp' : null;

    if (!ext) {
      console.log(`    WARN: no image file found for ${slug}`);
      return false;
    }

    if (ext !== 'webp') {
      execSync(`convert "${outFile}.${ext}" -resize 1200x630^ -gravity center -extent 1200x630 -quality 82 "${outFile}.webp"`, { stdio: 'pipe' });
      execSync(`rm "${outFile}.${ext}"`, { stdio: 'pipe' });
    } else {
      execSync(`convert "${outFile}.webp" -resize 1200x630^ -gravity center -extent 1200x630 -quality 82 "${outFile}-tmp.webp" && mv "${outFile}-tmp.webp" "${outFile}.webp"`, { stdio: 'pipe' });
    }

    // Clean up JSON sidecar
    if (existsSync(`${outFile}.json`)) execSync(`rm "${outFile}.json"`, { stdio: 'pipe' });

    console.log(`    OK: ${slug}.webp`);
    return true;
  } catch (e) {
    console.log(`    ERROR: ${e.message?.split('\n')[0]}`);
    return false;
  }
}

// ── Main ──
const args = process.argv.slice(2);
const force = args.includes('--force');
const all = args.includes('--all');
const subjectIdx = args.indexOf('--subject');
const overrideSubject = subjectIdx !== -1 ? args[subjectIdx + 1] : null;

if (args.includes('--help') || (!all && args.filter(a => !a.startsWith('--')).length === 0)) {
  console.log(`
generate-hero.mjs — Branded hero image generator for SouthernSky Blog

  node scripts/generate-hero.mjs <slug>                    Single post
  node scripts/generate-hero.mjs --all                     All missing images
  node scripts/generate-hero.mjs --all --force             Regenerate everything
  node scripts/generate-hero.mjs <slug> --subject "desc"   Custom subject override
`);
  process.exit(0);
}

const posts = findAllPosts();

if (all) {
  const targets = force ? posts : posts.filter(p => !p.hasImage);
  console.log(`\nGenerating ${targets.length} hero images...\n`);
  let ok = 0, fail = 0;
  for (const post of targets) {
    const subject = titleToSubject(post.title, post.description);
    if (generateImage(post.slug, subject)) ok++;
    else fail++;
  }
  console.log(`\nDone: ${ok} generated, ${fail} failed out of ${targets.length} total.`);
} else {
  const slug = args.find(a => !a.startsWith('--'));
  const post = posts.find(p => p.slug === slug);
  if (!post) {
    console.error(`Post "${slug}" not found. Available: ${posts.map(p => p.slug).join(', ')}`);
    process.exit(1);
  }
  const subject = overrideSubject || titleToSubject(post.title, post.description);
  if (!force && post.hasImage) {
    console.log(`${slug}.webp already exists. Use --force to regenerate.`);
    process.exit(0);
  }
  generateImage(post.slug, subject);
}
