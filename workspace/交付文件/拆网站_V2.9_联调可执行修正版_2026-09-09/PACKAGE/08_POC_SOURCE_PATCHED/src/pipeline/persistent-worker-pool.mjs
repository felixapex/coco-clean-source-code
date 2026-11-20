export async function runPersistentWorkerPool(items, requestedWorkers, runWorker) {
  const values = [...items];
  if (!values.length) return [];
  const workerCount = Math.min(
    values.length,
    Math.max(1, Math.floor(Number(requestedWorkers) || 1)),
  );
  const results = new Array(values.length);
  let nextIndex = 0;

  async function drain(processItem) {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await processItem(values[index], index);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, (_, workerId) => (
    runWorker({ workerId, drain })
  )));
  return results;
}
