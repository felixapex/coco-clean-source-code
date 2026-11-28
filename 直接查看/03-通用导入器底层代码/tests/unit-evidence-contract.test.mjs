import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UNIT_EVIDENCE_CONTRACT_VERSION,
  createUnitContract,
  validateUnitContract,
} from '../scripts/lib/unit-evidence-contract.mjs';

function validInput() {
  return {
    route: '/dining/',
    componentId: 'header-group',
    sourceHash: 'source-v1',
    candidateHash: 'candidate-v1',
    verifierVersion: 'verifier-v1',
    requiredViewports: ['desktop', 'mobile'],
    requiredControls: {
      desktop: [
        { fingerprint: 'header:sign-in', occurrence: 0 },
        { fingerprint: 'header:dining', occurrence: 0 },
      ],
      mobile: [{ fingerprint: 'header:menu-toggle', occurrence: 0 }],
    },
    captures: [
      {
        viewport: 'desktop',
        status: 'passed',
        screenshot: 'source/desktop/header.png',
        domSnapshot: 'source/desktop/header.json',
        controls: [
          {
            fingerprint: 'header:sign-in',
            occurrence: 0,
            status: 'passed',
            before: { url: 'https://example.test/dining/' },
            after: { url: 'https://example.test/dining/', effectType: 'drawer' },
          },
          {
            fingerprint: 'header:dining',
            occurrence: 0,
            status: 'passed',
            before: { url: 'https://example.test/dining/' },
            after: { url: 'https://example.test/dining/', effectType: 'mega-menu' },
          },
        ],
      },
      {
        viewport: 'mobile',
        status: 'passed',
        screenshot: 'source/mobile/header.png',
        domSnapshot: 'source/mobile/header.json',
        controls: [
          {
            fingerprint: 'header:menu-toggle',
            occurrence: 0,
            status: 'passed',
            before: { url: 'https://example.test/dining/' },
            after: { url: 'https://example.test/dining/', effectType: 'drawer' },
          },
        ],
      },
    ],
  };
}

test('unit evidence fails when a required viewport is missing', () => {
  const input = validInput();
  input.captures = input.captures.filter((capture) => capture.viewport !== 'mobile');

  const result = validateUnitContract(createUnitContract(input), input);

  assert.equal(result.pass, false);
  assert.deepEqual(result.failures, [{ type: 'missing-unit-viewport', viewport: 'mobile' }]);
});

test('unit evidence fails when one visible control occurrence is not checked', () => {
  const input = validInput();
  input.captures[0].controls = input.captures[0].controls.filter((control) => control.fingerprint !== 'header:dining');

  const result = validateUnitContract(createUnitContract(input), input);

  assert.equal(result.pass, false);
  assert.deepEqual(result.failures, [{
    type: 'missing-control-evidence',
    viewport: 'desktop',
    fingerprint: 'header:dining',
    occurrence: 0,
  }]);
});

test('unit evidence fails when a clicked control has no after state', () => {
  const input = validInput();
  delete input.captures[0].controls[0].after;

  const result = validateUnitContract(createUnitContract(input), input);

  assert.equal(result.pass, false);
  assert.deepEqual(result.failures, [{
    type: 'missing-control-after-state',
    viewport: 'desktop',
    fingerprint: 'header:sign-in',
    occurrence: 0,
  }]);
});

test('unit evidence exposes capture errors instead of counting them as coverage', () => {
  const input = validInput();
  input.captures[1] = { viewport: 'mobile', status: 'error', error: 'net::ERR_CONNECTION_RESET' };

  const result = validateUnitContract(createUnitContract(input), input);

  assert.equal(result.pass, false);
  assert.deepEqual(result.failures, [{
    type: 'unit-capture-error',
    viewport: 'mobile',
    error: 'net::ERR_CONNECTION_RESET',
  }]);
});

test('unit evidence fails when cached hashes or verifier version are stale', () => {
  const input = validInput();
  const contract = createUnitContract(input);

  const result = validateUnitContract(contract, {
    ...input,
    sourceHash: 'source-v2',
    candidateHash: 'candidate-v2',
    verifierVersion: 'verifier-v2',
  });

  assert.equal(result.pass, false);
  assert.deepEqual(result.failures, [
    { type: 'stale-source-evidence', expected: 'source-v2', actual: 'source-v1' },
    { type: 'stale-candidate-evidence', expected: 'candidate-v2', actual: 'candidate-v1' },
    { type: 'stale-verifier-evidence', expected: 'verifier-v2', actual: 'verifier-v1' },
  ]);
});

test('complete current evidence passes with exact coverage', () => {
  const input = validInput();
  const contract = createUnitContract(input);

  const result = validateUnitContract(contract, input);

  assert.equal(contract.contractVersion, UNIT_EVIDENCE_CONTRACT_VERSION);
  assert.equal(result.pass, true);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.coverage, {
    requiredViewports: 2,
    passedViewports: 2,
    requiredControls: 3,
    checkedControls: 3,
  });
});
