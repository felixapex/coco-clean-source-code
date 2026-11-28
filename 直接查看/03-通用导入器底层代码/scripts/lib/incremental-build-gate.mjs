import fs from 'node:fs/promises';
import path from 'node:path';
import { evaluateComponentCandidate } from './unit-self-verification.mjs';
import { auditMaterializedComponentPackage } from '../../src/import-foundation/component-package.mjs';

export const REQUIRED_UNIT_GATES = Object.freeze([
  'contract',
  'visual',
  'interaction',
  'coverage',
  'assets',
  'schema',
  'bindings',
  'imageRatio',
  'mutations',
]);

export function evaluateUnitPromotion(evidence = {}) {
  const failures = [];
  for (const gate of REQUIRED_UNIT_GATES) {
    const result = evidence?.[gate];
    if (!result || typeof result.pass !== 'boolean') {
      failures.push({ gate, type: 'missing-gate-evidence' });
      continue;
    }
    if (result.pass) continue;
    const gateFailures = Array.isArray(result.failures) && result.failures.length > 0
      ? result.failures
      : [{ type: 'gate-failed-without-reason' }];
    for (const failure of gateFailures) failures.push({ gate, ...failure });
  }
  return { pass: failures.length === 0, failures };
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function promoteDirectoryAtomically({ stagingDir, acceptedDir } = {}) {
  if (!stagingDir || !acceptedDir) throw new TypeError('stagingDir and acceptedDir are required');
  if (!await pathExists(stagingDir)) throw new Error(`Missing staged directory: ${stagingDir}`);
  await fs.mkdir(path.dirname(acceptedDir), { recursive: true });
  const backupDir = `${acceptedDir}.previous`;
  const hadAccepted = await pathExists(acceptedDir);
  if (await pathExists(backupDir)) await fs.rm(backupDir, { recursive: true, force: true });
  if (hadAccepted) await fs.rename(acceptedDir, backupDir);
  try {
    await fs.rename(stagingDir, acceptedDir);
  } catch (error) {
    if (hadAccepted && await pathExists(backupDir) && !await pathExists(acceptedDir)) {
      await fs.rename(backupDir, acceptedDir);
    }
    throw error;
  }
  if (hadAccepted && await pathExists(backupDir)) await fs.rm(backupDir, { recursive: true, force: true });
  return { promoted: true, acceptedDir };
}

export async function verifyAndPromoteUnit({
  unitId,
  stagingDir,
  acceptedDir,
  evidence,
  component,
  availableAssetHrefs = [],
} = {}) {
  const result = evaluateUnitPromotion(evidence);
  if (!result.pass) return { ...result, unitId, promoted: false };
  const candidateResult = evaluateComponentCandidate(component, { availableAssetHrefs });
  if (!candidateResult.pass) return { ...candidateResult, unitId, promoted: false };
  if (!unitId || !stagingDir || !acceptedDir) {
    return {
      pass: false,
      promoted: false,
      unitId: unitId || '',
      failures: [{ gate: 'promotion', type: 'invalid-promotion-target' }],
    };
  }
  if (!await pathExists(stagingDir)) {
    return {
      pass: false,
      promoted: false,
      unitId,
      failures: [{ gate: 'promotion', type: 'missing-staged-candidate' }],
    };
  }
  const packageAudit = await auditMaterializedComponentPackage(stagingDir);
  if (!packageAudit.pass) {
    return {
      pass: false,
      promoted: false,
      unitId,
      failures: packageAudit.failures.map((failure) => ({ gate: 'package', ...failure })),
    };
  }

  const manifest = {
    contractVersion: 2,
    unitId,
    pass: true,
    gates: Object.fromEntries(REQUIRED_UNIT_GATES.map((gate) => [gate, evidence[gate]])),
    candidate: {
      componentId: component.matboxComponentId,
      sourceGeometry: component.sourceGeometry,
      imageCount: [...String(component.sourceMarkup || '').matchAll(/<img\b/gi)].length,
    },
  };
  await fs.writeFile(path.join(stagingDir, 'accepted-unit-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const packageManifestPath = path.join(stagingDir, 'manifest.json');
  const packageManifest = JSON.parse(await fs.readFile(packageManifestPath, 'utf8'));
  packageManifest.status = 'accepted';
  await fs.writeFile(packageManifestPath, `${JSON.stringify(packageManifest, null, 2)}\n`, 'utf8');
  const acceptedPackageAudit = await auditMaterializedComponentPackage(stagingDir, { status: 'accepted', requireAccepted: true });
  if (!acceptedPackageAudit.pass) {
    return {
      pass: false,
      promoted: false,
      unitId,
      failures: acceptedPackageAudit.failures.map((failure) => ({ gate: 'package', ...failure })),
    };
  }
  await promoteDirectoryAtomically({ stagingDir, acceptedDir });
  return { pass: true, promoted: true, unitId, failures: [], manifest };
}

export async function runIncrementalBuild({ units = [], buildCandidate, verifyCandidate } = {}) {
  if (typeof buildCandidate !== 'function' || typeof verifyCandidate !== 'function') {
    throw new TypeError('runIncrementalBuild requires buildCandidate and verifyCandidate functions');
  }
  const accepted = [];
  for (const unitId of units) {
    const candidate = await buildCandidate(unitId);
    const result = await verifyCandidate(candidate);
    if (!result?.pass) {
      return {
        pass: false,
        accepted,
        failedUnitId: unitId,
        failures: result?.failures || [{ type: 'unit-verification-failed' }],
      };
    }
    accepted.push(unitId);
  }
  return { pass: true, accepted, failedUnitId: null, failures: [] };
}

