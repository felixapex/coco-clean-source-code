import fs from 'node:fs/promises';
import path from 'node:path';
import { renderComponentCss, renderLayoutCss } from '../compiler/visual-css.mjs';

const FILES = ['src/component-styles.css', 'src/layout.css'];

async function readWorkspaceFiles(workspaceDir) {
  const files = {};
  for (const rel of FILES) {
    const abs = path.join(workspaceDir, rel);
    try {
      files[rel] = await fs.readFile(abs, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      files[rel] = '';
    }
  }
  return files;
}

export async function captureVisualWorkspaceRevision(workspaceDir, { id = `rev-${Date.now()}` } = {}) {
  return {
    id,
    workspaceDir,
    files: await readWorkspaceFiles(workspaceDir),
  };
}

export async function applyDeterministicVisualRepair({ ir, workspaceDir, id = `rev-${Date.now()}` }) {
  if (!ir) throw new Error('ir is required');
  if (!workspaceDir) throw new Error('workspaceDir is required');
  const componentCss = renderComponentCss(ir);
  const layoutCss = renderLayoutCss(ir);
  await fs.mkdir(path.join(workspaceDir, 'src'), { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(workspaceDir, 'src/component-styles.css'), componentCss, 'utf8'),
    fs.writeFile(path.join(workspaceDir, 'src/layout.css'), layoutCss, 'utf8'),
  ]);
  return captureVisualWorkspaceRevision(workspaceDir, { id });
}

export async function restoreVisualWorkspaceRevision(revision, workspaceDir = revision?.workspaceDir) {
  if (!revision?.files) throw new Error('revision.files is required');
  if (!workspaceDir) throw new Error('workspaceDir is required');
  for (const [rel, content] of Object.entries(revision.files)) {
    const abs = path.join(workspaceDir, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf8');
  }
  return revision;
}
