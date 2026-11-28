import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const projectRoot = path.resolve(import.meta.dirname, '..');
const port = 4207;

async function waitFor(fn, timeout = 10000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try { return await fn(); } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError ?? new Error('Timed out');
}

test('server reloads replay route manifest after build without requiring a restart', async (t) => {
  const fixture = await fs.mkdtemp(path.join(projectRoot, '.test-route-refresh-'));
  const replay = path.join(fixture, 'dist', 'replay');
  await fs.mkdir(replay, { recursive: true });
  await fs.writeFile(path.join(fixture, 'dist', 'index.html'), '<p>fallback</p>', 'utf8');
  await fs.writeFile(path.join(replay, 'home.html'), '<p>home</p>', 'utf8');
  await fs.writeFile(path.join(replay, 'routes.json'), JSON.stringify({ '/': 'home.html' }), 'utf8');
  await fs.writeFile(path.join(replay, 'home-mobile.html'), '<p>mobile home</p>', 'utf8');
  await fs.writeFile(path.join(fixture, 'dist', 'shared.css'), 'body{margin:0}', 'utf8');
  await fs.writeFile(path.join(replay, 'routes-mobile.json'), JSON.stringify({ '/': 'home-mobile.html' }), 'utf8');
  const server = spawn(process.execPath, [path.join(projectRoot, 'scripts', 'serve.mjs'), '--port', String(port)], { cwd: fixture, stdio: 'pipe' });
  t.after(async () => {
    if (server.exitCode === null) server.kill();
    await fs.rm(fixture, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  });
  await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(response.status, 200);
  });
  const missingBeforeBuild = await fetch(`http://127.0.0.1:${port}/new-route`);
  assert.equal(missingBeforeBuild.status, 404);
  assert.equal(await missingBeforeBuild.text(), 'Not Found');
  assert.equal(await (await fetch(`http://127.0.0.1:${port}/?matbox-viewport=mobile`)).text(), '<p>mobile home</p>');
  assert.equal((await fetch(`http://127.0.0.1:${port}/`)).headers.get('cache-control'), 'no-store');
  assert.match((await fetch(`http://127.0.0.1:${port}/shared.css`)).headers.get('cache-control'), /immutable/);
  await fs.writeFile(path.join(replay, 'new-route.html'), '<p>new replay route</p>', 'utf8');
  await fs.writeFile(path.join(replay, 'routes.json'), JSON.stringify({ '/': 'home.html', '/new-route': 'new-route.html' }), 'utf8');
  await waitFor(async () => {
    assert.equal(await (await fetch(`http://127.0.0.1:${port}/new-route`)).text(), '<p>new replay route</p>');
  });
  assert.equal(await (await fetch(`http://127.0.0.1:${port}/new-route/`)).text(), '<p>new replay route</p>');
});

test('server resolves captured search states by pathname and query before the pathname fallback', async (t) => {
  const fixture = await fs.mkdtemp(path.join(projectRoot, '.test-search-state-'));
  const replay = path.join(fixture, 'dist', 'replay');
  await fs.mkdir(replay, { recursive: true });
  await fs.writeFile(path.join(fixture, 'dist', 'index.html'), '<p>fallback</p>', 'utf8');
  await fs.writeFile(path.join(replay, 'search-aster.html'), '<p>Aster results</p>', 'utf8');
  await fs.writeFile(path.join(replay, 'search-camden.html'), '<p>Camden results</p>', 'utf8');
  await fs.writeFile(path.join(replay, 'routes.json'), JSON.stringify({
    '/search.php?search_query=aster': 'search-aster.html',
    '/search.php?search_query=camden': 'search-camden.html',
  }), 'utf8');
  const queryPort = port + 1;
  const server = spawn(process.execPath, [path.join(projectRoot, 'scripts', 'serve.mjs'), '--port', String(queryPort)], { cwd: fixture, stdio: 'pipe' });
  t.after(async () => {
    if (server.exitCode === null) server.kill();
    await fs.rm(fixture, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  });
  await waitFor(async () => assert.equal((await fetch(`http://127.0.0.1:${queryPort}/search.php?search_query=aster`)).status, 200));
  assert.equal(await (await fetch(`http://127.0.0.1:${queryPort}/search.php?search_query=aster`)).text(), '<p>Aster results</p>');
  assert.equal(await (await fetch(`http://127.0.0.1:${queryPort}/search.php?search_query=camden`)).text(), '<p>Camden results</p>');
  assert.equal(
    await (await fetch(`http://127.0.0.1:${queryPort}/search.php?search_query=aster&responsive-audit=390&matbox-viewport=mobile`)).text(),
    '<p>Aster results</p>',
  );
});
