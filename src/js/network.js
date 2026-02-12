/**
 * @fileoverview Network monitoring abstraction.
 * Uses @capacitor/network on native, falls back to navigator.onLine on web.
 */

let _Network = null;
let _isNative = false;
const _listeners = [];

async function init() {
    if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform()) {
        try {
            const mod = await import('@capacitor/network');
            _Network = mod.Network;
            _isNative = true;

            _Network.addListener('networkStatusChange', (status) => {
                for (const cb of _listeners) {
                    try {
                        cb(status.connected);
                    } catch {}
                }
            });
        } catch {
            /* stay with web fallback */
        }
    }

    // Web fallback
    if (!_isNative && typeof window !== 'undefined') {
        window.addEventListener('online', () => {
            for (const cb of _listeners) {
                try {
                    cb(true);
                } catch {}
            }
        });
        window.addEventListener('offline', () => {
            for (const cb of _listeners) {
                try {
                    cb(false);
                } catch {}
            }
        });
    }
}

export async function isConnected() {
    if (_isNative && _Network) {
        const status = await _Network.getStatus();
        return status.connected;
    }
    return navigator.onLine;
}

export function onStatusChange(callback) {
    _listeners.push(callback);
}

// Auto-initialize
init();

// Expose on window for script.js
if (typeof window !== 'undefined') {
    window.__networkMonitor = { isConnected, onStatusChange };
}
