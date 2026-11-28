export const EDITOR_DATA_CONTRACT_VERSION = '1.0.0';

export const REQUIRED_EDITOR_DATA_DOMAINS = Object.freeze([
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

export const NON_WAIVABLE_EDITOR_DATA_DOMAINS = Object.freeze([
  'colors',
  'dimensions',
  'ratios',
  'containers',
  'spacing',
  'alignment',
  'responsive',
  'editableFields',
]);

const REQUIRED_RECORD_PATHS = Object.freeze({
  text: ['path', 'value'],
  images: [
    'path',
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
  ],
  typography: ['target', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'color'],
  colors: ['target', 'value'],
  dimensions: ['target', 'width', 'height'],
  ratios: ['target', 'width', 'height', 'value'],
  containers: ['target', 'width', 'height', 'maxWidth', 'display', 'layout', 'overflow'],
  spacing: ['target', 'margin', 'padding', 'gap', 'borderRadius'],
  alignment: ['target', 'horizontal', 'vertical', 'text'],
  cropping: ['target', 'objectFit', 'objectPosition'],
  interactions: ['target', 'event', 'outcome'],
  links: ['target', 'type', 'url'],
  editableFields: ['path', 'domain', 'type', 'label'],
});

function hasEvidence(evidence) {
  if (typeof evidence === 'string') return evidence.trim().length > 0;
  return Array.isArray(evidence)
    && evidence.length > 0
    && evidence.every((item) => typeof item === 'string' && item.trim().length > 0);
}

function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function valueAtPath(value, dottedPath) {
  return dottedPath.split('.').reduce((current, key) => current?.[key], value);
}

function validateRecords(domain, value) {
  const requiredPaths = REQUIRED_RECORD_PATHS[domain];
  if (!requiredPaths) return [];
  if (!Array.isArray(value) || value.length === 0) return [{ domain, type: 'invalid-record-list' }];
  const failures = [];
  value.forEach((record, index) => {
    for (const requiredPath of requiredPaths) {
      if (!hasValue(valueAtPath(record, requiredPath))) {
        failures.push({ domain, type: 'missing-record-field', path: `${domain}[${index}].${requiredPath}` });
      }
    }
    if (domain === 'images') {
      if (!['available', 'frozen'].includes(record?.resourceStatus)) {
        failures.push({ domain, type: 'resource-unavailable', path: `${domain}[${index}].resourceStatus`, status: record?.resourceStatus ?? 'missing' });
      }
      for (const dimensionPath of ['source.width', 'source.height', 'displayed.desktop.width', 'displayed.desktop.height', 'displayed.mobile.width', 'displayed.mobile.height']) {
        const measured = Number(valueAtPath(record, dimensionPath));
        if (Number.isFinite(measured) && measured <= 0) {
          failures.push({ domain, type: 'invalid-measurement', path: `${domain}[${index}].${dimensionPath}`, value: measured });
        }
      }
      if (Number.isFinite(Number(record?.aspectRatio)) && Number(record.aspectRatio) <= 0) {
        failures.push({ domain, type: 'invalid-aspect-ratio', path: `${domain}[${index}].aspectRatio`, value: record.aspectRatio });
      }
    }
  });
  return failures;
}

function validateResponsive(value) {
  const failures = [];
  for (const path of ['desktop', 'desktop.widthMode', 'mobile', 'mobile.widthMode', 'rules']) {
    const resolved = valueAtPath(value, path);
    const present = path === 'rules' ? Array.isArray(resolved) : hasValue(resolved);
    if (!present) failures.push({ domain: 'responsive', type: 'missing-responsive-field', path: `responsive.${path}` });
  }
  return failures;
}

function validateDomainValue(domain, value) {
  if (domain === 'responsive') return validateResponsive(value);
  return validateRecords(domain, value);
}

function validateDomain(domain, descriptor) {
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
    return [{ domain, type: 'missing-domain' }];
  }

  if (descriptor.status === 'not-applicable') {
    if (NON_WAIVABLE_EDITOR_DATA_DOMAINS.includes(domain)) {
      return [{ domain, type: 'domain-always-applicable' }];
    }
    if (
      typeof descriptor.reason !== 'string'
      || descriptor.reason.trim().length === 0
      || !hasEvidence(descriptor.evidence)
    ) {
      return [{ domain, type: 'unsupported-not-applicable' }];
    }
    return [];
  }

  if (descriptor.status !== 'captured') {
    return [{ domain, type: 'invalid-domain-status', status: descriptor.status ?? 'missing' }];
  }

  const failures = [];
  if (!hasValue(descriptor.value)) failures.push({ domain, type: 'empty-value' });
  if (!hasEvidence(descriptor.evidence)) failures.push({ domain, type: 'missing-evidence' });
  if (hasValue(descriptor.value)) failures.push(...validateDomainValue(domain, descriptor.value));
  return failures;
}

export function evaluateEditorComponent(component = {}) {
  const failures = [];
  if (typeof component.id !== 'string' || component.id.trim().length === 0) {
    failures.push({ domain: 'identity', type: 'missing-component-id' });
  }
  if (typeof component.type !== 'string' || component.type.trim().length === 0) {
    failures.push({ domain: 'identity', type: 'missing-component-type' });
  }

  for (const domain of REQUIRED_EDITOR_DATA_DOMAINS) {
    failures.push(...validateDomain(domain, component.domains?.[domain]));
  }

  return {
    id: component.id ?? null,
    type: component.type ?? null,
    contractVersion: EDITOR_DATA_CONTRACT_VERSION,
    pass: failures.length === 0,
    status: failures.length === 0 ? 'passed' : 'failed',
    failures,
  };
}

export function evaluateEditorPage(page = {}) {
  const components = Array.isArray(page.components) ? page.components : [];
  const failures = [];
  const componentResults = {};

  if (typeof page.id !== 'string' || page.id.trim().length === 0) {
    failures.push({ componentId: null, domain: 'identity', type: 'missing-page-id' });
  }
  if (components.length === 0) {
    failures.push({ componentId: null, domain: 'components', type: 'missing-page-components' });
  }

  for (const component of components) {
    const result = evaluateEditorComponent(component);
    const key = result.id ?? `missing-id-${Object.keys(componentResults).length + 1}`;
    if (Object.hasOwn(componentResults, key)) {
      failures.push({ componentId: key, domain: 'identity', type: 'duplicate-component-id' });
      continue;
    }
    componentResults[key] = result;
    for (const failure of result.failures) failures.push({ componentId: result.id, ...failure });
  }

  return {
    id: page.id ?? null,
    contractVersion: EDITOR_DATA_CONTRACT_VERSION,
    pass: failures.length === 0,
    status: failures.length === 0 ? 'passed' : 'failed',
    componentCount: components.length,
    passedComponentCount: Object.values(componentResults).filter((result) => result.pass).length,
    componentResults,
    failures,
  };
}
