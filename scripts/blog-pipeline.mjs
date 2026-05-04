#!/usr/bin/env node
// blog-pipeline.mjs — End-to-end blog post creation pipeline
//
// Usage:
//   node scripts/blog-pipeline.mjs "Build a personal AI research pipeline"
//   node scripts/blog-pipeline.mjs "Build a research pipeline" --tier applied --category ai-ml
//   node scripts/blog-pipeline.mjs "Build a research pipeline" --slug ai-research-pipeline
//   node scripts/blog-pipeline.mjs "Build a research pipeline" --no-animate  # skip animation
//   node scripts/blog-pipeline.mjs "Build a research pipeline" --no-deploy   # skip deploy
//   node scripts/blog-pipeline.mjs "Build a research pipeline" --dry-run     # writer only, draft:true
//
// Pipeline stages:
//   1. Blog Writer agent   → generates markdown with frontmatter
//   2. Blog Polish agent   → reputation/tone/influence review
//   3. Hero image + animation → Grok Imagine + id8 I2V
//   4. Sanitization sweep  → grep for leaked PII
//   5. Build validation    → npm run build (Zod + Astro)
//   6. Deploy to VPS       → node deploy.mjs

import { execSync, spawnSync } from 'child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const POSTS_DIR = resolve(ROOT, 'src/content/posts');
const AGENTS_DIR = resolve(process.env.HOME, '.claude/agents');

const args = process.argv.slice(2);
const flags = args.filter(a => a.startsWith('--'));
const positional = args.filter(a => !a.startsWith('--') && !isArgValue(args, a));

function isArgValue(allArgs, val) {
  const idx = allArgs.indexOf(val);
  if (idx <= 0) return false;
  const prev = allArgs[idx - 1];
  return ['--tier', '--category', '--slug', '--type', '--difficulty'].includes(prev);
}

const topic = positional[0];
if (!topic) {
  console.log(`
Usage: node scripts/blog-pipeline.mjs "<topic description>" [options]

Options:
  --tier <foundations|applied|professional>  Content tier (default: applied)
  --category <category>                     Post category (default: auto-detected)
  --slug <slug>                             Override slug (default: auto-generated)
  --type <postType>                         Post type (default: project-walkthrough)
  --difficulty <level>                      Difficulty (default: intermediate)
  --no-animate                              Skip hero animation (static image only)
  --no-deploy                               Skip deployment to VPS
  --dry-run                                 Writer only, sets draft:true, no deploy

Example:
  node scripts/blog-pipeline.mjs "Setting up Tailscale mesh networking for a home lab"
  node scripts/blog-pipeline.mjs "SQLite FTS5 full-text search" --tier applied --category ai-ml
`);
  process.exit(0);
}

function getFlag(name, fallback) {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

const tier = getFlag('--tier', 'applied');
const category = getFlag('--category', '');
const slug = getFlag('--slug', '');
const postType = getFlag('--type', 'project-walkthrough');
const difficulty = getFlag('--difficulty', 'intermediate');
const noAnimate = flags.includes('--no-animate');
const noDeploy = flags.includes('--no-deploy');
const dryRun = flags.includes('--dry-run');

const today = new Date().toISOString().slice(0, 10);

function stage(num, total, label) {
  console.log(`\n\x1b[36m── ${num}/${total} ${label} ──\x1b[0m\n`);
}

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: 'inherit', timeout: 600000, ...opts });
  } catch (e) {
    if (opts.allowFail) return null;
    console.error(`\x1b[31mFailed:\x1b[0m ${e.message}`);
    process.exit(1);
  }
}

function findPost(slugHint) {
  for (const t of ['foundations', 'applied', 'professional']) {
    const dir = resolve(POSTS_DIR, t);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (slugHint && f === `${slugHint}.md`) return resolve(dir, f);
      if (!slugHint && f.endsWith('.md')) {
        const content = readFileSync(resolve(dir, f), 'utf-8');
        if (content.includes(topic.slice(0, 40))) return resolve(dir, f);
      }
    }
  }
  return null;
}

function extractSlug(filePath) {
  return filePath.replace(/.*\//, '').replace(/\.md$/, '');
}

const SANITIZATION_CHECKS = [
  { pattern: '104\\.243\\.', label: 'Real server IPs' },
  { pattern: '100\\.117\\.\\|100\\.73\\.', label: 'Tailscale IPs' },
  { pattern: '-i "\\bZeus\\b\\|\\bHera\\b\\|\\bAtlas\\b\\|\\bArtemis\\b\\|\\bAres\\b"', label: 'Machine names' },
  { pattern: '/home/danko', label: 'Real home directory' },
  { pattern: '\\.env-ai-keys', label: 'Credential file paths' },
  { pattern: '-i tailscale', label: 'Tailscale references' },
  { pattern: '/mnt/sandisk\\|/mnt/onyx', label: 'Real mount paths' },
];

// ── Pipeline ──

const totalStages = dryRun ? 2 : (noDeploy ? 5 : 6);

// Stage 1: Blog Writer
stage(1, totalStages, 'Blog Writer Agent');

const writerPrompt = [
  `Write a blog post about: ${topic}`,
  `Tier: ${tier}. Post type: ${postType}. Difficulty: ${difficulty}.`,
  `Publish date: ${today}.`,
  category ? `Category: ${category}.` : '',
  slug ? `Slug: ${slug}.` : '',
  dryRun ? 'Set draft: true.' : 'Set draft: false.',
  'Research the actual codebase for real code patterns.',
  'Save the file to the correct posts directory.',
  'Run npm run check after writing.',
].filter(Boolean).join(' ');

run(`claude -p --agent blog-writer --dangerously-skip-permissions --max-budget-usd 1.00 "${writerPrompt.replace(/"/g, '\\"')}"`, {
  cwd: ROOT,
  stdio: ['pipe', 'pipe', 'inherit'],
});

// Find the written post
let postPath = slug ? findPost(slug) : null;
if (!postPath) {
  // Search all tiers for the most recently modified post
  const allPosts = [];
  for (const t of ['foundations', 'applied', 'professional']) {
    const dir = resolve(POSTS_DIR, t);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.md')) continue;
      const p = resolve(dir, f);
      const stat = execSync(`stat -c %Y "${p}"`, { encoding: 'utf-8' }).trim();
      allPosts.push({ path: p, mtime: parseInt(stat) });
    }
  }
  allPosts.sort((a, b) => b.mtime - a.mtime);
  postPath = allPosts[0]?.path;
}

if (!postPath || !existsSync(postPath)) {
  console.error('\x1b[31mCould not find the generated post. Check Blog Writer output.\x1b[0m');
  process.exit(1);
}

const postSlug = extractSlug(postPath);
console.log(`  Post: ${postPath}`);
console.log(`  Slug: ${postSlug}`);

if (dryRun) {
  stage(2, totalStages, 'Dry Run Complete');
  console.log('  Post written in draft mode. Review and re-run without --dry-run to publish.');
  process.exit(0);
}

// Stage 2: Blog Polish
stage(2, totalStages, 'Blog Polish Agent');

const polishPrompt = `Polish the blog post at: ${postPath}. Follow your complete checklist: security/PII sanitization, reputation scan, tone calibration, influence integration, structural review. Edit the file in place. Run sanitization grep checks after.`;

run(`claude -p --agent blog-polish --dangerously-skip-permissions --max-budget-usd 0.50 "${polishPrompt.replace(/"/g, '\\"')}"`, {
  cwd: ROOT,
  stdio: ['pipe', 'pipe', 'inherit'],
});

// Stage 3: Hero Image + Animation
stage(3, totalStages, 'Hero Image Generation');

const animateFlag = noAnimate ? '' : '--animate';
run(`node scripts/generate-hero.mjs ${postSlug} ${animateFlag}`, { cwd: ROOT });

// If animation timed out, try converting completed renders
if (!noAnimate) {
  const webmPath = resolve(ROOT, 'public/images/posts', `${postSlug}.webm`);
  if (!existsSync(webmPath)) {
    console.log('  Animation still rendering, attempting convert...');
    run(`node scripts/animate-hero.mjs --convert`, { cwd: ROOT, allowFail: true });
  }
}

// Add heroImage to frontmatter if missing
const postContent = readFileSync(postPath, 'utf-8');
if (!postContent.includes('heroImage:')) {
  const updated = postContent.replace(
    /^(featured:\s*.*)$/m,
    `$1\nheroImage: "/images/posts/${postSlug}.webp"`
  );
  writeFileSync(postPath, updated);
  console.log('  Added heroImage to frontmatter');
}

// Stage 4: Sanitization Sweep
stage(4, totalStages, 'Sanitization Sweep');

let sanitizationFailed = false;
for (const check of SANITIZATION_CHECKS) {
  const result = spawnSync('grep', ['-rn', check.pattern, postPath], { encoding: 'utf-8' });
  if (result.stdout.trim()) {
    console.error(`  \x1b[31mFAIL:\x1b[0m ${check.label}`);
    console.error(`    ${result.stdout.trim()}`);
    sanitizationFailed = true;
  } else {
    console.log(`  \x1b[32mPASS:\x1b[0m ${check.label}`);
  }
}

if (sanitizationFailed) {
  console.error('\n\x1b[31mSanitization failed. Fix the issues above and re-run.\x1b[0m');
  process.exit(1);
}

// Stage 5: Build Validation
stage(5, totalStages, 'Build Validation');
run('npm run build', { cwd: ROOT });

if (noDeploy) {
  console.log('\n\x1b[32m✅ Pipeline complete (deploy skipped). Post is ready for manual deploy.\x1b[0m\n');
  process.exit(0);
}

// Stage 6: Deploy
stage(6, totalStages, 'Deploy to VPS');
run('node deploy.mjs', { cwd: ROOT });

console.log(`\n\x1b[32m✅ Published: https://blog.southernsky.cloud/blog/${tier}/${postSlug}/\x1b[0m\n`);
