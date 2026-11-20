export function teeAsyncIterable(source, count = 2) {
  if (!Number.isInteger(count) || count < 1) throw new Error('count must be a positive integer');
  const iterator = source[Symbol.asyncIterator]();
  let current;
  let loading;
  let consumed = new Set();
  let advanced;
  let releaseAdvance;

  const ensureCurrent = async () => {
    if (current) return current;
    if (!loading) {
      loading = iterator.next().then((item) => {
        current = item;
        consumed = new Set();
        if (!item.done) advanced = new Promise((resolve) => { releaseAdvance = resolve; });
        return item;
      }).finally(() => { loading = undefined; });
    }
    return loading;
  };

  return Array.from({ length: count }, (_, branch) => ({
    [Symbol.asyncIterator]() { return this; },
    async next() {
      while (true) {
        const item = await ensureCurrent();
        if (item.done) return item;
        if (!consumed.has(branch)) {
          consumed.add(branch);
          const result = { done: false, value: item.value };
          if (consumed.size === count) {
            const release = releaseAdvance;
            current = undefined;
            releaseAdvance = undefined;
            release?.();
          }
          return result;
        }
        await advanced;
      }
    },
  }));
}
