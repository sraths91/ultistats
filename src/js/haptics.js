/**
 * @fileoverview Unified haptics abstraction.
 * Uses Capacitor Haptics (Taptic Engine) on native iOS/Android,
 * falls back to navigator.vibrate() on web.
 */

let _Haptics = null;
let _isNative = false;

// Map UltiStats haptic types to Capacitor ImpactStyle/NotificationType
const NATIVE_MAP = {
    tap: { method: 'impact', style: 'Light' },
    select: { method: 'impact', style: 'Light' },
    success: { method: 'notification', type: 'Success' },
    score: { method: 'notification', type: 'Success' },
    endzoneScore: { method: 'notification', type: 'Success' },
    block: { method: 'impact', style: 'Medium' },
    turnover: { method: 'notification', type: 'Warning' },
    error: { method: 'notification', type: 'Error' },
    undo: { method: 'impact', style: 'Medium' },
    swipeUndo: { method: 'impact', style: 'Heavy' },
    halfTime: { method: 'notification', type: 'Warning' },
    gamePoint: { method: 'notification', type: 'Success' },
};

async function init() {
    if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform()) {
        try {
            const mod = await import('@capacitor/haptics');
            _Haptics = mod.Haptics;
            _isNative = true;
        } catch {
            /* stay with web fallback */
        }
    }
}

// Auto-initialize
init();

/**
 * Trigger haptic feedback by type.
 * Same signature as existing hapticFeedback() in script.js.
 */
export async function hapticFeedback(type) {
    if (!_isNative || !_Haptics) return false; // let web fallback handle it

    const mapping = NATIVE_MAP[type];
    if (!mapping) return false;

    try {
        if (mapping.method === 'impact') {
            await _Haptics.impact({ style: mapping.style });
        } else {
            await _Haptics.notification({ type: mapping.type });
        }
        return true; // signal that native haptic was triggered
    } catch {
        return false;
    }
}

/**
 * Trigger a simple vibration pattern.
 * Same signature as existing vibrate() in script.js.
 */
export async function vibrate(pattern = 30, type = null) {
    if (!_isNative || !_Haptics) return false;

    if (type && NATIVE_MAP[type]) {
        return hapticFeedback(type);
    }

    try {
        // Map duration to impact style
        if (pattern <= 20) await _Haptics.impact({ style: 'Light' });
        else if (pattern <= 60) await _Haptics.impact({ style: 'Medium' });
        else await _Haptics.impact({ style: 'Heavy' });
        return true;
    } catch {
        return false;
    }
}

export function isNative() {
    return _isNative;
}

// Expose on window for script.js bridge
if (typeof window !== 'undefined') {
    window.__nativeHaptics = { hapticFeedback, vibrate, isNative };
}
