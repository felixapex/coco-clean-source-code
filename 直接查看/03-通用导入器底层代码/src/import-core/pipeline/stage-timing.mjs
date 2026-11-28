export async function runCheckpointedStage({
  name,
  timings,
  execute,
  checkpoint = async () => {},
  now = Date.now,
} = {}) {
  if (!name) throw new Error('Timed stage requires a name');
  if (!Array.isArray(timings)) throw new Error('Timed stage requires a timings array');
  if (typeof execute !== 'function') throw new Error('Timed stage requires execute');
  const startedAt = now();
  const timing = { name, status: 'running', elapsedMs: 0 };
  timings.push(timing);
  await checkpoint({ ...timing }, [...timings]);
  try {
    const result = await execute();
    timing.status = 'passed';
    return result;
  } catch (error) {
    timing.status = /budget exceeded/i.test(String(error?.message || error)) ? 'timed-out' : 'failed';
    timing.error = String(error?.message || error);
    throw error;
  } finally {
    timing.elapsedMs = Math.max(0, now() - startedAt);
    await checkpoint({ ...timing }, [...timings]);
  }
}
