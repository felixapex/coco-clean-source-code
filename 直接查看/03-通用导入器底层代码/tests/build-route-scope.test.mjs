import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

test('Coco build can be hard-scoped to the requested homepage before replay files are opened', async () => {
  const source = await fs.readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
  assert.match(source, /selectedBuildRoutes/);
  assert.match(source, /--route=/);
  assert.match(source, /selectedBuildRoutes\.has\(route\)/);
  const routeSelection = source.indexOf('selectedBuildRoutes');
  const replayRead = source.indexOf("fs.readFile(path.join(sourceReplayDir, replayFile)");
  assert.ok(routeSelection >= 0 && replayRead > routeSelection);
});
