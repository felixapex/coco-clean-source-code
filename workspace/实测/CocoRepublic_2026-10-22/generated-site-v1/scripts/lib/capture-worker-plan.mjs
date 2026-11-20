export function partitionForWorkers(items, requestedWorkers) {
  const values = [...items];
  if (!values.length) return [];
  const workerCount = Math.min(
    values.length,
    Math.max(1, Math.floor(Number(requestedWorkers) || 1)),
  );
  const baseSize = Math.floor(values.length / workerCount);
  const remainder = values.length % workerCount;
  const shards = [];
  let offset = 0;
  for (let worker = 0; worker < workerCount; worker += 1) {
    const size = baseSize + (worker < remainder ? 1 : 0);
    shards.push(values.slice(offset, offset + size));
    offset += size;
  }
  return shards;
}

