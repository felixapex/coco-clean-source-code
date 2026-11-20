import fs from 'node:fs/promises';
import path from 'node:path';

function safeSlug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'site';
}

function timestamp(date) {
  return date.toISOString().replace(/[-:TZ]/g, '').replace('.', '-').slice(0, 19).replace(/^(\d{8})(\d{6})-(\d{3})$/, '$1-$2-$3');
}

export async function createIsolatedProjectWorkspace({ projectsRoot, sourceUrl, now = new Date() }) {
  if (!projectsRoot) throw new Error('projectsRoot is required');
  const parsed = new URL(sourceUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('sourceUrl must use http or https');
  parsed.hash = '';
  const root = path.resolve(projectsRoot);
  await fs.mkdir(root, { recursive: true });
  const baseId = `${safeSlug(parsed.hostname)}-${timestamp(now)}`;

  let projectId = baseId;
  let projectRoot;
  for (let suffix = 1; ; suffix += 1) {
    projectId = suffix === 1 ? baseId : `${baseId}-${String(suffix).padStart(2, '0')}`;
    projectRoot = path.join(root, projectId);
    try {
      await fs.mkdir(projectRoot, { recursive: false });
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }

  const metadata = {
    schemaVersion: '1.0',
    projectId,
    sourceUrl: parsed.href,
    createdAt: now.toISOString(),
    paths: {
      captures: 'captures',
      componentLibrary: 'component-library',
      generatedSite: 'generated-site',
      acceptance: 'acceptance',
    },
  };
  await Promise.all(Object.values(metadata.paths).map((name) => fs.mkdir(path.join(projectRoot, name))));
  await fs.writeFile(path.join(projectRoot, 'project.json'), `${JSON.stringify(metadata, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  return { projectId, projectRoot, metadata };
}
