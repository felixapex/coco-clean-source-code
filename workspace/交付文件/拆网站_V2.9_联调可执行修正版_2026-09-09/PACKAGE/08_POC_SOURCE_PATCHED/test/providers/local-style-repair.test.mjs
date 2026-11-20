import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  captureVisualWorkspaceRevision,
  applyDeterministicVisualRepair,
  restoreVisualWorkspaceRevision,
} from '../../src/providers/local-style-repair.mjs';

function sampleIr() {
  return {
    routes: [{ id: 'route-home', path: '/', viewport: { width: 800, height: 600 }, documentStyle: { backgroundColor: 'rgb(250, 250, 250)' } }],
    componentFamilies: [{
      id: 'fam-product', canonicalName: 'ProductCard', semanticRole: 'product-card',
      styleProfile: { root: { backgroundColor: 'rgb(255, 245, 235)', borderTopStyle: 'solid', borderTopWidth: '1px' }, slots: {}, variants: {} },
    }],
    componentInstances: [{ id: 'inst-product', familyId: 'fam-product', routeId: 'route-home', bbox: { x: 20, y: 30, width: 200, height: 120 } }],
  };
}

async function makeWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'visual-workspace-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/component-styles.css'), '/* baseline */\n', 'utf8');
  await fs.writeFile(path.join(root, 'src/layout.css'), '/* baseline layout */\n', 'utf8');
  return root;
}

test('local visual repair writes IR-derived CSS and can restore an earlier workspace revision', async () => {
  const workspaceDir = await makeWorkspace();
  const before = await captureVisualWorkspaceRevision(workspaceDir, { id: 'rev-0' });

  const repaired = await applyDeterministicVisualRepair({ ir: sampleIr(), workspaceDir, id: 'rev-1' });
  const componentCss = await fs.readFile(path.join(workspaceDir, 'src/component-styles.css'), 'utf8');
  const layoutCss = await fs.readFile(path.join(workspaceDir, 'src/layout.css'), 'utf8');
  assert.match(componentCss, /background-color: rgb\(255, 245, 235\);/);
  assert.match(componentCss, /border-top-style: solid;/);
  assert.match(layoutCss, /\[data-instance="inst-product"\]/);
  assert.equal(repaired.id, 'rev-1');

  await restoreVisualWorkspaceRevision(before, workspaceDir);
  assert.equal(await fs.readFile(path.join(workspaceDir, 'src/component-styles.css'), 'utf8'), '/* baseline */\n');
  assert.equal(await fs.readFile(path.join(workspaceDir, 'src/layout.css'), 'utf8'), '/* baseline layout */\n');
});
