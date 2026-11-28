function positive(width, height) {
  return width > 0 && height > 0 ? { width, height } : null;
}

function readWebp(buffer) {
  if (buffer.length < 20 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return null;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (data + size > buffer.length) return null;
    if (type === 'VP8X' && size >= 10) {
      return positive(buffer.readUIntLE(data + 4, 3) + 1, buffer.readUIntLE(data + 7, 3) + 1);
    }
    if (type === 'VP8L' && size >= 5 && buffer[data] === 0x2f) {
      const b0 = buffer[data + 1];
      const b1 = buffer[data + 2];
      const b2 = buffer[data + 3];
      const b3 = buffer[data + 4];
      return positive(1 + b0 + ((b1 & 0x3f) << 8), 1 + (b1 >> 6) + (b2 << 2) + ((b3 & 0x0f) << 10));
    }
    if (type === 'VP8 ' && size >= 10) {
      for (let cursor = data; cursor + 7 <= data + Math.min(size, 16); cursor += 1) {
        if (buffer[cursor] !== 0x9d || buffer[cursor + 1] !== 0x01 || buffer[cursor + 2] !== 0x2a) continue;
        return positive(buffer.readUInt16LE(cursor + 3) & 0x3fff, buffer.readUInt16LE(cursor + 5) & 0x3fff);
      }
    }
    offset = data + size + (size % 2);
  }
  return null;
}

function readJpeg(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    while (offset < buffer.length && buffer[offset] !== 0xff) offset += 1;
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) break;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) break;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) break;
    if (startOfFrame.has(marker) && length >= 7) return positive(buffer.readUInt16BE(offset + 5), buffer.readUInt16BE(offset + 3));
    offset += length;
  }
  return null;
}

function readSvg(buffer) {
  const markup = buffer.toString('utf8', 0, Math.min(buffer.length, 65536));
  const tag = markup.match(/<svg\b[^>]*>/i)?.[0] || '';
  const number = (name) => Number(tag.match(new RegExp(`\\b${name}=["']([0-9.]+)`, 'i'))?.[1] || 0);
  const width = number('width');
  const height = number('height');
  if (width > 0 && height > 0) return { width, height };
  const viewBox = tag.match(/\bviewBox=["']\s*[-0-9.]+\s+[-0-9.]+\s+([0-9.]+)\s+([0-9.]+)/i);
  return viewBox ? positive(Number(viewBox[1]), Number(viewBox[2])) : null;
}

export function readImageDimensions(buffer, contentType = '') {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('buffer must be a Buffer');
  const type = String(contentType || '').toLowerCase();
  if ((type.includes('png') || buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) && buffer.length >= 24) {
    return positive(buffer.readUInt32BE(16), buffer.readUInt32BE(20));
  }
  if (type.includes('webp') || buffer.toString('ascii', 8, 12) === 'WEBP') return readWebp(buffer);
  if (type.includes('jpeg') || type.includes('jpg') || (buffer[0] === 0xff && buffer[1] === 0xd8)) return readJpeg(buffer);
  if ((type.includes('gif') || buffer.toString('ascii', 0, 3) === 'GIF') && buffer.length >= 10) {
    return positive(buffer.readUInt16LE(6), buffer.readUInt16LE(8));
  }
  if (type.includes('svg') || buffer.toString('utf8', 0, 256).includes('<svg')) return readSvg(buffer);
  return null;
}
