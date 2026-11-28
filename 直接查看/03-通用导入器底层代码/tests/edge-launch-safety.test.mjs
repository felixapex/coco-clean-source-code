import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const requiredBrowserEntrypoints = ['../scripts/audit-localization.mjs', '../scripts/audit-responsive-layout.mjs'];
const optionalBrowserEntrypoints = ['./interactive-runtime.test.mjs'];

const browserEntrypoints = [...requiredBrowserEntrypoints];
for (const relativePath of optionalBrowserEntrypoints) {
  try {
    await fs.access(new URL(relativePath, import.meta.url));
    browserEntrypoints.push(relativePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

for (const relativePath of browserEntrypoints) {
  test(`${relativePath} checks the Edge launch policy before spawning a browser`, async () => {
    const source = await fs.readFile(new URL(relativePath, import.meta.url), 'utf8');
    const policyCheck = source.search(/assert(?:BrowserLaunchAllowed|SafeBrowserPath)\(/);
    const edgeSpawn = source.search(/spawn\((?:edge|chromePath),/);
    assert.ok(policyCheck >= 0, 'missing Edge launch policy check');
    assert.ok(edgeSpawn < 0 || policyCheck < edgeSpawn, 'policy check must run before Edge spawn');
  });
}
