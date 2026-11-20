import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const files = {
  supervisor: new URL('../scripts/lib/capture-batch-supervisor.mjs', import.meta.url),
  recovery: new URL('../scripts/lib/targeted-recovery.mjs', import.meta.url),
  capture: new URL('../scripts/capture-rendered-golden.mjs', import.meta.url),
  timing: new URL('../scripts/lib/pipeline-timing.mjs', import.meta.url),
  pipeline: new URL('../scripts/run-20-minute-pipeline.mjs', import.meta.url),
};

test('Coco external importer is forced through the shared failure policy', async () => {
  const [supervisor, recovery, capture] = await Promise.all([
    fs.readFile(files.supervisor, 'utf8'),
    fs.readFile(files.recovery, 'utf8'),
    fs.readFile(files.capture, 'utf8'),
  ]);
  assert.match(supervisor, /capture-failure-policy\.mjs/);
  assert.doesNotMatch(supervisor, /from '\.\/targeted-recovery\.mjs'/);
  assert.match(recovery, /classifyCapturePipelineFailure/);
  assert.match(capture, /createInvalidCaptureError/);
});

test('Coco pipeline persists a running checkpoint before every stage completes', async () => {
  const [timing, pipeline] = await Promise.all([
    fs.readFile(files.timing, 'utf8'),
    fs.readFile(files.pipeline, 'utf8'),
  ]);
  assert.match(timing, /runCheckpointedStage/);
  assert.match(pipeline, /checkpoint:/);
  assert.match(pipeline, /writeReport\('running'/);
});

test('Coco rendered capture configures a lane-local persistent resource cache', async () => {
  const source = await fs.readFile(files.capture, 'utf8');
  assert.match(source, /MATBOX_PERSISTENT_RESOURCE_CACHE_DIR/);
  assert.match(source, /persistent-resource-cache/);
});
