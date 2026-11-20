import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

function safeSegment(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'item';
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

class CaptureWriter {
  constructor(dir, siteId, captureId, metadata) {
    this.dir = dir;
    this.siteId = siteId;
    this.captureId = captureId;
    this.metadata = metadata;
    this.artifacts = [];
  }

  async putJson(type, value) {
    const body = Buffer.from(JSON.stringify(value, null, 2));
    return this.#put(type, body, 'json');
  }

  async putBuffer(type, buffer, ext = 'bin') {
    return this.#put(type, Buffer.from(buffer), ext);
  }

  async #put(type, buffer, ext) {
    const safeType = safeSegment(type);
    const digest = sha256(buffer);
    const filename = `${String(this.artifacts.length + 1).padStart(3, '0')}-${safeType}-${digest.slice(0, 12)}.${safeSegment(ext)}`;
    const artifactPath = path.join(this.dir, filename);
    await fs.writeFile(artifactPath, buffer);
    const entry = {
      id: `${this.captureId}:${safeType}:${this.artifacts.length + 1}`,
      type: safeType,
      path: artifactPath,
      filename,
      bytes: buffer.length,
      sha256: digest,
    };
    this.artifacts.push(entry);
    return entry;
  }

  async finalize() {
    const manifest = {
      version: '0.1',
      siteId: this.siteId,
      captureId: this.captureId,
      metadata: this.metadata,
      artifacts: this.artifacts,
    };
    await fs.writeFile(path.join(this.dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    return manifest;
  }
}

export class EvidenceStore {
  constructor(rootDir) {
    this.rootDir = path.resolve(rootDir);
  }

  async createCapture(siteId, metadata = {}) {
    const stableSeed = JSON.stringify({ siteId, metadata });
    const suffix = crypto.createHash('sha256').update(stableSeed).digest('hex').slice(0, 10);
    const captureId = `${safeSegment(siteId)}-${Date.now()}-${suffix}`;
    const dir = path.join(this.rootDir, safeSegment(siteId), captureId);
    await fs.mkdir(dir, { recursive: true });
    return new CaptureWriter(dir, siteId, captureId, metadata);
  }
}
