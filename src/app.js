// -----------------------------------------------------------------------------
// Registers every SDK handler on a GladysIntegration (or the SDK's fake Gladys)
// and returns the monitor, so index.js stays a few lines and the tests drive
// the very same wiring.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { CONFIG_ACTION, SCENE_ACTION, checkNow, readEvents } from './actions.js';
import { normalizeConfig } from './config.js';
import { STATUS, render } from './messages.js';
import { Monitor } from './monitor.js';
import { Store } from './store.js';
import { WIDGETS } from './widgets.js';

const logger = createLogger({ name: 'geofeeds-app' });

/**
 * @param {object} gladys GladysIntegration instance
 * @param {object} [options] test seams: store, fetch, timers, now, timings
 */
export function registerHandlers(gladys, options = {}) {
  const monitor = new Monitor({
    gladys,
    store: options.store ?? new Store(),
    fetch: options.fetch,
    timers: options.timers ?? true,
    now: options.now,
    timings: options.timings,
  });

  // Resolved once the monitor has started; every handler waits for it, so a
  // request arriving during the start is not lost.
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let started = false;
  const whenReady =
    (fn) =>
    async (...args) => {
      await ready;
      return fn(...args);
    };

  gladys.on('connected', async () => {
    try {
      const config = normalizeConfig(await gladys.getConfig());
      if (started) {
        // A reconnection (Gladys restarted): publish everything again.
        await monitor.resync(config);
        return;
      }
      await monitor.start(config);
      // Only now: a failed start is tried again at the next connection.
      started = true;
    } catch (err) {
      logger.error('Initialization failed', err);
      await gladys.setConnectionStatus(false, render(STATUS, 'initFailed')).catch(() => {});
    } finally {
      resolveReady();
    }
  });

  gladys.onScanRequest(whenReady(() => monitor.publishDiscovered()));

  // The device is published with should_poll: false (refreshed by the
  // monitor's own timer); this only serves a Gladys that would poll anyway.
  gladys.onPoll(whenReady((device) => monitor.poll(device)));

  gladys.onDeviceCreated(whenReady((device) => monitor.onDeviceCreated(device)));

  gladys.onConfigUpdated(whenReady((newConfig) => monitor.reconfigure(normalizeConfig(newConfig))));

  gladys.onAction(
    CONFIG_ACTION,
    whenReady(() => checkNow(monitor)),
  );
  gladys.onSceneAction(
    SCENE_ACTION,
    whenReady((fields) => readEvents(monitor, fields ?? {})),
  );

  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(
      key,
      whenReady((request) => widget.get(monitor, request)),
    );
  }

  return {
    monitor,
    ready,
    stop: () => monitor.stop(),
  };
}
