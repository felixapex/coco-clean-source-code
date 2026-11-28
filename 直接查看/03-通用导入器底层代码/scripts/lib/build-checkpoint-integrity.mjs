import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function isHtml(buffer) {
  const head = buffer.subarray(0, 256).toString('utf8').trimStart().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html');
}

async function auditOne(stageDir, replayFile, sourceReplayDir) {
  const failures = [];
  if (!replayFile || path.basename(replayFile) !== replayFile) {
    return [{ type: 'invalid-replay-filename', replayFile }];
  }
  const replayPath = path.join(stageDir, 'replay', replayFile);
  let replay;
  try {
    replay = await fs.readFile(replayPath);
  } catch (error) {
    failures.push({
      type: error?.code === 'ENOENT' ? 'replay-missing' : 'replay-unreadable',
      replayFile,
      error: error?.code || error?.message || String(error),
    });
    return failures;
  }
  if (!isHtml(replay)) failures.push({ type: 'replay-not-html', replayFile });

  const checkpointPath = path.join(
    stageDir,
    '.matbox-checkpoints',
    'pages',
    `${encodeURIComponent(replayFile)}.json`,
  );
  let checkpoint;
  try {
    checkpoint = JSON.parse(await fs.readFile(checkpointPath, 'utf8'));
  } catch (error) {
    failures.push({
      type: error?.code === 'ENOENT' ? 'checkpoint-missing' : 'checkpoint-invalid',
      replayFile,
      error: error?.code || error?.message || String(error),
    });
    return failures;
  }
  if (checkpoint.status !== 'completed' || checkpoint.replayFile !== replayFile) {
    failures.push({ type: 'checkpoint-state-invalid', replayFile });
  }
  const actualOutputSha256 = sha256(replay);
  if (checkpoint.outputSha256 !== actualOutputSha256) {
    failures.push({
      type: 'checkpoint-output-hash-mismatch',
      replayFile,
      expected: checkpoint.outputSha256 || null,
      actual: actualOutputSha256,
    });
  }
  if (sourceReplayDir) {
    try {
      const source = await fs.readFile(path.join(sourceReplayDir, replayFile));
      const actualSourceSha256 = sha256(source);
      if (checkpoint.sourceSha256 !== actualSourceSha256) {
        failures.push({
          type: 'checkpoint-source-hash-mismatch',
          replayFile,
          expected: checkpoint.sourceSha256 || null,
          actual: actualSourceSha256,
        });
      }
    } catch (error) {
      failures.push({
        type: error?.code === 'ENOENT' ? 'source-replay-missing' : 'source-replay-unreadable',
        replayFile,
        error: error?.code || error?.message || String(error),
      });
    }
  }
  return failures;
}

export async function auditBuildCheckpointIntegrity({
  stageDir,
  sourceReplayDir,
  replayFiles,
  readConcurrency = 32,
} = {}) {
  if (!stageDir) throw new TypeError('stageDir is required');
  if (!Array.isArray(replayFiles)) throw new TypeError('replayFiles must be an array');
  if (!Number.isInteger(readConcurrency) || readConcurrency < 1) {
    throw new TypeError('readConcurrency must be a positive integer');
  }
  const uniqueReplayFiles = [...new Set(replayFiles)].sort();
  const failures = [];
  for (let index = 0; index < uniqueReplayFiles.length; index += readConcurrency) {
    const batch = uniqueReplayFiles.slice(index, index + readConcurrency);
    const batchFailures = await Promise.all(batch.map((replayFile) => auditOne(stageDir, replayFile, sourceReplayDir)));
    failures.push(...batchFailures.flat());
  }
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    stageDir: path.resolve(stageDir),
    replayFileCount: uniqueReplayFiles.length,
    failureCount: failures.length,
    failures,
    pass: failures.length === 0,
  };
}

export function assertBuildCheckpointIntegrity(report, label = 'build checkpoint integrity') {
  if (!report?.pass) {
    throw new Error(`${label} failed: ${JSON.stringify((report?.failures || []).slice(0, 20))}`);
  }
  return report;
}
