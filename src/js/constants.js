/**
 * @fileoverview Application constants and configuration
 * @module constants
 */

/**
 * Game-related constants
 * @typedef {Object} GameConstants
 * @property {number} FIELD_LENGTH_YARDS - Total field length including end zones
 * @property {number} FIELD_WIDTH_YARDS - Field width in yards
 * @property {number} ENDZONE_PERCENT - End zone as percentage of field
 * @property {number} BRICK_MARK_PERCENT - Brick mark position as percentage
 * @property {number} MAX_LINE_SIZE - Maximum players per line
 * @property {number} MAX_UNDO_HISTORY - Maximum undo states to keep
 * @property {number} DEFAULT_SCORE_DISTANCE - Default scoring throw distance
 */
export const GAME_CONSTANTS = {
    FIELD_LENGTH_YARDS: 120,
    FIELD_WIDTH_YARDS: 40,
    ENDZONE_PERCENT: 13.3,
    BRICK_MARK_PERCENT: 26.6,
    MAX_LINE_SIZE: 7,
    MAX_UNDO_HISTORY: 20,
    DEFAULT_SCORE_DISTANCE: 20,
};

/**
 * Field dimensions for SVG rendering
 * @typedef {Object} FieldDimensions
 */
export const FIELD_DIMENSIONS = {
    totalLength: 100,
    playingFieldLength: 64,
    endZoneDepth: 18,
    width: 37,
    brickMarkDistance: 10,
};

/**
 * LocalStorage keys
 * @enum {string}
 */
export const STORAGE_KEYS = {
    GAME_DATA: 'ultistats_game_data',
    SEASON_DATA: 'ultistats_season_data',
    TOURNAMENT_DATA: 'ultistats_tournament_data',
    PAST_TOURNAMENTS: 'ultistats_past_tournaments',
    GAME_HISTORY: 'ultistats_game_history',
    ROSTER: 'ultistats_roster',
    CAREER_DATA: 'ultistats_career_data',
    TEAMS: 'ultistats_teams',
    SETTINGS: 'ultistats_settings',
    AVATARS: 'ultistats_avatars',
    AUTH_TOKEN: 'ultistats_auth_token',
    AUTH_USER: 'ultistats_auth_user',
    CURRENT_TEAM: 'ultistats_current_team',
    PLAYER_POSITIONS: 'ultistats_player_positions',
    PLAYER_REGISTRY: 'ultistats_player_registry',
    CUSTOM_POSITIONS: 'ultistats_custom_positions',
    GAME_SETUP: 'ultistats_game_setup',
};

/**
 * Player positions
 * @type {string[]}
 */
export const POSITIONS = ['Handler', 'Cutter', 'Hybrid'];

/**
 * Haptic feedback patterns
 * @enum {number[]}
 */
export const HAPTIC_PATTERNS = {
    tap: [10],
    success: [30, 20, 30],
    score: [100, 50, 100, 50, 100],
    turnover: [100],
    block: [50, 30, 50],
    error: [200],
    select: [15],
    undo: [40, 40],
};

/**
 * API configuration - loaded from environment or defaults
 * @type {Object}
 */
export const API_CONFIG = {
    get BASE_URL() {
        return window.ULTISTATS_CONFIG?.API_BASE_URL || 'http://localhost:3001/api';
    },
    get GOOGLE_CLIENT_ID() {
        return window.ULTISTATS_CONFIG?.GOOGLE_CLIENT_ID || '';
    },
    get GOOGLE_API_KEY() {
        return window.ULTISTATS_CONFIG?.GOOGLE_API_KEY || '';
    },
};

/**
 * Google Sheets API configuration
 */
export const GOOGLE_SHEETS_CONFIG = {
    DISCOVERY_DOC: 'https://sheets.googleapis.com/$discovery/rest?version=v4',
    SCOPES: 'https://www.googleapis.com/auth/spreadsheets',
};

/**
 * Application routes
 * @enum {string}
 */
export const ROUTES = {
    '/': 'auth',
    '/login': 'auth',
    '/dashboard': 'dashboard',
    '/game': 'game',
    '/stats': 'stats',
    '/settings': 'settings',
};

/**
 * Default application settings
 * @type {Object}
 */
export const DEFAULT_SETTINGS = {
    darkMode: true,
    hapticEnabled: true,
    soundEnabled: false,
    confirmDestructive: true,
};

/**
 * Action types for logging
 * @enum {string}
 */
export const ACTION_TYPES = {
    THROW: 'throw',
    CATCH: 'catch',
    GOAL: 'goal',
    ASSIST: 'assist',
    BLOCK: 'block',
    TURNOVER: 'turnover',
    DROP: 'drop',
    SYSTEM: 'system',
};
