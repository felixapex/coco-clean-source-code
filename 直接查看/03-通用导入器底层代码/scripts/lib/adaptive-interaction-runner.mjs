import {
  advanceInteractionSession,
  chooseInteractionIsolation,
  createInteractionSession,
} from './interaction-isolation.mjs';

export function createAdaptiveInteractionRunner({ pageReady = false, reset, execute, restore } = {}) {
  if (typeof reset !== 'function') throw new TypeError('reset is required');
  if (typeof execute !== 'function') throw new TypeError('execute is required');
  if (typeof restore !== 'function') throw new TypeError('restore is required');

  let session = createInteractionSession({ pageReady });

  return {
    async run(control) {
      const resetApplied = session.nextReset;
      if (resetApplied !== 'none') await reset(resetApplied, control);
      const effect = await execute(control);
      const isolation = chooseInteractionIsolation({ control, effect });
      const restored = isolation === 'verified-restore' || isolation === 'history-restore'
        ? Boolean(await restore({ control, effect }))
        : false;
      session = advanceInteractionSession(session, { isolation, restored });
      return { effect, isolation, restored, resetApplied };
    },
    resetSession() {
      session = createInteractionSession();
    },
    snapshot() {
      return { ...session };
    },
  };
}
