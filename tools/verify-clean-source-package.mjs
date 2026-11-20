import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REQUIRED_FILES = [
  'README.md',
  'IMPLEMENTATION-STATUS.md',
  'TEST-EVIDENCE.md',
  'verification-report.json',
  'verify-source.cmd',
  'tools/verify-clean-source-package.mjs',
  'standards/01-组件与模板开发标准.md',
  'standards/04-导入与转换标准.md',
  'standards/05-自动验收标准.md',
  'standards/09-最终导入底层执行标准.md',
  'standards/10-全部执行思路总纲.md',
  'workspace/实测/CocoRepublic_2026-10-22/generated-site-v1/package.json',
  'workspace/实测/CocoRepublic_2026-10-22/generated-site-v1/scripts/run-20-minute-pipeline.mjs',
  'workspace/实测/CocoRepublic_2026-10-22/generated-site-v1/scripts/importers/select-importer.mjs',
  'workspace/实测/CocoRepublic_2026-10-22/generated-site-v1/scripts/importers/wix-importer.mjs',
  'workspace/实测/CocoRepublic_2026-10-22/generated-site-v1/scripts/lib/incremental-build-gate.mjs',
  'workspace/实测/CocoRepublic_2026-10-22/generated-site-v1/scripts/lib/pipeline-timing.mjs',
  'workspace/实测/CocoRepublic_2026-10-22/generated-site-v1/scripts/lib/unit-self-verification.mjs',
  'workspace/实测/CocoRepublic_2026-10-22/generated-site-v1/src/component-registry.ts',
  'workspace/实测/CocoRepublic_2026-10-22/generated-site-v1/src/main.tsx',
  'workspace/实测/CocoRepublic_2026-10-22/generated-site-v1/tests/importer-selection.test.mjs',
  'workspace/实测/CocoRepublic_2026-10-22/generated-site-v1/tests/edge-launch-safety.test.mjs',
  'workspace/packages/import-foundation/component-package.mjs',
  'workspace/packages/import-foundation/registry-adapter.mjs',
  'workspace/packages/import-foundation/tests/component-package.test.mjs',
  'workspace/experiments/coco-homepage-method-benchmark/benchmark.mjs',
  'workspace/scripts/register-central-component-library.mjs',
  'workspace/交付文件/拆网站_V2.9_联调可执行修正版_2026-09-09/PACKAGE/08_POC_SOURCE_PATCHED/package.json',
  'workspace/交付文件/拆网站_V2.9_联调可执行修正版_2026-09-09/PACKAGE/08_POC_SOURCE_PATCHED/package-lock.json',
  'workspace/交付文件/拆网站_V2.9_联调可执行修正版_2026-09-09/PACKAGE/08_POC_SOURCE_PATCHED/examples/multi-page-site.mjs',
  'workspace/交付文件/拆网站_V2.9_联调可执行修正版_2026-09-09/PACKAGE/08_POC_SOURCE_PATCHED/examples/visual-fidelity-site.mjs',
  'workspace/交付文件/拆网站_V2.9_联调可执行修正版_2026-09-09/PACKAGE/08_POC_SOURCE_PATCHED/src/capture/chromium-capture.mjs',
  'workspace/交付文件/拆网站_V2.9_联调可执行修正版_2026-09-09/PACKAGE/08_POC_SOURCE_PATCHED/src/component/fingerprint.mjs',
  'workspace/交付文件/拆网站_V2.9_联调可执行修正版_2026-09-09/PACKAGE/08_POC_SOURCE_PATCHED/src/pipeline/run-site-component-pipeline.mjs',
  'workspace/交付文件/拆网站_V2.9_联调可执行修正版_2026-09-09/PACKAGE/08_POC_SOURCE_PATCHED/test/capture/edge-launch-policy.test.mjs',
  'delivery-verification/verify-package.mjs',
  'delivery-verification/clean-publish-gate.mjs',
];

const FORBIDDEN_SEGMENTS = new Set([
  'node_modules',
  'dist',
  'artifacts',
  '.cache',
  '__pycache__',
  'screenshots',
  'coverage',
]);

const FORBIDDEN_EXTENSIONS = new Set([
  '.7z', '.zip', '.rar', '.001', '.exe', '.dll', '.dmp', '.log',
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.mp4', '.webm', '.woff', '.woff2',
]);

const MAX_SOURCE_FILE_BYTES = 2 * 1024 * 1024;

function normalizeRelative(value) {
  return value.split(path.sep).join('/');
}

async function listFiles(root) {
  const files = [];
  const links = [];
  async function walk(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = normalizeRelative(path.relative(root, absolute));
      if (entry.isSymbolicLink()) {
        links.push(relative);
      } else if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        files.push(relative);
      }
    }
  }
  await walk(root);
  return { files: files.sort(), links: links.sort() };
}

async function sha256(file) {
  return createHash('sha256').update(await fs.readFile(file)).digest('hex');
}

async function readManifest(root) {
  const manifestPath = path.join(root, 'SHA256SUMS.txt');
  try {
    const text = await fs.readFile(manifestPath, 'utf8');
    const entries = new Map();
    for (const rawLine of text.split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (!line) continue;
      const match = /^([a-f0-9]{64})\s+\*?(.+)$/iu.exec(line);
      if (!match) throw new Error(`Invalid SHA256 line: ${rawLine}`);
      entries.set(match[2].replaceAll('\\', '/'), match[1].toLowerCase());
    }
    return { exists: true, entries, error: null };
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, entries: new Map(), error: null };
    return { exists: true, entries: new Map(), error: error.message };
  }
}

export async function verifyCleanSourcePackage(packageRoot, options = {}) {
  const root = path.resolve(packageRoot);
  const report = {
    packageRoot: root,
    pass: false,
    fileCount: 0,
    totalBytes: 0,
    missingRequiredFiles: [],
    forbiddenPaths: [],
    symbolicLinks: [],
    oversizedFiles: [],
    manifest: { exists: false, error: null, missing: [], mismatched: [], extra: [] },
  };

  try {
    const stat = await fs.stat(root);
    if (!stat.isDirectory()) throw new Error('Package path is not a directory');
  } catch (error) {
    report.error = `Package is missing: ${error.message}`;
    return report;
  }

  const { files, links } = await listFiles(root);
  report.fileCount = files.length;
  report.symbolicLinks = links;

  const fileSet = new Set(files);
  report.missingRequiredFiles = REQUIRED_FILES.filter((file) => !fileSet.has(file));

  for (const relative of files) {
    const segments = relative.split('/');
    const name = segments.at(-1);
    const lower = name.toLowerCase();
    const extension = path.extname(lower);
    const stat = await fs.stat(path.join(root, ...segments));
    report.totalBytes += stat.size;

    if (
      segments.some((segment) => FORBIDDEN_SEGMENTS.has(segment.toLowerCase()) || segment.toLowerCase().startsWith('.dist-'))
      || FORBIDDEN_EXTENSIONS.has(extension)
      || lower === '.env'
      || lower.startsWith('.env.')
      || lower.endsWith('.pem')
      || lower.endsWith('.key')
    ) {
      report.forbiddenPaths.push(relative);
    }
    if (stat.size > MAX_SOURCE_FILE_BYTES) report.oversizedFiles.push({ path: relative, bytes: stat.size });
  }

  if (!options.skipManifest) {
    const parsed = await readManifest(root);
    report.manifest.exists = parsed.exists;
    report.manifest.error = parsed.error;
    const payloadFiles = files.filter((file) => file !== 'SHA256SUMS.txt');
    report.manifest.missing = payloadFiles.filter((file) => !parsed.entries.has(file));
    report.manifest.extra = [...parsed.entries.keys()].filter((file) => !fileSet.has(file) || file === 'SHA256SUMS.txt');
    if (parsed.exists && !parsed.error) {
      for (const file of payloadFiles) {
        const expected = parsed.entries.get(file);
        if (!expected) continue;
        const actual = await sha256(path.join(root, ...file.split('/')));
        if (actual !== expected) report.manifest.mismatched.push(file);
      }
    }
  }

  report.pass = report.missingRequiredFiles.length === 0
    && report.forbiddenPaths.length === 0
    && report.symbolicLinks.length === 0
    && report.oversizedFiles.length === 0
    && (options.skipManifest || (
      report.manifest.exists
      && !report.manifest.error
      && report.manifest.missing.length === 0
      && report.manifest.mismatched.length === 0
      && report.manifest.extra.length === 0
    ));
  return report;
}

async function main() {
  const args = process.argv.slice(2);
  const skipManifest = args.includes('--skip-manifest');
  const packagePath = args.find((arg) => !arg.startsWith('--'));
  if (!packagePath) {
    console.error('Usage: node verify-coco-clean-source-package.mjs <package-path> [--skip-manifest]');
    process.exitCode = 2;
    return;
  }
  const report = await verifyCleanSourcePackage(packagePath, { skipManifest });
  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
