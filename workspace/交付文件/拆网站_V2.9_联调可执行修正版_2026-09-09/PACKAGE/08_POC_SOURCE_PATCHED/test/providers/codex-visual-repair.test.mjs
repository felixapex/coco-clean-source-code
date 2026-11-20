import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCodexVisualRepairRequest } from '../../src/providers/codex-visual-repair.mjs';

test('Codex visual repair request preserves repair-task scope and carries evidence paths without secrets', () => {
  const request = buildCodexVisualRepairRequest({
    task: {
      kind: 'visual-fidelity-repair', routeId: 'route-home', similarity: 0.91, threshold: 0.98,
      referenceEvidenceId: 'ev-shot', generatedArtifact: 'styled-preview.png',
      allowedScopes: ['generated-react','generated-css'], forbiddenScopes: ['component-ir','deployment'],
      instructions: ['Do not change Component IR architecture.'],
    },
    workspaceDir: '/work/generated-react',
    referenceScreenshot: '/work/evidence/source.png',
    diffScreenshot: '/work/evidence/diff.png',
  });
  assert.equal(request.mode, 'workspace-write-sandbox');
  assert.deepEqual(request.allowedScopes, ['generated-react','generated-css']);
  assert.deepEqual(request.forbiddenScopes, ['component-ir','deployment']);
  assert.match(request.prompt, /source\.png/);
  assert.match(request.prompt, /diff\.png/);
  assert.match(request.prompt, /do not change component ir architecture/i);
  assert.equal(request.networkAccess, 'disabled');
});
