/**
 * @fileoverview Dexie.js database definition for UltiStats.
 * Replaces localStorage with async IndexedDB storage.
 */

import Dexie from 'dexie';

export const db = new Dexie('ultistats');

db.version(1).stores({
    // Key-value store: maps 1:1 with existing localStorage keys
    keyval: 'key',

    // Sync queue: replaces raw IndexedDB usage in SyncQueue class
    pendingSync: '++id, timestamp, synced',
});
