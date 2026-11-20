import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const inflight = new Map();

function uniqueHttpUrls(values) {
  return [...new Set(values.filter(Boolean).map(String).filter((value) => /^https?:\/\//i.test(value)))];
}

async function readIndex(cacheDir) {
  try { return JSON.parse(await fs.readFile(path.join(cacheDir, 'resource-index.json'), 'utf8')); } catch { return {}; }
}

async function writeIndex(cacheDir, index) {
  const target = path.join(cacheDir, 'resource-index.json');
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, target);
}

function validate(buffer, sourceUrl, validateResource) {
  let valid = false;
  try { valid = validateResource(buffer, sourceUrl) !== false; } catch (error) { throw error; }
  if (!valid) throw new Error(`Resource validation failed for ${sourceUrl}`);
}

async function performRecovery({
  primaryUrl,
  declaredCandidates = [],
  cacheDir,
  fetchResource,
  validateResource,
  maxAttemptsPerCandidate = 3,
}) {
  if (!primaryUrl || !/^https?:\/\//i.test(primaryUrl)) throw new Error('recoverResource requires an HTTP primaryUrl');
  if (!cacheDir) throw new Error('recoverResource requires cacheDir');
  if (typeof fetchResource !== 'function') throw new Error('recoverResource requires fetchResource');
  if (typeof validateResource !== 'function') throw new Error('recoverResource requires validateResource');
  await fs.mkdir(cacheDir, { recursive: true });
  const candidates = uniqueHttpUrls([primaryUrl, ...declaredCandidates]);
  const index = await readIndex(cacheDir);
  for (const candidate of candidates) {
    const digest = index[candidate];
    if (!digest) continue;
    const cachePath = path.join(cacheDir, `${digest}.bin`);
    try {
      const buffer = await fs.readFile(cachePath);
      validate(buffer, candidate, validateResource);
      return { pass: true, sourceUrl: candidate, cachePath, attempts: [], reused: true };
    } catch {}
  }

  const attempts = [];
  let lastError = null;
  const attemptLimit = Math.max(1, Number(maxAttemptsPerCandidate) || 1);
  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    const sourceUrl = candidates[candidateIndex];
    for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
      try {
        const buffer = Buffer.from(await fetchResource(sourceUrl, { attempt, candidateIndex }));
        validate(buffer, sourceUrl, validateResource);
        const digest = crypto.createHash('sha256').update(buffer).digest('hex');
        const cachePath = path.join(cacheDir, `${digest}.bin`);
        try { await fs.access(cachePath); } catch { await fs.writeFile(cachePath, buffer); }
        const nextIndex = { ...index };
        for (const candidate of candidates) nextIndex[candidate] = digest;
        await writeIndex(cacheDir, nextIndex);
        attempts.push({ sourceUrl, attempt, ok: true });
        return { pass: true, sourceUrl, cachePath, attempts, reused: false };
      } catch (error) {
        lastError = error;
        attempts.push({ sourceUrl, attempt, ok: false, error: error?.message || String(error) });
      }
    }
  }
  return {
    pass: false,
    sourceUrl: null,
    cachePath: null,
    attempts,
    failure: { message: lastError?.message || `Unable to recover ${primaryUrl}` },
  };
}

export function recoverResource(options) {
  const candidates = uniqueHttpUrls([options?.primaryUrl, ...(options?.declaredCandidates || [])]);
  const key = `${path.resolve(options?.cacheDir || '.')}\n${candidates.join('\n')}`;
  if (inflight.has(key)) return inflight.get(key);
  const operation = performRecovery(options).finally(() => inflight.delete(key));
  inflight.set(key, operation);
  return operation;
}
