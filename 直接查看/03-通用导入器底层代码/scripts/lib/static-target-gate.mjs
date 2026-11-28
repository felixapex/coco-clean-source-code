import fs from 'node:fs/promises';
import path from 'node:path';

export async function generatedStaticTargetExists(distRoot, target) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(String(target), 'http://matbox.local').pathname); } catch { return false; }
  const relativeTarget = pathname.replace(/^\/+/, '');
  if (!relativeTarget || relativeTarget.split(/[\\/]+/).includes('..')) return false;
  const root = path.resolve(distRoot);
  const candidate = path.resolve(root, relativeTarget);
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false;
  try { return (await fs.stat(candidate)).isFile(); } catch { return false; }
}
