export const IMPORT_PLATFORMS = Object.freeze(['shopify', 'wix', 'web']);
export const IMPORT_MODES = Object.freeze(['authorized', 'layout-learning']);

export function createImportContext(request, importerId) {
  if (!request || !IMPORT_PLATFORMS.includes(request.platform)) {
    throw new Error(`Unsupported import platform: ${request?.platform ?? '<missing>'}`);
  }
  if (!IMPORT_MODES.includes(request.mode)) {
    throw new Error(`Unsupported import mode: ${request.mode ?? '<missing>'}`);
  }
  let sourceUrl;
  try {
    sourceUrl = new URL(request.sourceUrl);
  } catch {
    throw new Error(`Invalid source URL: ${request.sourceUrl ?? '<missing>'}`);
  }
  if (!/^https?:$/.test(sourceUrl.protocol)) {
    throw new Error(`Unsupported source URL protocol: ${sourceUrl.protocol}`);
  }
  return Object.freeze({
    importerId,
    platform: request.platform,
    mode: request.mode,
    sourceUrl: sourceUrl.href,
    sourceOrigin: sourceUrl.origin,
  });
}

