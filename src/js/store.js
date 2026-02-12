/**
 * @fileoverview In-memory cache backed by Dexie/IndexedDB.
 *
 * Design: setItem() updates the in-memory Map synchronously (so the next
 * getSync() call sees the new value immediately) but persists to IndexedDB
 * asynchronously. This means all existing synchronous read/write patterns
 * in script.js continue working identically.
 */

import { db } from './db.js';

// In-memory cache: mirrors IndexedDB state, enables synchronous reads
const _cache = new Map();
let _initialized = false;

/**
 * Bootstrap: called ONCE at app startup, before DOMContentLoaded handlers.
 * Runs one-time migration from localStorage, then preloads all keyval rows.
 */
export async function initStore() {
    await migrateFromLocalStorage();
    const all = await db.keyval.toArray();
    for (const row of all) {
        _cache.set(row.key, row.value);
    }
    _initialized = true;
}

/**
 * Synchronous read from in-memory cache.
 * Falls back to localStorage if called before initStore completes.
 */
export function getSync(key, defaultValue = null) {
    if (!_initialized) {
        try {
            const raw = localStorage.getItem(key);
            return raw !== null ? JSON.parse(raw) : defaultValue;
        } catch {
            return defaultValue;
        }
    }
    const val = _cache.get(key);
    return val !== undefined ? val : defaultValue;
}

/**
 * Updates cache synchronously, persists to IndexedDB async (fire-and-forget).
 */
export function setItem(key, value) {
    _cache.set(key, value);
    db.keyval.put({ key, value }).catch((err) => console.warn(`[Store] Failed to persist ${key}:`, err));
}

/**
 * Removes from cache and IndexedDB.
 */
export function removeItem(key) {
    _cache.delete(key);
    db.keyval.delete(key).catch((err) => console.warn(`[Store] Failed to remove ${key}:`, err));
}

/**
 * Batch write for visibility-hidden saves and beforeunload.
 * Updates cache synchronously, bulk-persists to IndexedDB async.
 */
export function bulkSet(entries) {
    for (const [key, value] of entries) {
        _cache.set(key, value);
    }
    db.keyval
        .bulkPut(entries.map(([key, value]) => ({ key, value })))
        .catch((err) => console.warn('[Store] bulkSet failed:', err));
}

/**
 * Clear all keyval data. Returns backup for undo.
 */
export async function clearAll() {
    const backup = {};
    for (const [key, value] of _cache.entries()) {
        backup[key] = value;
    }
    _cache.clear();
    await db.keyval.clear();
    return backup;
}

/**
 * Restore from backup (for undo of clearAll).
 */
export async function restoreFromBackup(backup) {
    const entries = Object.entries(backup).map(([key, value]) => ({ key, value }));
    await db.keyval.bulkPut(entries);
    for (const { key, value } of entries) {
        _cache.set(key, value);
    }
}

/**
 * Iterate all stored keys (for export/debug).
 */
export function getAllKeys() {
    return Array.from(_cache.keys());
}

/**
 * Check if store is initialized.
 */
export function isInitialized() {
    return _initialized;
}

// ---------------------------------------------------------------------------
// One-time migration from localStorage to IndexedDB
// ---------------------------------------------------------------------------

const MIGRATION_FLAG = 'ultistats_indexeddb_migrated';

async function migrateFromLocalStorage() {
    const existing = await db.keyval.get(MIGRATION_FLAG);
    if (existing) return;

    const entries = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('ultistats_')) {
            try {
                entries.push({ key, value: JSON.parse(localStorage.getItem(key)) });
            } catch {
                entries.push({ key, value: localStorage.getItem(key) });
            }
        }
    }
    if (entries.length > 0) {
        await db.keyval.bulkPut(entries);
    }
    await db.keyval.put({ key: MIGRATION_FLAG, value: new Date().toISOString() });
    console.log(`[Store] Migrated ${entries.length} keys from localStorage to IndexedDB`);
}
