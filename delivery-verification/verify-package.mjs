import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createVerificationPlan, verifyManifest } from './package-integrity.mjs';
import { verifyCleanPublishedSite } from './clean-publish-gate.mjs';

const packageRoot = path.resolve(import.meta.dirname, '..');
const siteRoot = path.join(packageRoot, 'site');
const runtime = path.join(packageRoot, 'runtime', 'node.exe');
const serverScript = path.join(packageRoot, 'server', 'serve.mjs');
const rounds = 5;
const skipManifest = process.argv.includes('--skip-manifest');

const routes = Object.keys(JSON.parse(await fs.readFile(path.join(siteRoot, 'replay', 'routes.json'), 'utf8')));

async function collectImages(directory) {
  const output = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await collectImages(full));
    else if (/\.(png|jpe?g|webp|gif|svg|avif)$/i.test(entry.name)) output.push(full);
  }
  return output;
}

const images = (await collectImages(siteRoot)).sort();

async function waitUntilReady(origin) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`server did not become ready: ${origin}`);
}

async function checkUrl(url, headers = {}, method = 'GET') {
  const response = await fetch(url, { headers, method });
  const bytes = method === 'HEAD'
    ? Number(response.headers.get('content-length') || 0)
    : (await response.arrayBuffer()).byteLength;
  if (!response.ok || bytes === 0) throw new Error(`${response.status} ${bytes}B ${url}`);
  return bytes;
}

async function checkMany(items, worker, concurrency = 12) {
  const failures = [];
  let index = 0;
  async function run() {
    while (index < items.length) {
      const current = items[index++];
      try { await worker(current); } catch (error) { failures.push(String(error)); }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, run));
  if (failures.length) throw new Error(failures.slice(0, 20).join('\n'));
}

const report = {
  generatedAt: new Date().toISOString(),
  packageRoot,
  expectedRounds: rounds,
  routeCount: routes.length,
  imageCount: images.length,
  rounds: [],
  pass: false
};

report.integrity = skipManifest ? { skippedForPackaging: true } : await verifyManifest(packageRoot);
report.cleanPublish = await verifyCleanPublishedSite(siteRoot);
if (!report.cleanPublish.pass) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
}
const verificationPlan = createVerificationPlan({ routeCount: routes.length, imageCount: images.length, rounds });

for (const expected of verificationPlan) {
  const { round } = expected;
  const startedAt = Date.now();
  const port = 4300 + round;
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(runtime, [serverScript, '--port', String(port)], {
    cwd: packageRoot,
    windowsHide: true,
    stdio: 'ignore'
  });
  try {
    await waitUntilReady(origin);
    await checkMany(routes, route => checkUrl(`${origin}${route}`));
    await checkMany(routes, route => checkUrl(`${origin}${route}${route.includes('?') ? '&' : '?'}matbox-viewport=mobile`, {
      'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile'
    }));
    await checkMany(images, image => {
      const relative = path.relative(siteRoot, image).split(path.sep).map(encodeURIComponent).join('/');
      return checkUrl(`${origin}/${relative}`, {}, 'HEAD');
    }, 24);
    report.rounds.push({
      round,
      pass: true,
      desktopRoutesChecked: expected.desktopRoutesChecked,
      mobileRoutesChecked: expected.mobileRoutesChecked,
      imagesChecked: expected.imagesChecked,
      durationMs: Date.now() - startedAt
    });
  } catch (error) {
    report.rounds.push({ round, pass: false, error: String(error), durationMs: Date.now() - startedAt });
    child.kill();
    process.exitCode = 1;
    break;
  } finally {
    child.kill();
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

report.pass = report.cleanPublish.pass && report.rounds.length === rounds && report.rounds.every(round => round.pass);
console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exitCode = 1;
