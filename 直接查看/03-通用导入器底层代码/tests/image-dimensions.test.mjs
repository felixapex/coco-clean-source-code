import assert from 'node:assert/strict';
import test from 'node:test';

import { readImageDimensions } from '../scripts/lib/image-dimensions.mjs';

test('reads WebP VP8X intrinsic dimensions without a browser', () => {
  const buffer = Buffer.alloc(30);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(22, 4);
  buffer.write('WEBP', 8, 'ascii');
  buffer.write('VP8X', 12, 'ascii');
  buffer.writeUInt32LE(10, 16);
  buffer.writeUIntLE(799, 24, 3);
  buffer.writeUIntLE(599, 27, 3);

  assert.deepEqual(readImageDimensions(buffer, 'image/webp'), { width: 800, height: 600 });
});

test('reads PNG intrinsic dimensions without a browser', () => {
  const buffer = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(buffer, 0);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(1200, 16);
  buffer.writeUInt32BE(800, 20);

  assert.deepEqual(readImageDimensions(buffer, 'image/png'), { width: 1200, height: 800 });
});
