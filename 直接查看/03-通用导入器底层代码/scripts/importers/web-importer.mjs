import { createImportContext } from './importer-contract.mjs';

export const webImporter = Object.freeze({
  importerId: 'web-v1',
  platform: 'web',
  async prepare(request) {
    return createImportContext({ ...request, platform: 'web' }, this.importerId);
  },
});

