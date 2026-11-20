import fs from 'node:fs/promises';
import path from 'node:path';

export async function writeJsonObjectStreaming(filePath, value, { streamedArrayKeys = [] } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('value must be a JSON object');
  }
  const streamed = new Set(streamedArrayKeys);
  for (const key of streamed) {
    if (!Array.isArray(value[key])) throw new TypeError(`${key} must be an array`);
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const handle = await fs.open(temporaryPath, 'w');
  let bytesWritten = 0;
  let streamedItemCount = 0;
  let peakSerializedItemBytes = 0;
  const write = async (chunk) => {
    const text = String(chunk);
    bytesWritten += Buffer.byteLength(text, 'utf8');
    await handle.write(text);
  };

  try {
    await write('{\n');
    const entries = Object.entries(value);
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
      const [key, propertyValue] = entries[entryIndex];
      await write(`  ${JSON.stringify(key)}: `);
      if (streamed.has(key)) {
        await write('[\n');
        for (let itemIndex = 0; itemIndex < propertyValue.length; itemIndex += 1) {
          const serialized = JSON.stringify(propertyValue[itemIndex]);
          const serializedBytes = Buffer.byteLength(serialized, 'utf8');
          peakSerializedItemBytes = Math.max(peakSerializedItemBytes, serializedBytes);
          streamedItemCount += 1;
          await write(`    ${serialized}${itemIndex + 1 < propertyValue.length ? ',' : ''}\n`);
        }
        await write('  ]');
      } else {
        await write(JSON.stringify(propertyValue));
      }
      await write(entryIndex + 1 < entries.length ? ',\n' : '\n');
    }
    await write('}\n');
    await handle.sync();
    await handle.close();
    await fs.rename(temporaryPath, filePath);
    return { bytesWritten, streamedItemCount, peakSerializedItemBytes };
  } catch (error) {
    await handle.close().catch(() => {});
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}
