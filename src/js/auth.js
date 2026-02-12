/**
 * @fileoverview Authentication module
 * @module auth
 */

import * as api from './api.js';
import * as storage from './storage.js';
import { showToast, hapticFeedback, showLoadingState, hideLoadingState, refreshIcons } from './ui.js';

/**
 * @typedef {Object} User
 * @property {string} id - User ID
 * @property {string} email - User email
 * @property {string} name - User name
 * @property {string} [createdAt] - Creation timestamp
 */

/**
 * @typedef {Object} AuthState
 * @property {User|null} user - Current user
 * @property {string|null} token - JWT token
 * @property {Object|null} currentTeam - Current selected team
 * @property {Array} userTeams - User's teams
 */

/** @type {AuthState} */
const authState = {
    user: null,
    token: null,
    currentTeam: null,
    userTeams: [],
};

/**
 * Initialize auth state from storage
 * @returns {boolean} Whether user is authenticated
 */
export function initAuth() {
    const { token, user } = storage.loadAuthState();
    if (token && user) {
        authState.token = token;
        authState.user = user;
        authState.currentTeam = storage.loadCurrentTeam();
        return true;
    }
    return false;
}

/**
 * Get current auth state
 * @returns {AuthState}
 */
export function getAuthState() {
    return { ...authState };
}

/**
 * Check if user is authenticated
 * @returns {boolean}
 */
export function isAuthenticated() {
    return !!authState.token && !!authState.user;
}

/**
 * Get current user
 * @returns {User|null}
 */
export function getCurrentUser() {
    return authState.user;
}

/**
 * Get current team
 * @returns {Object|null}
 */
export function getCurrentTeam() {
    return authState.currentTeam;
}

/**
 * Get user teams
 * @returns {Array}
 */
export function getUserTeams() {
    return authState.userTeams;
}

/**
 * Set user teams
 * @param {Array} teams - Teams array
 */
export function setUserTeams(teams) {
    authState.userTeams = teams;
}

/**
 * Register new user
 * @param {string} email - User email
 * @param {string} password - User password
 * @param {string} name - User name
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function register(email, password, name) {
    const result = await api.register(email, password, name);

    if (result.ok && result.data) {
        authState.token = result.data.token;
        authState.user = result.data.user;
        storage.saveAuthState(result.data.token, result.data.user);
        hapticFeedback('success');
        return { success: true };
    }

    return { success: false, error: result.error || 'Registration failed' };
}

/**
 * Login user
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function login(email, password) {
    const result = await api.login(email, password);

    if (result.ok && result.data) {
        authState.token = result.data.token;
        authState.user = result.data.user;
        storage.saveAuthState(result.data.token, result.data.user);
        hapticFeedback('success');
        return { success: true };
    }

    return { success: false, error: result.error || 'Login failed' };
}

/**
 * Logout user
 */
export function logout() {
    authState.token = null;
    authState.user = null;
    authState.currentTeam = null;
    authState.userTeams = [];
    storage.clearAuthState();
    hapticFeedback('tap');
}

/**
 * Select team
 * @param {Object} team - Team to select
 */
export function selectTeam(team) {
    authState.currentTeam = team;
    storage.saveCurrentTeam(team);
}

/**
 * Load user's teams from API
 * @returns {Promise<Array>}
 */
export async function loadUserTeams() {
    if (!authState.token) return [];

    const result = await api.getTeams();
    if (result.ok && result.data) {
        authState.userTeams = result.data;
        return result.data;
    }

    return [];
}

/**
 * Create a new team
 * @param {string} name - Team name
 * @returns {Promise<{success: boolean, team?: Object, error?: string}>}
 */
export async function createTeam(name) {
    const result = await api.createTeam(name);

    if (result.ok && result.data) {
        authState.userTeams.push(result.data);
        selectTeam(result.data);
        hapticFeedback('success');
        return { success: true, team: result.data };
    }

    return { success: false, error: result.error || 'Failed to create team' };
}

/**
 * Invite user to current team
 * @param {string} email - Email to invite
 * @param {string} [role='coach'] - Role to assign
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function inviteToTeam(email, role = 'coach') {
    if (!authState.currentTeam) {
        return { success: false, error: 'No team selected' };
    }

    const result = await api.inviteToTeam(authState.currentTeam.id, email, role);

    if (result.ok) {
        hapticFeedback('success');
        return { success: true };
    }

    return { success: false, error: result.error || 'Failed to send invitation' };
}

/**
 * Request password reset
 * @param {string} email - User email
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function requestPasswordReset(email) {
    const result = await api.requestPasswordReset(email);

    if (result.ok) {
        return { success: true };
    }

    return { success: false, error: result.error || 'Failed to send reset email' };
}

/**
 * Check for pending invitations
 * @returns {Promise<Array>}
 */
export async function checkPendingInvitations() {
    const result = await api.getPendingInvitations();
    return result.ok ? result.data : [];
}

/**
 * Accept team invitation
 * @param {string} invitationId - Invitation ID
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function acceptInvitation(invitationId) {
    const result = await api.acceptInvitation(invitationId);

    if (result.ok) {
        // Reload teams to get the new team
        await loadUserTeams();
        hapticFeedback('success');
        return { success: true };
    }

    return { success: false, error: result.error || 'Failed to accept invitation' };
}

/**
 * Decline team invitation
 * @param {string} invitationId - Invitation ID
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function declineInvitation(invitationId) {
    const result = await api.declineInvitation(invitationId);

    if (result.ok) {
        return { success: true };
    }

    return { success: false, error: result.error || 'Failed to decline invitation' };
}

// ==================== UI HANDLERS ====================

/**
 * Handle login form submission
 * @param {Event} event - Form submit event
 */
export async function handleLoginSubmit(event) {
    event.preventDefault();

    const email = document.getElementById('login-email')?.value;
    const password = document.getElementById('login-password')?.value;
    const submitBtn = event.target.querySelector('button[type="submit"]');
    const errorDiv = document.getElementById('login-error');

    if (!email || !password) {
        if (errorDiv) {
            errorDiv.textContent = 'Please fill in all fields';
            errorDiv.classList.remove('hidden');
        }
        return;
    }

    showLoadingState(submitBtn, 'Signing in...');

    const result = await login(email, password);

    hideLoadingState(submitBtn);

    if (result.success) {
        showToast('Welcome back!', 'success');
        // Redirect to dashboard
        window.location.href = '/dashboard.html';
    } else {
        if (errorDiv) {
            errorDiv.textContent = result.error;
            errorDiv.classList.remove('hidden');
        }
        hapticFeedback('error');
    }
}

/**
 * Handle registration form submission
 * @param {Event} event - Form submit event
 */
export async function handleRegisterSubmit(event) {
    event.preventDefault();

    const name = document.getElementById('register-name')?.value;
    const email = document.getElementById('register-email')?.value;
    const password = document.getElementById('register-password')?.value;
    const confirmPassword = document.getElementById('register-confirm-password')?.value;
    const submitBtn = event.target.querySelector('button[type="submit"]');
    const errorDiv = document.getElementById('register-error');

    if (!name || !email || !password) {
        if (errorDiv) {
            errorDiv.textContent = 'Please fill in all fields';
            errorDiv.classList.remove('hidden');
        }
        return;
    }

    if (password !== confirmPassword) {
        if (errorDiv) {
            errorDiv.textContent = 'Passwords do not match';
            errorDiv.classList.remove('hidden');
        }
        return;
    }

    if (password.length < 6) {
        if (errorDiv) {
            errorDiv.textContent = 'Password must be at least 6 characters';
            errorDiv.classList.remove('hidden');
        }
        return;
    }

    showLoadingState(submitBtn, 'Creating account...');

    const result = await register(email, password, name);

    hideLoadingState(submitBtn);

    if (result.success) {
        showToast('Account created!', 'success');
        // Redirect to dashboard
        window.location.href = '/dashboard.html';
    } else {
        if (errorDiv) {
            errorDiv.textContent = result.error;
            errorDiv.classList.remove('hidden');
        }
        hapticFeedback('error');
    }
}

/**
 * Handle logout
 */
export function handleLogout() {
    logout();
    showToast('Logged out', 'info');
    window.location.href = '/index.html';
}
