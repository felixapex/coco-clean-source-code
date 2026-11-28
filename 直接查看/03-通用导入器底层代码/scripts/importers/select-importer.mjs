import { IMPORT_MODES, IMPORT_PLATFORMS } from './importer-contract.mjs';
import { shopifyImporter } from './shopify-importer.mjs';
import { webImporter } from './web-importer.mjs';
import { wixImporter } from './wix-importer.mjs';

const importers = new Map([
  ['shopify', shopifyImporter],
  ['web', webImporter],
  ['wix', wixImporter],
]);

export function selectImporter(platform) {
  if (!platform) throw new Error('An explicit import platform is required.');
  const importer = importers.get(String(platform).toLowerCase());
  if (!importer) throw new Error(`Unsupported import platform: ${platform}`);
  return importer;
}

export function parseImportArguments(argv = [], env = process.env) {
  const platform = argv.find((value) => value.startsWith('--platform='))?.slice('--platform='.length)
    || env.MATBOX_IMPORT_PLATFORM;
  const mode = argv.find((value) => value.startsWith('--mode='))?.slice('--mode='.length)
    || env.MATBOX_IMPORT_MODE
    || 'authorized';
  const sourceUrl = argv.find((value) => !value.startsWith('--'));
  if (!platform) {
    throw new Error(`Usage: node scripts/run-20-minute-pipeline.mjs --platform=${IMPORT_PLATFORMS.join('|')} [--mode=${IMPORT_MODES.join('|')}] <public-site-url>`);
  }
  if (!IMPORT_MODES.includes(mode)) throw new Error(`Unsupported import mode: ${mode}`);
  if (!sourceUrl) throw new Error('A public site URL is required.');
  return { platform: String(platform).toLowerCase(), mode, sourceUrl };
}

