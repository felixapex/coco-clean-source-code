import fs from 'node:fs/promises';
import path from 'node:path';

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function promoteVerifiedDirectory({ stagingDir, acceptedDir, verification } = {}) {
  if (!verification?.pass || verification.status !== 'passed') {
    return { pass: false, promoted: false, failures: verification?.failures ?? [{ type: 'verification-not-passed' }] };
  }
  if (!stagingDir || !acceptedDir || !await exists(stagingDir)) {
    return { pass: false, promoted: false, failures: [{ type: 'invalid-or-missing-staged-candidate' }] };
  }
  await fs.mkdir(path.dirname(acceptedDir), { recursive: true });
  const backupDir = `${acceptedDir}.previous`;
  const hadAccepted = await exists(acceptedDir);
  if (await exists(backupDir)) await fs.rm(backupDir, { recursive: true, force: true });
  if (hadAccepted) await fs.rename(acceptedDir, backupDir);
  try {
    await fs.rename(stagingDir, acceptedDir);
  } catch (error) {
    if (hadAccepted && await exists(backupDir) && !await exists(acceptedDir)) {
      await fs.rename(backupDir, acceptedDir);
    }
    throw error;
  }
  if (hadAccepted && await exists(backupDir)) await fs.rm(backupDir, { recursive: true, force: true });
  return { pass: true, promoted: true, acceptedDir, failures: [] };
}

