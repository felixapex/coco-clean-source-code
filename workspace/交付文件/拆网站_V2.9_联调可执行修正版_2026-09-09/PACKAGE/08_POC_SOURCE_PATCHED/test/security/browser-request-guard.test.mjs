import test from 'node:test';
import assert from 'node:assert/strict';
import { installBrowserRequestGuard } from '../../src/security/browser-request-guard.mjs';

class FakeClient {
  constructor() { this.handlers = new Map(); this.commands = []; }
  async send(method, params = {}) { this.commands.push({ method, params }); return {}; }
  onEvent(method, handler) { this.handlers.set(method, handler); return () => this.handlers.delete(method); }
  async emit(method, params) { await this.handlers.get(method)?.(params); }
}

const resolver = async (hostname) => {
  if (hostname === 'safe.example') return [{ address: '93.184.216.34', family: 4 }];
  if (hostname === 'internal.example') return [{ address: '127.0.0.1', family: 4 }];
  throw new Error(`unexpected host ${hostname}`);
};

test('browser request guard continues public requests and fails requests resolving to private addresses', async () => {
  const client = new FakeClient();
  const guard = await installBrowserRequestGuard(client, { resolver });
  await client.emit('Fetch.requestPaused', { requestId: 'safe-1', request: { url: 'https://safe.example/app.js', method: 'GET' }, resourceType: 'Script' });
  await client.emit('Fetch.requestPaused', { requestId: 'private-1', request: { url: 'https://internal.example/admin', method: 'GET' }, resourceType: 'Document' });

  assert.ok(client.commands.some((c) => c.method === 'Fetch.continueRequest' && c.params.requestId === 'safe-1'));
  assert.ok(client.commands.some((c) => c.method === 'Fetch.failRequest' && c.params.requestId === 'private-1'));
  assert.equal(guard.stats.allowed.length, 1);
  assert.equal(guard.stats.blocked.length, 1);
  assert.match(guard.stats.blocked[0].reason, /Blocked address 127\.0\.0\.1/);
  await guard.close();
  assert.ok(client.commands.some((c) => c.method === 'Fetch.disable'));
});

test('browser request guard blocks unsupported schemes and credential-bearing URLs without DNS', async () => {
  const client = new FakeClient();
  const guard = await installBrowserRequestGuard(client, { resolver });
  await client.emit('Fetch.requestPaused', { requestId: 'bad-scheme', request: { url: 'file:///etc/passwd', method: 'GET' } });
  await client.emit('Fetch.requestPaused', { requestId: 'creds', request: { url: 'https://user:pass@safe.example/private', method: 'GET' } });
  assert.equal(guard.stats.blocked.length, 2);
  assert.ok(client.commands.filter((c) => c.method === 'Fetch.failRequest').length >= 2);
  await guard.close();
});
