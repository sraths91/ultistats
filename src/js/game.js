/**
 * @fileoverview Game state and field interaction module
 * @module game
 */

import { GAME_CONSTANTS, FIELD_DIMENSIONS } from './constants.js';
import * as storage from './storage.js';
import * as stats from './stats.js';
import { showToast, vibrate, hapticFeedback, playSound, getContentAreaCoordinates, refreshIcons } from './ui.js';

/**
 * @typedef {Object} GameState
 * @property {string[]} players - All players
 * @property {Object} currentGame - Current game info
 * @property {Object<string, import('./stats.js').PlayerStats>} playerStats - Player statistics
 * @property {import('./stats.js').TeamStats} teamStats - Team statistics
 * @property {Array} actions - Action log
 * @property {Array} actionHistory - Undo history
 * @property {string[]} onFieldPlayers - Players currently on field
 * @property {string[]} presentPlayers - Players present for game
 * @property {boolean} pointInProgress - Whether a point is being played
 * @property {Object|null} discPosition - Current disc position
 * @property {string|null} currentThrower - Player with the disc
 * @property {number} pointThrows - Throws in current point
 * @property {number} pointNumber - Current point number
 */

/** @type {GameState} */
let gameState = createInitialGameState();

/** @type {string[]} */
let lastUsedLine = [];

/** @type {'offense'|'defense'} */
let startingPossession = 'offense';

/** @type {boolean} */
let waitingForInitialPosition = false;

/**
 * Create initial game state
 * @returns {GameState}
 */
export function createInitialGameState() {
    return {
        players: [],
        currentGame: {
            id: null,
            ourTeam: '',
            opponentTeam: '',
            date: '',
            sheetId: '',
            isActive: false
        },
        playerStats: {},
        teamStats: stats.createEmptyTeamStats(),
        actions: [],
        actionHistory: [],
        lastClickPoint: null,
        throwInProgress: false,
        selectedThrower: null,
        selectedReceiver: null,
        onFieldPlayers: [],
        pointInProgress: false,
        injurySub: null,
        previousThrower: null,
        lastCompletedThrower: null,
        presentPlayers: [],
        discPosition: null,
        currentThrower: null,
        pointThrows: 0,
        possessionThrows: 0,
        totalPointThrows: [],
        currentPeriod: 1,
        periodType: 'half',
        gameTimerSeconds: 0,
        gameTimerRunning: false,
        gameTimerInterval: null,
        pointNumber: 1
    };
}

/**
 * Get current game state
 * @returns {GameState}
 */
export function getGameState() {
    return gameState;
}

/**
 * Update game state
 * @param {Partial<GameState>} updates - State updates
 */
export function updateGameState(updates) {
    gameState = { ...gameState, ...updates };
}

/**
 * Reset game state
 */
export function resetGameState() {
    gameState = createInitialGameState();
    lastUsedLine = [];
}

/**
 * Get last used line
 * @returns {string[]}
 */
export function getLastUsedLine() {
    return lastUsedLine;
}

/**
 * Set last used line
 * @param {string[]} line - Player names
 */
export function setLastUsedLine(line) {
    lastUsedLine = [...line];
}

/**
 * Get starting possession
 * @returns {'offense'|'defense'}
 */
export function getStartingPossession() {
    return startingPossession;
}

/**
 * Set starting possession
 * @param {'offense'|'defense'} possession
 */
export function setStartingPossession(possession) {
    startingPossession = possession;
}

/**
 * Check if waiting for initial position
 * @returns {boolean}
 */
export function isWaitingForInitialPosition() {
    return waitingForInitialPosition;
}

/**
 * Set waiting for initial position
 * @param {boolean} waiting
 */
export function setWaitingForInitialPosition(waiting) {
    waitingForInitialPosition = waiting;
}

// ==================== PLAYER MANAGEMENT ====================

/**
 * Initialize player stats for a player
 * @param {string} player - Player name
 */
export function initializePlayerStats(player) {
    if (!gameState.playerStats[player]) {
        gameState.playerStats[player] = stats.createEmptyPlayerStats();
    }
}

/**
 * Add player to roster
 * @param {string} player - Player name
 */
export function addPlayer(player) {
    if (!gameState.players.includes(player)) {
        gameState.players.push(player);
        initializePlayerStats(player);
    }
}

/**
 * Remove player from roster
 * @param {string} player - Player name
 */
export function removePlayer(player) {
    const index = gameState.players.indexOf(player);
    if (index > -1) {
        gameState.players.splice(index, 1);
        // Also remove from present and on-field
        const presentIndex = gameState.presentPlayers.indexOf(player);
        if (presentIndex > -1) gameState.presentPlayers.splice(presentIndex, 1);
        const fieldIndex = gameState.onFieldPlayers.indexOf(player);
        if (fieldIndex > -1) gameState.onFieldPlayers.splice(fieldIndex, 1);
    }
}

/**
 * Toggle player presence
 * @param {string} player - Player name
 */
export function toggleAttendance(player) {
    const index = gameState.presentPlayers.indexOf(player);
    if (index === -1) {
        gameState.presentPlayers.push(player);
    } else {
        gameState.presentPlayers.splice(index, 1);
        // Also remove from on-field
        const fieldIndex = gameState.onFieldPlayers.indexOf(player);
        if (fieldIndex > -1) {
            gameState.onFieldPlayers.splice(fieldIndex, 1);
        }
    }
}

/**
 * Toggle player on field
 * @param {string} player - Player name
 * @returns {boolean} Whether action succeeded
 */
export function togglePlayerOnField(player) {
    const index = gameState.onFieldPlayers.indexOf(player);
    
    if (index > -1) {
        gameState.onFieldPlayers.splice(index, 1);
        return true;
    } else if (gameState.onFieldPlayers.length < GAME_CONSTANTS.MAX_LINE_SIZE) {
        gameState.onFieldPlayers.push(player);
        return true;
    }
    
    return false;
}

/**
 * Clear line selection
 */
export function clearLineSelection() {
    gameState.onFieldPlayers = [];
}

/**
 * Select last used line
 * @returns {boolean} Whether selection succeeded
 */
export function selectLastLine() {
    if (lastUsedLine.length === 0) {
        showToast('No previous line to select');
        return false;
    }
    
    const availablePlayers = lastUsedLine.filter(p => gameState.presentPlayers.includes(p));
    
    if (availablePlayers.length === 0) {
        showToast('Previous players not available');
        return false;
    }
    
    gameState.onFieldPlayers = [...availablePlayers];
    
    if (availablePlayers.length < 7) {
        showToast(`${availablePlayers.length}/7 from last line available`);
    } else {
        showToast('Last line selected');
    }
    
    vibrate(30);
    return true;
}

// ==================== POINT MANAGEMENT ====================

/**
 * Start a new point
 * @returns {boolean} Whether point started successfully
 */
export function startPoint() {
    if (gameState.onFieldPlayers.length !== GAME_CONSTANTS.MAX_LINE_SIZE) {
        showToast('Select exactly 7 players');
        return false;
    }
    
    // Save current line for "Last Line" button
    lastUsedLine = [...gameState.onFieldPlayers];
    
    gameState.pointInProgress = true;
    gameState.discPosition = null;
    gameState.currentThrower = null;
    gameState.pointThrows = 0;
    gameState.possessionThrows = 0;
    
    vibrate([30, 20, 30]);
    
    if (startingPossession === 'offense') {
        logAction(`Point started (Offense) with: ${gameState.onFieldPlayers.join(', ')}`, 'system');
        return true;
    } else {
        logAction(`Point started (Defense) with: ${gameState.onFieldPlayers.join(', ')}`, 'system');
        showToast('Defense - tap field when we get the disc');
        return true;
    }
}

/**
 * End current point
 * @param {'score'|'turnover'|'halftime'} reason - Reason for ending point
 */
export function endPoint(reason) {
    gameState.pointInProgress = false;
    gameState.totalPointThrows.push(gameState.pointThrows);
    
    if (reason === 'score') {
        gameState.pointNumber++;
        hapticFeedback('score');
        playSound('score');
    }
}

/**
 * Select initial thrower
 * @param {string} player - Player name
 */
export function selectInitialThrower(player) {
    gameState.currentThrower = player;
    gameState.selectedThrower = player;
    showToast(`${player} has the disc - tap field to set position`);
    waitingForInitialPosition = true;
}

// ==================== STATS RECORDING ====================

/**
 * Record a throw
 * @param {string} thrower - Thrower name
 * @param {string} receiver - Receiver name
 * @param {number} distance - Distance in yards
 * @param {Object} startPos - Start position
 * @param {Object} endPos - End position
 */
export function recordThrow(thrower, receiver, distance, startPos, endPos) {
    // Update thrower stats
    if (gameState.playerStats[thrower]) {
        gameState.playerStats[thrower].throws++;
        gameState.playerStats[thrower].yardsThrown += distance;
    }
    
    // Update receiver stats
    if (gameState.playerStats[receiver]) {
        gameState.playerStats[receiver].catches++;
        gameState.playerStats[receiver].yardsCaught += distance;
    }
    
    // Update team stats
    gameState.teamStats.totalYardsThrown += distance;
    gameState.teamStats.totalYardsCaught += distance;
    
    // Increment throw counts
    gameState.pointThrows++;
    gameState.possessionThrows++;
    
    logAction(`${thrower} → ${receiver} (${distance} yds)`, 'throw');
}

/**
 * Record a goal
 * @param {string} thrower - Thrower name (assist)
 * @param {string} scorer - Scorer name
 * @param {number} distance - Distance of scoring throw
 */
export function recordGoal(thrower, scorer, distance) {
    // Update scorer stats
    if (gameState.playerStats[scorer]) {
        gameState.playerStats[scorer].goals++;
        gameState.playerStats[scorer].catches++;
        gameState.playerStats[scorer].yardsCaught += distance;
    }
    
    // Update thrower stats (assist)
    if (gameState.playerStats[thrower]) {
        gameState.playerStats[thrower].assists++;
        gameState.playerStats[thrower].throws++;
        gameState.playerStats[thrower].yardsThrown += distance;
    }
    
    // Check for hockey assist
    if (gameState.previousThrower && gameState.previousThrower !== thrower) {
        if (gameState.playerStats[gameState.previousThrower]) {
            gameState.playerStats[gameState.previousThrower].hockeyAssists++;
        }
    }
    
    // Update team stats
    gameState.teamStats.score++;
    gameState.teamStats.totalYardsThrown += distance;
    gameState.teamStats.totalYardsCaught += distance;
    
    logAction(`🎯 GOAL! ${thrower} → ${scorer}`, 'goal');
    hapticFeedback('score');
    playSound('score');
}

/**
 * Record opponent goal
 */
export function recordOpponentGoal() {
    gameState.teamStats.opponentScore++;
    logAction('Opponent scored', 'system');
}

/**
 * Record a turnover
 * @param {string} player - Player who turned it over
 * @param {string} type - Type of turnover
 * @param {Object} position - Position on field
 */
export function recordTurnover(player, type, position) {
    if (gameState.playerStats[player]) {
        gameState.playerStats[player].turnovers++;
    }
    
    gameState.teamStats.turnovers++;
    gameState.currentThrower = null;
    gameState.discPosition = position;
    gameState.possessionThrows = 0;
    
    logAction(`❌ Turnover: ${player} (${type})`, 'turnover');
    hapticFeedback('turnover');
    playSound('turnover');
}

/**
 * Record a block
 * @param {string} player - Player who got the block
 * @param {Object} position - Position on field
 */
export function recordBlock(player, position) {
    if (gameState.playerStats[player]) {
        gameState.playerStats[player].blocks++;
    }
    
    gameState.teamStats.turnoversGained++;
    gameState.discPosition = position;
    
    logAction(`🛡️ Block by ${player}`, 'block');
    hapticFeedback('block');
    playSound('block');
}

/**
 * Record opponent turnover (we get the disc)
 * @param {Object} position - Position on field
 */
export function recordOpponentTurnover(position) {
    gameState.teamStats.turnoversGained++;
    gameState.discPosition = position;
    gameState.possessionThrows = 0;
    
    logAction('Opponent turnover - we have the disc', 'system');
}

// ==================== ACTION LOG ====================

/**
 * Log an action
 * @param {string} message - Action message
 * @param {string} [type='info'] - Action type
 */
export function logAction(message, type = 'info') {
    const action = {
        id: Date.now().toString(),
        message,
        type,
        timestamp: new Date().toISOString(),
        pointNumber: gameState.pointNumber
    };
    
    gameState.actions.unshift(action);
    
    // Keep only last 100 actions in memory
    if (gameState.actions.length > 100) {
        gameState.actions = gameState.actions.slice(0, 100);
    }
}

/**
 * Undo last action
 * @returns {boolean} Whether undo succeeded
 */
export function undoLastAction() {
    if (gameState.actionHistory.length === 0) {
        showToast('Nothing to undo');
        return false;
    }
    
    const previousState = gameState.actionHistory.pop();
    
    // Restore relevant state
    gameState.playerStats = previousState.playerStats;
    gameState.teamStats = previousState.teamStats;
    gameState.currentThrower = previousState.currentThrower;
    gameState.discPosition = previousState.discPosition;
    gameState.pointThrows = previousState.pointThrows;
    
    // Remove last action from log
    if (gameState.actions.length > 0) {
        gameState.actions.shift();
    }
    
    hapticFeedback('undo');
    showToast('Action undone');
    return true;
}

/**
 * Save state for undo
 */
export function saveStateForUndo() {
    const stateCopy = {
        playerStats: JSON.parse(JSON.stringify(gameState.playerStats)),
        teamStats: { ...gameState.teamStats },
        currentThrower: gameState.currentThrower,
        discPosition: gameState.discPosition ? { ...gameState.discPosition } : null,
        pointThrows: gameState.pointThrows
    };
    
    gameState.actionHistory.push(stateCopy);
    
    // Keep only MAX_UNDO_HISTORY states
    if (gameState.actionHistory.length > GAME_CONSTANTS.MAX_UNDO_HISTORY) {
        gameState.actionHistory.shift();
    }
}

// ==================== FIELD UTILITIES ====================

/**
 * Calculate distance between field positions
 * @param {Object} startPos - Start position {x, y}
 * @param {Object} endPos - End position {x, y}
 * @returns {number} Distance in yards
 */
export function calculateThrowDistance(startPos, endPos) {
    return stats.calculateDistance(startPos, endPos);
}

/**
 * Check if position is in endzone
 * @param {number} y - Y coordinate (percentage)
 * @returns {'their'|'our'|null}
 */
export function checkEndzone(y) {
    return stats.isInEndzone(y);
}

// ==================== PERSISTENCE ====================

/**
 * Save game state to storage
 */
export function saveGameState() {
    storage.saveGameState(gameState);
}

/**
 * Load game state from storage
 */
export function loadGameState() {
    const saved = storage.loadGameState();
    if (saved) {
        gameState = { ...createInitialGameState(), ...saved };
    }
}

/**
 * Initialize game from setup
 * @param {Object} setup - Game setup object
 */
export function initializeFromSetup(setup) {
    if (!setup) return;
    
    gameState.currentGame = {
        id: setup.id || Date.now().toString(),
        ourTeam: setup.teamName || '',
        opponentTeam: setup.opponentName || '',
        date: setup.date || new Date().toISOString().split('T')[0],
        sheetId: setup.sheetId || '',
        isActive: true
    };
    
    if (setup.players && setup.players.length > 0) {
        gameState.players = [...setup.players];
        setup.players.forEach(player => initializePlayerStats(player));
    }
}

// Export for window access (needed for test page)
if (typeof window !== 'undefined') {
    window.lastUsedLine = lastUsedLine;
}
