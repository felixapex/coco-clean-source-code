import fs from 'node:fs/promises';
import path from 'node:path';
import { auditPublishedSiteHtml } from './published-site-audit.mjs';

const forbiddenSourceHosts = [
  'cocorepublic.com.au',
  'cocorepublic.co.nz',
  'cocorepublichelp.zendesk.com',
  'store-hkpsknj5ns.mybigcommerce.com',
  'store-mc0jqubfon.mybigcommerce.com',
  'store-r9qus9llfb.mybigcommerce.com',
  'viewer.ipaper.io',
  'republicpropertystyling.com.au',
  'lamericano.com.au',
  'olessio.com.au',
];

export async function verifyCleanPublishedSite(siteRoot) {
  const replayRoot = path.join(siteRoot, 'replay');
  const routeMap = JSON.parse(await fs.readFile(path.join(replayRoot, 'routes.json'), 'utf8'));
  const files = [...new Set(Object.values(routeMap))].sort();
  const failures = [];
  let externalRuntimeResources = 0;
  let forbiddenSourceNavigation = 0;

  for (const filename of files) {
    const html = await fs.readFile(path.join(replayRoot, filename), 'utf8');
    const result = auditPublishedSiteHtml(html, { sourceHosts: forbiddenSourceHosts });
    externalRuntimeResources += result.resourceReferences.length;
    forbiddenSourceNavigation += result.sourceNavigation.length;
    if (!result.pass) failures.push({ filename, failures: result.failures });
  }

  return {
    pass: failures.length === 0,
    htmlFiles: files.length,
    externalRuntimeResources,
    forbiddenSourceNavigation,
    failures: failures.slice(0, 20),
  };
}
