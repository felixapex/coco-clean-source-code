import path from 'node:path';
import { validateUrlSyntax } from '../security/url-policy.mjs';

const AUTH_STATUSES = new Set(['owned', 'authorized', 'public-benchmark']);
const ROBOTS_POLICIES = new Set(['respect', 'record-only']);

const DEFAULT_RELEASE_GATES = {
  minSites: 10,
  minCoverage: 0.98,
  minClusteringF1: 0.85,
  maxOverMergeRate: 0.05,
  maxUnderMergeRate: 0.12,
  minSemanticRoleAccuracy: 0.90,
  minVariantAccuracy: 0.80,
  minStateF1: 0.80,
  minPerSiteCoverage: 0.90,
  minPerSiteClusteringF1: 0.75,
};

function requireString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function validateAuthorization(value, siteId) {
  if (!value || typeof value !== 'object') throw new Error(`Site ${siteId} requires authorization`);
  const status = requireString(value.status, `Site ${siteId} authorization.status`);
  if (!AUTH_STATUSES.has(status)) throw new Error(`Unsupported authorization status for ${siteId}: ${status}`);
  const attestedBy = requireString(value.attestedBy, `Site ${siteId} authorization.attestedBy`);
  const attestedAt = requireString(value.attestedAt, `Site ${siteId} authorization.attestedAt`);
  if (Number.isNaN(Date.parse(attestedAt))) throw new Error(`Invalid authorization.attestedAt for ${siteId}`);
  return { status, attestedBy, attestedAt: new Date(attestedAt).toISOString(), evidence: value.evidence ?? null };
}

function normalizeCapturePolicy(value = {}, siteId) {
  const robots = value.robots ?? 'respect';
  if (!ROBOTS_POLICIES.has(robots)) throw new Error(`Unsupported robots policy for ${siteId}: ${robots}`);
  const maxPages = value.maxPages ?? 20;
  if (!Number.isInteger(maxPages) || maxPages <= 0 || maxPages > 500) throw new Error(`Invalid maxPages for ${siteId}`);
  return {
    robots,
    maxPages,
    timeoutMs: Number.isInteger(value.timeoutMs) && value.timeoutMs > 0 ? value.timeoutMs : 30000,
  };
}

export function validateRealSiteSuite(input) {
  if (!input || input.version !== '1.0' || !Array.isArray(input.sites) || input.sites.length === 0) {
    throw new Error('Invalid real-site suite; version 1.0 with non-empty sites is required');
  }
  const ids = new Set();
  const sites = input.sites.map((raw, index) => {
    const id = requireString(raw?.id, `sites[${index}].id`);
    if (ids.has(id)) throw new Error(`Duplicate site id: ${id}`);
    ids.add(id);
    const url = validateUrlSyntax(requireString(raw.url, `Site ${id} url`)).href;
    return {
      ...raw,
      id,
      url,
      authorization: validateAuthorization(raw.authorization, id),
      capturePolicy: normalizeCapturePolicy(raw.capturePolicy, id),
    };
  });
  return {
    version: '1.0',
    name: input.name ?? 'real-site-release-suite',
    releaseGates: { ...DEFAULT_RELEASE_GATES, ...(input.releaseGates ?? {}) },
    sites,
  };
}

export function buildCapturePlan(input, outputRoot) {
  const suite = validateRealSiteSuite(input);
  const root = path.resolve(outputRoot);
  return suite.sites.map((site) => ({
    siteId: site.id,
    startUrl: site.url,
    outputRoot: path.join(root, site.id),
    authorization: site.authorization,
    robotsPolicy: site.capturePolicy.robots,
    maxPages: site.capturePolicy.maxPages,
    timeoutMs: site.capturePolicy.timeoutMs,
  }));
}
