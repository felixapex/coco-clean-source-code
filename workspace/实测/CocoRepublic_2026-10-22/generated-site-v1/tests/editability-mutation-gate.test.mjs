import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSettingMutations } from '../scripts/lib/editability-mutation-gate.mjs';

function schema() {
  return {
    settings: [
      { type: 'inline_richtext', id: 'heading', label: '标题' },
      { type: 'image_picker', id: 'image', label: '图片' },
      { type: 'url', id: 'link', label: '链接' },
      { type: 'color_scheme', id: 'color_scheme', label: '配色' },
      { type: 'text_alignment', id: 'alignment', label: '对齐' },
      { type: 'range', id: 'padding_top', label: '上间距', min: 0, max: 100, default: 40 },
      { type: 'select', id: 'radius', label: '圆角', options: [{ value: 'round', label: '圆角' }, { value: 'square', label: '直角' }] },
      { type: 'select', id: 'image_ratio', label: '图片比例', options: [{ value: 'original', label: '原图' }, { value: '1:1', label: '1:1' }] },
    ],
  };
}

function mutation(settingId) {
  return {
    settingId,
    status: 'passed',
    targetRegionIds: [`setting:${settingId}`],
    changedRegionIds: [`setting:${settingId}`],
    changedOutsideTargetIds: [],
    evidenceByViewport: {
      desktop: {
        before: { domHash: `before-desktop-${settingId}`, screenshot: `before/desktop-${settingId}.png` },
        after: { domHash: `after-desktop-${settingId}`, screenshot: `after/desktop-${settingId}.png` },
        diff: { path: `diff/desktop-${settingId}.png`, changedPixels: 10 },
      },
      mobile: {
        before: { domHash: `before-mobile-${settingId}`, screenshot: `before/mobile-${settingId}.png` },
        after: { domHash: `after-mobile-${settingId}`, screenshot: `after/mobile-${settingId}.png` },
        diff: { path: `diff/mobile-${settingId}.png`, changedPixels: 8 },
      },
    },
  };
}

function validInput() {
  const settingIds = schema().settings.map((setting) => setting.id);
  return {
    schema: schema(),
    baseline: { domHash: 'baseline', screenshot: 'baseline.png' },
    requiredViewports: ['desktop', 'mobile'],
    mutations: settingIds.map(mutation),
  };
}

test('every declared editable setting passes only with isolated render-change evidence', () => {
  const result = evaluateSettingMutations(validInput());
  assert.equal(result.pass, true);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.coverage, { required: 8, checked: 8, passed: 8 });
});

test('missing mutation evidence fails instead of treating schema declaration as editability', () => {
  const input = validInput();
  input.mutations = input.mutations.filter((item) => item.settingId !== 'link');
  const result = evaluateSettingMutations(input);
  assert.equal(result.pass, false);
  assert.deepEqual(result.failures, [{ type: 'missing-setting-mutation', settingId: 'link' }]);
});

test('a mutation that produces no DOM or visual change fails', () => {
  const input = validInput();
  const heading = input.mutations.find((item) => item.settingId === 'heading');
  heading.evidenceByViewport.desktop.after.domHash = heading.evidenceByViewport.desktop.before.domHash;
  heading.evidenceByViewport.desktop.diff.changedPixels = 0;
  const result = evaluateSettingMutations(input);
  assert.equal(result.pass, false);
  assert.deepEqual(result.failures, [{ type: 'setting-mutation-no-render-change', settingId: 'heading', viewport: 'desktop' }]);
});

test('a mutation that changes unrelated regions fails isolation', () => {
  const input = validInput();
  input.mutations.find((item) => item.settingId === 'image_ratio').changedOutsideTargetIds = ['site-header'];
  const result = evaluateSettingMutations(input);
  assert.equal(result.pass, false);
  assert.deepEqual(result.failures, [{ type: 'setting-mutation-leaked', settingId: 'image_ratio', regions: ['site-header'] }]);
});

test('missing before, after, diff, or required viewport evidence fails closed', () => {
  const input = validInput();
  const image = input.mutations.find((item) => item.settingId === 'image');
  delete image.evidenceByViewport.desktop.after;
  delete image.evidenceByViewport.desktop.diff;
  delete image.evidenceByViewport.mobile;
  const result = evaluateSettingMutations(input);
  assert.equal(result.pass, false);
  assert.deepEqual(result.failures, [
    { type: 'incomplete-setting-mutation-evidence', settingId: 'image', viewport: 'desktop' },
    { type: 'missing-setting-mutation-viewport', settingId: 'image', viewport: 'mobile' },
  ]);
});

test('viewport names without viewport-specific before and after evidence fail closed', () => {
  const input = validInput();
  const link = input.mutations.find((item) => item.settingId === 'link');
  delete link.evidenceByViewport;
  link.viewports = ['desktop', 'mobile'];
  link.before = { domHash: 'before', screenshot: 'before.png' };
  link.after = { domHash: 'after', screenshot: 'after.png' };
  link.diff = { path: 'diff.png', changedPixels: 10 };

  const result = evaluateSettingMutations(input);

  assert.equal(result.pass, false);
  assert.deepEqual(result.failures, [
    { type: 'missing-setting-mutation-viewport', settingId: 'link', viewport: 'desktop' },
    { type: 'missing-setting-mutation-viewport', settingId: 'link', viewport: 'mobile' },
  ]);
});

test('an errored mutation is reported and cannot count as coverage', () => {
  const input = validInput();
  const alignment = input.mutations.find((item) => item.settingId === 'alignment');
  alignment.status = 'error';
  alignment.error = 'render timeout';
  const result = evaluateSettingMutations(input);
  assert.equal(result.pass, false);
  assert.deepEqual(result.failures, [{ type: 'setting-mutation-error', settingId: 'alignment', error: 'render timeout' }]);
  assert.deepEqual(result.coverage, { required: 8, checked: 8, passed: 7 });
});

