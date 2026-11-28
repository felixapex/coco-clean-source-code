import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('the build reads its locale runtime from inside the project', async () => {
  const source = await fs.readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /path\.resolve\(root,\s*['"]\.\.['"]/);
  assert.match(source, /src['"],\s*['"]localization['"],\s*['"]locale-service\.js['"]/);
  await fs.access(new URL('../src/localization/locale-service.js', import.meta.url));
});
