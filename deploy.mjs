#!/usr/bin/env node
// ── deploy.mjs — SouthernSky Blog Deployment Pipeline ──
// Usage:
//   node deploy.mjs              Build + ship + deploy to production
//   node deploy.mjs --status     Show what's running on the server
//   node deploy.mjs --build-only Build the image locally without deploying
//   node deploy.mjs --logs       Tail the last 50 lines of server logs
//   node deploy.mjs --restart    Restart the container without rebuilding
//   node deploy.mjs --shell      Open an SSH session to the server

import { execSync } from 'child_process';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

const SERVER = {
  host: 'jmartin@104.243.45.247',
  port: 4006,
  container: 'southernsky-blog',
  imageName: 'localhost/southernsky-blog:latest',
  tmpImage: '/tmp/southernsky-blog.tar.gz',
  healthUrl: 'https://blog.southernsky.cloud',
};

function run(cmd, opts = {}) {
  const { silent = false, allowFail = false, timeout = 120_000 } = opts;
  try {
    const result = execSync(cmd, {
      cwd: ROOT,
      timeout,
      stdio: silent ? 'pipe' : 'inherit',
      encoding: 'utf-8',
    });
    return (result || '').trim();
  } catch (e) {
    if (allowFail) return '';
    throw e;
  }
}

function ssh(cmd, opts = {}) {
  const escaped = cmd.replace(/'/g, "'\\''");
  return run(`ssh ${SERVER.host} "sg docker -c '${escaped}'"`, opts);
}

function step(label) {
  console.log(`\n\x1b[36m── ${label} ──\x1b[0m`);
}

const flag = process.argv[2];

if (flag === '--status') {
  step('Server Status');
  ssh(`docker ps --filter name=${SERVER.container} --format 'table {{.Status}}\t{{.Ports}}'`);
  process.exit(0);
}

if (flag === '--logs') {
  step('Server Logs');
  ssh(`docker logs --tail 50 ${SERVER.container}`);
  process.exit(0);
}

if (flag === '--restart') {
  step('Restarting Container');
  ssh(`docker restart ${SERVER.container}`);
  process.exit(0);
}

if (flag === '--shell') {
  step('Opening SSH');
  run(`ssh ${SERVER.host}`, { timeout: 0 });
  process.exit(0);
}

// ── Full Deploy ──
step('1/5 Building Astro site');
run('npm run build');

step('2/5 Building container image');
run(`podman build -t ${SERVER.imageName} .`);

if (flag === '--build-only') {
  console.log('\n✅ Image built. Skipping deploy.');
  process.exit(0);
}

step('3/5 Exporting image');
run(`podman save ${SERVER.imageName} | gzip > ${SERVER.tmpImage}`);

step('4/5 Shipping to server');
run(`scp ${SERVER.tmpImage} ${SERVER.host}:/tmp/`);

step('5/5 Loading and launching on server');
ssh(`gunzip -c ${SERVER.tmpImage} | docker load`);
ssh(`docker stop ${SERVER.container} 2>/dev/null; docker rm ${SERVER.container} 2>/dev/null; echo ok`);
ssh(`docker run -d --name ${SERVER.container} --restart unless-stopped -p ${SERVER.port}:3000 ${SERVER.imageName}`);

step('Health Check');
run(`sleep 3 && curl -s -o /dev/null -w "%{http_code}" ${SERVER.healthUrl}`, { allowFail: true });

console.log(`\n✅ Deployed to ${SERVER.healthUrl}`);
