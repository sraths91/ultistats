/**
 * @fileoverview API communication module
 * @module api
 */

import { API_CONFIG } from './constants.js';
import * as storage from './storage.js';

/**
 * @typedef {Object} APIResponse
 * @property {boolean} ok - Whether the request succeeded
 * @property {*} data - Response data
 * @property {string} [error] - Error message if failed
 */

/**
 * Get authorization headers
 * @returns {Object} Headers object with Authorization
 */
function getAuthHeaders() {
    const { token } = storage.loadAuthState();
    return token ? { 'Authorization': `Bearer ${token}` } : {};
}

/**
 * Make an API request with error handling
 * @param {string} endpoint - API endpoint (without base URL)
 * @param {Object} options - Fetch options
 * @returns {Promise<APIResponse>}
 */
async function apiRequest(endpoint, options = {}) {
    const url = `${API_CONFIG.BASE_URL}${endpoint}`;
    
    const defaultHeaders = {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
    };
    
    try {
        const response = await fetch(url, {
            ...options,
            headers: {
                ...defaultHeaders,
                ...options.headers
            }
        });
        
        const data = await response.json().catch(() => null);
        
        if (!response.ok) {
            return {
                ok: false,
                data: null,
                error: data?.error || `Request failed with status ${response.status}`
            };
        }
        
        return { ok: true, data, error: null };
    } catch (error) {
        console.error(`API request failed [${endpoint}]:`, error);
        return {
            ok: false,
            data: null,
            error: error.message || 'Network error'
        };
    }
}

// ==================== AUTH API ====================

/**
 * Register a new user
 * @param {string} email - User email
 * @param {string} password - User password
 * @param {string} name - User name
 * @returns {Promise<APIResponse>}
 */
export async function register(email, password, name) {
    return apiRequest('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, name })
    });
}

/**
 * Login user
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {Promise<APIResponse>}
 */
export async function login(email, password) {
    return apiRequest('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
    });
}

/**
 * Get current user profile
 * @returns {Promise<APIResponse>}
 */
export async function getProfile() {
    return apiRequest('/auth/me');
}

/**
 * Request password reset
 * @param {string} email - User email
 * @returns {Promise<APIResponse>}
 */
export async function requestPasswordReset(email) {
    return apiRequest('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email })
    });
}

// ==================== TEAMS API ====================

/**
 * Get user's teams
 * @returns {Promise<APIResponse>}
 */
export async function getTeams() {
    return apiRequest('/teams');
}

/**
 * Create a new team
 * @param {string} name - Team name
 * @returns {Promise<APIResponse>}
 */
export async function createTeam(name) {
    return apiRequest('/teams', {
        method: 'POST',
        body: JSON.stringify({ name })
    });
}

/**
 * Get team by ID
 * @param {string} teamId - Team ID
 * @returns {Promise<APIResponse>}
 */
export async function getTeam(teamId) {
    return apiRequest(`/teams/${teamId}`);
}

/**
 * Update team
 * @param {string} teamId - Team ID
 * @param {Object} updates - Team updates
 * @returns {Promise<APIResponse>}
 */
export async function updateTeam(teamId, updates) {
    return apiRequest(`/teams/${teamId}`, {
        method: 'PUT',
        body: JSON.stringify(updates)
    });
}

/**
 * Delete team
 * @param {string} teamId - Team ID
 * @returns {Promise<APIResponse>}
 */
export async function deleteTeam(teamId) {
    return apiRequest(`/teams/${teamId}`, {
        method: 'DELETE'
    });
}

/**
 * Invite user to team
 * @param {string} teamId - Team ID
 * @param {string} email - User email to invite
 * @param {string} role - Role to assign
 * @returns {Promise<APIResponse>}
 */
export async function inviteToTeam(teamId, email, role = 'coach') {
    return apiRequest(`/teams/${teamId}/invite`, {
        method: 'POST',
        body: JSON.stringify({ email, role })
    });
}

/**
 * Update team roster
 * @param {string} teamId - Team ID
 * @param {string[]} roster - Array of player names
 * @returns {Promise<APIResponse>}
 */
export async function updateRoster(teamId, roster) {
    return apiRequest(`/teams/${teamId}/roster`, {
        method: 'PUT',
        body: JSON.stringify({ roster })
    });
}

// ==================== GAMES API ====================

/**
 * Get games for a team
 * @param {string} teamId - Team ID
 * @returns {Promise<APIResponse>}
 */
export async function getGames(teamId) {
    return apiRequest(`/teams/${teamId}/games`);
}

/**
 * Create a new game
 * @param {string} teamId - Team ID
 * @param {Object} gameData - Game data
 * @returns {Promise<APIResponse>}
 */
export async function createGame(teamId, gameData) {
    return apiRequest(`/teams/${teamId}/games`, {
        method: 'POST',
        body: JSON.stringify(gameData)
    });
}

/**
 * Update game
 * @param {string} gameId - Game ID
 * @param {Object} updates - Game updates
 * @returns {Promise<APIResponse>}
 */
export async function updateGame(gameId, updates) {
    return apiRequest(`/games/${gameId}`, {
        method: 'PUT',
        body: JSON.stringify(updates)
    });
}

/**
 * End game and save final stats
 * @param {string} gameId - Game ID
 * @param {Object} finalStats - Final game statistics
 * @returns {Promise<APIResponse>}
 */
export async function endGame(gameId, finalStats) {
    return apiRequest(`/games/${gameId}/end`, {
        method: 'POST',
        body: JSON.stringify(finalStats)
    });
}

// ==================== STATS API ====================

/**
 * Get player stats
 * @param {string} teamId - Team ID
 * @param {string} [playerId] - Optional player ID for specific player
 * @returns {Promise<APIResponse>}
 */
export async function getPlayerStats(teamId, playerId = null) {
    const endpoint = playerId 
        ? `/teams/${teamId}/stats/players/${playerId}`
        : `/teams/${teamId}/stats/players`;
    return apiRequest(endpoint);
}

/**
 * Get team stats
 * @param {string} teamId - Team ID
 * @returns {Promise<APIResponse>}
 */
export async function getTeamStats(teamId) {
    return apiRequest(`/teams/${teamId}/stats`);
}

/**
 * Sync stats to server
 * @param {string} teamId - Team ID
 * @param {Object} stats - Stats to sync
 * @returns {Promise<APIResponse>}
 */
export async function syncStats(teamId, stats) {
    return apiRequest(`/teams/${teamId}/stats/sync`, {
        method: 'POST',
        body: JSON.stringify(stats)
    });
}

// ==================== TOURNAMENTS API ====================

/**
 * Get tournaments
 * @returns {Promise<APIResponse>}
 */
export async function getTournaments() {
    return apiRequest('/tournaments');
}

/**
 * Create tournament
 * @param {Object} tournamentData - Tournament data
 * @returns {Promise<APIResponse>}
 */
export async function createTournament(tournamentData) {
    return apiRequest('/tournaments', {
        method: 'POST',
        body: JSON.stringify(tournamentData)
    });
}

/**
 * Get tournament by ID
 * @param {string} tournamentId - Tournament ID
 * @returns {Promise<APIResponse>}
 */
export async function getTournament(tournamentId) {
    return apiRequest(`/tournaments/${tournamentId}`);
}

/**
 * Update tournament
 * @param {string} tournamentId - Tournament ID
 * @param {Object} updates - Tournament updates
 * @returns {Promise<APIResponse>}
 */
export async function updateTournament(tournamentId, updates) {
    return apiRequest(`/tournaments/${tournamentId}`, {
        method: 'PUT',
        body: JSON.stringify(updates)
    });
}

// ==================== INVITATIONS API ====================

/**
 * Get pending invitations for current user
 * @returns {Promise<APIResponse>}
 */
export async function getPendingInvitations() {
    return apiRequest('/invitations/pending');
}

/**
 * Accept invitation
 * @param {string} invitationId - Invitation ID
 * @returns {Promise<APIResponse>}
 */
export async function acceptInvitation(invitationId) {
    return apiRequest(`/invitations/${invitationId}/accept`, {
        method: 'POST'
    });
}

/**
 * Decline invitation
 * @param {string} invitationId - Invitation ID
 * @returns {Promise<APIResponse>}
 */
export async function declineInvitation(invitationId) {
    return apiRequest(`/invitations/${invitationId}/decline`, {
        method: 'POST'
    });
}
