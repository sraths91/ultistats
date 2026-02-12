/**
 * @fileoverview Shared application initialization module.
 * Consolidates duplicated inline scripts: Tailwind config, store init,
 * and conditional module imports.
 *
 * Used by: game.html, dashboard.html, index.html, tournament.html,
 *          league.html, testgame.html
 * @module app-init
 */

// Import IndexedDB store module (exposes window.__ultistatsStore)
import './store-entry.js';

// Configure Tailwind (CDN detects assignment via property setter and rebuilds)
tailwind.config = {
    theme: {
        extend: {
            fontFamily: {
                sans: ['Inter', 'sans-serif'],
            },
        },
    },
};

// Create __storeReady Promise — initializes the IndexedDB store
// (store-entry.js has already set window.__ultistatsStore via static import)
window.__storeReady = new Promise(function (resolve) {
    const check = function () {
        window.__ultistatsStore ? resolve(window.__ultistatsStore.initStore()) : requestAnimationFrame(check);
    };
    check();
});

// Load additional modules on game + dashboard pages
if (window.isGamePage || window.isDashboardPage) {
    import('./analytics-bridge.js');
    import('./haptics.js');
    import('./network.js');
    import('./engine/audio.js');
    import('./engine/analytics-render.js');
}
