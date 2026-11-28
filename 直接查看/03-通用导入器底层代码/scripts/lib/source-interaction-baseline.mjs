import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

export function interactionInventorySignature(controls = []) {
  return digest(controls.map((control) => ({
    fingerprint: String(control.fingerprint || ''),
    occurrence: Number(control.occurrence || 0),
    classification: String(control.classification || ''),
    tag: String(control.tag || ''),
    role: String(control.role || ''),
    type: String(control.type || ''),
    text: String(control.text || ''),
    ariaLabel: String(control.ariaLabel || ''),
    name: String(control.name || ''),
    href: String(control.href || ''),
    formAction: String(control.formAction || ''),
    slideout: String(control.slideout || ''),
    calendlyBound: Boolean(control.calendlyBound),
    disabled: Boolean(control.disabled),
  })));
}

export function createSourceBaselineIdentity({
  sourceOrigin,
  route,
  viewport,
  contractVersion,
  selection,
  inventorySignature,
} = {}) {
  const identity = {
    sourceOrigin: new URL(sourceOrigin).origin,
    route: String(route || '/'),
    viewport: String(viewport || ''),
    contractVersion: String(contractVersion || ''),
    selection: String(selection || 'all'),
    inventorySignature: String(inventorySignature || ''),
  };
  return { ...identity, key: digest(identity) };
}

export function sourceInteractionBaselinePath(rootDirectory, {
  sourceOrigin,
  route,
  viewport,
  selection = 'all',
} = {}) {
  const locator = digest({
    sourceOrigin: new URL(sourceOrigin).origin,
    route: String(route || '/'),
    viewport: String(viewport || ''),
    selection: String(selection || 'all'),
  });
  return path.join(rootDirectory, `${locator}.json`);
}

export function isReusableSourceBaselineEvidence(controls = []) {
  return Array.isArray(controls)
    && controls.every((control) => control?.effect && control.effect.effectType !== 'error');
}

export async function loadSourceInteractionBaseline(baselinePath, expectedIdentity) {
  let baseline;
  try {
    baseline = JSON.parse(await fs.readFile(baselinePath, 'utf8'));
  } catch {
    return null;
  }
  if (baseline?.version !== 1 || baseline?.identity?.key !== expectedIdentity?.key) return null;
  if (!Array.isArray(baseline.controls) || !baseline.controls.every((control) => control?.effect)) return null;
  return baseline;
}

export async function loadFrozenSourceInteractionBaseline(baselinePath, expected = {}) {
  let baseline;
  try {
    baseline = JSON.parse(await fs.readFile(baselinePath, 'utf8'));
  } catch {
    return null;
  }
  const actual = baseline?.identity || {};
  let expectedOrigin = '';
  try { expectedOrigin = new URL(expected.sourceOrigin).origin; } catch {}
  if (
    baseline?.version !== 1
    || actual.sourceOrigin !== expectedOrigin
    || actual.route !== String(expected.route || '/')
    || actual.viewport !== String(expected.viewport || '')
    || actual.contractVersion !== String(expected.contractVersion || '')
    || actual.selection !== String(expected.selection || 'all')
    || !isReusableSourceBaselineEvidence(baseline.controls)
  ) return null;
  return baseline;
}

export async function writeSourceInteractionBaseline(baselinePath, { identity, controls, diagnostics }) {
  const baseline = {
    version: 1,
    capturedAt: new Date().toISOString(),
    identity,
    controls,
    diagnostics: diagnostics || {},
  };
  await fs.mkdir(path.dirname(baselinePath), { recursive: true });
  const temporaryPath = `${baselinePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  await fs.rename(temporaryPath, baselinePath);
  return baseline;
}
