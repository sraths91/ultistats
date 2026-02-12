/**
 * @fileoverview Bundle entry point that exposes the store API on window.
 * Loaded as a module script before script.js in each HTML page.
 */

import {
    initStore,
    getSync,
    setItem,
    removeItem,
    bulkSet,
    clearAll,
    restoreFromBackup,
    getAllKeys,
    isInitialized,
} from './store.js';
import { db } from './db.js';

window.__ultistatsStore = {
    initStore,
    getSync,
    setItem,
    removeItem,
    bulkSet,
    clearAll,
    restoreFromBackup,
    getAllKeys,
    isInitialized,
    db,
};
