import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const REQUIRED_COMPONENT_PACKAGE_FILES = Object.freeze([
  'manifest.json',
  'schema.json',
  'presets.json',
  'implementation.html',
  'styles.css',
  'assets.json',
  'interactions.json',
  'preview.html',
  'verification.json',
]);

export const REQUIRED_COMPONENT_VERIFICATION_GATES = Object.freeze([
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

const SECTION_ROOT_SETTING_IDS = new Set(['color_scheme', 'padding_top', 'padding_bottom']);

function digest(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function extractStyles(markup) {
  const styles = [];
  const implementation = String(markup || '').replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (_full, css) => {
    if (String(css).trim()) styles.push(String(css).trim());
    return '';
  });
  return { implementation, styles: styles.join('\n\n') };
}

function referencedAssets(component, implementation, styles) {
  const activeImplementation = String(implementation).replace(/<!--[\s\S]*?-->/g, '');
  const activeStyles = String(styles).replace(/<!--[\s\S]*?-->/g, '');
  const markupAssets = [...activeImplementation.matchAll(/(?:^|\s)(?:src|poster)\s*=\s*(["'])([^"']+)\1/gi)]
    .map((match) => match[2]);
  const cssAssets = [...activeStyles.matchAll(/url\(\s*(?:["']([^"']+)["']|([^)'"\s]+))\s*\)/gi)]
    .map((match) => match[1] || match[2]);
  return unique([
    ...(component?.contract?.assets || []),
    ...markupAssets,
    ...cssAssets,
  ]).filter((href) => !/^(?:data:|about:blank|#)/i.test(href));
}

function interactionContract(implementation, declaredStates = []) {
  const anchors = [...String(implementation).matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])([^"']+)\1[^>]*>([\s\S]*?)<\/a\s*>/gi)]
    .map((match) => ({
      action: 'navigate',
      target: match[2],
      href: match[2],
      label: match[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    }));
  const buttons = [...String(implementation).matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button\s*>/gi)]
    .map((match) => {
      const attributes = match[1];
      const type = attributes.match(/\btype\s*=\s*(["'])([^"']+)\1/i)?.[2]?.toLowerCase() || 'button';
      const closesOverlay = /\bdata-reveal-close\b/i.test(attributes)
        || /\bclass\s*=\s*(["'])[^"']*\b(?:modal-close|close-reveal-modal|confirm|cancel)\b[^"']*\1/i.test(attributes);
      return {
        action: closesOverlay ? 'close-overlay' : type === 'submit' ? 'submit-form' : 'activate',
        type,
        label: match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      };
    });
  const forms = [...String(implementation).matchAll(/<form\b([^>]*)>/gi)]
    .map((match) => ({
      action: 'submit-form',
      target: match[1].match(/\baction\s*=\s*(["'])([^"']+)\1/i)?.[2] || '',
      method: (match[1].match(/\bmethod\s*=\s*(["'])([^"']+)\1/i)?.[2] || 'get').toLowerCase(),
    }));
  return {
    anchors,
    buttons,
    forms,
    declaredStates: unique(declaredStates).sort(),
  };
}

function safePackageFolder(componentId) {
  return encodeURIComponent(String(componentId || ''));
}

function parseJsonFile(files, name, failures) {
  try {
    return JSON.parse(files[name]);
  } catch (error) {
    failures.push({ type: 'invalid-package-json', file: name, message: error.message });
    return null;
  }
}

function activeSourceScript(markup) {
  return /<script\b(?![^>]*\btype\s*=\s*(["'])application\/x-matbox-disabled\1)[^>]*>/i.test(String(markup || ''));
}

function remoteIframe(markup) {
  return [...String(markup || '').matchAll(/<iframe\b([^>]*)>/gi)].some((match) => {
    const source = match[1].match(/(?:^|\s)src\s*=\s*(["'])(.*?)\1/i)?.[2] || '';
    return /^(?:https?:)?\/\//i.test(source);
  });
}

export function createPortableComponentPackage(component, { assetManifest = [], verification = {} } = {}) {
  const componentId = String(component?.matboxComponentId || '');
  const defaultVariant = component?.variants?.[0];
  const sourceMarkup = String(defaultVariant?.markup || component?.sourceMarkup || '');
  const { implementation, styles } = extractStyles(sourceMarkup);
  const assetsByHref = new Map((assetManifest || []).filter((asset) => asset?.href).map((asset) => [asset.href, asset]));
  const assetHrefs = referencedAssets(component, implementation, styles);
  const assets = assetHrefs.map((href) => {
    const resolved = assetsByHref.get(href);
    return resolved ? { ...resolved, href, resolved: true } : { href, resolved: false };
  });
  const interactions = interactionContract(implementation, component?.contract?.interactionStates || []);
  const schema = { ...(component?.schema || {}), status: 'materialized' };
  const presets = Array.isArray(schema.presets) ? schema.presets : [];
  const implementationFile = implementation.trim();
  const stylesFile = styles ? `${styles}\n` : '';
  const previewFile = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="./styles.css"></head>
<body><main data-component-preview="${componentId}"><!-- implementation: implementation.html -->${implementationFile}</main></body></html>
`;
  const files = {
    'schema.json': json(schema),
    'presets.json': json({ componentId, presets }),
    'implementation.html': implementationFile,
    'styles.css': stylesFile,
    'assets.json': json({ componentId, assets }),
    'interactions.json': json({ componentId, ...interactions }),
    'preview.html': previewFile,
    'verification.json': json({ componentId, gates: verification }),
  };
  const fileEntries = Object.entries(files).map(([name, content]) => ({
    name,
    sha256: digest(content),
    byteLength: Buffer.byteLength(content, 'utf8'),
  }));
  const manifest = {
    contractVersion: 1,
    componentId,
    componentType: component?.sourceSectionType || schema.type || '',
    componentKind: 'section',
    componentVersion: 1,
    status: 'materialized',
    source: {
      sectionId: component?.sourceSectionId || null,
      sectionType: component?.sourceSectionType || null,
      sourceFingerprint: component?.sourceFingerprint || null,
      structuralFingerprint: component?.structuralFingerprint || null,
    },
    entry: 'implementation.html',
    preview: 'preview.html',
    schema: 'schema.json',
    presets: 'presets.json',
    packageFolder: safePackageFolder(componentId),
    requiredFiles: REQUIRED_COMPONENT_PACKAGE_FILES,
    files: fileEntries,
  };
  files['manifest.json'] = json(manifest);
  return { componentId, status: 'materialized', files, manifest };
}

export function auditPortableComponentPackage(packageRecord, { requireAccepted = false } = {}) {
  const failures = [];
  const files = packageRecord?.files || {};
  const allowedStatuses = requireAccepted ? ['accepted', 'registered'] : ['materialized', 'accepted', 'registered'];
  if (!allowedStatuses.includes(packageRecord?.status)) {
    failures.push({ type: 'invalid-package-status', status: packageRecord?.status || null });
  }
  for (const file of REQUIRED_COMPONENT_PACKAGE_FILES) {
    if (!Object.hasOwn(files, file)) failures.push({ type: 'missing-package-file', file });
  }
  if (failures.some((failure) => failure.type === 'missing-package-file')) return { pass: false, failures };

  const manifest = parseJsonFile(files, 'manifest.json', failures);
  const schema = parseJsonFile(files, 'schema.json', failures);
  parseJsonFile(files, 'presets.json', failures);
  const assets = parseJsonFile(files, 'assets.json', failures);
  parseJsonFile(files, 'interactions.json', failures);
  const verification = parseJsonFile(files, 'verification.json', failures);
  const implementation = files['implementation.html'];

  if (manifest?.componentId !== packageRecord.componentId) failures.push({ type: 'package-component-id-mismatch' });
  if (!String(implementation || '').trim()) failures.push({ type: 'empty-component-implementation' });
  const rootMarkerCount = [...String(implementation || '').matchAll(/\bdata-section-id\s*=/gi)].length;
  if (rootMarkerCount !== 1) failures.push({ type: 'invalid-component-root-count', count: rootMarkerCount });
  if (activeSourceScript(implementation)) failures.push({ type: 'active-source-script' });
  if (remoteIframe(implementation)) failures.push({ type: 'remote-source-iframe' });

  for (const setting of schema?.settings || []) {
    if (!setting?.id) continue;
    if (SECTION_ROOT_SETTING_IDS.has(setting.id)) continue;
    const escaped = String(setting.id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`\\bdata-setting=["']${escaped}["']`).test(String(implementation))) {
      failures.push({ type: 'missing-setting-binding', settingId: setting.id });
    }
  }
  for (const asset of assets?.assets || []) {
    if (asset?.resolved !== true) failures.push({ type: 'unresolved-package-asset', href: asset?.href || '' });
  }
  for (const gate of REQUIRED_COMPONENT_VERIFICATION_GATES) {
    const result = verification?.gates?.[gate];
    if (!result || result.pass !== true) failures.push({ type: 'package-verification-gate-failed', gate });
  }
  return { pass: failures.length === 0, failures };
}

export async function materializePortableComponentPackage(packageRecord, directory) {
  if (!directory) throw new TypeError('directory is required');
  const audit = auditPortableComponentPackage(packageRecord);
  if (!audit.pass) return { ...audit, written: false, directory };
  await fs.mkdir(directory, { recursive: true });
  await Promise.all(Object.entries(packageRecord.files).map(([name, content]) => (
    fs.writeFile(path.join(directory, name), String(content), 'utf8')
  )));
  return { pass: true, failures: [], written: true, directory };
}

export async function auditMaterializedComponentPackage(directory, options = {}) {
  const files = {};
  const failures = [];
  for (const name of REQUIRED_COMPONENT_PACKAGE_FILES) {
    try {
      files[name] = await fs.readFile(path.join(directory, name), 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') failures.push({ type: 'missing-package-file', file: name });
      else throw error;
    }
  }
  if (failures.length > 0) return { pass: false, failures };
  const manifest = JSON.parse(files['manifest.json']);
  return auditPortableComponentPackage({
    componentId: manifest.componentId,
    status: options.status || manifest.status || 'materialized',
    files,
  }, options);
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

export function auditComponentDelivery({
  candidates = [],
  excluded = [],
  formalComponents = [],
  packages = [],
  acceptedIds = [],
  registeredIds = [],
  pageReferences = [],
} = {}) {
  const failures = [];
  const candidateIds = candidates.map((candidate) => typeof candidate === 'string' ? candidate : candidate?.candidateId).filter(Boolean);
  const excludedIds = excluded.map((candidate) => candidate?.candidateId).filter(Boolean);
  const formalIds = formalComponents.map((component) => component?.componentId).filter(Boolean);
  const formalSourceIds = formalComponents.map((component) => component?.sourceCandidateId).filter(Boolean);
  const packageIds = packages.map((record) => record?.componentId).filter(Boolean);
  const accepted = new Set(acceptedIds);
  const registered = new Set(registeredIds);
  const packageIdSet = new Set(packageIds);

  for (const duplicate of duplicateValues(formalIds)) failures.push({ type: 'duplicate-formal-component-id', componentId: duplicate });
  for (const duplicate of duplicateValues(packageIds)) failures.push({ type: 'duplicate-package-id', componentId: duplicate });
  for (const item of excluded) {
    if (!item?.candidateId || !String(item?.reason || '').trim()) failures.push({ type: 'invalid-excluded-candidate', candidateId: item?.candidateId || null });
  }
  const accountedCandidates = new Set([...excludedIds, ...formalSourceIds]);
  for (const candidateId of candidateIds) {
    if (!accountedCandidates.has(candidateId)) failures.push({ type: 'unaccounted-component-candidate', candidateId });
  }
  for (const candidateId of accountedCandidates) {
    if (!candidateIds.includes(candidateId)) failures.push({ type: 'unknown-accounted-candidate', candidateId });
  }
  for (const componentId of formalIds) {
    if (!packageIdSet.has(componentId)) failures.push({ type: 'missing-formal-component-package', componentId });
    if (!accepted.has(componentId)) failures.push({ type: 'formal-component-not-accepted', componentId });
    if (!registered.has(componentId)) failures.push({ type: 'formal-component-not-registered', componentId });
  }
  for (const record of packages) {
    const audit = auditPortableComponentPackage(record);
    if (!audit.pass) failures.push(...audit.failures.map((failure) => ({ type: 'invalid-materialized-package', componentId: record?.componentId || null, failure })));
    if (!formalIds.includes(record?.componentId)) failures.push({ type: 'package-without-formal-component', componentId: record?.componentId || null });
  }
  for (const componentId of accepted) {
    if (!packageIdSet.has(componentId)) failures.push({ type: 'accepted-component-without-package', componentId });
  }
  for (const componentId of registered) {
    if (!accepted.has(componentId)) failures.push({ type: 'registered-component-not-accepted', componentId });
    if (!packageIdSet.has(componentId)) failures.push({ type: 'registered-component-without-package', componentId });
  }
  for (const page of pageReferences) {
    for (const componentId of page?.componentIds || []) {
      if (!registered.has(componentId)) failures.push({
        type: 'unregistered-page-component-reference',
        pageId: page?.pageId || null,
        componentId,
      });
    }
  }

  const counts = {
    candidates: candidateIds.length,
    excluded: excludedIds.length,
    formal: formalIds.length,
    materialized: packageIdSet.size,
    accepted: accepted.size,
    registered: registered.size,
  };
  if (counts.formal !== counts.materialized) failures.push({ type: 'formal-package-count-mismatch', formal: counts.formal, materialized: counts.materialized });
  if (counts.formal !== counts.accepted) failures.push({ type: 'formal-accepted-count-mismatch', formal: counts.formal, accepted: counts.accepted });
  if (counts.formal !== counts.registered) failures.push({ type: 'formal-registered-count-mismatch', formal: counts.formal, registered: counts.registered });
  return { pass: failures.length === 0, counts, failures };
}

