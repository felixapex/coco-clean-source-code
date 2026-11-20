import test from 'node:test';
import assert from 'node:assert/strict';

import { connectCdp } from '../scripts/lib/cdp-client.mjs';

class FakeWebSocket extends EventTarget {
  static last;

  constructor() {
    super();
    FakeWebSocket.last = this;
  }

  send(payload) {
    this.lastPayload = JSON.parse(payload);
  }

  close() {
    this.dispatchEvent(new Event('close'));
  }
}

test('closing a CDP socket rejects every pending command instead of deadlocking cancellation', async () => {
  const client = connectCdp('ws://test', { WebSocketImpl: FakeWebSocket });
  FakeWebSocket.last.dispatchEvent(new Event('open'));
  await client.ready;

  const pending = client.call('Runtime.evaluate', { expression: 'true' });
  client.close();

  await assert.rejects(pending, /CDP target closed/);
});
