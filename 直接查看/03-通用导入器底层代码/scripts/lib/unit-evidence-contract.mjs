export const UNIT_EVIDENCE_CONTRACT_VERSION = '1';

function controlKey(control = {}) {
  return `${String(control.fingerprint || '')}\u0000${Number(control.occurrence || 0)}`;
}

export function createUnitContract(input = {}) {
  return {
    contractVersion: UNIT_EVIDENCE_CONTRACT_VERSION,
    route: String(input.route || ''),
    componentId: String(input.componentId || ''),
    sourceHash: String(input.sourceHash || ''),
    candidateHash: String(input.candidateHash || ''),
    verifierVersion: String(input.verifierVersion || ''),
    requiredViewports: structuredClone(input.requiredViewports || []),
    requiredControls: structuredClone(input.requiredControls || {}),
    captures: structuredClone(input.captures || []),
  };
}

export function validateUnitContract(contract = {}, expected = {}) {
  const failures = [];
  const requiredViewports = Array.isArray(contract.requiredViewports) ? contract.requiredViewports : [];
  const requiredControls = contract.requiredControls && typeof contract.requiredControls === 'object'
    ? contract.requiredControls
    : {};
  const captures = Array.isArray(contract.captures) ? contract.captures : [];
  const capturesByViewport = new Map(captures.map((capture) => [capture.viewport, capture]));
  const coverage = {
    requiredViewports: requiredViewports.length,
    passedViewports: 0,
    requiredControls: 0,
    checkedControls: 0,
  };

  if (contract.contractVersion !== UNIT_EVIDENCE_CONTRACT_VERSION) {
    failures.push({
      type: 'stale-contract-version',
      expected: UNIT_EVIDENCE_CONTRACT_VERSION,
      actual: contract.contractVersion,
    });
  }
  if (expected.sourceHash !== undefined && contract.sourceHash !== expected.sourceHash) {
    failures.push({ type: 'stale-source-evidence', expected: expected.sourceHash, actual: contract.sourceHash });
  }
  if (expected.candidateHash !== undefined && contract.candidateHash !== expected.candidateHash) {
    failures.push({ type: 'stale-candidate-evidence', expected: expected.candidateHash, actual: contract.candidateHash });
  }
  if (expected.verifierVersion !== undefined && contract.verifierVersion !== expected.verifierVersion) {
    failures.push({ type: 'stale-verifier-evidence', expected: expected.verifierVersion, actual: contract.verifierVersion });
  }

  for (const viewport of requiredViewports) {
    const required = Array.isArray(requiredControls[viewport]) ? requiredControls[viewport] : [];
    coverage.requiredControls += required.length;
    const capture = capturesByViewport.get(viewport);
    if (!capture) {
      failures.push({ type: 'missing-unit-viewport', viewport });
      continue;
    }
    if (capture.status !== 'passed') {
      failures.push({
        type: 'unit-capture-error',
        viewport,
        error: String(capture.error || capture.status || 'unknown error'),
      });
      continue;
    }
    coverage.passedViewports += 1;
    const controls = Array.isArray(capture.controls) ? capture.controls : [];
    const controlsByKey = new Map(controls.map((control) => [controlKey(control), control]));
    for (const descriptor of required) {
      const evidence = controlsByKey.get(controlKey(descriptor));
      if (!evidence) {
        failures.push({
          type: 'missing-control-evidence',
          viewport,
          fingerprint: descriptor.fingerprint,
          occurrence: Number(descriptor.occurrence || 0),
        });
        continue;
      }
      if (!evidence.after) {
        failures.push({
          type: 'missing-control-after-state',
          viewport,
          fingerprint: descriptor.fingerprint,
          occurrence: Number(descriptor.occurrence || 0),
        });
        continue;
      }
      coverage.checkedControls += 1;
    }
  }

  return { pass: failures.length === 0, failures, coverage };
}
