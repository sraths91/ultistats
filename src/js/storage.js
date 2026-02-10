/**
 * @fileoverview LocalStorage management module
 * @module storage
 */

import { STORAGE_KEYS } from './constants.js';

/**
 * Safely get item from localStorage with JSON parsing
 * @param {string} key - Storage key
 * @param {*} defaultValue - Default value if key doesn't exist
 * @returns {*} Parsed value or default
 */
export function getItem(key, defaultValue = null) {
    try {
        const item = localStorage.getItem(key);
        if (item === null) return defaultValue;
        return JSON.parse(item);
    } catch (error) {
        console.error(`Error reading from localStorage [${key}]:`, error);
        return defaultValue;
    }
}

/**
 * Safely set item in localStorage with JSON stringification
 * @param {string} key - Storage key
 * @param {*} value - Value to store
 * @returns {boolean} Success status
 */
export function setItem(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (error) {
        console.error(`Error writing to localStorage [${key}]:`, error);
        return false;
    }
}

/**
 * Remove item from localStorage
 * @param {string} key - Storage key
 */
export function removeItem(key) {
    try {
        localStorage.removeItem(key);
    } catch (error) {
        console.error(`Error removing from localStorage [${key}]:`, error);
    }
}

/**
 * Clear all app-related localStorage items
 */
export function clearAll() {
    Object.values(STORAGE_KEYS).forEach(key => {
        removeItem(key);
    });
}

// ==================== AUTH STORAGE ====================

/**
 * Save authentication state
 * @param {string} token - JWT token
 * @param {Object} user - User object
 */
export function saveAuthState(token, user) {
    setItem(STORAGE_KEYS.AUTH_TOKEN, token);
    setItem(STORAGE_KEYS.AUTH_USER, user);
}

/**
 * Load authentication state
 * @returns {{token: string|null, user: Object|null}}
 */
export function loadAuthState() {
    return {
        token: getItem(STORAGE_KEYS.AUTH_TOKEN),
        user: getItem(STORAGE_KEYS.AUTH_USER)
    };
}

/**
 * Clear authentication state
 */
export function clearAuthState() {
    removeItem(STORAGE_KEYS.AUTH_TOKEN);
    removeItem(STORAGE_KEYS.AUTH_USER);
    removeItem(STORAGE_KEYS.CURRENT_TEAM);
}

// ==================== GAME STORAGE ====================

/**
 * Save game state
 * @param {Object} gameState - Current game state
 */
export function saveGameState(gameState) {
    setItem(STORAGE_KEYS.GAME_DATA, gameState);
}

/**
 * Load game state
 * @returns {Object|null}
 */
export function loadGameState() {
    return getItem(STORAGE_KEYS.GAME_DATA);
}

/**
 * Save game setup configuration
 * @param {Object} setup - Game setup data
 */
export function saveGameSetup(setup) {
    setItem(STORAGE_KEYS.GAME_SETUP, setup);
}

/**
 * Load game setup configuration
 * @returns {Object|null}
 */
export function loadGameSetup() {
    return getItem(STORAGE_KEYS.GAME_SETUP);
}

// ==================== ROSTER STORAGE ====================

/**
 * Save roster
 * @param {string[]} roster - Array of player names
 */
export function saveRoster(roster) {
    setItem(STORAGE_KEYS.ROSTER, roster);
}

/**
 * Load roster
 * @returns {string[]}
 */
export function loadRoster() {
    return getItem(STORAGE_KEYS.ROSTER, []);
}

/**
 * Save player registry
 * @param {Object} registry - Player registry object
 */
export function savePlayerRegistry(registry) {
    setItem(STORAGE_KEYS.PLAYER_REGISTRY, registry);
}

/**
 * Load player registry
 * @returns {Object}
 */
export function loadPlayerRegistry() {
    return getItem(STORAGE_KEYS.PLAYER_REGISTRY, {});
}

/**
 * Save player positions
 * @param {Object} positions - Player positions mapping
 */
export function savePlayerPositions(positions) {
    setItem(STORAGE_KEYS.PLAYER_POSITIONS, positions);
}

/**
 * Load player positions
 * @returns {Object}
 */
export function loadPlayerPositions() {
    return getItem(STORAGE_KEYS.PLAYER_POSITIONS, {});
}

// ==================== STATS STORAGE ====================

/**
 * Save career stats
 * @param {Object} stats - Career stats object
 */
export function saveCareerStats(stats) {
    setItem(STORAGE_KEYS.CAREER_DATA, stats);
}

/**
 * Load career stats
 * @returns {Object}
 */
export function loadCareerStats() {
    return getItem(STORAGE_KEYS.CAREER_DATA, {
        players: {},
        totalGames: 0,
        totalSeasons: 0,
        startDate: null
    });
}

/**
 * Save season stats
 * @param {Object} stats - Season stats object
 */
export function saveSeasonStats(stats) {
    setItem(STORAGE_KEYS.SEASON_DATA, stats);
}

/**
 * Load season stats
 * @returns {Object}
 */
export function loadSeasonStats() {
    return getItem(STORAGE_KEYS.SEASON_DATA, {
        players: {},
        games: [],
        totalGames: 0,
        wins: 0,
        losses: 0
    });
}

/**
 * Save tournament stats
 * @param {Object} stats - Tournament stats object
 */
export function saveTournamentStats(stats) {
    setItem(STORAGE_KEYS.TOURNAMENT_DATA, stats);
}

/**
 * Load tournament stats
 * @returns {Object}
 */
export function loadTournamentStats() {
    return getItem(STORAGE_KEYS.TOURNAMENT_DATA, {
        name: '',
        isActive: false,
        startDate: null,
        players: {},
        games: [],
        totalGames: 0,
        wins: 0,
        losses: 0
    });
}

/**
 * Save past tournaments
 * @param {Array} tournaments - Array of past tournament objects
 */
export function savePastTournaments(tournaments) {
    setItem(STORAGE_KEYS.PAST_TOURNAMENTS, tournaments);
}

/**
 * Load past tournaments
 * @returns {Array}
 */
export function loadPastTournaments() {
    return getItem(STORAGE_KEYS.PAST_TOURNAMENTS, []);
}

/**
 * Save game history
 * @param {Array} history - Array of game records
 */
export function saveGameHistory(history) {
    setItem(STORAGE_KEYS.GAME_HISTORY, history);
}

/**
 * Load game history
 * @returns {Array}
 */
export function loadGameHistory() {
    return getItem(STORAGE_KEYS.GAME_HISTORY, []);
}

// ==================== TEAMS STORAGE ====================

/**
 * Save teams data
 * @param {Object} teamsData - Teams data object
 */
export function saveTeamsData(teamsData) {
    setItem(STORAGE_KEYS.TEAMS, teamsData);
}

/**
 * Load teams data
 * @returns {Object}
 */
export function loadTeamsData() {
    return getItem(STORAGE_KEYS.TEAMS, {
        teams: {},
        currentTeamId: null
    });
}

/**
 * Save current team
 * @param {Object} team - Current team object
 */
export function saveCurrentTeam(team) {
    setItem(STORAGE_KEYS.CURRENT_TEAM, team);
}

/**
 * Load current team
 * @returns {Object|null}
 */
export function loadCurrentTeam() {
    return getItem(STORAGE_KEYS.CURRENT_TEAM);
}

// ==================== SETTINGS STORAGE ====================

/**
 * Save app settings
 * @param {Object} settings - Settings object
 */
export function saveSettings(settings) {
    setItem(STORAGE_KEYS.SETTINGS, settings);
}

/**
 * Load app settings
 * @returns {Object}
 */
export function loadSettings() {
    return getItem(STORAGE_KEYS.SETTINGS, {
        darkMode: true,
        hapticEnabled: true,
        soundEnabled: false,
        confirmDestructive: true
    });
}

/**
 * Save player avatars
 * @param {Object} avatars - Avatars mapping
 */
export function saveAvatars(avatars) {
    setItem(STORAGE_KEYS.AVATARS, avatars);
}

/**
 * Load player avatars
 * @returns {Object}
 */
export function loadAvatars() {
    return getItem(STORAGE_KEYS.AVATARS, {});
}
