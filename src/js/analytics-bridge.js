/**
 * @fileoverview Comlink bridge exposing analytics Worker as async functions on window.
 * Falls back gracefully if Worker fails to load.
 */

import { wrap } from 'comlink';

let _proxy = null;

try {
    const worker = new Worker(new URL('./analytics.worker.js', import.meta.url), { type: 'module' });
    _proxy = wrap(worker);
} catch (e) {
    console.warn('[Analytics] Worker creation failed, will use main-thread fallback:', e);
}

window.__analyticsWorker = _proxy;
