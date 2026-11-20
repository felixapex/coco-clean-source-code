import { createImportContext } from './importer-contract.mjs';

export const shopifyImporter = Object.freeze({
  importerId: 'shopify-v1',
  platform: 'shopify',
  async prepare(request) {
    return createImportContext({ ...request, platform: 'shopify' }, this.importerId);
  },
});

