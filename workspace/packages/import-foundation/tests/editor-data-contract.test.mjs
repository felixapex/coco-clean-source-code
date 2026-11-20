import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REQUIRED_EDITOR_DATA_DOMAINS,
  evaluateEditorComponent,
  evaluateEditorPage,
} from '../editor-data-contract.mjs';

function captured(value) {
  return { status: 'captured', value, evidence: ['fixture'] };
}

function validDomainValues() {
  return {
    text: [{ path: 'title', value: 'Title' }],
    images: [{
      path: 'image',
      url: 'https://example.com/image.jpg',
      resourceStatus: 'frozen',
      source: { width: 1200, height: 800 },
      displayed: {
        desktop: { width: 600, height: 400 },
        mobile: { width: 360, height: 240 },
      },
      aspectRatio: 1.5,
      container: {
        desktop: { width: 600, height: 400 },
        mobile: { width: 360, height: 240 },
      },
      objectFit: 'cover',
      objectPosition: '50% 50%',
    }],
    typography: [{ target: '.title', fontFamily: 'Arial', fontSize: '32px', fontWeight: 600, lineHeight: '40px', color: '#111111' }],
    colors: [{ target: '.hero', value: '#ffffff' }],
    dimensions: [{ target: '.hero', width: '100%', height: '400px' }],
    ratios: [{ target: '.hero', width: 3, height: 2, value: 1.5 }],
    containers: [{ target: '.hero', width: '100%', height: '400px', maxWidth: '1200px', display: 'grid', layout: 'grid', overflow: 'hidden' }],
    spacing: [{ target: '.hero', margin: '0', padding: '24px', gap: '16px', borderRadius: '12px' }],
    alignment: [{ target: '.hero', horizontal: 'center', vertical: 'center', text: 'left' }],
    cropping: [{ target: '.hero img', objectFit: 'cover', objectPosition: '50% 50%' }],
    responsive: {
      desktop: { minWidth: 768, widthMode: 'fluid', columns: 3 },
      mobile: { maxWidth: 767, widthMode: 'fluid', columns: 1 },
      rules: [{ breakpoint: 768, property: 'columns', desktop: 3, mobile: 1 }],
    },
    interactions: [{ target: '.hero', event: 'tap', outcome: { type: 'route', target: '/detail' } }],
    links: [{ target: '.hero', type: 'route', url: '/detail' }],
    editableFields: [{ path: 'title', domain: 'text', type: 'string', label: 'Title' }],
  };
}

function completeComponent(id = 'hero') {
  const values = validDomainValues();
  return {
    id,
    type: 'hero',
    domains: Object.fromEntries(REQUIRED_EDITOR_DATA_DOMAINS.map((domain) => [
      domain,
      captured(values[domain]),
    ])),
  };
}

test('the editor contract contains every data class required by the editor', () => {
  assert.deepEqual(REQUIRED_EDITOR_DATA_DOMAINS, [
    'text',
    'images',
    'typography',
    'colors',
    'dimensions',
    'ratios',
    'containers',
    'spacing',
    'alignment',
    'cropping',
    'responsive',
    'interactions',
    'links',
    'editableFields',
  ]);
});

test('a component passes only when all editor data domains are complete', () => {
  const result = evaluateEditorComponent(completeComponent());
  assert.equal(result.pass, true);
  assert.equal(result.status, 'passed');
  assert.deepEqual(result.failures, []);
});

test('each missing editor domain independently blocks component approval', () => {
  for (const domain of REQUIRED_EDITOR_DATA_DOMAINS) {
    const component = completeComponent();
    delete component.domains[domain];
    component.status = 'passed';

    const result = evaluateEditorComponent(component);

    assert.equal(result.pass, false, `${domain} must block approval`);
    assert.equal(result.status, 'failed');
    assert.ok(result.failures.some((failure) => failure.domain === domain && failure.type === 'missing-domain'));
  }
});

test('not-applicable is accepted only with a reason and evidence', () => {
  const valid = completeComponent('image-only');
  valid.domains.text = {
    status: 'not-applicable',
    reason: 'The source component contains no text node.',
    evidence: ['source-dom:.image-only:text-count=0'],
  };
  assert.equal(evaluateEditorComponent(valid).pass, true);

  const invalid = completeComponent('image-only');
  invalid.domains.text = { status: 'not-applicable' };
  const result = evaluateEditorComponent(invalid);
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.domain === 'text' && failure.type === 'unsupported-not-applicable'));
});

test('empty captured values and missing evidence fail closed', () => {
  const emptyValue = completeComponent();
  emptyValue.domains.colors = { status: 'captured', value: [], evidence: ['fixture'] };
  assert.ok(evaluateEditorComponent(emptyValue).failures.some((failure) => failure.domain === 'colors' && failure.type === 'empty-value'));

  const noEvidence = completeComponent();
  noEvidence.domains.colors = { status: 'captured', value: [{ value: '#fff' }], evidence: [] };
  assert.ok(evaluateEditorComponent(noEvidence).failures.some((failure) => failure.domain === 'colors' && failure.type === 'missing-evidence'));
});

test('an image is incomplete unless original and rendered facts are all captured', () => {
  const requiredPaths = [
    'url',
    'resourceStatus',
    'source.width',
    'source.height',
    'displayed.desktop.width',
    'displayed.desktop.height',
    'displayed.mobile.width',
    'displayed.mobile.height',
    'aspectRatio',
    'container.desktop.width',
    'container.desktop.height',
    'container.mobile.width',
    'container.mobile.height',
    'objectFit',
    'objectPosition',
  ];

  for (const missingPath of requiredPaths) {
    const component = completeComponent();
    const image = component.domains.images.value[0];
    const segments = missingPath.split('.');
    let cursor = image;
    for (const segment of segments.slice(0, -1)) cursor = cursor[segment];
    delete cursor[segments.at(-1)];

    const result = evaluateEditorComponent(component);
    assert.equal(result.pass, false, `${missingPath} must block image approval`);
    assert.ok(result.failures.some((failure) => failure.domain === 'images' && failure.path?.endsWith(missingPath)));
  }
});

test('layout, type, responsive, and editor settings reject shallow placeholder records', () => {
  const component = completeComponent();
  component.domains.typography.value = [{ fontFamily: 'Arial' }];
  component.domains.containers.value = [{ width: '100%' }];
  component.domains.responsive.value = { desktop: {} };
  component.domains.editableFields.value = [{ path: 'title' }];

  const result = evaluateEditorComponent(component);

  for (const domain of ['typography', 'containers', 'responsive', 'editableFields']) {
    assert.ok(result.failures.some((failure) => failure.domain === domain), `${domain} must be strict`);
  }
});

test('geometry and editor-setting domains can never be waived as not applicable', () => {
  const component = completeComponent();
  component.domains.dimensions = {
    status: 'not-applicable',
    reason: 'Skipped.',
    evidence: ['fixture'],
  };

  const result = evaluateEditorComponent(component);
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.domain === 'dimensions' && failure.type === 'domain-always-applicable'));
});

test('a page cannot pass while any child component is incomplete', () => {
  const complete = completeComponent('complete');
  const incomplete = completeComponent('incomplete');
  delete incomplete.domains.responsive;

  const result = evaluateEditorPage({ id: 'home', components: [complete, incomplete] });

  assert.equal(result.pass, false);
  assert.equal(result.status, 'failed');
  assert.equal(result.componentResults.complete.status, 'passed');
  assert.equal(result.componentResults.incomplete.status, 'failed');
  assert.ok(result.failures.some((failure) => failure.componentId === 'incomplete' && failure.domain === 'responsive'));
});
