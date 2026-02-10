/**
 * @fileoverview Main entry point for UltiStats modules
 * @module ultistats
 * 
 * This file exports all modules for use in the application.
 * It can be used with ES modules in modern browsers or bundled with a tool like Vite.
 */

// Re-export all modules
export * as constants from './constants.js';
export * as storage from './storage.js';
export * as api from './api.js';
export * as ui from './ui.js';
export * as stats from './stats.js';
export * as auth from './auth.js';
export * as game from './game.js';
export * as utils from './utils.js';

// Named exports for commonly used items
export { 
    GAME_CONSTANTS, 
    FIELD_DIMENSIONS, 
    STORAGE_KEYS, 
    POSITIONS,
    HAPTIC_PATTERNS,
    API_CONFIG,
    ROUTES,
    DEFAULT_SETTINGS,
    ACTION_TYPES
} from './constants.js';

export {
    showToast,
    vibrate,
    hapticFeedback,
    playSound,
    showConfirmModal,
    showInputModal,
    safeElement,
    createElement,
    refreshIcons,
    getContentAreaCoordinates
} from './ui.js';

export {
    createEmptyPlayerStats,
    createEmptyTeamStats,
    calculateDistance,
    isInEndzone,
    getLeaderboard,
    calculateRecord
} from './stats.js';

export {
    initAuth,
    isAuthenticated,
    getCurrentUser,
    getCurrentTeam,
    login,
    logout,
    register
} from './auth.js';

export {
    getGameState,
    updateGameState,
    resetGameState,
    startPoint,
    endPoint,
    recordThrow,
    recordGoal,
    recordTurnover,
    recordBlock,
    togglePlayerOnField,
    selectLastLine
} from './game.js';

export {
    generateUUID,
    debounce,
    throttle,
    deepClone,
    formatDate,
    isEmpty
} from './utils.js';

import { loadAppSettings } from './ui.js';
import { initAuth } from './auth.js';

/**
 * Initialize the UltiStats application
 * @param {Object} options - Initialization options
 * @param {boolean} options.loadAuth - Whether to load auth state
 * @param {boolean} options.loadSettings - Whether to load app settings
 */
export function initApp(options = {}) {
    const { loadAuth = true, loadSettings = true } = options;

    if (loadSettings) {
        loadAppSettings();
    }

    if (loadAuth) {
        return initAuth();
    }

    return false;
}

// Version info
export const VERSION = '2.0.0';
export const BUILD_DATE = new Date().toISOString().split('T')[0];
