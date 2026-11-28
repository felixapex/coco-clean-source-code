import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('representative stability gate runs three fresh rounds and uses shared semantic comparison', async () => {
  const source = await fs.readFile(new URL('../scripts/run-representative-interaction-stability.mjs', import.meta.url), 'utf8');
  assert.match(source, /evaluateInteractionConsensusRounds/);
  assert.match(source, /representativeRound/);
  assert.match(source, /stability-rounds/);
  assert.match(source, /--evaluate-only/);
  assert.match(source, /evaluationMode/);
  assert.match(source, /MATBOX_STABILITY_ROUNDS[^\n]+\|\| '3'/);
  assert.match(source, /MATBOX_RESUME:\s*'0'/);
  assert.match(source, /representative-interaction-stability\.json/);
  assert.match(source, /process\.exitCode\s*=\s*1/);
});
