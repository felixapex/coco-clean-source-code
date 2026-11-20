import fs from 'node:fs/promises';
import path from 'node:path';

const siteRoot = path.resolve(process.argv[2] || '交付文件/Coco完整网站交接包_2026-11-20/site');
const compact = process.argv.includes('--compact');
const replayRoot = path.join(siteRoot, 'replay');
const routeMap = JSON.parse(await fs.readFile(path.join(replayRoot, 'routes.json'), 'utf8'));
const files = [...new Set(Object.values(routeMap))].sort();
const resourceAttributes = new Set([
  'src',
  'poster',
  'data-src',
  'data-lazy-src',
  'data-original',
  'srcset',
  'data-srcset',
  'data-lazy-srcset',
]);
const findings = [];
const navigationFindings = [];
const forbiddenNavigationHosts = new Set([
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
]);

function addFinding(file, tagName, attribute, value) {
  const candidates = attribute.includes('srcset')
    ? String(value).split(',').map((part) => part.trim().split(/\s+/)[0])
    : [String(value).trim()];
  for (const candidate of candidates) {
    if (!/^(?:https?:)?\/\//i.test(candidate)) continue;
    let hostname = '<invalid>';
    try { hostname = new URL(candidate.startsWith('//') ? `https:${candidate}` : candidate).hostname; } catch {}
    findings.push({ file, tag: tagName, attribute, hostname, url: candidate });
  }
}

function addNavigationFinding(file, tagName, attribute, value) {
  const candidate = String(value).trim();
  if (!/^(?:https?:)?\/\//i.test(candidate)) return;
  let hostname = '<invalid>';
  try { hostname = new URL(candidate.startsWith('//') ? `https:${candidate}` : candidate).hostname; } catch {}
  navigationFindings.push({ file, tag: tagName, attribute, hostname, url: candidate });
}

for (const file of files) {
  const html = await fs.readFile(path.join(replayRoot, file), 'utf8');
  for (const tagMatch of html.matchAll(/<([a-z][\w:-]*)\b[^>]*>/gi)) {
    const tag = tagMatch[0];
    const tagName = tagMatch[1].toLowerCase();
    for (const attributeMatch of tag.matchAll(/\s([\w:-]+)\s*=\s*(["'])(.*?)\2/gis)) {
      const attribute = attributeMatch[1].toLowerCase();
      const value = attributeMatch[3];
      if (resourceAttributes.has(attribute) || (tagName === 'link' && attribute === 'href')) {
        addFinding(file, tagName, attribute, value);
      }
      if ((tagName === 'a' && attribute === 'href') || (tagName === 'form' && attribute === 'action')) {
        addNavigationFinding(file, tagName, attribute, value);
      }
    }
  }
  for (const match of html.matchAll(/url\(\s*(['"]?)(https?:\/\/[^'")\s]+)\1\s*\)/gi)) {
    addFinding(file, 'style', 'css-url', match[2]);
  }
}

const counts = {};
for (const finding of findings) {
  const key = `${finding.tag}:${finding.attribute}:${finding.hostname}`;
  counts[key] = (counts[key] || 0) + 1;
}
const grouped = Object.entries(counts)
  .map(([key, count]) => ({ key, count }))
  .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
const examples = [];
for (const group of grouped) {
  const [tag, attribute, hostname] = group.key.split(':');
  examples.push({
    ...group,
    examples: findings
      .filter((finding) => finding.tag === tag && finding.attribute === attribute && finding.hostname === hostname)
      .slice(0, 3),
  });
}

const navigationCounts = {};
for (const finding of navigationFindings) {
  const key = `${finding.tag}:${finding.attribute}:${finding.hostname}`;
  navigationCounts[key] = (navigationCounts[key] || 0) + 1;
}
const forbiddenNavigationFindings = navigationFindings.filter((finding) => forbiddenNavigationHosts.has(finding.hostname.replace(/^www\./, '')));

console.log(JSON.stringify({
  siteRoot,
  htmlFiles: files.length,
  filesWithExternalResources: new Set(findings.map((finding) => finding.file)).size,
  externalResourceReferences: findings.length,
  groups: compact ? grouped : examples,
  filesWithExternalNavigation: new Set(navigationFindings.map((finding) => finding.file)).size,
  externalNavigationReferences: navigationFindings.length,
  forbiddenExternalNavigationReferences: forbiddenNavigationFindings.length,
  navigationGroups: Object.entries(navigationCounts)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
}, null, 2));

if (findings.length || forbiddenNavigationFindings.length) process.exitCode = 1;
