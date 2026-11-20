import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

for (const relativePath of ['../scripts/audit-localization.mjs', '../scripts/audit-responsive-layout.mjs', './interactive-runtime.test.mjs']) {
  test(`${relativePath} checks the Edge launch policy before spawning a browser`, async () => {
    const source = await fs.readFile(new URL(relativePath, import.meta.url), 'utf8');
    const policyCheck = source.search(/assert(?:BrowserLaunchAllowed|SafeBrowserPath)\(/);
    const edgeSpawn = source.search(/spawn\((?:edge|chromePath),/);
    assert.ok(policyCheck >= 0, 'missing Edge launch policy check');
    assert.ok(edgeSpawn < 0 || policyCheck < edgeSpawn, 'policy check must run before Edge spawn');
  });
}
