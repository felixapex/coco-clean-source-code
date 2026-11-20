export const wixImporter = Object.freeze({
  importerId: 'wix-v1',
  platform: 'wix',
  async prepare() {
    throw new Error('Wix importer is not implemented; capture was not started.');
  },
});

