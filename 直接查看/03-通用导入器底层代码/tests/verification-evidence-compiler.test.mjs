import test from 'node:test';
import assert from 'node:assert/strict';
import { compileVerificationEvidence } from '../scripts/lib/verification-evidence-compiler.mjs';

function fixture(overrides = {}) {
  return {
    stageMarker: { failedGates: [] },
    componentReport: {
      coverage: 1,
      unmappedSectionCount: 0,
      componentIdCollisionCount: 0,
      reassemblyFailureCount: 0,
    },
    editableAudit: { pass: true, failures: [] },
    routeClosure: { pass: true, missingTargetCount: 0 },
    responsiveBase: {
      cells: [
        { route: '/living', viewport: 'mobile', width: 390, pass: true, failures: [] },
        { route: '/living', viewport: 'desktop', width: 1366, pass: true, failures: [] },
      ],
      failures: [],
    },
    responsivePatches: [],
    interactionBase: {
      routeResults: [{ route: '/living', visibleControls: 12, noEffectButtons: 0 }],
      failures: [],
    },
    interactionPatches: [],
    mutationReport: { pass: true, sampleSize: 8, externalRequests: [] },
    componentRegistry: {
      components: [{ matboxComponentId: 'matbox.section.hero.v1.abc', sourceSectionType: 'hero' }],
    },
    pageCompositions: [{
      route: '/living',
      instances: [{ matboxComponentId: 'matbox.section.hero.v1.abc' }],
    }],
    ...overrides,
  };
}

test('compiles all required unit and page gates from passed site evidence', () => {
  const result = compileVerificationEvidence(fixture());

  assert.equal(result.pass, true, JSON.stringify(result.failures));
  const unit = result.unitEvidenceById['matbox.section.hero.v1.abc'];
  assert.deepEqual(Object.keys(unit).sort(), [
    'assets', 'bindings', 'contract', 'coverage', 'imageRatio',
    'interaction', 'mutations', 'schema', 'visual',
  ].sort());
  assert.ok(Object.values(unit).every((gate) => gate.pass === true));
  const page = result.pageEvidenceByRoute['/living'];
  assert.equal(page.viewports.desktop.visual.pass, true);
  assert.equal(page.viewports.mobile.geometry.pass, true);
  assert.deepEqual(page.interactions, { pass: true, total: 12, verified: 12, failures: [] });
});

test('fails closed when a responsive failure has not been covered by a passing patch', () => {
  const input = fixture();
  input.responsiveBase.cells[1] = {
    route: '/living', viewport: 'desktop', width: 1366, pass: false,
    failures: [{ type: 'navigation-or-audit-error' }],
  };
  input.responsiveBase.failures = [{ route: '/living', viewport: 'desktop', width: 1366 }];

  const result = compileVerificationEvidence(input);

  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.type === 'responsive-route-failed'));
});

test('a passing targeted patch replaces the exact failed responsive cell and interaction route', () => {
  const input = fixture();
  input.responsiveBase.cells[1] = {
    route: '/living', viewport: 'desktop', width: 1366, pass: false,
    failures: [{ type: 'navigation-or-audit-error' }],
  };
  input.responsiveBase.failures = [{ route: '/living', viewport: 'desktop', width: 1366 }];
  input.responsivePatches = [{
    pass: true,
    cells: [{ route: '/living', viewport: 'desktop', width: 1366, pass: true, failures: [] }],
  }];
  input.interactionBase.failures = [{ type: 'no-observable-effect', route: '/living' }];
  input.interactionPatches = [{
    pass: true,
    failures: [],
    routeResults: [{ route: '/living', visibleControls: 12, noEffectButtons: 0 }],
  }];

  const result = compileVerificationEvidence(input);

  assert.equal(result.pass, true, JSON.stringify(result.failures));
  assert.equal(result.pageEvidenceByRoute['/living'].interactions.pass, true);
});

test('mobile capture compositions inherit verified evidence from their canonical route', () => {
  const input = fixture({
    pageCompositions: [{
      route: '/living?matbox-viewport=mobile',
      instances: [{ matboxComponentId: 'matbox.section.hero.v1.abc' }],
    }],
  });

  const result = compileVerificationEvidence(input);

  assert.equal(result.pass, true, JSON.stringify(result.failures));
  assert.ok(result.pageEvidenceByRoute['/living?matbox-viewport=mobile']);
});

test('missing route, editability, mutation, or stage evidence prevents compilation', () => {
  const result = compileVerificationEvidence(fixture({
    stageMarker: { failedGates: ['stylesheet-recovery'] },
    editableAudit: { pass: false, failures: [{ type: 'missing-binding' }] },
    routeClosure: { pass: false, missingTargetCount: 1 },
    mutationReport: { pass: false, sampleSize: 0, externalRequests: ['https://source.example'] },
  }));

  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.type === 'stage-has-failed-gates'));
  assert.ok(result.failures.some((failure) => failure.type === 'editable-contract-failed'));
  assert.ok(result.failures.some((failure) => failure.type === 'route-closure-failed'));
  assert.ok(result.failures.some((failure) => failure.type === 'mutation-verification-failed'));
});
