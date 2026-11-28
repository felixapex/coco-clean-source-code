const RESOURCE_KINDS = new Set([
  'stylesheet',
  'style-import',
  'font',
  'background-image',
  'image',
]);

function validHttpUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function safeLocalPath(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  const normalized = value.replace(/\\/g, '/');
  return !normalized.startsWith('/')
    && !/^[a-z]:/i.test(normalized)
    && !normalized.split('/').includes('..')
    && !normalized.includes('://');
}

function missingFields(resource) {
  const required = [
    'id', 'kind', 'sourceUrl', 'localPath', 'sha256', 'byteLength',
    'status', 'critical', 'referencedBy',
  ];
  return required.filter((field) => {
    const value = resource?.[field];
    if (field === 'critical') return typeof value !== 'boolean';
    if (field === 'byteLength') return !Number.isInteger(value) || value <= 0;
    if (field === 'referencedBy') return !Array.isArray(value) || value.length === 0;
    return typeof value !== 'string' || value.trim().length === 0;
  });
}

export function evaluateResourceManifest(manifest = {}) {
  const failures = [];
  if (!validHttpUrl(manifest.baseUrl)) failures.push({ type: 'invalid-base-url', value: manifest.baseUrl ?? null });
  if (manifest.discoveryComplete !== true) failures.push({ type: 'discovery-incomplete' });
  if (manifest.rewritesComplete !== true) failures.push({ type: 'rewrites-incomplete' });

  const unresolved = Array.isArray(manifest.unresolvedReferences) ? manifest.unresolvedReferences : [];
  for (const sourceUrl of unresolved) failures.push({ type: 'unresolved-reference', sourceUrl });

  const resources = Array.isArray(manifest.resources) ? manifest.resources : [];
  const seenUrls = new Set();
  for (const resource of resources) {
    for (const field of missingFields(resource)) {
      failures.push({ type: 'missing-resource-field', resourceId: resource?.id ?? null, field });
    }
    if (!RESOURCE_KINDS.has(resource?.kind)) {
      failures.push({ type: 'invalid-resource-kind', resourceId: resource?.id ?? null, kind: resource?.kind ?? null });
    }
    if (!validHttpUrl(resource?.sourceUrl)) {
      failures.push({ type: 'invalid-resource-url', resourceId: resource?.id ?? null, sourceUrl: resource?.sourceUrl ?? null });
    } else if (seenUrls.has(resource.sourceUrl)) {
      failures.push({ type: 'duplicate-resource-url', sourceUrl: resource.sourceUrl });
    } else {
      seenUrls.add(resource.sourceUrl);
    }
    if (!safeLocalPath(resource?.localPath)) {
      failures.push({ type: 'unsafe-local-path', resourceId: resource?.id ?? null, localPath: resource?.localPath ?? null });
    }
    if (typeof resource?.sha256 === 'string' && !/^[a-f0-9]{64}$/i.test(resource.sha256)) {
      failures.push({ type: 'invalid-resource-hash', resourceId: resource?.id ?? null });
    }
    if (resource?.critical === true && resource?.status !== 'frozen') {
      failures.push({ type: 'critical-resource-not-frozen', resourceId: resource?.id ?? null, status: resource?.status ?? 'missing' });
    }
  }

  return {
    pass: failures.length === 0,
    status: failures.length === 0 ? 'passed' : 'failed',
    resourceCount: resources.length,
    failures,
  };
}

export async function verifyFrozenResourceFiles(manifest = {}, resourceRoot) {
  const contract = evaluateResourceManifest(manifest);
  const failures = [...contract.failures];
  const root = path.resolve(resourceRoot || '');
  if (!resourceRoot) failures.push({ type: 'missing-resource-root' });

  for (const resource of manifest.resources || []) {
    if (resource.status !== 'frozen' || !safeLocalPath(resource.localPath) || !resourceRoot) continue;
    const file = path.resolve(root, resource.localPath);
    const relative = path.relative(root, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      failures.push({ type: 'resource-file-outside-root', resourceId: resource.id, localPath: resource.localPath });
      continue;
    }
    let buffer;
    try {
      buffer = await readFile(file);
    } catch (error) {
      failures.push({ type: 'resource-file-missing', resourceId: resource.id, localPath: resource.localPath, error: error?.code ?? 'read-failed' });
      continue;
    }
    if (buffer.length !== resource.byteLength) {
      failures.push({ type: 'resource-size-mismatch', resourceId: resource.id, expected: resource.byteLength, actual: buffer.length });
    }
    const digest = createHash('sha256').update(buffer).digest('hex');
    if (digest !== resource.sha256) {
      failures.push({ type: 'resource-hash-mismatch', resourceId: resource.id, expected: resource.sha256, actual: digest });
    }
  }

  return {
    pass: failures.length === 0,
    status: failures.length === 0 ? 'passed' : 'failed',
    resourceCount: Array.isArray(manifest.resources) ? manifest.resources.length : 0,
    failures,
  };
}

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

