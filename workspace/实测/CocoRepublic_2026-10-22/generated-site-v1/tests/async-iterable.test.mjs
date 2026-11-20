import test from 'node:test';
import assert from 'node:assert/strict';
import { teeAsyncIterable } from '../scripts/lib/async-iterable.mjs';

test('teeAsyncIterable lets two consumers inspect each source value after one read', async () => {
  let reads = 0;
  async function* source() {
    for (const value of ['page-a', 'page-b', 'page-c']) {
      reads += 1;
      yield value;
    }
  }

  const [left, right] = teeAsyncIterable(source(), 2);
  const consume = async (iterable) => {
    const values = [];
    for await (const value of iterable) values.push(value);
    return values;
  };
  const [leftValues, rightValues] = await Promise.all([consume(left), consume(right)]);

  assert.deepEqual(leftValues, ['page-a', 'page-b', 'page-c']);
  assert.deepEqual(rightValues, ['page-a', 'page-b', 'page-c']);
  assert.equal(reads, 3);
});
