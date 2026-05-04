#!/usr/bin/env node
// animate-hero.mjs — Queue I2V animation for a blog hero image via id8 pipeline
//
// Usage:
//   node scripts/animate-hero.mjs <slug>          # Queue + wait + convert single post
//   node scripts/animate-hero.mjs <slug> --queue   # Queue only (don't wait)
//   node scripts/animate-hero.mjs --status          # Show pending renders
//   node scripts/animate-hero.mjs --convert         # Convert all completed renders to WebM

import { execSync } from 'child_process';
import { existsSync, copyFileSync } from 'fs';
import { resolve, basename } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const IMAGES_DIR = resolve(ROOT, 'public/images/posts');
const ID8_DIR = resolve(process.env.HOME, 'projects/id8');
const DB_PATH = resolve(ID8_DIR, 'data/pipeline.db');
const INPUT_DIR = resolve(ID8_DIR, 'comfyui/input');
const OUTPUT_DIR = resolve(ID8_DIR, 'comfyui/output/batch');

const I2V_PROMPT = 'subtle ambient glow and gentle light pulse, soft volumetric rays slowly shifting, minimal camera movement, seamless loop, dark tech atmosphere';

function sqlite(query) {
  return execSync(`sqlite3 "${DB_PATH}" "${query.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
}

function queueAnimation(slug) {
  const heroPath = resolve(IMAGES_DIR, `${slug}.webp`);
  if (!existsSync(heroPath)) {
    console.error(`  ERROR: No hero image at ${slug}.webp — run generate-hero.mjs first`);
    return false;
  }

  const imageFile = `blog-${slug}.webp`;
  const inputPath = resolve(INPUT_DIR, imageFile);

  const existing = sqlite(`SELECT id, status FROM test_runs WHERE prompt_name = 'blog-hero' AND image_file = '${imageFile}'`);
  if (existing) {
    const [id, status] = existing.split('|');
    if (status === 'done') {
      console.log(`  SKIP: ${slug} already rendered (run #${id})`);
      return 'done';
    }
    console.log(`  EXISTS: ${slug} is ${status} (run #${id})`);
    return status;
  }

  copyFileSync(heroPath, inputPath);
  console.log(`  Copied hero to id8 input: ${imageFile}`);

  const hash = `blog-hero-${slug}`;
  sqlite(`INSERT INTO test_runs (prompt_name, prompt_text, prompt_hash, image_file, seed, status, quality, width, height, num_frames, priority) VALUES ('blog-hero', '${I2V_PROMPT}', '${hash}', '${imageFile}', 42, 'queued', 'draft', 624, 352, 73, 50)`);
  console.log(`  Queued I2V render for ${slug}`);
  return 'queued';
}

function pollUntilDone(slug, timeoutMs = 120000) {
  const imageFile = `blog-${slug}.webp`;
  const start = Date.now();
  const interval = 5000;

  process.stdout.write(`  Waiting for render`);
  while (Date.now() - start < timeoutMs) {
    const result = sqlite(`SELECT status, output_file FROM test_runs WHERE prompt_name = 'blog-hero' AND image_file = '${imageFile}' ORDER BY id DESC LIMIT 1`);
    const [status, outputFile] = result.split('|');

    if (status === 'done' && outputFile) {
      process.stdout.write(` done!\n`);
      return outputFile;
    }
    if (status === 'error') {
      process.stdout.write(` failed!\n`);
      console.error(`  ERROR: Render failed for ${slug}`);
      return null;
    }

    process.stdout.write('.');
    execSync(`sleep ${interval / 1000}`);
  }

  process.stdout.write(` timeout!\n`);
  console.error(`  TIMEOUT: Render did not complete within ${timeoutMs / 1000}s`);
  return null;
}

function convertToWebm(slug, outputFile) {
  const outputPath = resolve(OUTPUT_DIR, outputFile);
  const webmPath = resolve(IMAGES_DIR, `${slug}.webm`);

  if (!existsSync(outputPath)) {
    console.error(`  ERROR: Output file not found: ${outputFile}`);
    return false;
  }

  console.log(`  Converting to WebM...`);
  try {
    execSync(
      `ffmpeg -nostdin -y -i "${outputPath}" -c:v libvpx-vp9 -b:v 500k -crf 35 -vf "scale=1200:630:force_original_aspect_ratio=increase,crop=1200:630" -an -loop 0 "${webmPath}"`,
      { stdio: 'pipe', timeout: 60000 }
    );
    const size = execSync(`du -h "${webmPath}" | cut -f1`, { encoding: 'utf8' }).trim();
    console.log(`  OK: ${slug}.webm (${size})`);
    return true;
  } catch (e) {
    console.error(`  ERROR: ffmpeg failed — ${e.message?.split('\n')[0]}`);
    return false;
  }
}

function showStatus() {
  const rows = sqlite("SELECT image_file, status FROM test_runs WHERE prompt_name = 'blog-hero' AND status != 'done' ORDER BY id");
  if (!rows) {
    console.log('All blog-hero renders are complete.');
    return;
  }
  console.log('Pending blog-hero renders:');
  for (const row of rows.split('\n')) {
    const [file, status] = row.split('|');
    const slug = file.replace(/^blog-/, '').replace(/\.webp$/, '');
    console.log(`  ${slug}: ${status}`);
  }
}

function convertAll() {
  const rows = sqlite("SELECT image_file, output_file FROM test_runs WHERE prompt_name = 'blog-hero' AND status = 'done' AND output_file IS NOT NULL");
  if (!rows) {
    console.log('No completed renders to convert.');
    return;
  }
  let converted = 0, skipped = 0;
  for (const row of rows.split('\n')) {
    const [imageFile, outputFile] = row.split('|');
    const slug = imageFile.replace(/^blog-/, '').replace(/\.webp$/, '');
    const webmPath = resolve(IMAGES_DIR, `${slug}.webm`);
    const outputPath = resolve(OUTPUT_DIR, outputFile);

    if (existsSync(webmPath)) {
      skipped++;
      continue;
    }
    if (convertToWebm(slug, outputFile)) converted++;
  }
  console.log(`\nConverted: ${converted}, Skipped (already exist): ${skipped}`);
}

// ── Main ──
const args = process.argv.slice(2);

if (args.includes('--status')) {
  showStatus();
  process.exit(0);
}

if (args.includes('--convert')) {
  convertAll();
  process.exit(0);
}

const slug = args.find(a => !a.startsWith('--'));
const queueOnly = args.includes('--queue');

if (!slug) {
  console.log(`
animate-hero.mjs — Queue I2V animation for blog hero images

  node scripts/animate-hero.mjs <slug>          Queue + wait + convert
  node scripts/animate-hero.mjs <slug> --queue   Queue only (don't wait)
  node scripts/animate-hero.mjs --status          Show pending renders
  node scripts/animate-hero.mjs --convert         Convert all completed to WebM
`);
  process.exit(0);
}

console.log(`\nAnimating: ${slug}`);
const status = queueAnimation(slug);

if (status === false) process.exit(1);

if (status === 'done') {
  const webmPath = resolve(IMAGES_DIR, `${slug}.webm`);
  if (existsSync(webmPath)) {
    console.log(`  WebM already exists: ${slug}.webm`);
    process.exit(0);
  }
  const outputFile = sqlite(`SELECT output_file FROM test_runs WHERE prompt_name = 'blog-hero' AND image_file = 'blog-${slug}.webp' AND status = 'done' ORDER BY id DESC LIMIT 1`);
  if (outputFile) convertToWebm(slug, outputFile);
  process.exit(0);
}

if (queueOnly) {
  console.log('  Queued. Run --convert after render completes.');
  process.exit(0);
}

const outputFile = pollUntilDone(slug);
if (outputFile) {
  convertToWebm(slug, outputFile);
}
