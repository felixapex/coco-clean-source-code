import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const replayRoot = path.join(root, 'dist', 'replay');
const assetRoot = path.join(root, 'dist', 'component-library', 'assets');

test('every captured SOFAS mega-menu uses the restored standalone image', async () => {
  const files = (await fs.readdir(replayRoot)).filter((file) => file.endsWith('.html'));
  let imageCount = 0;
  const contentHashes = new Set();
  for (const file of files) {
    const html = await fs.readFile(path.join(replayRoot, file), 'utf8');
    for (const match of html.matchAll(/<img\b(?=[^>]*\balt="SOFAS")[^>]*>/gi)) {
      const tag = match[0];
      imageCount += 1;
      assert.match(tag, /data-matbox-restored-menu-image="true"/);
      assert.match(tag, /data-matbox-original-source-url="https:\/\/cdn11\.bigcommerce\.com\/[^\"]+sofa-meganav-desktop-tile-1-\.jpg[^\"]*"/);
      assert.doesNotMatch(tag, /data-matbox-browser-(?:frozen|screenshot)-image="true"/);
      const localAsset = tag.match(/\ssrc="\/component-library\/assets\/([^\"]+)"/i)?.[1];
      const embeddedAsset = tag.match(/\ssrc="data:image\/png;base64,([^\"]+)"/i)?.[1];
      assert.ok(localAsset || embeddedAsset, `${file} must reference an offline image asset`);
      const bytes = localAsset
        ? await fs.readFile(path.join(assetRoot, localAsset))
        : Buffer.from(embeddedAsset, 'base64');
      assert.ok(bytes.length > 100_000);
      contentHashes.add(crypto.createHash('sha256').update(bytes).digest('hex'));
    }
  }
  assert.equal(imageCount, 202);
  assert.equal(contentHashes.size, 1, 'all routes must share one canonical menu image');
});
