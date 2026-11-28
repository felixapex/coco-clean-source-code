import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(new URL('./windows-image-fetch.ps1', import.meta.url));

function runPowerShell(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal, stderr }));
  });
}

export async function fetchImageWithWindowsPowerShell(url, {
  timeoutMs = 20_000,
  userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MatboxImageRecovery/1.0',
} = {}) {
  if (process.platform !== 'win32') throw new Error('Windows system image transport is only available on win32');
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-image-fetch-'));
  const outputPath = path.join(tempRoot, 'body.bin');
  const metadataPath = path.join(tempRoot, 'metadata.json');
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const executable = process.env.MATBOX_POWERSHELL_PATH
    || path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  try {
    const result = await runPowerShell(executable, [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-Url',
      String(url),
      '-OutputPath',
      outputPath,
      '-MetadataPath',
      metadataPath,
      '-TimeoutSeconds',
      String(Math.max(1, Math.ceil(timeoutMs / 1000))),
      '-UserAgent',
      userAgent,
    ]);
    const metadataText = await fs.readFile(metadataPath, 'utf8').catch(() => '');
    const metadata = metadataText ? JSON.parse(metadataText.replace(/^\uFEFF/, '')) : {};
    if (result.code !== 0 || !metadata.ok) {
      return {
        ok: false,
        status: Number(metadata.status || 0),
        error: metadata.error || result.stderr || `PowerShell image fetch exited ${result.code ?? result.signal}`,
      };
    }
    const buffer = await fs.readFile(outputPath);
    return {
      ok: true,
      status: Number(metadata.status || 200),
      resolvedSource: metadata.resolvedSource || String(url),
      contentType: metadata.contentType || '',
      buffer,
    };
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}
