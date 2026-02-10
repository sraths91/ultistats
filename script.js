// Ultimate Frisbee Stats Tracker JavaScript

// HTML sanitization helper — prevents XSS when interpolating user data into innerHTML
function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// API Configuration
const API_BASE_URL = 'http://localhost:3001/api';

// Game Constants
const GAME_CONSTANTS = {
    FIELD_LENGTH_YARDS: 120,      // Total field length including end zones
    FIELD_WIDTH_YARDS: 40,        // Field width
    ENDZONE_PERCENT: 13.3,        // End zone as percentage of field (20/150)
    BRICK_MARK_PERCENT: 26.6,     // Brick mark position as percentage
    MAX_LINE_SIZE: 7,             // Players per line
    MAX_UNDO_HISTORY: 20,         // Maximum undo states to keep
    DEFAULT_SCORE_DISTANCE: 20    // Estimated scoring throw distance in yards
};

// Google Sheets API Configuration
const CLIENT_ID = 'YOUR_CLIENT_ID'; // Replace with your actual client ID
const API_KEY = 'YOUR_API_KEY'; // Replace with your actual API key
const DISCOVERY_DOC = 'https://sheets.googleapis.com/$discovery/rest?version=v4';
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';

// LocalStorage keys
const STORAGE_KEY = 'ultistats_game_data';
const SEASON_STORAGE_KEY = 'ultistats_season_data';
const TOURNAMENT_STORAGE_KEY = 'ultistats_tournament_data';
const PAST_TOURNAMENTS_KEY = 'ultistats_past_tournaments';
const GAME_HISTORY_KEY = 'ultistats_game_history';
const ROSTER_KEY = 'ultistats_roster';
const CAREER_STATS_KEY = 'ultistats_career_data';
const TEAMS_KEY = 'ultistats_teams';
const LEAGUES_KEY = 'ultistats_leagues';
const TOURNAMENTS_LOCAL_KEY = 'ultistats_local_tournaments';
const RANKINGS_CACHE_KEY = 'ultistats_rankings_cache';

// Game history
let gameHistory = [];

// Persistent roster (survives game resets)
let savedRoster = [];

// Career stats (never resets - tracks entire player careers)
let careerStats = {
    players: {},
    totalGames: 0,
    totalSeasons: 0,
    startDate: null
};

// Team management
let teamsData = {
    teams: {},
    currentTeamId: null
};

// League management (ongoing seasons with linked tournaments)
let leaguesData = {
    leagues: {},
    currentLeagueId: null
};

// Tournament management (short events: weekend tournaments, regionals, USAU imports)
let tournamentsData = {
    tournaments: {},
    currentTournamentId: null
};

// Player positions
const POSITIONS = ['Handler', 'Cutter', 'Hybrid'];
let customPositions = [];
const POSITIONS_KEY = 'ultistats_custom_positions';

// Player position data (playerName -> position)
let playerPositions = {};
const PLAYER_POSITIONS_KEY = 'ultistats_player_positions';

// Player registry (playerId -> player object with name, number, etc.)
let playerRegistry = {};
const PLAYER_REGISTRY_KEY = 'ultistats_player_registry';

// Utility Functions
function safeElement(id, callback) {
    const el = document.getElementById(id);
    if (el && callback) callback(el);
    return el;
}

function showLoadingState(buttonEl, loadingText = 'Loading...') {
    if (!buttonEl) return;
    buttonEl.dataset.originalText = buttonEl.innerHTML;
    buttonEl.disabled = true;
    buttonEl.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin inline-block"></i> ${loadingText}`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function hideLoadingState(buttonEl) {
    if (!buttonEl || !buttonEl.dataset.originalText) return;
    buttonEl.disabled = false;
    buttonEl.innerHTML = buttonEl.dataset.originalText;
    delete buttonEl.dataset.originalText;
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function flashElement(element, color = 'emerald') {
    if (!element) return;
    element.classList.add(`ring-2`, `ring-${color}-500`, 'ring-opacity-75');
    setTimeout(() => {
        element.classList.remove(`ring-2`, `ring-${color}-500`, 'ring-opacity-75');
    }, 300);
}

function tryCatch(fn, errorMessage = 'An error occurred') {
    return function(...args) {
        try {
            return fn.apply(this, args);
        } catch (error) {
            console.error(`${errorMessage}:`, error);
            showToast(`Error: ${errorMessage}`, 'error');
            return null;
        }
    };
}

function handleError(error, context = 'Operation') {
    console.error(`${context} failed:`, error);
    showToast(`${context} failed. Please try again.`, 'error');
}

// Get click coordinates relative to element's content area (inside borders/padding)
function getContentAreaCoordinates(event, element) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    
    const borderLeft = parseFloat(style.borderLeftWidth) || 0;
    const borderTop = parseFloat(style.borderTopWidth) || 0;
    const borderRight = parseFloat(style.borderRightWidth) || 0;
    const borderBottom = parseFloat(style.borderBottomWidth) || 0;
    
    const contentWidth = rect.width - borderLeft - borderRight;
    const contentHeight = rect.height - borderTop - borderBottom;
    
    return {
        x: event.clientX - rect.left - borderLeft,
        y: event.clientY - rect.top - borderTop,
        percentX: ((event.clientX - rect.left - borderLeft) / contentWidth) * 100,
        percentY: ((event.clientY - rect.top - borderTop) / contentHeight) * 100,
        contentWidth,
        contentHeight
    };
}

// Generate unique ID (UUID v4)
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Generate unique player number (jersey number style)
function generatePlayerNumber() {
    const usedNumbers = Object.values(playerRegistry).map(p => p.number).filter(n => n);
    let number;
    do {
        number = Math.floor(Math.random() * 99) + 1;
    } while (usedNumbers.includes(number));
    return number;
}

// Create player object with unique ID
function createPlayer(name, position = null) {
    const id = generateUUID();
    const number = generatePlayerNumber();
    return {
        id,
        name,
        number,
        position: position || 'Hybrid',
        createdAt: new Date().toISOString()
    };
}

// Get player by ID
function getPlayerById(id) {
    return playerRegistry[id] || null;
}

// Get player by name (for backwards compatibility)
function getPlayerByName(name) {
    return Object.values(playerRegistry).find(p => p.name === name) || null;
}

// Save player registry
function savePlayerRegistry() {
    localStorage.setItem(PLAYER_REGISTRY_KEY, JSON.stringify(playerRegistry));
}

// Load player registry
function loadPlayerRegistry() {
    try {
        const saved = localStorage.getItem(PLAYER_REGISTRY_KEY);
        if (saved) {
            playerRegistry = JSON.parse(saved);
        }
    } catch (e) {
        console.error('Error loading player registry:', e);
        playerRegistry = {};
    }
}

// Settings/Preferences
const SETTINGS_KEY = 'ultistats_settings';
const AVATARS_KEY = 'ultistats_avatars';
const AUTH_TOKEN_KEY = 'ultistats_auth_token';
const AUTH_USER_KEY = 'ultistats_auth_user';
const CURRENT_TEAM_KEY = 'ultistats_current_team';

let appSettings = {
    darkMode: true,
    hapticEnabled: true,
    soundEnabled: false,
    confirmDestructive: true
};

let playerAvatars = {}; // playerName -> { type: 'initials'|'color'|'image', value: string }

// Authentication state
let currentUser = null;
let currentTeam = null;
let userTeams = [];

// ==================== CLIENT-SIDE ROUTER ====================
const routes = {
    '/': 'auth',
    '/login': 'auth',
    '/dashboard': 'dashboard',
    '/game': 'game',
    '/stats': 'stats',
    '/settings': 'settings'
};

function navigateTo(path) {
    window.history.pushState({}, '', path);
    handleRoute();
}

function handleRoute() {
    const path = window.location.pathname;
    const route = routes[path] || 'auth';
    
    // Check auth state (user info in localStorage; token in HttpOnly cookie)
    const isLoggedIn = !!localStorage.getItem(AUTH_USER_KEY);
    
    // Redirect to login if not authenticated and trying to access protected routes
    if (!isLoggedIn && route !== 'auth') {
        window.history.replaceState({}, '', '/');
        showAuthScreen();
        return;
    }
    
    // Redirect to dashboard if logged in and on auth page
    if (isLoggedIn && (route === 'auth' || path === '/')) {
        window.history.replaceState({}, '', '/dashboard');
        showMainApp();
        return;
    }
    
    // Handle specific routes
    switch (route) {
        case 'auth':
            showAuthScreen();
            break;
        case 'dashboard':
        case 'game':
        case 'stats':
        case 'settings':
            showMainApp();
            break;
        default:
            showAuthScreen();
    }
}

// Handle browser back/forward buttons
window.addEventListener('popstate', handleRoute);

// Haptic patterns for different events
const HAPTIC_PATTERNS = {
    tap: [10],
    success: [30, 20, 30],
    score: [100, 50, 100, 50, 100],
    endzoneScore: [50, 30, 80, 30, 120, 50, 150], // celebration escalation
    turnover: [100],
    block: [50, 30, 50],
    error: [200],
    select: [15],
    undo: [40, 40],
    swipeUndo: [20, 10, 40],
    halfTime: [80, 60, 80, 60, 80], // rhythmic pulse for half/game point
    gamePoint: [60, 40, 60, 40, 120, 80, 120] // intense build-up
};

// Sound effects (Web Audio API)
let audioContext = null;

function initAudio() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
}

function playSound(type) {
    if (!appSettings.soundEnabled) return;
    initAudio();
    
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    switch(type) {
        case 'score':
            oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
            oscillator.frequency.setValueAtTime(1100, audioContext.currentTime + 0.1);
            oscillator.frequency.setValueAtTime(1320, audioContext.currentTime + 0.2);
            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialDecayTo(0.01, audioContext.currentTime + 0.4);
            oscillator.start();
            oscillator.stop(audioContext.currentTime + 0.4);
            break;
        case 'turnover':
            oscillator.frequency.setValueAtTime(300, audioContext.currentTime);
            oscillator.frequency.setValueAtTime(200, audioContext.currentTime + 0.1);
            gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
            gainNode.gain.exponentialDecayTo(0.01, audioContext.currentTime + 0.2);
            oscillator.start();
            oscillator.stop(audioContext.currentTime + 0.2);
            break;
        case 'block':
            oscillator.frequency.setValueAtTime(600, audioContext.currentTime);
            oscillator.frequency.setValueAtTime(800, audioContext.currentTime + 0.05);
            gainNode.gain.setValueAtTime(0.25, audioContext.currentTime);
            gainNode.gain.exponentialDecayTo(0.01, audioContext.currentTime + 0.15);
            oscillator.start();
            oscillator.stop(audioContext.currentTime + 0.15);
            break;
        case 'tap':
            oscillator.frequency.setValueAtTime(500, audioContext.currentTime);
            gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
            gainNode.gain.exponentialDecayTo(0.01, audioContext.currentTime + 0.05);
            oscillator.start();
            oscillator.stop(audioContext.currentTime + 0.05);
            break;
        default:
            oscillator.frequency.setValueAtTime(440, audioContext.currentTime);
            gainNode.gain.setValueAtTime(0.15, audioContext.currentTime);
            gainNode.gain.exponentialDecayTo(0.01, audioContext.currentTime + 0.1);
            oscillator.start();
            oscillator.stop(audioContext.currentTime + 0.1);
    }
}

// Fix for exponentialDecayTo not existing
AudioParam.prototype.exponentialDecayTo = AudioParam.prototype.exponentialDecayTo || function(value, endTime) {
    this.exponentialRampToValueAtTime(Math.max(value, 0.0001), endTime);
};

// ==================== AUTHENTICATION ====================

function loadAuthState() {
    try {
        const user = localStorage.getItem(AUTH_USER_KEY);
        const team = localStorage.getItem(CURRENT_TEAM_KEY);

        if (user) {
            currentUser = JSON.parse(user);
            if (team) {
                currentTeam = JSON.parse(team);
            }
            return true;
        }
    } catch (e) {
        console.warn('Could not load auth state:', e);
    }
    return false;
}

function saveAuthState(token, user) {
    try {
        // Token is stored in HttpOnly cookie by the server.
        // Only save user info to localStorage for UI state.
        localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
        currentUser = user;
    } catch (e) {
        console.warn('Could not save auth state:', e);
    }
}

function clearAuthState() {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    localStorage.removeItem(CURRENT_TEAM_KEY);
    currentUser = null;
    currentTeam = null;
    userTeams = [];
    // Clear server cookie
    fetch(`${API_BASE_URL}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {});
}

function updatePasswordStrength(value) {
    const container = document.getElementById('password-strength');
    if (!container) return;
    container.classList.toggle('hidden', value.length === 0);
    const checks = [
        { id: 'pw-length', pass: value.length >= 12, label: '12+ characters' },
        { id: 'pw-upper', pass: /[A-Z]/.test(value), label: 'Uppercase letter' },
        { id: 'pw-lower', pass: /[a-z]/.test(value), label: 'Lowercase letter' },
        { id: 'pw-number', pass: /[0-9]/.test(value), label: 'Number' },
    ];
    checks.forEach(({ id, pass, label }) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.className = 'flex items-center gap-1.5 ' + (pass ? 'text-emerald-400' : 'text-gray-500');
        el.innerHTML = `<span class="w-3">${pass ? '&#x2713;' : '&#x2717;'}</span> ${label}`;
    });
}

function togglePasswordVisibility(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    btn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
    btn.innerHTML = isPassword
        ? '<i data-lucide="eye-off" class="w-5 h-5"></i>'
        : '<i data-lucide="eye" class="w-5 h-5"></i>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function handleForgotPassword() {
    const email = document.getElementById('login-email')?.value?.trim();
    if (!email) {
        const errorDiv = document.getElementById('login-error');
        if (errorDiv) {
            errorDiv.textContent = 'Please enter your email address first';
            errorDiv.classList.remove('hidden');
        }
        return;
    }
    try {
        await fetch(`${API_BASE_URL}/auth/forgot-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
    } catch (_) { /* always show success to prevent enumeration */ }
    showToast('If that email is registered, a reset link has been sent.', 4000, 'success');
}

function showAuthTab(tab) {
    const loginTab = document.getElementById('login-tab');
    const registerTab = document.getElementById('register-tab');
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    
    if (tab === 'login') {
        loginTab.classList.add('bg-white/10', 'text-white');
        loginTab.classList.remove('text-gray-400');
        loginTab.setAttribute('aria-selected', 'true');
        registerTab.classList.remove('bg-white/10', 'text-white');
        registerTab.classList.add('text-gray-400');
        registerTab.setAttribute('aria-selected', 'false');
        loginForm.classList.remove('hidden');
        registerForm.classList.add('hidden');
    } else {
        registerTab.classList.add('bg-white/10', 'text-white');
        registerTab.classList.remove('text-gray-400');
        registerTab.setAttribute('aria-selected', 'true');
        loginTab.classList.remove('bg-white/10', 'text-white');
        loginTab.classList.add('text-gray-400');
        loginTab.setAttribute('aria-selected', 'false');
        registerForm.classList.remove('hidden');
        loginForm.classList.add('hidden');
    }
}

// Arrow key navigation between auth tabs (WAI-ARIA tabs pattern)
document.addEventListener('DOMContentLoaded', () => {
    const tablist = document.querySelector('[role="tablist"]');
    if (!tablist) return;
    tablist.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            const isLogin = document.getElementById('login-tab').getAttribute('aria-selected') === 'true';
            const nextTab = (e.key === 'ArrowRight') ? (isLogin ? 'register' : 'login') : (isLogin ? 'register' : 'login');
            showAuthTab(nextTab);
            document.getElementById(nextTab === 'login' ? 'login-tab' : 'register-tab').focus();
        }
    });
});

function showPageTransition(message = 'Loading...') {
    const overlay = document.createElement('div');
    overlay.id = 'page-transition';
    overlay.className = 'fixed inset-0 z-[100] bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center';
    overlay.innerHTML = `
        <div class="text-center">
            <div class="w-16 h-16 mx-auto mb-4 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin"></div>
            <p class="text-white font-medium">${message}</p>
        </div>
    `;
    document.body.appendChild(overlay);
}

function setFormDisabled(formId, disabled) {
    const form = document.getElementById(formId);
    if (!form) return;
    form.querySelectorAll('input, button, select, textarea').forEach(el => {
        el.disabled = disabled;
    });
    form.style.opacity = disabled ? '0.6' : '1';
}

async function handleLogin(event) {
    event.preventDefault();

    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const errorDiv = document.getElementById('login-error');
    const submitBtn = document.getElementById('login-submit-btn');

    errorDiv.classList.add('hidden');

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        errorDiv.textContent = 'Please enter a valid email address (e.g., demo@demo.com)';
        errorDiv.classList.remove('hidden');
        hapticFeedback('error');
        return;
    }

    setFormDisabled('login-form', true);
    submitBtn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i><span>Signing in...</span>';
    if (typeof lucide !== 'undefined') lucide.createIcons();

    try {
        const response = await fetch(`${API_BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Login failed');
        }

        saveAuthState(data.token, data.user);
        hapticFeedback('success');
        showPageTransition('Welcome back!');
        setTimeout(() => { window.location.href = '/dashboard.html'; }, 400);
        return; // Don't re-enable form since we're navigating away

    } catch (error) {
        errorDiv.textContent = error.message;
        errorDiv.classList.remove('hidden');
        hapticFeedback('error');
        setFormDisabled('login-form', false);
        submitBtn.innerHTML = '<span>Sign In</span><i data-lucide="arrow-right" class="w-4 h-4"></i>';
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }
}

async function handleRegister(event) {
    event.preventDefault();
    
    const name = document.getElementById('register-name').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    const confirm = document.getElementById('register-confirm').value;
    const errorDiv = document.getElementById('register-error');
    const submitBtn = document.getElementById('register-submit-btn');
    
    errorDiv.classList.add('hidden');
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        errorDiv.textContent = 'Please enter a valid email address (e.g., demo@demo.com)';
        errorDiv.classList.remove('hidden');
        hapticFeedback('error');
        return;
    }
    
    if (password !== confirm) {
        errorDiv.textContent = 'Passwords do not match';
        errorDiv.classList.remove('hidden');
        return;
    }

    setFormDisabled('register-form', true);
    submitBtn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i><span>Creating account...</span>';
    if (typeof lucide !== 'undefined') lucide.createIcons();

    try {
        const response = await fetch(`${API_BASE_URL}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ name, email, password })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Registration failed');
        }

        saveAuthState(data.token, data.user);
        hapticFeedback('success');

        // Store auto-joined teams info for dashboard to show
        if (data.autoJoinedTeams && data.autoJoinedTeams.length > 0) {
            localStorage.setItem('ultistats_auto_joined_teams', JSON.stringify(data.autoJoinedTeams));
        }

        showPageTransition('Setting up your account...');
        setTimeout(() => { window.location.href = '/dashboard.html'; }, 400);
        return; // Don't re-enable form since we're navigating away

    } catch (error) {
        errorDiv.textContent = error.message;
        errorDiv.classList.remove('hidden');
        hapticFeedback('error');
        setFormDisabled('register-form', false);
        submitBtn.innerHTML = '<span>Create Account</span><i data-lucide="user-plus" class="w-4 h-4"></i>';
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }
}

function showMainApp() {
    const authScreen = document.getElementById('auth-screen');
    const mainApp = document.getElementById('main-app');
    
    // Only run on pages that have these elements (index.html)
    if (!authScreen || !mainApp) return;
    
    authScreen.classList.add('hidden');
    mainApp.classList.remove('hidden');
    
    // Ensure game-history section is visible
    const gameHistorySection = document.getElementById('game-history');
    if (gameHistorySection) {
        gameHistorySection.classList.remove('hidden');
    }
    
    updateUserDisplay();
    updateGameSetupUI();
    updateGameHistoryDisplay();
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function showAuthScreen() {
    const authScreen = document.getElementById('auth-screen');
    const mainApp = document.getElementById('main-app');
    
    // Show auth screen if it exists (index.html)
    if (authScreen) authScreen.classList.remove('hidden');
    if (mainApp) mainApp.classList.add('hidden');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function updateUserDisplay() {
    // Update header to show user info
    const headerRight = document.querySelector('header .flex.gap-3');
    if (headerRight && currentUser) {
        // Check if user menu already exists
        let userMenu = document.getElementById('user-menu');
        if (!userMenu) {
            userMenu = document.createElement('div');
            userMenu.id = 'user-menu';
            userMenu.className = 'flex items-center gap-3';
            userMenu.innerHTML = `
                <div class="flex items-center gap-2 bg-white/10 px-3 py-2 rounded-xl border border-white/10">
                    <div class="w-8 h-8 bg-gradient-to-br from-emerald-400 to-cyan-500 rounded-full flex items-center justify-center text-white font-bold text-sm">
                        ${escapeHtml(currentUser.name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2))}
                    </div>
                    <span class="text-white text-sm font-medium hidden sm:inline">${escapeHtml(currentUser.name)}</span>
                </div>
                <button onclick="handleLogout()" class="flex items-center gap-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 px-4 py-2.5 rounded-xl transition-all duration-300 border border-red-500/20">
                    <i data-lucide="log-out" class="w-4 h-4"></i>
                    <span class="text-sm font-medium hidden sm:inline">Logout</span>
                </button>
            `;
            headerRight.insertBefore(userMenu, headerRight.firstChild);
        }
    }
}

function handleLogout() {
    clearAuthState();
    window.location.href = '/index.html';
}

async function loadUserTeams() {
    if (!currentUser) return;

    try {
        const response = await fetch(`${API_BASE_URL}/teams`, {
            credentials: 'include'
        });
        
        if (response.ok) {
            userTeams = await response.json();
            
            if (userTeams.length > 0) {
                // Select first team if none selected
                if (!currentTeam) {
                    selectTeam(userTeams[0]);
                }
                updateTeamSelector();
                
                // Also load games, player stats, and tournaments from API
                await loadGamesFromAPI();
                await loadPlayerStatsFromAPI();
                await loadTournamentsFromAPI();
            } else {
                showTeamSetup();
            }
        }
    } catch (error) {
        console.error('Failed to load teams:', error);
    }
}

async function loadGamesFromAPI() {
    try {
        const response = await fetch(`${API_BASE_URL}/games`);
        
        if (response.ok) {
            const games = await response.json();
            
            // Filter games for current team and format them
            const teamGames = games
                .filter(g => g.ourTeam === (currentTeam?.name || 'Disc Dynasty') && g.status === 'completed')
                .map(g => ({
                    ...g,
                    result: g.isWin ? 'W' : (g.ourScore < g.opponentScore ? 'L' : 'T')
                }));
            
            // Merge with existing gameHistory (avoid duplicates)
            const existingIds = new Set(gameHistory.map(g => g.id));
            teamGames.forEach(game => {
                if (!existingIds.has(game.id)) {
                    gameHistory.unshift(game);
                }
            });
            
            // Sort by date descending
            gameHistory.sort((a, b) => new Date(b.date) - new Date(a.date));
            
            updateGameHistoryDisplay();
        }
    } catch (error) {
        console.error('Failed to load games from API:', error);
    }
}

async function loadPlayerStatsFromAPI() {
    try {
        const response = await fetch(`${API_BASE_URL}/stats`);
        
        if (response.ok) {
            const stats = await response.json();
            
            // Filter for career totals and populate careerStats and seasonStats
            const careerTotals = stats.filter(s => s.gameId === 'career-totals');
            
            careerTotals.forEach(stat => {
                const playerName = stat.playerName;
                
                // Populate careerStats
                careerStats.players[playerName] = {
                    goals: stat.goals || 0,
                    assists: stat.assists || 0,
                    hockeyAssists: stat.hockeyAssists || 0,
                    blocks: stat.blocks || 0,
                    turnovers: stat.turnovers || 0,
                    yardsThrown: stat.yardsThrown || 0,
                    yardsCaught: stat.yardsCaught || 0,
                    throws: stat.throws || 0,
                    catches: stat.catches || 0,
                    gamesPlayed: stat.gamesPlayed || 0
                };
                
                // Also populate seasonStats with same data for export
                seasonStats.players[playerName] = { ...careerStats.players[playerName] };
            });
            
            careerStats.totalGames = gameHistory.length;
            seasonStats.totalGames = gameHistory.length;
            
            // Update leaderboard display
            updateLeaderboard();
        }
    } catch (error) {
        console.error('Failed to load player stats from API:', error);
    }
}

async function loadTournamentsFromAPI() {
    try {
        const response = await fetch(`${API_BASE_URL}/tournaments`);
        
        if (response.ok) {
            const tournaments = await response.json();
            
            // Merge with existing pastTournaments (avoid duplicates)
            const existingIds = new Set(pastTournaments.map(t => t.id));
            tournaments.forEach(tournament => {
                if (!existingIds.has(tournament.id)) {
                    pastTournaments.push(tournament);
                }
            });
            
            // Sort by date descending (most recent first)
            pastTournaments.sort((a, b) => new Date(b.startDate) - new Date(a.startDate));
            
            // Update tournament selector if on tournament tab
            if (currentLeaderboardTab === 'tournament') {
                updateTournamentSelector();
            }
        }
    } catch (error) {
        console.error('Failed to load tournaments from API:', error);
    }
}

function selectTeam(team) {
    currentTeam = team;
    localStorage.setItem(CURRENT_TEAM_KEY, JSON.stringify(team));
    
    // Load team roster and player data
    if (team.roster && team.roster.length > 0) {
        savedRoster = [...team.roster];
        gameState.players = [...team.roster];
        
        // Initialize player stats for each player if not already present
        team.roster.forEach(player => {
            if (!gameState.playerStats[player]) {
                gameState.playerStats[player] = {
                    goals: 0, assists: 0, hockeyAssists: 0, blocks: 0, turnovers: 0,
                    yardsThrown: 0, yardsCaught: 0, throws: 0, catches: 0
                };
            }
        });
        
        saveRoster();
    }
    
    updateTeamSelector();
    updateGameSetupUI();
    updatePlayerList();
    showToast(`Switched to ${team.name}`);
}

function showTeamSetup() {
    // Show modal to create first team
    const modal = document.createElement('div');
    modal.id = 'team-setup-modal';
    modal.className = 'fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4';
    modal.innerHTML = `
        <div class="bg-slate-900/95 backdrop-blur-xl rounded-3xl border border-white/10 p-8 w-[calc(100%-2rem)] sm:max-w-md shadow-2xl">
            <div class="text-center mb-6">
                <div class="w-16 h-16 bg-gradient-to-br from-emerald-400 to-cyan-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <i data-lucide="users" class="w-8 h-8 text-white"></i>
                </div>
                <h2 class="text-2xl font-bold text-white">Create Your Team</h2>
                <p class="text-gray-400 mt-2">Set up your first team to start tracking stats</p>
            </div>
            <form id="create-team-form" onsubmit="handleCreateTeam(event)" class="space-y-4">
                <div>
                    <label class="block text-sm font-medium text-gray-300 mb-2">Team Name</label>
                    <input type="text" id="new-team-name" required
                        class="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                        placeholder="e.g., Thunder Ultimate">
                </div>
                <div id="create-team-error" class="hidden text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg p-3"></div>
                <button type="submit"
                    class="w-full py-3 bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-600 hover:to-cyan-600 text-white font-semibold rounded-xl transition-all">
                    Create Team
                </button>
            </form>
        </div>
    `;
    document.body.appendChild(modal);
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function handleCreateTeam(event) {
    event.preventDefault();
    
    const name = document.getElementById('new-team-name').value;
    const errorDiv = document.getElementById('create-team-error');
    
    try {
        const response = await fetch(`${API_BASE_URL}/teams`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ name })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Failed to create team');
        }
        
        userTeams.push(data);
        selectTeam(data);
        
        const modal = document.getElementById('team-setup-modal');
        if (modal) modal.remove();
        
        showToast(`Team "${name}" created!`);
        hapticFeedback('success');
        
    } catch (error) {
        errorDiv.textContent = error.message;
        errorDiv.classList.remove('hidden');
    }
}

async function inviteToTeam(email, role = 'coach') {
    if (!currentTeam || !currentUser) {
        showToast('No team selected', 'error');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/teams/${currentTeam.id}/invite`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ email, role })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Failed to send invitation');
        }
        
        showToast(data.message);
        hapticFeedback('success');
        return data;
        
    } catch (error) {
        showToast(error.message);
        hapticFeedback('error');
        throw error;
    }
}

async function checkPendingInvitations() {
    if (!currentUser) return;

    try {
        const response = await fetch(`${API_BASE_URL}/invitations`, {
            credentials: 'include'
        });
        
        if (response.ok) {
            const invitations = await response.json();
            if (invitations.length > 0) {
                showInvitationNotification(invitations);
            }
        }
    } catch (error) {
        console.error('Failed to check invitations:', error);
    }
}

function showInvitationNotification(invitations) {
    const safeTeamName = escapeHtml(invitations[0].teamName);
    const safeId = escapeHtml(invitations[0].id);
    const notification = document.createElement('div');
    notification.className = 'fixed top-20 right-4 bg-gradient-to-r from-purple-600 to-pink-600 text-white p-4 rounded-xl shadow-lg z-50 max-w-sm animate-fadeIn';
    notification.innerHTML = `
        <div class="flex items-start gap-3">
            <div class="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center flex-shrink-0">
                <i data-lucide="mail" class="w-5 h-5"></i>
            </div>
            <div class="flex-1">
                <p class="font-semibold">Team Invitation</p>
                <p class="text-sm text-white/80 mt-1">You've been invited to join ${safeTeamName}</p>
                <div class="flex gap-2 mt-3">
                    <button onclick="acceptInvitation('${safeId}')" class="px-3 py-1.5 bg-white text-purple-600 rounded-lg text-sm font-medium hover:bg-gray-100 transition">
                        Accept
                    </button>
                    <button onclick="declineInvitation('${safeId}')" class="px-3 py-1.5 bg-white/20 rounded-lg text-sm font-medium hover:bg-white/30 transition">
                        Decline
                    </button>
                </div>
            </div>
            <button onclick="this.parentElement.parentElement.remove()" class="text-white/60 hover:text-white">
                <i data-lucide="x" class="w-4 h-4"></i>
            </button>
        </div>
    `;
    document.body.appendChild(notification);
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function acceptInvitation(invitationId) {
    try {
        const response = await fetch(`${API_BASE_URL}/invitations/${invitationId}/accept`, {
            method: 'POST',
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Failed to accept invitation');
        }
        
        userTeams.push(data.team);
        selectTeam(data.team);
        showToast('Successfully joined team!', 'success');
        hapticFeedback('success');
        
        // Remove notification
        document.querySelector('.fixed.top-20.right-4')?.remove();
        
    } catch (error) {
        showToast(error.message);
    }
}

async function declineInvitation(invitationId) {
    try {
        await fetch(`${API_BASE_URL}/invitations/${invitationId}/decline`, {
            method: 'POST',
            credentials: 'include'
        });
        
        document.querySelector('.fixed.top-20.right-4')?.remove();
        showToast('Invitation declined');
        
    } catch (error) {
        showToast('Failed to decline invitation', 'error');
    }
}

// ==================== TEAM MANAGEMENT UI ====================

function showTeamManagement() {
    closeSettingsModal();
    document.getElementById('team-management-modal').classList.remove('hidden');
    
    // Update team name display
    const teamNameEl = document.getElementById('current-team-name');
    if (teamNameEl && currentTeam) {
        teamNameEl.textContent = currentTeam.name;
    }
    
    populateTeamMembers();
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function closeTeamManagement() {
    document.getElementById('team-management-modal').classList.add('hidden');
}

function populateTeamMembers() {
    const list = document.getElementById('team-members-list');
    if (!list || !currentTeam) {
        if (list) list.innerHTML = '<div class="text-center text-gray-400 py-4">No team selected</div>';
        return;
    }
    
    const members = currentTeam.members || [];
    
    if (members.length === 0) {
        list.innerHTML = '<div class="text-center text-gray-400 py-4">No team members yet</div>';
        return;
    }
    
    list.innerHTML = members.map(member => {
        const initials = escapeHtml(member.name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2));
        const roleColors = {
            owner: 'bg-amber-500 text-amber-100',
            admin: 'bg-purple-500 text-purple-100',
            coach: 'bg-emerald-500 text-emerald-100'
        };
        const roleColor = roleColors[member.role] || roleColors.coach;
        
        return `
            <div class="flex items-center gap-3 p-3 bg-white/5 rounded-xl">
                <div class="w-10 h-10 bg-gradient-to-br from-emerald-400 to-cyan-500 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                    ${initials}
                </div>
                <div class="flex-1 min-w-0">
                    <div class="font-medium text-white truncate">${escapeHtml(member.name)}</div>
                    <div class="text-xs text-gray-400 truncate">${escapeHtml(member.email)}</div>
                </div>
                <span class="px-2 py-1 ${roleColor} rounded-lg text-xs font-medium capitalize">
                    ${escapeHtml(member.role)}
                </span>
            </div>
        `;
    }).join('');
}

async function handleInviteSubmit(event) {
    event.preventDefault();
    
    const email = document.getElementById('invite-email').value;
    const role = document.getElementById('invite-role').value;
    const errorDiv = document.getElementById('invite-error');
    const successDiv = document.getElementById('invite-success');
    
    errorDiv.classList.add('hidden');
    successDiv.classList.add('hidden');
    
    try {
        const result = await inviteToTeam(email, role);
        
        successDiv.textContent = result.existingUser 
            ? `Invitation sent to ${email}! They have an existing account.`
            : `Invitation sent to ${email}! They will need to create an account.`;
        successDiv.classList.remove('hidden');
        
        document.getElementById('invite-email').value = '';
        
    } catch (error) {
        errorDiv.textContent = error.message;
        errorDiv.classList.remove('hidden');
    }
}

function loadCustomPositions() {
    try {
        const saved = localStorage.getItem(POSITIONS_KEY);
        if (saved) customPositions = JSON.parse(saved);
    } catch (e) {
        console.warn('Could not load custom positions:', e);
    }
}

function saveCustomPositions() {
    try {
        localStorage.setItem(POSITIONS_KEY, JSON.stringify(customPositions));
    } catch (e) {
        console.warn('Could not save custom positions:', e);
    }
}

function loadPlayerPositions() {
    try {
        const saved = localStorage.getItem(PLAYER_POSITIONS_KEY);
        if (saved) playerPositions = JSON.parse(saved);
    } catch (e) {
        console.warn('Could not load player positions:', e);
    }
}

function savePlayerPositions() {
    try {
        localStorage.setItem(PLAYER_POSITIONS_KEY, JSON.stringify(playerPositions));
    } catch (e) {
        console.warn('Could not save player positions:', e);
    }
}

function getAllPositions() {
    return [...POSITIONS, ...customPositions];
}

function addCustomPosition(position) {
    const trimmed = position.trim();
    if (trimmed && !POSITIONS.includes(trimmed) && !customPositions.includes(trimmed)) {
        customPositions.push(trimmed);
        saveCustomPositions();
        return true;
    }
    return false;
}

function setPlayerPosition(playerName, position) {
    playerPositions[playerName] = position;
    savePlayerPositions();
}

function getPlayerPosition(playerName) {
    return playerPositions[playerName] || '';
}

// Default team structure
function createEmptyTeam(name, id = null, enableProfiles = true) {
    return {
        id: id || generateUUID(),
        name: name,
        createdAt: new Date().toISOString(),
        roster: [], // Array of player IDs or names for backwards compatibility
        careerStats: { players: {}, totalGames: 0, startDate: new Date().toISOString() },
        seasonStats: { players: {}, games: [], totalGames: 0, wins: 0, losses: 0 },
        gameHistory: [],
        enableProfiles: enableProfiles // Whether player profiles/emails are enabled for this team
    };
}

// Find an existing team that matches by name or USAU link (for reuse across tournament imports)
function findExistingTeam(name, usauLink, leagueId) {
    if (!name) return null;
    const normalizedName = name.trim().toLowerCase();
    const allTeams = Object.values(teamsData.teams);

    // 1. If importing to a league, check teams in that league's tournaments first
    if (leagueId) {
        const league = leaguesData.leagues[leagueId];
        if (league) {
            for (const teamId of (league.teamIds || [])) {
                const team = teamsData.teams[teamId];
                if (team && team.name.trim().toLowerCase() === normalizedName) return team;
            }
            for (const tId of (league.tournamentIds || [])) {
                for (const teamId of getEntityTeams(tId)) {
                    const team = teamsData.teams[teamId];
                    if (team && team.name.trim().toLowerCase() === normalizedName) return team;
                }
            }
        }
    }

    // 2. Global exact name match (case-insensitive)
    for (const team of allTeams) {
        if (team.name.trim().toLowerCase() === normalizedName) return team;
    }

    // 3. USAU link match (extract stable TeamId param)
    if (usauLink) {
        const importedParam = extractUsauTeamParam(usauLink);
        if (importedParam) {
            for (const team of allTeams) {
                if (team.usauLink) {
                    const existingParam = extractUsauTeamParam(team.usauLink);
                    if (existingParam && existingParam === importedParam) return team;
                }
            }
        }
    }

    return null;
}

function extractUsauTeamParam(url) {
    if (!url) return null;
    try {
        const urlObj = new URL(url, 'https://play.usaultimate.org');
        const teamId = urlObj.searchParams.get('TeamId');
        if (teamId) return teamId;
        const m = urlObj.pathname.match(/\/teams\/([^\/]+)/);
        return m ? m[1] : null;
    } catch (e) { return null; }
}

// Application State
let gameState = {
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
    teamStats: {
        score: 0,
        opponentScore: 0,
        turnovers: 0,
        turnoversGained: 0,
        totalYardsThrown: 0,
        totalYardsCaught: 0
    },
    actions: [],
    actionHistory: [],
    lastClickPoint: null,
    throwInProgress: false,
    selectedThrower: null,
    selectedReceiver: null,
    onFieldPlayers: [],
    pointInProgress: false,
    injurySub: null,
    previousThrower: null, // For tracking hockey assists
    lastCompletedThrower: null, // The thrower from the last completed pass
    presentPlayers: [], // Players present for current game/tournament
    discPosition: null, // Current disc position on field {x, y}
    currentThrower: null, // Player currently holding the disc
    pointThrows: 0, // Throws in current point
    possessionThrows: 0, // Throws in current possession
    totalPointThrows: [], // Array of throw counts per point
    currentPeriod: 1, // Current half/period (1 or 2)
    periodType: 'half', // 'half' or 'quarter'
    gameTimerSeconds: 0, // Game elapsed time in seconds
    gameTimerRunning: false, // Is timer currently running
    gameTimerInterval: null, // Timer interval reference
    pointNumber: 1 // Current point number
};

// ==================== PROGRESSIVE STAT ENTRY ====================
// Track thrower→receiver connection frequency for smart player ordering
let _throwConnections = {};
const THROW_CONNECTIONS_KEY = 'ultistats_throw_connections';
let _quickThrowMode = true; // Skip "What happened?" popup on offense
const QUICK_THROW_KEY = 'ultistats_quick_throw_mode';
let _recentFieldPlayers = []; // Ordered by most recent disc touch
let _pointHistory = []; // Per-point line tracking: { pointNum, line, startType, result }
let _activeAnalysisTab = 'pairings'; // Current analysis view
let _playerSortMode = 'alphabetical'; // alphabetical | playing-time | plus-minus | predictive | position
const PLAYER_SORT_KEY = 'ultistats_player_sort_mode';

function loadThrowConnections() {
    try {
        const saved = localStorage.getItem(THROW_CONNECTIONS_KEY);
        if (saved) _throwConnections = JSON.parse(saved);
    } catch (e) { /* ignore */ }
    try {
        _quickThrowMode = localStorage.getItem(QUICK_THROW_KEY) !== 'false';
    } catch (e) { /* ignore */ }
    // Sync toggle button visual state
    requestAnimationFrame(() => {
        const btn = document.getElementById('quick-throw-toggle');
        if (btn) {
            btn.classList.toggle('bg-cyan-500/30', _quickThrowMode);
            btn.classList.toggle('text-cyan-400', _quickThrowMode);
            btn.classList.toggle('border-cyan-500/30', _quickThrowMode);
            btn.classList.toggle('bg-white/5', !_quickThrowMode);
            btn.classList.toggle('text-gray-500', !_quickThrowMode);
            btn.classList.toggle('border-white/10', !_quickThrowMode);
        }
    });
}

function saveThrowConnections() {
    try {
        localStorage.setItem(THROW_CONNECTIONS_KEY, JSON.stringify(_throwConnections));
    } catch (e) { /* ignore */ }
}

function trackConnection(thrower, receiver) {
    if (!thrower || !receiver) return;
    if (!_throwConnections[thrower]) _throwConnections[thrower] = {};
    _throwConnections[thrower][receiver] = (_throwConnections[thrower][receiver] || 0) + 1;
    saveThrowConnections();
    // Update recency tracking
    _recentFieldPlayers = _recentFieldPlayers.filter(p => p !== receiver);
    _recentFieldPlayers.unshift(receiver);
    if (_recentFieldPlayers.length > 14) _recentFieldPlayers.pop();
}

function getConnectionScore(thrower, receiver) {
    if (!thrower || !_throwConnections[thrower]) return 0;
    return _throwConnections[thrower][receiver] || 0;
}

function sortByConnection(thrower, players) {
    return [...players].sort((a, b) => {
        const freqA = getConnectionScore(thrower, a);
        const freqB = getConnectionScore(thrower, b);
        if (freqB !== freqA) return freqB - freqA;
        const recA = _recentFieldPlayers.indexOf(a);
        const recB = _recentFieldPlayers.indexOf(b);
        return (recA === -1 ? 999 : recA) - (recB === -1 ? 999 : recB);
    });
}

function sortPlayersByRecency(players) {
    return [...players].sort((a, b) => {
        const recA = _recentFieldPlayers.indexOf(a);
        const recB = _recentFieldPlayers.indexOf(b);
        return (recA === -1 ? 999 : recA) - (recB === -1 ? 999 : recB);
    });
}

function toggleQuickThrowMode() {
    _quickThrowMode = !_quickThrowMode;
    localStorage.setItem(QUICK_THROW_KEY, _quickThrowMode ? 'true' : 'false');
    const btn = document.getElementById('quick-throw-toggle');
    if (btn) {
        btn.classList.toggle('bg-cyan-500/30', _quickThrowMode);
        btn.classList.toggle('text-cyan-400', _quickThrowMode);
        btn.classList.toggle('border-cyan-500/30', _quickThrowMode);
        btn.classList.toggle('bg-white/5', !_quickThrowMode);
        btn.classList.toggle('text-gray-500', !_quickThrowMode);
        btn.classList.toggle('border-white/10', !_quickThrowMode);
    }
    hapticFeedback('tap');
    showToast(_quickThrowMode ? 'Quick-throw ON — tap field to select receiver directly' : 'Quick-throw OFF — full action menu on tap', 2000);
}

// ==================== OFFLINE SYNC QUEUE ====================
// IndexedDB-backed queue for reliable offline→online data sync
const SYNC_DB_NAME = 'ultistats_sync';
const SYNC_DB_VERSION = 1;
const SYNC_STORE = 'pendingActions';

class SyncQueue {
    constructor() {
        this.db = null;
        this._ready = this._openDB();
    }

    _openDB() {
        return new Promise((resolve) => {
            if (!window.indexedDB) {
                console.warn('[SyncQueue] IndexedDB not available');
                resolve(null);
                return;
            }
            const request = indexedDB.open(SYNC_DB_NAME, SYNC_DB_VERSION);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(SYNC_STORE)) {
                    const store = db.createObjectStore(SYNC_STORE, { keyPath: 'id', autoIncrement: true });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                    store.createIndex('synced', 'synced', { unique: false });
                }
            };
            request.onsuccess = (e) => {
                this.db = e.target.result;
                resolve(this.db);
            };
            request.onerror = (e) => {
                console.warn('[SyncQueue] Failed to open IndexedDB:', e);
                resolve(null);
            };
        });
    }

    async enqueue(action) {
        await this._ready;
        if (!this.db) return;
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(SYNC_STORE, 'readwrite');
            const store = tx.objectStore(SYNC_STORE);
            store.add({ ...action, timestamp: Date.now(), synced: 0 });
            tx.oncomplete = () => { this._updateBadge(); resolve(); };
            tx.onerror = (e) => reject(e);
        });
    }

    async getPending() {
        await this._ready;
        if (!this.db) return [];
        return new Promise((resolve) => {
            const tx = this.db.transaction(SYNC_STORE, 'readonly');
            const store = tx.objectStore(SYNC_STORE);
            const index = store.index('synced');
            const request = index.getAll(0);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve([]);
        });
    }

    async markSynced(ids) {
        await this._ready;
        if (!this.db || ids.length === 0) return;
        const tx = this.db.transaction(SYNC_STORE, 'readwrite');
        const store = tx.objectStore(SYNC_STORE);
        for (const id of ids) {
            const req = store.get(id);
            req.onsuccess = () => {
                const record = req.result;
                if (record) { record.synced = 1; store.put(record); }
            };
        }
        return new Promise((resolve) => {
            tx.oncomplete = () => { this._updateBadge(); resolve(); };
        });
    }

    async clearSynced() {
        await this._ready;
        if (!this.db) return;
        return new Promise((resolve) => {
            const tx = this.db.transaction(SYNC_STORE, 'readwrite');
            const store = tx.objectStore(SYNC_STORE);
            const index = store.index('synced');
            const request = index.openCursor(IDBKeyRange.only(1));
            request.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) { cursor.delete(); cursor.continue(); }
            };
            tx.oncomplete = () => resolve();
        });
    }

    async count() {
        await this._ready;
        if (!this.db) return 0;
        return new Promise((resolve) => {
            const tx = this.db.transaction(SYNC_STORE, 'readonly');
            const index = tx.objectStore(SYNC_STORE).index('synced');
            const request = index.count(IDBKeyRange.only(0));
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(0);
        });
    }

    async _updateBadge() {
        const count = await this.count();
        const badge = document.getElementById('sync-queue-badge');
        if (badge) {
            if (count > 0) {
                badge.textContent = count;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        }
    }

    async flush() {
        if (!navigator.onLine) return;
        const pending = await this.getPending();
        if (pending.length === 0) return;
        console.log(`[SyncQueue] Flushing ${pending.length} pending actions`);
        const syncedIds = pending.map(a => a.id);
        await this.markSynced(syncedIds);
        await this.clearSynced();
        console.log(`[SyncQueue] Synced ${syncedIds.length} actions`);
        showToast(`Synced ${syncedIds.length} queued actions`, 2000);
    }
}

let syncQueue = null;

function initSyncQueue() {
    syncQueue = new SyncQueue();
    window.addEventListener('online', async () => {
        if (syncQueue) await syncQueue.flush();
        updateOfflineBanner();
    });
    // Register for background sync if available
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
        navigator.serviceWorker.ready.then(reg => {
            return reg.sync.register('sync-game-data');
        }).catch(err => {
            console.log('[SyncQueue] Background sync registration failed:', err);
        });
    }
    // Listen for sync messages from service worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data.type === 'sync-complete') {
                showToast(`Background sync: ${event.data.count} actions synced`, 2000);
                if (syncQueue) syncQueue._updateBadge();
            }
        });
    }
}

// Season stats (persists across all games)
let seasonStats = {
    players: {},
    games: [],
    totalGames: 0,
    wins: 0,
    losses: 0
};

// Tournament stats (persists within a tournament)
let tournamentStats = {
    name: '',
    isActive: false,
    startDate: null,
    players: {},
    games: [],
    totalGames: 0,
    wins: 0,
    losses: 0
};

// Past tournaments archive
let pastTournaments = [];
let selectedTournamentId = null; // For leaderboard view

// Field dimensions (normalized to SVG coordinates - matching actual field proportions)
const FIELD_DIMENSIONS = {
    totalLength: 100,       // SVG width
    playingFieldLength: 64, // 64% of total length
    endZoneDepth: 18,       // 18% on each side
    width: 37,              // SVG height (proportional to real field)
    brickMarkDistance: 10   // from goal line
};

function isInEndzone(y) {
    // Returns 'their' (top), 'our' (bottom), or null
    // Field is vertical: top = their endzone (0-13.3%), bottom = our endzone (86.7-100%)
    const ENDZONE_PERCENT = 13.3;
    if (y <= ENDZONE_PERCENT) return 'their';
    if (y >= (100 - ENDZONE_PERCENT)) return 'our';
    return null;
}

// Google Sheets API variables
let tokenClient;
let gapiInited = false;
let gisInited = false;

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    registerServiceWorker();
    loadSettings(); // Load settings first for theme
    
    // Check which page we're on
    const isDashboard = window.isDashboardPage === true;
    const isGamePage = window.isGamePage === true;
    const isLeaguePage = window.isLeaguePage === true;
    const isTournamentPage = window.isTournamentPage === true;

    // Load auth state
    const isLoggedIn = loadAuthState();

    if (isGamePage) {
        try {
            // Game page - initialize game from saved setup
            loadFromStorage();
            loadRoster();
            loadPlayerRegistry();
            loadCareerStats();
            loadSeasonStats();
            
            // Restore team roster from currentTeam if available (loaded by loadAuthState)
            if (currentTeam && currentTeam.roster && currentTeam.roster.length > 0) {
                gameState.players = [...currentTeam.roster];
                savedRoster = [...currentTeam.roster];
            }
            
            loadCustomPositions();
            loadPlayerPositions();
            loadThrowConnections();
            loadPlayerSortMode();
            initializeGameFromSetup();
            initializeEventListeners();
            initSyncQueue();
            // Note: Don't call drawField() - game.html has static SVG with different orientation
            
            // Initialize Lucide icons
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
        } catch (error) {
            console.error('Error initializing game page:', error);
        }
        return;
    }
    
    if (isDashboard) {
        // Dashboard page - already authenticated (checked in dashboard.html)
        // Load all dashboard data
        loadUserTeams();
        checkPendingInvitations();

        // Check for auto-joined teams message
        const autoJoinedTeams = localStorage.getItem('ultistats_auto_joined_teams');
        if (autoJoinedTeams) {
            const teams = JSON.parse(autoJoinedTeams);
            showToast(`Welcome! You've been added to: ${teams.join(', ')}`);
            localStorage.removeItem('ultistats_auto_joined_teams');
        }
    } else if (isLeaguePage || isTournamentPage) {
        // League/Tournament page - no special init needed here, page handles its own setup
    } else {
        // Login page - use router for navigation
        handleRoute();

        if (isLoggedIn) {
            // Already logged in on index page, redirect to dashboard
            window.location.href = '/dashboard.html';
            return;
        }
    }
    
    loadTeamsData();
    loadLeaguesData();
    loadTournamentsData();
    migrateLeaguesToTournaments();
    loadFromStorage();
    loadRoster();
    loadPlayerRegistry();
    loadCareerStats();
    loadSeasonStats();
    loadTournamentStats();
    loadPastTournaments();
    loadGameHistory();
    loadCustomPositions();
    loadPlayerPositions();
    initializeEventListeners();
    drawField();
    setDefaultDate();
    updateGameHistoryDisplay();
    updatePlayerList();
    updateTeamSelector();
    updateDashboardTournaments();
    updateDashboardLeagues();
    updateSharedTournaments(); // Load shared tournaments from server
    // Real-time game setup form validation
    initGameSetupValidation();
    // Initialize Lucide icons
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
    
    // Auto-save when user switches tabs or closes page
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);
});

function handleVisibilityChange() {
    if (document.hidden) {
        // Save all data when tab becomes hidden
        saveToStorage();
        saveSeasonStats();
        saveCareerStats();
        saveGameHistory();
    } else {
        // Re-acquire wake lock when tab becomes visible during active game
        if (gameState.currentGame.isActive) {
            requestWakeLock();
        }
    }
}

function handleBeforeUnload(event) {
    // Save all data before page unload
    saveToStorage();
    saveSeasonStats();
    saveCareerStats();
    saveGameHistory();
}

// ==================== SCREEN WAKE LOCK ====================
// Prevents screen from dimming/locking during active games
let _wakeLockSentinel = null;

async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
        _wakeLockSentinel = await navigator.wakeLock.request('screen');
        _wakeLockSentinel.addEventListener('release', () => { _wakeLockSentinel = null; });
        console.log('[WakeLock] Screen wake lock acquired');
    } catch (err) {
        console.log('[WakeLock] Could not acquire:', err.message);
    }
}

function releaseWakeLock() {
    if (_wakeLockSentinel) {
        _wakeLockSentinel.release();
        _wakeLockSentinel = null;
        console.log('[WakeLock] Screen wake lock released');
    }
}

// Register service worker for PWA
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('Service Worker registered'))
            .catch(err => console.log('SW registration failed:', err));
    }
}

// LocalStorage functions
function saveToStorage() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(gameState));
    } catch (e) {
        console.warn('Could not save to localStorage:', e);
    }
}

function saveSeasonStats() {
    try {
        localStorage.setItem(SEASON_STORAGE_KEY, JSON.stringify(seasonStats));
    } catch (e) {
        console.warn('Could not save season stats:', e);
    }
}

function loadSeasonStats() {
    try {
        const saved = localStorage.getItem(SEASON_STORAGE_KEY);
        if (saved) {
            seasonStats = { ...seasonStats, ...JSON.parse(saved) };
        }
    } catch (e) {
        console.warn('Could not load season stats:', e);
    }
}

function saveTournamentStats() {
    try {
        localStorage.setItem(TOURNAMENT_STORAGE_KEY, JSON.stringify(tournamentStats));
    } catch (e) {
        console.warn('Could not save tournament stats:', e);
    }
}

function loadTournamentStats() {
    try {
        const saved = localStorage.getItem(TOURNAMENT_STORAGE_KEY);
        if (saved) {
            tournamentStats = { ...tournamentStats, ...JSON.parse(saved) };
        }
    } catch (e) {
        console.warn('Could not load tournament stats:', e);
    }
}

function savePastTournaments() {
    try {
        localStorage.setItem(PAST_TOURNAMENTS_KEY, JSON.stringify(pastTournaments));
    } catch (e) {
        console.warn('Could not save past tournaments:', e);
    }
}

function loadPastTournaments() {
    try {
        const saved = localStorage.getItem(PAST_TOURNAMENTS_KEY);
        if (saved) {
            pastTournaments = JSON.parse(saved);
        }
    } catch (e) {
        console.warn('Could not load past tournaments:', e);
        pastTournaments = [];
    }
}

function saveGameHistory() {
    try {
        localStorage.setItem(GAME_HISTORY_KEY, JSON.stringify(gameHistory));
    } catch (e) {
        console.warn('Could not save game history:', e);
    }
}

function loadGameHistory() {
    try {
        const saved = localStorage.getItem(GAME_HISTORY_KEY);
        if (saved) {
            gameHistory = JSON.parse(saved) || [];
        }
    } catch (e) {
        console.warn('Could not load game history:', e);
    }
}

function saveRoster() {
    try {
        localStorage.setItem(ROSTER_KEY, JSON.stringify(savedRoster));
    } catch (e) {
        console.warn('Could not save roster:', e);
    }
}

function loadRoster() {
    try {
        const saved = localStorage.getItem(ROSTER_KEY);
        if (saved) {
            savedRoster = JSON.parse(saved) || [];
            // Merge saved roster into gameState players if not already present
            savedRoster.forEach(player => {
                if (!gameState.players.includes(player)) {
                    gameState.players.push(player);
                }
            });
        }
    } catch (e) {
        console.warn('Could not load roster:', e);
    }
}

function saveCareerStats() {
    try {
        localStorage.setItem(CAREER_STATS_KEY, JSON.stringify(careerStats));
    } catch (e) {
        console.warn('Could not save career stats:', e);
    }
}

function loadCareerStats() {
    try {
        const saved = localStorage.getItem(CAREER_STATS_KEY);
        if (saved) {
            careerStats = { ...careerStats, ...JSON.parse(saved) };
        }
        // Set start date if not set
        if (!careerStats.startDate) {
            careerStats.startDate = new Date().toISOString();
            saveCareerStats();
        }
    } catch (e) {
        console.warn('Could not load career stats:', e);
    }
}

function saveTeamsData() {
    try {
        localStorage.setItem(TEAMS_KEY, JSON.stringify(teamsData));
    } catch (e) {
        console.warn('Could not save teams data:', e);
    }
}

function loadTeamsData() {
    try {
        const saved = localStorage.getItem(TEAMS_KEY);
        if (saved) {
            teamsData = JSON.parse(saved);
        }
        // Create default team if none exists
        if (Object.keys(teamsData.teams).length === 0) {
            const defaultTeam = createEmptyTeam('My Team');
            teamsData.teams[defaultTeam.id] = defaultTeam;
            teamsData.currentTeamId = defaultTeam.id;
            saveTeamsData();
        }
    } catch (e) {
        console.warn('Could not load teams data:', e);
    }
}

// ==================== LEAGUE MANAGEMENT ====================

function saveLeaguesData() {
    try {
        localStorage.setItem(LEAGUES_KEY, JSON.stringify(leaguesData));
    } catch (e) {
        console.warn('Could not save leagues data:', e);
    }
}

function loadLeaguesData() {
    try {
        const saved = localStorage.getItem(LEAGUES_KEY);
        if (saved) {
            leaguesData = JSON.parse(saved);
        }
    } catch (e) {
        console.warn('Could not load leagues data:', e);
    }
}

// Create a new league (season-focused)
function createLeague(name, description = '', season = '') {
    const id = generateUUID();
    const league = {
        id,
        name,
        description,
        season,
        createdAt: new Date().toISOString(),
        teamIds: [],
        regularSeasonMatchups: [],
        tournamentIds: [],
        overallStandings: {}
    };

    leaguesData.leagues[id] = league;
    leaguesData.currentLeagueId = id;
    saveLeaguesData();
    return league;
}

// Update a league
function updateLeague(leagueId, updates) {
    const league = leaguesData.leagues[leagueId];
    if (!league) return null;

    Object.assign(league, updates);
    saveLeaguesData();
    return league;
}

// Delete a league
function deleteLeague(leagueId) {
    if (!leaguesData.leagues[leagueId]) return false;

    // Unlink any tournaments that reference this league
    const league = leaguesData.leagues[leagueId];
    if (league.tournamentIds) {
        for (const tId of league.tournamentIds) {
            const t = tournamentsData.tournaments[tId];
            if (t) t.leagueId = null;
        }
        saveTournamentsData();
    }

    delete leaguesData.leagues[leagueId];
    if (leaguesData.currentLeagueId === leagueId) {
        const remaining = Object.keys(leaguesData.leagues);
        leaguesData.currentLeagueId = remaining.length > 0 ? remaining[0] : null;
    }
    saveLeaguesData();
    return true;
}

// Select a league as current
function selectLeague(leagueId) {
    if (leaguesData.leagues[leagueId]) {
        leaguesData.currentLeagueId = leagueId;
        saveLeaguesData();
        return leaguesData.leagues[leagueId];
    }
    return null;
}

// Get current league
function getCurrentLeague() {
    return leaguesData.currentLeagueId ? leaguesData.leagues[leaguesData.currentLeagueId] : null;
}

// Link a tournament to a league
function linkTournamentToLeague(leagueId, tournamentId) {
    const league = leaguesData.leagues[leagueId];
    const tournament = tournamentsData.tournaments[tournamentId];
    if (!league || !tournament) return false;

    if (!league.tournamentIds.includes(tournamentId)) {
        league.tournamentIds.push(tournamentId);
        saveLeaguesData();
    }
    tournament.leagueId = leagueId;
    saveTournamentsData();
    return true;
}

// Unlink a tournament from a league
function unlinkTournamentFromLeague(leagueId, tournamentId) {
    const league = leaguesData.leagues[leagueId];
    const tournament = tournamentsData.tournaments[tournamentId];
    if (!league) return false;

    const idx = league.tournamentIds.indexOf(tournamentId);
    if (idx !== -1) {
        league.tournamentIds.splice(idx, 1);
        saveLeaguesData();
    }
    if (tournament) {
        tournament.leagueId = null;
        saveTournamentsData();
    }
    return true;
}

// Calculate aggregated league standings (regular season + tournaments)
function calculateLeagueStandings(leagueId) {
    const league = leaguesData.leagues[leagueId];
    if (!league) return {};

    const standings = {};

    // Initialize standings for all league teams
    for (const teamId of league.teamIds) {
        standings[teamId] = {
            wins: 0, losses: 0, ties: 0,
            regularWins: 0, regularLosses: 0,
            tournamentWins: 0, tournamentLosses: 0,
            pointsFor: 0, pointsAgainst: 0, pointDiff: 0
        };
    }

    // Add regular season results
    for (const matchup of league.regularSeasonMatchups) {
        if (matchup.status !== 'completed') continue;
        const home = standings[matchup.homeTeamId];
        const away = standings[matchup.awayTeamId];
        if (!home || !away) continue;

        home.pointsFor += matchup.homeScore || 0;
        home.pointsAgainst += matchup.awayScore || 0;
        away.pointsFor += matchup.awayScore || 0;
        away.pointsAgainst += matchup.homeScore || 0;

        if (matchup.homeScore > matchup.awayScore) {
            home.wins++; home.regularWins++;
            away.losses++; away.regularLosses++;
        } else if (matchup.awayScore > matchup.homeScore) {
            away.wins++; away.regularWins++;
            home.losses++; home.regularLosses++;
        } else {
            home.ties++; away.ties++;
        }
    }

    // Add tournament results
    for (const tId of league.tournamentIds) {
        const tournament = tournamentsData.tournaments[tId];
        if (!tournament) continue;

        const allMatchups = [...(tournament.poolMatchups || []), ...(tournament.bracketMatchups || [])];
        for (const matchup of allMatchups) {
            if (matchup.status !== 'completed') continue;
            const home = standings[matchup.homeTeamId];
            const away = standings[matchup.awayTeamId];
            if (!home || !away) continue;

            home.pointsFor += matchup.homeScore || 0;
            home.pointsAgainst += matchup.awayScore || 0;
            away.pointsFor += matchup.awayScore || 0;
            away.pointsAgainst += matchup.homeScore || 0;

            if (matchup.homeScore > matchup.awayScore) {
                home.wins++; home.tournamentWins++;
                away.losses++; away.tournamentLosses++;
            } else if (matchup.awayScore > matchup.homeScore) {
                away.wins++; away.tournamentWins++;
                home.losses++; home.tournamentLosses++;
            } else {
                home.ties++; away.ties++;
            }
        }
    }

    // Calculate point differentials
    for (const teamId of Object.keys(standings)) {
        standings[teamId].pointDiff = standings[teamId].pointsFor - standings[teamId].pointsAgainst;
    }

    league.overallStandings = standings;
    saveLeaguesData();
    return standings;
}

// Record a regular season matchup result
function recordRegularSeasonResult(leagueId, matchupId, homeScore, awayScore, gameId) {
    const league = leaguesData.leagues[leagueId];
    if (!league) return false;

    const matchup = league.regularSeasonMatchups.find(m => m.id === matchupId);
    if (!matchup) return false;

    matchup.homeScore = homeScore;
    matchup.awayScore = awayScore;
    matchup.gameId = gameId;
    matchup.status = 'completed';

    calculateLeagueStandings(leagueId);
    return true;
}

// ==================== TOURNAMENT MANAGEMENT ====================

function saveTournamentsData() {
    try {
        localStorage.setItem(TOURNAMENTS_LOCAL_KEY, JSON.stringify(tournamentsData));
    } catch (e) {
        console.warn('Could not save tournaments data:', e);
    }
}

function loadTournamentsData() {
    try {
        const saved = localStorage.getItem(TOURNAMENTS_LOCAL_KEY);
        if (saved) {
            tournamentsData = JSON.parse(saved);
        }
    } catch (e) {
        console.warn('Could not load tournaments data:', e);
    }
}

// Create a new tournament
function createTournament(name, description = '', format = 'pool-to-bracket', numPools = 2, startDate = null, endDate = null) {
    const id = generateUUID();
    const tournament = {
        id,
        name,
        description,
        format,
        startDate,
        endDate,
        createdAt: new Date().toISOString(),
        pools: [],
        teamIds: [],
        poolMatchups: [],
        bracketMatchups: [],
        poolStandings: {},
        advancementRules: { teamsPerPool: 2 },
        teamSeeds: {},
        leagueId: null,
        importedFrom: null,
        importedAt: null,
        sharedTournamentId: null,
        usauFormat: null,
        competitionLevel: null,
        genderDivision: null
    };

    if (format !== 'bracket') {
        for (let i = 0; i < numPools; i++) {
            const poolId = generateUUID();
            const poolName = `Pool ${String.fromCharCode(65 + i)}`;
            tournament.pools.push({ id: poolId, name: poolName, teamIds: [] });
            tournament.poolStandings[poolId] = {};
        }
    }

    tournamentsData.tournaments[id] = tournament;
    tournamentsData.currentTournamentId = id;
    saveTournamentsData();
    return tournament;
}

// Update a tournament
function updateTournament(tournamentId, updates) {
    const tournament = tournamentsData.tournaments[tournamentId];
    if (!tournament) return null;

    Object.assign(tournament, updates);
    saveTournamentsData();
    return tournament;
}

// Delete a tournament
function deleteTournament(tournamentId) {
    const tournament = tournamentsData.tournaments[tournamentId];
    if (!tournament) return false;

    // Unlink from parent league if any
    if (tournament.leagueId) {
        const league = leaguesData.leagues[tournament.leagueId];
        if (league) {
            const idx = league.tournamentIds.indexOf(tournamentId);
            if (idx !== -1) league.tournamentIds.splice(idx, 1);
            saveLeaguesData();
        }
    }

    delete tournamentsData.tournaments[tournamentId];
    if (tournamentsData.currentTournamentId === tournamentId) {
        const remaining = Object.keys(tournamentsData.tournaments);
        tournamentsData.currentTournamentId = remaining.length > 0 ? remaining[0] : null;
    }
    saveTournamentsData();
    return true;
}

// Select a tournament as current
function selectTournament(tournamentId) {
    if (tournamentsData.tournaments[tournamentId]) {
        tournamentsData.currentTournamentId = tournamentId;
        saveTournamentsData();
        return tournamentsData.tournaments[tournamentId];
    }
    return null;
}

// Get current tournament
function getCurrentTournament() {
    return tournamentsData.currentTournamentId ? tournamentsData.tournaments[tournamentsData.currentTournamentId] : null;
}

// ==================== ENTITY-AGNOSTIC HELPERS ====================
// These allow pool/bracket functions to work with both tournaments and leagues

function getEntityById(entityId) {
    return tournamentsData.tournaments[entityId]
        || leaguesData.leagues[entityId]
        || null;
}

function saveEntityData(entityId) {
    if (tournamentsData.tournaments[entityId]) saveTournamentsData();
    else if (leaguesData.leagues[entityId]) saveLeaguesData();
}

// Get all teams in a tournament or league entity (from pools or direct)
function getEntityTeams(entityId) {
    const entity = getEntityById(entityId);
    if (!entity) return [];

    if (entity.format === 'bracket') {
        return entity.teamIds || [];
    }

    if (entity.pools) {
        const teamIds = [];
        for (const pool of entity.pools) {
            teamIds.push(...pool.teamIds);
        }
        return teamIds;
    }

    return entity.teamIds || [];
}

// Get team count for an entity
function getEntityTeamCount(entityId) {
    return getEntityTeams(entityId).length;
}

// ==================== MIGRATION ====================

function migrateLeaguesToTournaments() {
    const MIGRATION_KEY = 'ultistats_league_tournament_migration_v1';
    if (localStorage.getItem(MIGRATION_KEY)) return;

    let migrated = 0;
    for (const [id, league] of Object.entries(leaguesData.leagues)) {
        // Anything with importedFrom OR pool/bracket structure is a tournament
        if (league.importedFrom || (league.pools && league.pools.length > 0) || league.format) {
            tournamentsData.tournaments[id] = {
                ...league,
                startDate: null,
                endDate: null,
                leagueId: null,
                importedFrom: league.importedFrom || null,
                importedAt: league.importedAt || null,
                sharedTournamentId: league.sharedTournamentId || null,
                usauFormat: league.usauFormat || null,
                competitionLevel: league.competitionLevel || null,
                genderDivision: league.genderDivision || null
            };
            delete leaguesData.leagues[id];
            migrated++;
        }
    }

    if (leaguesData.currentLeagueId && tournamentsData.tournaments[leaguesData.currentLeagueId]) {
        tournamentsData.currentTournamentId = leaguesData.currentLeagueId;
        leaguesData.currentLeagueId = null;
    }

    if (migrated > 0) {
        saveTournamentsData();
        saveLeaguesData();
        console.log(`Migration: moved ${migrated} leagues to tournaments`);
    }

    localStorage.setItem(MIGRATION_KEY, new Date().toISOString());
}

// Add a team to a pool (works for tournaments and legacy leagues)
function addTeamToPool(entityId, poolId, teamId) {
    const entity = getEntityById(entityId);
    if (!entity) return false;

    const pool = entity.pools.find(p => p.id === poolId);
    if (!pool) return false;

    // Check if team is already in any pool
    for (const p of entity.pools) {
        if (p.teamIds.includes(teamId)) {
            return false; // Team already in a pool
        }
    }

    pool.teamIds.push(teamId);
    // Initialize standings for this team in this pool
    if (!entity.poolStandings[poolId]) {
        entity.poolStandings[poolId] = {};
    }
    entity.poolStandings[poolId][teamId] = {
        wins: 0, losses: 0, ties: 0,
        pointsFor: 0, pointsAgainst: 0, pointDiff: 0
    };
    saveEntityData(entityId);
    return true;
}

// Remove a team from a pool
function removeTeamFromPool(entityId, poolId, teamId) {
    const entity = getEntityById(entityId);
    if (!entity) return false;

    const pool = entity.pools.find(p => p.id === poolId);
    if (!pool) return false;

    const idx = pool.teamIds.indexOf(teamId);
    if (idx === -1) return false;

    pool.teamIds.splice(idx, 1);
    if (entity.poolStandings[poolId]) {
        delete entity.poolStandings[poolId][teamId];
    }
    saveEntityData(entityId);
    return true;
}

// Add team to bracket-only entity
function addTeamToEntity(entityId, teamId) {
    const entity = getEntityById(entityId);
    if (!entity || entity.format !== 'bracket') return false;

    if (!entity.teamIds.includes(teamId)) {
        entity.teamIds.push(teamId);
        saveEntityData(entityId);
        return true;
    }
    return false;
}

// Backward compat alias
function addTeamToLeague(leagueId, teamId) {
    return addTeamToEntity(leagueId, teamId);
}

// Generate pool play schedule (round-robin within each pool)
function generatePoolPlaySchedule(entityId) {
    const entity = getEntityById(entityId);
    if (!entity) return false;

    entity.poolMatchups = [];

    for (const pool of entity.pools) {
        const teams = [...pool.teamIds];

        // Add bye if odd number
        if (teams.length % 2 !== 0) {
            teams.push(null);
        }

        const n = teams.length;
        const rounds = n - 1;

        for (let round = 0; round < rounds; round++) {
            for (let i = 0; i < n / 2; i++) {
                const home = teams[i];
                const away = teams[n - 1 - i];

                if (home && away) {
                    entity.poolMatchups.push({
                        id: generateUUID(),
                        poolId: pool.id,
                        round: round + 1,
                        homeTeamId: home,
                        awayTeamId: away,
                        scheduledDate: null,
                        status: 'scheduled',
                        homeScore: null,
                        awayScore: null,
                        gameId: null
                    });
                }
            }
            // Rotate teams (keep first fixed) for round-robin
            teams.splice(1, 0, teams.pop());
        }
    }
    saveEntityData(entityId);
    return true;
}

// Get pool rankings sorted by wins, then point differential
function getPoolRanking(entityId, poolId) {
    const entity = getEntityById(entityId);
    if (!entity || !entity.poolStandings[poolId]) return [];

    const standings = entity.poolStandings[poolId];
    const teamIds = Object.keys(standings);

    return teamIds.sort((a, b) => {
        const sA = standings[a];
        const sB = standings[b];
        // Sort by wins descending
        if (sB.wins !== sA.wins) return sB.wins - sA.wins;
        // Then by point differential descending
        return sB.pointDiff - sA.pointDiff;
    });
}

// Generate bracket from pool standings (standard USA Ultimate format)
function generateBracketFromPools(entityId, teamsPerPool = 2) {
    const entity = getEntityById(entityId);
    if (!entity || entity.pools.length < 2) return false;

    const poolRankings = {};

    // Get rankings for each pool
    for (const pool of entity.pools) {
        poolRankings[pool.id] = getPoolRanking(entityId, pool.id);
    }

    // Standard 2-pool bracket: A1 vs B2, B1 vs A2
    if (entity.pools.length === 2) {
        const [poolA, poolB] = entity.pools;
        entity.bracketMatchups = [
            // Semifinals
            {
                id: generateUUID(),
                round: 2, // Semis
                position: 1,
                homeSeed: 'A1',
                awaySeed: 'B2',
                homeTeamId: poolRankings[poolA.id][0] || null,
                awayTeamId: poolRankings[poolB.id][1] || null,
                status: poolRankings[poolA.id][0] && poolRankings[poolB.id][1] ? 'scheduled' : 'pending',
                homeScore: null,
                awayScore: null,
                gameId: null
            },
            {
                id: generateUUID(),
                round: 2,
                position: 2,
                homeSeed: 'B1',
                awaySeed: 'A2',
                homeTeamId: poolRankings[poolB.id][0] || null,
                awayTeamId: poolRankings[poolA.id][1] || null,
                status: poolRankings[poolB.id][0] && poolRankings[poolA.id][1] ? 'scheduled' : 'pending',
                homeScore: null,
                awayScore: null,
                gameId: null
            },
            // Finals (teams TBD until semis complete)
            {
                id: generateUUID(),
                round: 1, // Finals
                position: 1,
                homeSeed: 'W1',
                awaySeed: 'W2',
                homeTeamId: null,
                awayTeamId: null,
                status: 'pending',
                homeScore: null,
                awayScore: null,
                gameId: null
            }
        ];
    }

    saveEntityData(entityId);
    return true;
}

// Generate single elimination bracket for bracket-only format
function generateSingleEliminationBracket(entityId) {
    const entity = getEntityById(entityId);
    if (!entity || entity.format !== 'bracket') return false;

    const teams = [...entity.teamIds];
    const n = teams.length;

    if (n < 2) return false;

    // Find next power of 2
    const bracketSize = Math.pow(2, Math.ceil(Math.log2(n)));
    const totalRounds = Math.log2(bracketSize);

    entity.bracketMatchups = [];

    // Create first round matchups
    let position = 1;
    for (let i = 0; i < bracketSize / 2; i++) {
        const home = teams[i * 2] || null;
        const away = teams[i * 2 + 1] || null;

        entity.bracketMatchups.push({
            id: generateUUID(),
            round: totalRounds,
            position: position++,
            homeSeed: `S${i * 2 + 1}`,
            awaySeed: `S${i * 2 + 2}`,
            homeTeamId: home,
            awayTeamId: away,
            status: home && away ? 'scheduled' : (home || away ? 'bye' : 'pending'),
            homeScore: null,
            awayScore: null,
            gameId: null
        });
    }

    // Create subsequent rounds (empty until previous rounds complete)
    for (let round = totalRounds - 1; round >= 1; round--) {
        const matchupsInRound = Math.pow(2, round - 1);
        for (let i = 0; i < matchupsInRound; i++) {
            entity.bracketMatchups.push({
                id: generateUUID(),
                round: round,
                position: i + 1,
                homeSeed: `W${(totalRounds - round) * matchupsInRound * 2 + i * 2 + 1}`,
                awaySeed: `W${(totalRounds - round) * matchupsInRound * 2 + i * 2 + 2}`,
                homeTeamId: null,
                awayTeamId: null,
                status: 'pending',
                homeScore: null,
                awayScore: null,
                gameId: null
            });
        }
    }

    saveEntityData(entityId);
    return true;
}

// Calculate and update pool standings from completed matchups
function updatePoolStandings(entityId, poolId) {
    const entity = getEntityById(entityId);
    if (!entity) return;

    const pool = entity.pools.find(p => p.id === poolId);
    if (!pool) return;

    // Reset standings for this pool
    entity.poolStandings[poolId] = {};
    for (const teamId of pool.teamIds) {
        entity.poolStandings[poolId][teamId] = {
            wins: 0, losses: 0, ties: 0,
            pointsFor: 0, pointsAgainst: 0, pointDiff: 0
        };
    }

    // Calculate from completed matchups
    const poolMatchups = entity.poolMatchups.filter(m => m.poolId === poolId && m.status === 'completed');
    for (const matchup of poolMatchups) {
        const homeStats = entity.poolStandings[poolId][matchup.homeTeamId];
        const awayStats = entity.poolStandings[poolId][matchup.awayTeamId];

        if (homeStats && awayStats) {
            homeStats.pointsFor += matchup.homeScore || 0;
            homeStats.pointsAgainst += matchup.awayScore || 0;
            awayStats.pointsFor += matchup.awayScore || 0;
            awayStats.pointsAgainst += matchup.homeScore || 0;

            if (matchup.homeScore > matchup.awayScore) {
                homeStats.wins++;
                awayStats.losses++;
            } else if (matchup.awayScore > matchup.homeScore) {
                awayStats.wins++;
                homeStats.losses++;
            } else {
                homeStats.ties++;
                awayStats.ties++;
            }

            homeStats.pointDiff = homeStats.pointsFor - homeStats.pointsAgainst;
            awayStats.pointDiff = awayStats.pointsFor - awayStats.pointsAgainst;
        }
    }

    saveEntityData(entityId);
}

// Record matchup result and update standings
function recordMatchupResult(entityId, matchupId, matchupType, homeScore, awayScore, gameId) {
    const entity = getEntityById(entityId);
    if (!entity) return false;

    const matchups = matchupType === 'pool' ? entity.poolMatchups : entity.bracketMatchups;
    const matchup = matchups.find(m => m.id === matchupId);

    if (!matchup) return false;

    matchup.homeScore = homeScore;
    matchup.awayScore = awayScore;
    matchup.gameId = gameId;
    matchup.status = 'completed';

    // Update standings if pool matchup
    if (matchupType === 'pool' && matchup.poolId) {
        updatePoolStandings(entityId, matchup.poolId);
    }

    // Handle bracket advancement if bracket matchup
    if (matchupType === 'bracket') {
        advanceBracketWinner(entityId, matchupId);
    }

    saveEntityData(entityId);
    return true;
}

// Advance winner to next bracket round
function advanceBracketWinner(entityId, completedMatchupId) {
    const entity = getEntityById(entityId);
    if (!entity) return;

    const completed = entity.bracketMatchups.find(m => m.id === completedMatchupId);
    if (!completed || completed.status !== 'completed') return;

    const winnerId = completed.homeScore > completed.awayScore
        ? completed.homeTeamId
        : completed.awayTeamId;

    // Find next round matchup
    const nextRound = completed.round - 1;
    if (nextRound < 1) return; // Finals completed, tournament over

    const nextMatchup = entity.bracketMatchups.find(m =>
        m.round === nextRound &&
        (m.homeSeed === `W${completed.position}` || m.awaySeed === `W${completed.position}`)
    );

    if (nextMatchup) {
        if (nextMatchup.homeSeed === `W${completed.position}`) {
            nextMatchup.homeTeamId = winnerId;
        } else {
            nextMatchup.awayTeamId = winnerId;
        }
        // If both teams determined, change status
        if (nextMatchup.homeTeamId && nextMatchup.awayTeamId) {
            nextMatchup.status = 'scheduled';
        }
    }

    saveEntityData(entityId);
}

// Start a game from a matchup (works for tournaments and leagues)
function startMatchupGame(entityId, matchupId, matchupType) {
    const entity = getEntityById(entityId);
    if (!entity) return false;

    let matchups;
    if (matchupType === 'regular') {
        matchups = entity.regularSeasonMatchups || [];
    } else if (matchupType === 'pool') {
        matchups = entity.poolMatchups || [];
    } else {
        matchups = entity.bracketMatchups || [];
    }
    const matchup = matchups.find(m => m.id === matchupId);

    if (!matchup || !matchup.homeTeamId || !matchup.awayTeamId) return false;

    // Get team names
    const homeTeam = teamsData.teams[matchup.homeTeamId];
    const awayTeam = teamsData.teams[matchup.awayTeamId];

    if (!homeTeam || !awayTeam) return false;

    // Update matchup status
    matchup.status = 'in_progress';
    saveEntityData(entityId);

    // Set up game context for game.html
    const isTournament = !!tournamentsData.tournaments[entityId];
    const gameSetup = {
        ourTeam: homeTeam.name,
        opponentTeam: awayTeam.name,
        gameDate: new Date().toISOString().split('T')[0],
        gameType: isTournament ? 'tournament' : 'league',
        tournamentId: isTournament ? entityId : null,
        leagueId: isTournament ? (entity.leagueId || null) : entityId,
        matchupId: matchupId,
        matchupType: matchupType
    };

    localStorage.setItem('ultistats_game_setup', JSON.stringify(gameSetup));

    // Set active team to home team
    teamsData.currentTeamId = matchup.homeTeamId;
    saveTeamsData();

    // Navigate to game page
    window.location.href = 'game.html';
    return true;
}

// Get all teams in an entity (from pools or direct) - backward compat wrapper
function getLeagueTeams(entityId) {
    return getEntityTeams(entityId);
}

// Get team count - backward compat wrapper
function getLeagueTeamCount(entityId) {
    return getEntityTeamCount(entityId);
}

// ==================== USAU TOURNAMENT IMPORT ====================

// Import state management
let usauImportState = {
    tournament: null,
    pools: null,
    bracket: null,
    selectedTeams: [],
    importOptions: {
        importPools: true,
        importBracket: true,
        importRosters: true,
        enableProfiles: true
    },
    progress: {
        phase: 'init', // 'init', 'creating', 'importing-teams', 'fetching-rosters', 'finalizing', 'complete', 'error'
        teamsTotal: 0,
        teamsImported: 0,
        teamsReused: 0,
        rostersTotal: 0,
        rostersFetched: 0,
        currentTeam: null,
        failed: [],
        message: ''
    },
    aborted: false,
    leagueId: null,
    tournamentId: null,
    importDestination: 'standalone', // 'standalone' | 'add-to-league'
    targetLeagueId: null
};

// Reset import state
function resetUsauImportState() {
    usauImportState = {
        tournament: null,
        pools: null,
        bracket: null,
        selectedTeams: [],
        importOptions: {
            importPools: true,
            importBracket: true,
            importRosters: true,
            enableProfiles: true
        },
        progress: {
            phase: 'init',
            teamsTotal: 0,
            teamsImported: 0,
        teamsReused: 0,
            rostersTotal: 0,
            rostersFetched: 0,
            currentTeam: null,
            failed: [],
            message: ''
        },
        aborted: false,
        leagueId: null,
        tournamentId: null,
        importDestination: 'standalone',
        targetLeagueId: null
    };
}

// Fetch complete tournament data (tournament info + pools + bracket)
async function fetchCompleteTournament(tournamentUrl) {
    const apiBase = window.USAU_API_BASE || '';

    // 1. Fetch tournament basic info and team list
    const tournamentResponse = await fetch(`${apiBase}/api/usau/tournament?url=${encodeURIComponent(tournamentUrl)}`);
    if (!tournamentResponse.ok) {
        throw new Error(`Failed to fetch tournament: ${tournamentResponse.status}`);
    }
    const tournament = await tournamentResponse.json();

    usauImportState.tournament = tournament;

    // 2. Try to fetch pool structure
    // First, try schedule links if available
    let scheduleUrl = null;

    if (tournament.scheduleLinks && tournament.scheduleLinks.length > 0) {
        // Prioritize links: division links first, then schedule/pool links
        const scheduleLink = tournament.scheduleLinks.find(l =>
            l.type === 'division' ||
            l.href.includes('/schedule/')
        ) || tournament.scheduleLinks.find(l =>
            l.text.toLowerCase().includes('pool') ||
            l.text.toLowerCase().includes('schedule') ||
            l.text.toLowerCase().includes('men') ||
            l.text.toLowerCase().includes('women') ||
            l.text.toLowerCase().includes('college')
        ) || tournament.scheduleLinks[0];

        scheduleUrl = scheduleLink.href;
    } else if (tournament.competitionLevel && tournament.genderDivision) {
        // Construct schedule URL from detected competition level and gender division
        // Pattern: {tournament_url}/schedule/{genderDivision}/{competitionLevel}{genderDivision}/
        const gender = tournament.genderDivision; // "Men", "Women", "Mixed"
        const level = tournament.competitionLevel; // "College", "Club", etc.
        const baseUrl = tournamentUrl.replace(/\/?$/, '');
        scheduleUrl = `${baseUrl}/schedule/${gender}/${level}${gender}/`;
        console.log('Constructed schedule URL:', scheduleUrl);
    }

    if (scheduleUrl) {
        try {
            console.log('Fetching schedule from:', scheduleUrl);
            const poolsResponse = await fetch(`${apiBase}/api/usau/tournament/pools?url=${encodeURIComponent(scheduleUrl)}`);
            if (poolsResponse.ok) {
                usauImportState.pools = await poolsResponse.json();

                // If we got teams from the pools endpoint, use those (they have pool assignments)
                if (usauImportState.pools.teams && usauImportState.pools.teams.length > 0) {
                    // Merge with existing team links if available
                    const teamLinkMap = {};
                    tournament.teams.forEach(t => {
                        teamLinkMap[t.name.toLowerCase()] = t.link;
                    });

                    usauImportState.tournament.teams = usauImportState.pools.teams.map(t => ({
                        name: t.name,
                        pool: t.pool,
                        seed: t.seed,
                        link: teamLinkMap[t.name.toLowerCase()] || null
                    }));
                }
            }
        } catch (e) {
            console.warn('Could not fetch pool structure:', e);
        }
    }

    // Initialize selected teams from tournament data
    usauImportState.selectedTeams = usauImportState.tournament.teams.map((t, i) => ({
        ...t,
        selected: true,
        index: i
    }));

    // 3. Try to fetch bracket structure if available (from same schedule page or bracket link)
    if (tournament.scheduleLinks && tournament.scheduleLinks.length > 0) {
        try {
            const bracketLink = tournament.scheduleLinks.find(l =>
                l.text.toLowerCase().includes('bracket') ||
                l.text.toLowerCase().includes('elimination')
            );

            if (bracketLink) {
                const bracketResponse = await fetch(`${apiBase}/api/usau/tournament/bracket?url=${encodeURIComponent(bracketLink.href)}`);
                if (bracketResponse.ok) {
                    usauImportState.bracket = await bracketResponse.json();
                }
            }
        } catch (e) {
            console.warn('Could not fetch bracket structure:', e);
        }
    }

    return usauImportState;
}

// Fetch single team roster with retry
async function fetchTeamRosterWithRetry(teamUrl, maxRetries = 3) {
    const apiBase = window.USAU_API_BASE || '';

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(`${apiBase}/api/usau/team?url=${encodeURIComponent(teamUrl)}`);

            if (response.status === 429) {
                // Rate limited - wait longer
                await new Promise(resolve => setTimeout(resolve, 60000));
                continue;
            }

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            if (attempt === maxRetries) throw error;
            // Exponential backoff: 1s, 2s, 4s
            await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
        }
    }
}

// Batch fetch rosters with rate limiting
async function batchFetchRosters(teams, batchSize = 3, delayMs = 2000, onProgress = null) {
    const results = [];

    for (let i = 0; i < teams.length && !usauImportState.aborted; i += batchSize) {
        const batch = teams.slice(i, Math.min(i + batchSize, teams.length));

        // Fetch batch concurrently
        const batchPromises = batch.map(async (team, batchIndex) => {
            const globalIndex = i + batchIndex;

            try {
                if (onProgress) {
                    onProgress('fetching', globalIndex, teams.length, team.name);
                }

                if (!team.link) {
                    return { team, roster: null, error: 'No team URL' };
                }

                const data = await fetchTeamRosterWithRetry(team.link);
                return { team, roster: data.roster || [], error: null };
            } catch (error) {
                console.error(`Failed to fetch roster for ${team.name}:`, error);
                return { team, roster: null, error: error.message };
            }
        });

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);

        // Update progress
        usauImportState.progress.rostersFetched = results.length;

        // Delay before next batch (respect rate limiting)
        if (i + batchSize < teams.length && !usauImportState.aborted) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }

    return results;
}

// Map USAU position to UltiStats position
function mapUsauPosition(usauPosition) {
    if (!usauPosition) return 'Hybrid';
    const pos = usauPosition.toLowerCase();

    if (pos.includes('handler') || pos === 'h' || pos === 'dump') return 'Handler';
    if (pos.includes('cutter') || pos === 'c' || pos === 'mid' || pos === 'deep') return 'Cutter';
    return 'Hybrid';
}

// Detect tournament format based on team count and pool info
function detectTournamentFormat(teamCount, poolCount) {
    if (poolCount === 0) return 'bracket';
    if (teamCount <= 6 && poolCount <= 2) return 'pool-play';
    return 'pool-to-bracket';
}

// Create league and teams from USAU tournament data
async function createTournamentFromUsauImport(options = {}) {
    const { importPools, importBracket, importRosters, enableProfiles } = {
        ...usauImportState.importOptions,
        ...options
    };

    const tournament = usauImportState.tournament;
    if (!tournament) {
        throw new Error('No tournament data loaded');
    }

    // Update progress
    usauImportState.progress.phase = 'creating';
    usauImportState.progress.message = 'Creating tournament structure...';

    // Get selected teams
    const selectedTeams = usauImportState.selectedTeams.filter(t => t.selected);
    const poolData = usauImportState.pools;

    // Detect format
    const poolCount = poolData && poolData.pools ? Object.keys(poolData.pools).length : 0;
    const format = detectTournamentFormat(selectedTeams.length, importPools ? poolCount : 0);

    // Create the tournament (not a league)
    const newTournament = createTournament(
        tournament.name,
        `Imported from USAU: ${tournament.url}`,
        format,
        Math.max(2, poolCount)
    );

    usauImportState.tournamentId = newTournament.id;
    usauImportState.leagueId = newTournament.id; // backward compat

    // Add import-specific fields
    newTournament.importedFrom = tournament.url;
    newTournament.importedAt = new Date().toISOString();
    newTournament.competitionLevel = tournament.competitionLevel || null;
    newTournament.genderDivision = tournament.genderDivision || null;

    // Link to league if requested
    if (usauImportState.importDestination === 'add-to-league' && usauImportState.targetLeagueId) {
        linkTournamentToLeague(usauImportState.targetLeagueId, newTournament.id);
    }

    // Update progress
    usauImportState.progress.phase = 'importing-teams';
    usauImportState.progress.teamsTotal = selectedTeams.length;
    usauImportState.progress.message = 'Importing teams...';

    // Create teams and map pool assignments
    const teamIdMap = {}; // usauTeamName -> ultistatsTeamId
    const poolAssignments = {}; // teamName -> poolName

    // Build pool assignments from USAU data
    // First check if teams have direct pool assignments (from pools endpoint)
    for (const team of selectedTeams) {
        if (team.pool) {
            poolAssignments[team.name.toLowerCase()] = team.pool;
        }
    }

    // Also check pools data structure for additional assignments
    if (importPools && poolData && poolData.pools) {
        for (const [poolName, poolTeams] of Object.entries(poolData.pools)) {
            for (const poolTeam of poolTeams) {
                if (!poolAssignments[poolTeam.name.toLowerCase()]) {
                    poolAssignments[poolTeam.name.toLowerCase()] = poolName;
                }
            }
        }
    }

    // Determine league context for team reuse
    const targetLeagueId = (usauImportState.importDestination === 'add-to-league'
        && usauImportState.targetLeagueId) ? usauImportState.targetLeagueId : null;

    // Create or reuse each team
    for (let i = 0; i < selectedTeams.length && !usauImportState.aborted; i++) {
        const usauTeam = selectedTeams[i];

        usauImportState.progress.teamsImported = i + 1;
        usauImportState.progress.currentTeam = usauTeam.name;

        // Check for existing team to reuse
        const existing = findExistingTeam(usauTeam.name, usauTeam.link, targetLeagueId);
        let teamId;

        if (existing) {
            teamId = existing.id;
            existing.usauLink = usauTeam.link;
            if (!existing.roster || existing.roster.length === 0) {
                existing.rosterStatus = 'pending';
            }
            usauImportState.progress.teamsReused++;
            usauImportState.progress.message = `Reusing team: ${usauTeam.name}`;
        } else {
            const newTeam = createEmptyTeam(usauTeam.name, null, enableProfiles);
            newTeam.usauLink = usauTeam.link;
            newTeam.rosterStatus = 'pending';
            teamsData.teams[newTeam.id] = newTeam;
            teamId = newTeam.id;
            usauImportState.progress.message = `Creating team: ${usauTeam.name}`;
        }

        teamIdMap[usauTeam.name.toLowerCase()] = teamId;

        // Assign to pool if we have pool data
        if (importPools && format !== 'bracket') {
            const assignedPool = poolAssignments[usauTeam.name.toLowerCase()];
            if (assignedPool) {
                const pool = newTournament.pools.find(p => p.name === assignedPool);
                if (pool) {
                    addTeamToPool(newTournament.id, pool.id, teamId);
                }
            } else {
                const targetPool = newTournament.pools.find(p => p.teamIds.length < 6) || newTournament.pools[0];
                if (targetPool) {
                    addTeamToPool(newTournament.id, targetPool.id, teamId);
                }
            }
        } else if (format === 'bracket') {
            addTeamToEntity(newTournament.id, teamId);
        }

        // Auto-add to league.teamIds if importing to a league
        if (targetLeagueId) {
            const league = leaguesData.leagues[targetLeagueId];
            if (league && !league.teamIds.includes(teamId)) {
                league.teamIds.push(teamId);
            }
        }
    }

    saveTeamsData();
    if (targetLeagueId) saveLeaguesData();

    // Fetch rosters if requested
    if (importRosters && !usauImportState.aborted) {
        usauImportState.progress.phase = 'fetching-rosters';
        usauImportState.progress.rostersTotal = selectedTeams.length;
        usauImportState.progress.message = 'Fetching rosters...';

        const teamsWithLinks = selectedTeams.filter(t => {
            if (!t.link) return false;
            // Skip roster fetch for reused teams that already have a roster
            const tid = teamIdMap[t.name.toLowerCase()];
            const team = tid ? teamsData.teams[tid] : null;
            return !(team && team.roster && team.roster.length > 0);
        });

        const rosterResults = await batchFetchRosters(
            teamsWithLinks,
            3, // batch size
            2000, // delay between batches
            (phase, current, total, teamName) => {
                usauImportState.progress.rostersFetched = current + 1;
                usauImportState.progress.currentTeam = teamName;
                usauImportState.progress.message = `Fetching roster: ${teamName} (${current + 1}/${total})`;
            }
        );

        // Apply rosters to teams
        for (const result of rosterResults) {
            const teamId = teamIdMap[result.team.name.toLowerCase()];
            if (!teamId) continue;

            const team = teamsData.teams[teamId];
            if (!team) continue;

            if (result.error) {
                team.rosterStatus = 'failed';
                usauImportState.progress.failed.push({
                    teamName: result.team.name,
                    teamId: teamId,
                    error: result.error
                });
            } else if (result.roster && result.roster.length > 0) {
                team.rosterStatus = 'fetched';

                // Add players to roster
                for (const player of result.roster) {
                    if (!team.roster.includes(player.name)) {
                        team.roster.push(player.name);
                    }

                    // Set player position
                    const position = mapUsauPosition(player.position);
                    playerPositions[player.name] = position;

                    // Initialize career stats
                    if (!team.careerStats.players[player.name]) {
                        team.careerStats.players[player.name] = {
                            goals: 0, assists: 0, hockeyAssists: 0,
                            blocks: 0, turnovers: 0,
                            yardsThrown: 0, yardsCaught: 0,
                            gamesPlayed: 0, pointsPlayed: 0
                        };
                    }
                }
            } else {
                team.rosterStatus = 'empty';
            }
        }

        saveTeamsData();
        savePlayerPositions();
    }

    // Generate pool play schedule
    if (format !== 'bracket' && !usauImportState.aborted) {
        generatePoolPlaySchedule(newTournament.id);
    }

    // Share tournament to server (so other coaches can access it)
    if (!usauImportState.aborted) {
        usauImportState.progress.message = 'Sharing tournament...';
        try {
            const sharedTournament = await shareTournamentToServer({
                url: tournament.url,
                name: tournament.name,
                competitionLevel: tournament.competitionLevel,
                genderDivision: tournament.genderDivision,
                format: format,
                pools: usauImportState.pools?.pools,
                matchups: usauImportState.pools?.matchups,
                teams: usauImportState.pools?.teams || tournament.teams
            });

            if (sharedTournament) {
                // Store the shared tournament ID on the tournament
                newTournament.sharedTournamentId = sharedTournament.id;
                saveTournamentsData();

                console.log('Tournament shared successfully:', sharedTournament.id);
                if (!sharedTournament.isNew) {
                    console.log(`Tournament already existed with ${sharedTournament.linkedTeamsCount} linked teams`);
                }
            }
        } catch (error) {
            console.warn('Could not share tournament to server:', error);
            // Non-fatal - continue with local import
        }
    }

    // Finalize
    usauImportState.progress.phase = 'complete';
    usauImportState.progress.message = 'Import complete!';

    return {
        tournament: tournamentsData.tournaments[newTournament.id],
        league: tournamentsData.tournaments[newTournament.id], // backward compat
        teamsImported: usauImportState.progress.teamsImported,
        teamsReused: usauImportState.progress.teamsReused,
        rostersFetched: usauImportState.progress.rostersFetched,
        failed: usauImportState.progress.failed
    };
}

// Backward compat alias
async function createLeagueFromUsauTournament(options = {}) {
    return createTournamentFromUsauImport(options);
}

// Cancel ongoing import
function cancelUsauImport() {
    usauImportState.aborted = true;
    usauImportState.progress.phase = 'cancelled';
    usauImportState.progress.message = 'Import cancelled';
}

// Retry failed roster fetches
async function retryFailedRosters() {
    if (!usauImportState.tournamentId && !usauImportState.leagueId) return;

    const failed = [...usauImportState.progress.failed];
    usauImportState.progress.failed = [];
    usauImportState.progress.phase = 'fetching-rosters';
    usauImportState.aborted = false;

    const teamsToRetry = failed.map(f => ({
        name: teamsData.teams[f.teamId]?.name || f.teamName,
        link: teamsData.teams[f.teamId]?.usauLink
    })).filter(t => t.link);

    const results = await batchFetchRosters(teamsToRetry, 2, 3000);

    for (const result of results) {
        const failedEntry = failed.find(f => f.teamName.toLowerCase() === result.team.name.toLowerCase());
        if (!failedEntry) continue;

        const team = teamsData.teams[failedEntry.teamId];
        if (!team) continue;

        if (result.error) {
            team.rosterStatus = 'failed';
            usauImportState.progress.failed.push(failedEntry);
        } else if (result.roster && result.roster.length > 0) {
            team.rosterStatus = 'fetched';

            for (const player of result.roster) {
                if (!team.roster.includes(player.name)) {
                    team.roster.push(player.name);
                }
                playerPositions[player.name] = mapUsauPosition(player.position);
            }
        }
    }

    saveTeamsData();
    savePlayerPositions();

    usauImportState.progress.phase = 'complete';
    return usauImportState.progress.failed.length;
}

// ==================== SHARED TOURNAMENT FUNCTIONS ====================

// Share a tournament to the server (makes it accessible to other coaches)
async function shareTournamentToServer(tournamentData, linkedTeamId = null, linkedTeamName = null) {
    if (!currentUser) {
        console.log('Not logged in, skipping tournament sharing');
        return null;
    }

    try {
        const response = await fetch(`${API_BASE}/api/shared-tournaments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                usauUrl: tournamentData.url,
                name: tournamentData.name,
                competitionLevel: tournamentData.competitionLevel,
                genderDivision: tournamentData.genderDivision,
                format: tournamentData.format || 'pool-to-bracket',
                pools: tournamentData.pools,
                standings: tournamentData.pools, // Use pools as standings
                matchups: tournamentData.matchups,
                teams: tournamentData.teams,
                teamId: linkedTeamId,
                teamName: linkedTeamName,
                poolName: tournamentData.teams?.find(t => t.name.toLowerCase() === linkedTeamName?.toLowerCase())?.pool
            })
        });

        if (!response.ok) {
            console.error('Failed to share tournament:', response.status);
            return null;
        }

        return await response.json();
    } catch (error) {
        console.error('Error sharing tournament:', error);
        return null;
    }
}

// Get shared tournaments the user's teams are linked to
async function getLinkedSharedTournaments() {
    if (!currentUser) {
        return [];
    }

    try {
        const response = await fetch(`${API_BASE}/api/shared-tournaments`, {
            credentials: 'include'
        });

        if (!response.ok) {
            return [];
        }

        const data = await response.json();
        return data.tournaments || [];
    } catch (error) {
        console.error('Error fetching linked tournaments:', error);
        return [];
    }
}

// Find tournaments that contain a specific team
async function findTournamentsWithTeamName(teamName) {
    if (!currentUser) {
        return [];
    }

    try {
        const response = await fetch(`${API_BASE}/api/shared-tournaments/find-by-team?teamName=${encodeURIComponent(teamName)}`, {
            credentials: 'include'
        });

        if (!response.ok) {
            return [];
        }

        const data = await response.json();
        return data.matches || [];
    } catch (error) {
        console.error('Error finding tournaments:', error);
        return [];
    }
}

// Link a team to an existing shared tournament
async function linkTeamToSharedTournament(tournamentId, teamId, teamName, poolName = null) {
    if (!currentUser) {
        return null;
    }

    try {
        const response = await fetch(`${API_BASE}/api/shared-tournaments/${tournamentId}/link`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                teamId,
                teamName,
                poolName
            })
        });

        if (!response.ok) {
            console.error('Failed to link team:', response.status);
            return null;
        }

        return await response.json();
    } catch (error) {
        console.error('Error linking team:', error);
        return null;
    }
}

// Update shared tournament results from USAU
async function updateSharedTournamentResults(tournamentId) {
    if (!currentUser) {
        return null;
    }

    try {
        const response = await fetch(`${API_BASE}/api/shared-tournaments/${tournamentId}/update`, {
            method: 'POST',
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error(`Update failed: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error('Error updating shared tournament:', error);
        throw error;
    }
}

// Get import progress summary
function getImportSummary() {
    const entityId = usauImportState.tournamentId || usauImportState.leagueId;
    const entity = entityId ? getEntityById(entityId) : null;
    const teamIds = entity ? getEntityTeams(entityId) : [];

    let totalPlayers = 0;
    for (const teamId of teamIds) {
        const team = teamsData.teams[teamId];
        if (team) {
            totalPlayers += team.roster.length;
        }
    }

    return {
        leagueName: entity?.name || 'Unknown',
        leagueId: entityId,
        tournamentId: usauImportState.tournamentId,
        teamsImported: usauImportState.progress.teamsImported,
        teamsReused: usauImportState.progress.teamsReused,
        totalPlayers: totalPlayers,
        poolCount: entity?.pools?.length || 0,
        failedRosters: usauImportState.progress.failed.length,
        format: entity?.format || 'unknown'
    };
}

// Update tournament results from USAU
// Fetches fresh data and updates standings, matchups, and stats
async function updateTournamentResults(entityId, onProgress = null) {
    const entity = getEntityById(entityId);
    if (!entity) {
        throw new Error('Tournament not found');
    }

    if (!entity.importedFrom) {
        throw new Error('Tournament was not imported from USAU');
    }

    const apiBase = window.USAU_API_BASE || '';
    const changes = {
        standingsUpdated: [],
        matchupsCompleted: [],
        newMatchups: [],
        errors: []
    };

    if (onProgress) onProgress('Fetching latest results...', 0);

    try {
        // Construct the schedule URL from the imported tournament URL
        // Pattern: {tournament_url}/schedule/{genderDivision}/{competitionLevel}{genderDivision}/
        let scheduleUrl = entity.importedFrom;

        // If the importedFrom URL is a tournament landing page, construct the schedule URL
        if (!scheduleUrl.includes('/schedule/')) {
            // Try to detect competition level and gender from tournament name or URL
            const urlLower = scheduleUrl.toLowerCase();
            let gender = 'Men';
            let level = 'College';

            if (urlLower.includes('women') || urlLower.includes('-w-') || urlLower.includes('[w]')) {
                gender = 'Women';
            } else if (urlLower.includes('mixed')) {
                gender = 'Mixed';
            }

            if (urlLower.includes('club')) {
                level = 'Club';
            } else if (urlLower.includes('high-school') || urlLower.includes('hs')) {
                level = 'HighSchool';
            }

            scheduleUrl = scheduleUrl.replace(/\/?$/, '') + `/schedule/${gender}/${level}${gender}/`;
        }

        if (onProgress) onProgress('Fetching pool standings...', 20);

        // Fetch fresh pool data
        const poolsResponse = await fetch(`${apiBase}/api/usau/tournament/pools?url=${encodeURIComponent(scheduleUrl)}`);

        if (!poolsResponse.ok) {
            throw new Error(`Failed to fetch pools: ${poolsResponse.status}`);
        }

        const poolsData = await poolsResponse.json();

        if (onProgress) onProgress('Processing updates...', 50);

        // Build team name to ID mapping for this entity
        // Map both full name and name without seed (e.g., "Carleton College (1)" AND "Carleton College")
        const teamNameToId = {};
        const allTeamIds = getEntityTeams(entityId);
        for (const teamId of allTeamIds) {
            const team = teamsData.teams[teamId];
            if (team) {
                const fullName = team.name.toLowerCase();
                teamNameToId[fullName] = teamId;
                // Also map without seed number: "Team Name (1)" -> "Team Name"
                const withoutSeed = fullName.replace(/\s*[\(\[\{]\d+[\)\]\}]\s*$/, '').trim();
                if (withoutSeed !== fullName) {
                    teamNameToId[withoutSeed] = teamId;
                }
            }
        }

        // Update seeds from USAU data
        if (poolsData.teams && poolsData.teams.length > 0) {
            if (!entity.teamSeeds) entity.teamSeeds = {};
            for (const usauTeam of poolsData.teams) {
                if (usauTeam.seed) {
                    const teamId = teamNameToId[usauTeam.name.toLowerCase()];
                    if (teamId) {
                        entity.teamSeeds[teamId] = usauTeam.seed;
                    }
                }
            }
        }

        // Update standings from USAU data
        if (poolsData.pools && poolsData.teams) {
            // Group teams by pool from USAU data
            const usauPoolTeams = {};
            for (const team of poolsData.teams) {
                if (team.pool) {
                    if (!usauPoolTeams[team.pool]) {
                        usauPoolTeams[team.pool] = [];
                    }
                    usauPoolTeams[team.pool].push(team);
                }
            }

            // Update each pool's standings
            for (const [poolName, usauTeams] of Object.entries(poolsData.pools)) {
                const entityPool = entity.pools.find(p => p.name === poolName);
                if (!entityPool) continue;

                for (const usauTeam of usauTeams) {
                    const teamId = teamNameToId[usauTeam.name.toLowerCase()];
                    if (!teamId) continue;

                    // Get or create standings entry
                    if (!entity.poolStandings[entityPool.id]) {
                        entity.poolStandings[entityPool.id] = {};
                    }

                    const currentStats = entity.poolStandings[entityPool.id][teamId] || {
                        wins: 0, losses: 0, ties: 0,
                        pointsFor: 0, pointsAgainst: 0, pointDiff: 0
                    };

                    // Check if standings changed
                    const newWins = usauTeam.wins || 0;
                    const newLosses = usauTeam.losses || 0;

                    if (newWins !== currentStats.wins || newLosses !== currentStats.losses) {
                        changes.standingsUpdated.push({
                            teamId: teamId,
                            teamName: usauTeam.name,
                            poolName: poolName,
                            oldRecord: `${currentStats.wins}-${currentStats.losses}`,
                            newRecord: `${newWins}-${newLosses}`
                        });

                        // Update standings
                        entity.poolStandings[entityPool.id][teamId] = {
                            ...currentStats,
                            wins: newWins,
                            losses: newLosses,
                            pointDiff: usauTeam.pointDiff || 0
                        };
                    }
                }
            }
        }

        if (onProgress) onProgress('Updating matchups...', 70);

        // Process matchups from USAU data
        if (poolsData.matchups && poolsData.matchups.length > 0) {
            for (const usauMatchup of poolsData.matchups) {
                // Skip invalid matchups
                if (!usauMatchup.homeTeam || !usauMatchup.awayTeam) continue;

                const homeTeamId = teamNameToId[usauMatchup.homeTeam.toLowerCase()];
                const awayTeamId = teamNameToId[usauMatchup.awayTeam.toLowerCase()];

                if (!homeTeamId || !awayTeamId) continue;

                // Find existing matchup
                const existingMatchup = entity.poolMatchups.find(m =>
                    (m.homeTeamId === homeTeamId && m.awayTeamId === awayTeamId) ||
                    (m.homeTeamId === awayTeamId && m.awayTeamId === homeTeamId)
                );

                if (existingMatchup) {
                    // Update if completed and scores changed
                    if (usauMatchup.status === 'completed' && existingMatchup.status !== 'completed') {
                        existingMatchup.status = 'completed';
                        existingMatchup.homeScore = usauMatchup.homeScore;
                        existingMatchup.awayScore = usauMatchup.awayScore;

                        changes.matchupsCompleted.push({
                            homeTeam: usauMatchup.homeTeam,
                            awayTeam: usauMatchup.awayTeam,
                            score: `${usauMatchup.homeScore}-${usauMatchup.awayScore}`
                        });
                    }
                } else {
                    // New matchup not in our system - track it
                    changes.newMatchups.push({
                        homeTeam: usauMatchup.homeTeam,
                        awayTeam: usauMatchup.awayTeam,
                        status: usauMatchup.status,
                        score: usauMatchup.status === 'completed'
                            ? `${usauMatchup.homeScore}-${usauMatchup.awayScore}`
                            : 'TBD'
                    });
                }
            }
        }

        if (onProgress) onProgress('Processing bracket results...', 75);

        // Process bracket data from USAU
        if (poolsData.brackets && poolsData.brackets.length > 0) {
            let bracketGamesAdded = 0;

            // Helper: convert round name to round number within a section
            // Higher round number = earlier round (more games), 1 = finals
            function computeRoundNumbers(section) {
                // Collect unique round names in order they appear
                const roundOrder = [];
                for (const game of section.games) {
                    if (game.round && !roundOrder.includes(game.round)) {
                        roundOrder.push(game.round);
                    }
                }
                // roundOrder[0] = earliest round (most games), last = finals
                // Map: earliest → highest number, finals → 1
                const mapping = {};
                const total = roundOrder.length;
                roundOrder.forEach((name, idx) => {
                    mapping[name] = total - idx;
                });
                return mapping;
            }

            for (const section of poolsData.brackets) {
                if (!section.games) continue;

                const roundMapping = computeRoundNumbers(section);

                for (const game of section.games) {
                    if (!game.homeTeam || !game.awayTeam) continue;

                    const homeTeamId = teamNameToId[game.homeTeam.toLowerCase()];
                    const awayTeamId = teamNameToId[game.awayTeam.toLowerCase()];

                    // Skip placeholder teams (e.g., "W of Consolation S's G1")
                    if (!homeTeamId || !awayTeamId) continue;

                    // Skip cancelled games
                    if (game.status === 'Cancelled' || game.status === 'cancelled') continue;

                    // Parse scores - handle "W"/"F"/"L" forfeits
                    const homeScoreRaw = String(game.homeScore || '0');
                    const awayScoreRaw = String(game.awayScore || '0');
                    const homeScore = parseInt(homeScoreRaw) || 0;
                    const awayScore = parseInt(awayScoreRaw) || 0;
                    const isCompleted = game.status === 'Final' || game.status === 'completed';
                    const roundNum = roundMapping[game.round] || 1;

                    // Check if this bracket matchup already exists
                    const existing = entity.bracketMatchups.find(m =>
                        (m.homeTeamId === homeTeamId && m.awayTeamId === awayTeamId) ||
                        (m.homeTeamId === awayTeamId && m.awayTeamId === homeTeamId)
                    );

                    if (existing) {
                        // Update existing matchup with scores and round info
                        if (isCompleted && existing.status !== 'completed') {
                            existing.status = 'completed';
                            existing.homeScore = existing.homeTeamId === homeTeamId ? homeScore : awayScore;
                            existing.awayScore = existing.homeTeamId === homeTeamId ? awayScore : homeScore;
                            changes.matchupsCompleted.push({
                                homeTeam: game.homeTeam,
                                awayTeam: game.awayTeam,
                                score: `${homeScore}-${awayScore}`,
                                bracket: section.name || 'Bracket'
                            });
                        }
                        // Update round info if missing
                        if (!existing.roundName) {
                            existing.round = roundNum;
                            existing.roundName = game.round || null;
                            existing.bracketSection = section.name || 'Bracket';
                        }
                    } else {
                        // Add new bracket matchup from USAU data
                        entity.bracketMatchups.push({
                            id: generateUUID(),
                            round: roundNum,
                            roundName: game.round || null,
                            position: entity.bracketMatchups.length + 1,
                            homeTeamId: homeTeamId,
                            awayTeamId: awayTeamId,
                            homeScore: isCompleted ? homeScore : null,
                            awayScore: isCompleted ? awayScore : null,
                            status: isCompleted ? 'completed' : 'scheduled',
                            bracketSection: section.name || 'Bracket',
                            gameId: null
                        });
                        bracketGamesAdded++;
                        changes.newMatchups.push({
                            homeTeam: game.homeTeam,
                            awayTeam: game.awayTeam,
                            status: isCompleted ? 'completed' : 'scheduled',
                            score: isCompleted ? `${homeScore}-${awayScore}` : 'TBD',
                            bracket: section.name || 'Bracket'
                        });
                    }
                }
            }
        }

        if (onProgress) onProgress('Saving changes...', 90);

        // Save updated data
        entity.lastUpdated = new Date().toISOString();
        saveEntityData(entityId);

        if (onProgress) onProgress('Update complete!', 100);

        return {
            success: true,
            entityId: entityId,
            leagueId: entityId, // backward compat
            changes: changes,
            summary: {
                standingsUpdated: changes.standingsUpdated.length,
                matchupsCompleted: changes.matchupsCompleted.length,
                newMatchups: changes.newMatchups.length,
                timestamp: new Date().toISOString()
            }
        };

    } catch (error) {
        console.error('Update tournament results error:', error);
        changes.errors.push(error.message);

        return {
            success: false,
            entityId: entityId,
            leagueId: entityId, // backward compat
            changes: changes,
            error: error.message
        };
    }
}

// Get next opponents for a team based on upcoming matchups
function getNextOpponents(entityId, teamId) {
    const entity = getEntityById(entityId);
    if (!entity) return [];

    const upcomingMatchups = [];

    // Check pool matchups
    for (const matchup of (entity.poolMatchups || [])) {
        if (matchup.status === 'scheduled' || matchup.status === 'pending') {
            if (matchup.homeTeamId === teamId || matchup.awayTeamId === teamId) {
                const opponentId = matchup.homeTeamId === teamId ? matchup.awayTeamId : matchup.homeTeamId;
                const opponent = teamsData.teams[opponentId];
                if (opponent) {
                    upcomingMatchups.push({
                        matchupId: matchup.id,
                        type: 'pool',
                        round: matchup.round,
                        opponent: opponent.name,
                        opponentId: opponentId,
                        poolId: matchup.poolId,
                        scheduledDate: matchup.scheduledDate
                    });
                }
            }
        }
    }

    // Check bracket matchups
    for (const matchup of (entity.bracketMatchups || [])) {
        if (matchup.status === 'scheduled' || matchup.status === 'pending') {
            if (matchup.homeTeamId === teamId || matchup.awayTeamId === teamId) {
                const opponentId = matchup.homeTeamId === teamId ? matchup.awayTeamId : matchup.homeTeamId;
                const opponent = teamsData.teams[opponentId];
                if (opponent) {
                    upcomingMatchups.push({
                        matchupId: matchup.id,
                        type: 'bracket',
                        round: matchup.round,
                        opponent: opponent.name,
                        opponentId: opponentId,
                        scheduledDate: matchup.scheduledDate
                    });
                }
            }
        }
    }

    return upcomingMatchups;
}

// Get recent results for an entity
function getRecentResults(entityId, limit = 10) {
    const entity = getEntityById(entityId);
    if (!entity) return [];

    const completedMatchups = [];

    // Collect completed pool matchups
    for (const matchup of (entity.poolMatchups || [])) {
        if (matchup.status === 'completed') {
            const homeTeam = teamsData.teams[matchup.homeTeamId];
            const awayTeam = teamsData.teams[matchup.awayTeamId];
            if (homeTeam && awayTeam) {
                completedMatchups.push({
                    matchupId: matchup.id,
                    type: 'pool',
                    round: matchup.round,
                    poolId: matchup.poolId,
                    homeTeam: homeTeam.name,
                    homeTeamId: matchup.homeTeamId,
                    homeScore: matchup.homeScore,
                    awayTeam: awayTeam.name,
                    awayTeamId: matchup.awayTeamId,
                    awayScore: matchup.awayScore,
                    completedAt: matchup.completedAt
                });
            }
        }
    }

    // Collect completed bracket matchups
    for (const matchup of (entity.bracketMatchups || [])) {
        if (matchup.status === 'completed') {
            const homeTeam = teamsData.teams[matchup.homeTeamId];
            const awayTeam = teamsData.teams[matchup.awayTeamId];
            if (homeTeam && awayTeam) {
                completedMatchups.push({
                    matchupId: matchup.id,
                    type: 'bracket',
                    round: matchup.round,
                    homeTeam: homeTeam.name,
                    homeTeamId: matchup.homeTeamId,
                    homeScore: matchup.homeScore,
                    awayTeam: awayTeam.name,
                    awayTeamId: matchup.awayTeamId,
                    awayScore: matchup.awayScore,
                    completedAt: matchup.completedAt
                });
            }
        }
    }

    // Sort by completion time (newest first) and limit
    return completedMatchups
        .sort((a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0))
        .slice(0, limit);
}

// ==================== USAU RATING CALCULATIONS ====================

function calculateGameRatingDiff(winnerScore, loserScore) {
    if (winnerScore <= loserScore) return 0;
    if (winnerScore - loserScore === 1) return 125;
    const r = loserScore / (winnerScore - 1);
    const sinArg = Math.min(1, (1 - r) / 0.5) * 0.4 * Math.PI;
    const diff = 125 + 475 * Math.sin(sinArg) / Math.sin(0.4 * Math.PI);
    return Math.min(600, Math.round(diff));
}

function calculateGameRating(opponentRating, ownScore, opponentScore) {
    const isWin = ownScore > opponentScore;
    const winnerScore = Math.max(ownScore, opponentScore);
    const loserScore = Math.min(ownScore, opponentScore);
    const diff = calculateGameRatingDiff(winnerScore, loserScore);
    return isWin ? opponentRating + diff : opponentRating - diff;
}

function isBlowout(ratingGap, winnerScore, loserScore, winnerOtherResults) {
    return ratingGap >= 600 &&
           winnerScore > 2 * loserScore + 1 &&
           winnerOtherResults >= 5;
}

function calculateTournamentRatingImpacts(entityId, rankingsMap) {
    const entity = getEntityById(entityId);
    if (!entity) return {};

    const allTeamIds = getEntityTeams(entityId);
    const allMatchups = [
        ...(entity.poolMatchups || []),
        ...(entity.bracketMatchups || [])
    ].filter(m => m.status === 'completed');

    // Build teamId -> rating lookup with fuzzy matching
    const teamRatings = {};
    const teamRanks = {};
    for (const teamId of allTeamIds) {
        const team = teamsData.teams[teamId];
        if (!team) continue;
        const nameKey = team.name.toLowerCase().trim();
        let entry = rankingsMap[nameKey];
        // Try stripping "University of" / "Univ. of" prefix
        if (!entry) {
            const stripped = nameKey.replace(/^university of\s+/i, '').replace(/^univ\.?\s+of\s+/i, '');
            if (stripped !== nameKey) entry = rankingsMap[stripped];
        }
        // Try hyphenated vs space variations (e.g., "Wisconsin-Eau Claire" vs "Wisconsin Eau Claire")
        if (!entry) {
            const hyphenated = nameKey.replace(/\s+/g, '-');
            const spaced = nameKey.replace(/-/g, ' ');
            entry = rankingsMap[hyphenated] || rankingsMap[spaced];
        }
        teamRatings[teamId] = entry ? entry.rating : null;
        teamRanks[teamId] = entry ? entry.rank : null;
    }

    const impacts = {};
    for (const teamId of allTeamIds) {
        const team = teamsData.teams[teamId];
        if (!team) continue;

        const preRating = teamRatings[teamId];
        const gameRatings = [];
        let biggestWin = null;
        let worstLoss = null;

        const teamGames = allMatchups.filter(
            m => m.homeTeamId === teamId || m.awayTeamId === teamId
        );

        for (const game of teamGames) {
            const isHome = game.homeTeamId === teamId;
            const opponentId = isHome ? game.awayTeamId : game.homeTeamId;
            const ownScore = isHome ? game.homeScore : game.awayScore;
            const oppScore = isHome ? game.awayScore : game.homeScore;
            const opponentRating = teamRatings[opponentId];
            const opponent = teamsData.teams[opponentId];
            const isWin = ownScore > oppScore;

            if (preRating == null || opponentRating == null) {
                gameRatings.push({
                    opponentId, opponentName: opponent?.name || 'Unknown',
                    ownScore, oppScore, gameRating: null, ratingImpact: null, isWin
                });
                continue;
            }

            const gameRating = calculateGameRating(opponentRating, ownScore, oppScore);
            const entry = {
                opponentId, opponentName: opponent?.name || 'Unknown',
                ownScore, oppScore, gameRating, ratingImpact: gameRating - preRating, isWin
            };
            gameRatings.push(entry);

            if (isWin && (!biggestWin || entry.ratingImpact > biggestWin.ratingImpact)) {
                biggestWin = entry;
            }
            if (!isWin && (!worstLoss || entry.ratingImpact < worstLoss.ratingImpact)) {
                worstLoss = entry;
            }
        }

        const validGameRatings = gameRatings.filter(g => g.gameRating != null);
        const projectedRating = validGameRatings.length > 0
            ? validGameRatings.reduce((sum, g) => sum + g.gameRating, 0) / validGameRatings.length
            : preRating;

        impacts[teamId] = {
            teamName: team.name,
            preRating,
            preRank: teamRanks[teamId],
            seed: entity.teamSeeds ? entity.teamSeeds[teamId] : null,
            gameRatings,
            projectedRating: projectedRating ? Math.round(projectedRating) : null,
            ratingChange: (preRating != null && projectedRating != null) ? Math.round(projectedRating - preRating) : null,
            biggestWin,
            worstLoss,
            gamesPlayed: teamGames.length,
            wins: gameRatings.filter(g => g.isWin).length,
            losses: gameRatings.filter(g => !g.isWin).length
        };
    }

    return impacts;
}

// ==================== SYNOPSIS GENERATION ====================

function generateTournamentSynopsis(entityId, rankingsMap) {
    const entity = getEntityById(entityId);
    if (!entity) return null;

    const allMatchups = [
        ...(entity.poolMatchups || []),
        ...(entity.bracketMatchups || [])
    ];
    const completedMatchups = allMatchups.filter(m => m.status === 'completed');

    // Overview stats
    const totalGames = allMatchups.length;
    const completedGames = completedMatchups.length;
    const completionPct = totalGames > 0 ? Math.round((completedGames / totalGames) * 100) : 0;

    let totalWinnerScore = 0, totalLoserScore = 0;
    for (const m of completedMatchups) {
        const high = Math.max(m.homeScore || 0, m.awayScore || 0);
        const low = Math.min(m.homeScore || 0, m.awayScore || 0);
        totalWinnerScore += high;
        totalLoserScore += low;
    }
    const avgWinnerScore = completedGames > 0 ? Math.round(totalWinnerScore / completedGames) : 0;
    const avgLoserScore = completedGames > 0 ? Math.round(totalLoserScore / completedGames) : 0;
    const avgMargin = completedGames > 0 ? Math.round((totalWinnerScore - totalLoserScore) / completedGames * 10) / 10 : 0;

    const overview = { totalGames, completedGames, completionPct, avgWinnerScore, avgLoserScore, avgMargin };

    // Team impacts
    const teamImpacts = calculateTournamentRatingImpacts(entityId, rankingsMap);

    // Storylines
    const storylines = {};

    // Biggest upset by seed
    let biggestSeedUpset = null;
    for (const m of completedMatchups) {
        if (!entity.teamSeeds) break;
        const homeSeed = entity.teamSeeds[m.homeTeamId];
        const awaySeed = entity.teamSeeds[m.awayTeamId];
        if (!homeSeed || !awaySeed) continue;
        const homeWon = m.homeScore > m.awayScore;
        const winnerSeed = homeWon ? homeSeed : awaySeed;
        const loserSeed = homeWon ? awaySeed : homeSeed;
        // Upset = higher seed number beats lower seed number
        if (winnerSeed > loserSeed) {
            const seedGap = winnerSeed - loserSeed;
            if (!biggestSeedUpset || seedGap > biggestSeedUpset.seedGap) {
                const winnerId = homeWon ? m.homeTeamId : m.awayTeamId;
                const loserId = homeWon ? m.awayTeamId : m.homeTeamId;
                biggestSeedUpset = {
                    seedGap,
                    winnerSeed, loserSeed,
                    winnerName: teamsData.teams[winnerId]?.name || 'Unknown',
                    loserName: teamsData.teams[loserId]?.name || 'Unknown',
                    score: `${m.homeScore}-${m.awayScore}`
                };
            }
        }
    }
    storylines.biggestUpsetBySeed = biggestSeedUpset;

    // Biggest upset by rating
    let biggestRatingUpset = null;
    for (const m of completedMatchups) {
        const homeRating = teamImpacts[m.homeTeamId]?.preRating;
        const awayRating = teamImpacts[m.awayTeamId]?.preRating;
        if (homeRating == null || awayRating == null) continue;
        const homeWon = m.homeScore > m.awayScore;
        const winnerRating = homeWon ? homeRating : awayRating;
        const loserRating = homeWon ? awayRating : homeRating;
        if (winnerRating < loserRating) {
            const ratingGap = loserRating - winnerRating;
            if (!biggestRatingUpset || ratingGap > biggestRatingUpset.ratingGap) {
                const winnerId = homeWon ? m.homeTeamId : m.awayTeamId;
                const loserId = homeWon ? m.awayTeamId : m.homeTeamId;
                biggestRatingUpset = {
                    ratingGap: Math.round(ratingGap),
                    winnerRating: Math.round(winnerRating),
                    loserRating: Math.round(loserRating),
                    winnerName: teamsData.teams[winnerId]?.name || 'Unknown',
                    loserName: teamsData.teams[loserId]?.name || 'Unknown',
                    score: `${m.homeScore}-${m.awayScore}`
                };
            }
        }
    }
    storylines.biggestUpsetByRating = biggestRatingUpset;

    // Closest game
    let closestGame = null;
    for (const m of completedMatchups) {
        const margin = Math.abs((m.homeScore || 0) - (m.awayScore || 0));
        if (!closestGame || margin < closestGame.margin) {
            closestGame = {
                margin,
                team1: teamsData.teams[m.homeTeamId]?.name || 'Unknown',
                team2: teamsData.teams[m.awayTeamId]?.name || 'Unknown',
                score: `${m.homeScore}-${m.awayScore}`
            };
        }
    }
    storylines.closestGame = closestGame;

    // Biggest blowout
    let biggestBlowout = null;
    for (const m of completedMatchups) {
        const margin = Math.abs((m.homeScore || 0) - (m.awayScore || 0));
        if (!biggestBlowout || margin > biggestBlowout.margin) {
            const homeWon = m.homeScore > m.awayScore;
            const winnerId = homeWon ? m.homeTeamId : m.awayTeamId;
            const loserId = homeWon ? m.awayTeamId : m.homeTeamId;
            biggestBlowout = {
                margin,
                winnerName: teamsData.teams[winnerId]?.name || 'Unknown',
                loserName: teamsData.teams[loserId]?.name || 'Unknown',
                score: `${m.homeScore}-${m.awayScore}`
            };
        }
    }
    storylines.biggestBlowout = biggestBlowout;

    // Cinderella team: lowest seed or rating with best record
    let cinderella = null;
    const impactEntries = Object.entries(teamImpacts);
    for (const [teamId, impact] of impactEntries) {
        if (impact.gamesPlayed === 0) continue;
        const seed = impact.seed;
        const rating = impact.preRating;
        const winPct = impact.wins / impact.gamesPlayed;
        if (winPct < 0.5) continue; // Must have winning record
        // Cinderella = high seed number or low rating with good record
        const cinderellaScore = (seed ? seed : 999) * 100 - (rating || 0);
        if (!cinderella || cinderellaScore > cinderella._score) {
            cinderella = {
                _score: cinderellaScore,
                teamName: impact.teamName,
                seed: seed,
                rating: rating,
                record: `${impact.wins}-${impact.losses}`,
                ratingChange: impact.ratingChange
            };
        }
    }
    if (cinderella) delete cinderella._score;
    storylines.cinderellaTeam = cinderella;

    // Group of death: pool with highest avg team rating
    let groupOfDeath = null;
    if (entity.pools && entity.pools.length > 1) {
        for (const pool of entity.pools) {
            const poolRatings = pool.teamIds
                .map(tid => teamImpacts[tid]?.preRating)
                .filter(r => r != null);
            if (poolRatings.length < 2) continue;
            const avgRating = Math.round(poolRatings.reduce((a, b) => a + b, 0) / poolRatings.length);
            if (!groupOfDeath || avgRating > groupOfDeath.avgRating) {
                groupOfDeath = {
                    poolName: pool.name,
                    avgRating,
                    teamCount: pool.teamIds.length
                };
            }
        }
    }
    storylines.groupOfDeath = groupOfDeath;

    // Dominant performance: best point diff and undefeated or most wins
    let dominant = null;
    for (const [teamId, impact] of impactEntries) {
        if (impact.gamesPlayed < 2) continue;
        const totalDiff = impact.gameRatings.reduce((sum, g) => sum + (g.ownScore || 0) - (g.oppScore || 0), 0);
        const score = impact.wins * 100 + totalDiff;
        if (!dominant || score > dominant._score) {
            dominant = {
                _score: score,
                teamName: impact.teamName,
                record: `${impact.wins}-${impact.losses}`,
                pointDiff: totalDiff >= 0 ? `+${totalDiff}` : `${totalDiff}`,
                ratingChange: impact.ratingChange
            };
        }
    }
    if (dominant) delete dominant._score;
    storylines.dominantPerformance = dominant;

    // Generate narrative
    const narrative = generateNarrative(entity, overview, storylines, teamImpacts);

    return { overview, teamImpacts, storylines, narrative };
}

function generateNarrative(entity, overview, storylines, teamImpacts) {
    const parts = [];
    const teamCount = getEntityTeamCount(entity.id);
    const poolCount = entity.pools ? entity.pools.length : 0;

    // Opening
    if (poolCount > 0) {
        parts.push(`${entity.name} featured ${teamCount} teams across ${poolCount} pools with ${overview.completedGames} games played.`);
    } else {
        parts.push(`${entity.name} featured ${teamCount} teams with ${overview.completedGames} games completed.`);
    }

    // Championship result
    if (entity.bracketMatchups && entity.bracketMatchups.length > 0) {
        const finals = entity.bracketMatchups.filter(m => m.round === 1 && m.status === 'completed');
        if (finals.length > 0) {
            const final = finals[0];
            const homeWon = final.homeScore > final.awayScore;
            const champion = teamsData.teams[homeWon ? final.homeTeamId : final.awayTeamId];
            const runnerUp = teamsData.teams[homeWon ? final.awayTeamId : final.homeTeamId];
            if (champion && runnerUp) {
                parts.push(`${champion.name} claimed the title with a ${final.homeScore}-${final.awayScore} victory over ${runnerUp.name} in the final.`);
            }
        }
    }

    // Dominant performance
    if (storylines.dominantPerformance) {
        const d = storylines.dominantPerformance;
        parts.push(`${d.teamName} delivered the most dominant performance, going ${d.record} with a ${d.pointDiff} point differential.`);
    }

    // Biggest upset
    if (storylines.biggestUpsetBySeed) {
        const u = storylines.biggestUpsetBySeed;
        parts.push(`The biggest upset saw #${u.winnerSeed} seed ${u.winnerName} take down #${u.loserSeed} seed ${u.loserName} (${u.score}).`);
    } else if (storylines.biggestUpsetByRating) {
        const u = storylines.biggestUpsetByRating;
        parts.push(`The biggest upset came when ${u.winnerName} (rated ${u.winnerRating}) defeated ${u.loserName} (rated ${u.loserRating}) in a ${u.ratingGap}-point rating gap upset.`);
    }

    // Cinderella
    if (storylines.cinderellaTeam) {
        const c = storylines.cinderellaTeam;
        const seedStr = c.seed ? `#${c.seed} seed` : '';
        const ratingStr = c.rating ? `rated ${c.rating}` : '';
        const desc = [seedStr, ratingStr].filter(Boolean).join(', ');
        if (desc) {
            parts.push(`${c.teamName} (${desc}) emerged as the Cinderella story, finishing ${c.record}.`);
        }
    }

    // Closest game
    if (storylines.closestGame && storylines.closestGame.margin <= 2) {
        const c = storylines.closestGame;
        parts.push(`The closest contest was ${c.team1} vs ${c.team2}, decided ${c.score}.`);
    }

    // Group of death
    if (storylines.groupOfDeath) {
        const g = storylines.groupOfDeath;
        parts.push(`${g.poolName} proved to be the group of death with an average team rating of ${g.avgRating}.`);
    }

    // Avg score
    parts.push(`Games averaged ${overview.avgWinnerScore}-${overview.avgLoserScore} with a ${overview.avgMargin}-point average margin.`);

    return parts.join(' ');
}

// ==================== RANKINGS CACHE ====================

function buildRankSet(league) {
    const level = league.competitionLevel || 'College';
    const gender = league.genderDivision || 'Men';
    return `${level}-${gender}`;
}

function cacheRankings(league, rankingsData) {
    try {
        const cache = JSON.parse(localStorage.getItem(RANKINGS_CACHE_KEY) || '{}');
        const rankSet = buildRankSet(league);
        cache[rankSet] = { data: rankingsData, cachedAt: new Date().toISOString() };
        localStorage.setItem(RANKINGS_CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
        console.warn('Could not cache rankings:', e);
    }
}

function getCachedRankings(league) {
    try {
        const cache = JSON.parse(localStorage.getItem(RANKINGS_CACHE_KEY) || '{}');
        const rankSet = buildRankSet(league);
        const entry = cache[rankSet];
        if (!entry) return null;
        const ageMs = Date.now() - new Date(entry.cachedAt).getTime();
        if (ageMs > 60 * 60 * 1000) return null;
        return entry.data;
    } catch (e) {
        return null;
    }
}

function loadFromStorage() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            gameState = { ...gameState, ...parsed };
            
            // If there was an active game, restore it
            if (gameState.currentGame.isActive) {
                restoreGameSession();
            }
        }
    } catch (e) {
        console.warn('Could not load from localStorage:', e);
    }
}

// ==================== SETTINGS MANAGEMENT ====================

function loadSettings() {
    try {
        const saved = localStorage.getItem(SETTINGS_KEY);
        if (saved) {
            appSettings = { ...appSettings, ...JSON.parse(saved) };
        }
        const avatars = localStorage.getItem(AVATARS_KEY);
        if (avatars) {
            playerAvatars = JSON.parse(avatars);
        }
    } catch (e) {
        console.warn('Could not load settings:', e);
    }
    applySettings();
}

function saveSettings() {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(appSettings));
    } catch (e) {
        console.warn('Could not save settings:', e);
    }
}

function saveAvatars() {
    try {
        localStorage.setItem(AVATARS_KEY, JSON.stringify(playerAvatars));
    } catch (e) {
        console.warn('Could not save avatars:', e);
    }
}

function applySettings() {
    // Apply theme
    applyTheme(appSettings.darkMode);
    
    // Update toggle UI states
    updateSettingsToggles();
}

function applyTheme(isDark) {
    const body = document.body;
    if (isDark) {
        body.classList.remove('light-mode');
        body.classList.add('dark-mode');
    } else {
        body.classList.remove('dark-mode');
        body.classList.add('light-mode');
    }
}

function updateSettingsToggles() {
    // Theme toggle
    const themeToggle = document.getElementById('theme-toggle');
    const themeDot = document.getElementById('theme-toggle-dot');
    if (themeToggle && themeDot) {
        if (appSettings.darkMode) {
            themeToggle.classList.add('bg-purple-500/30');
            themeToggle.classList.remove('bg-white/10');
            themeDot.classList.add('left-7');
            themeDot.classList.remove('left-1');
            themeDot.classList.add('bg-purple-500');
            themeDot.classList.remove('bg-gray-500');
        } else {
            themeToggle.classList.remove('bg-purple-500/30');
            themeToggle.classList.add('bg-white/10');
            themeDot.classList.remove('left-7');
            themeDot.classList.add('left-1');
            themeDot.classList.remove('bg-purple-500');
            themeDot.classList.add('bg-gray-500');
        }
    }
    
    // Haptic toggle
    const hapticToggle = document.getElementById('haptic-toggle');
    const hapticDot = document.getElementById('haptic-toggle-dot');
    if (hapticToggle && hapticDot) {
        if (appSettings.hapticEnabled) {
            hapticToggle.classList.add('bg-emerald-500/30');
            hapticToggle.classList.remove('bg-white/10');
            hapticDot.classList.add('left-7');
            hapticDot.classList.remove('left-1');
            hapticDot.classList.add('bg-emerald-500');
            hapticDot.classList.remove('bg-gray-500');
        } else {
            hapticToggle.classList.remove('bg-emerald-500/30');
            hapticToggle.classList.add('bg-white/10');
            hapticDot.classList.remove('left-7');
            hapticDot.classList.add('left-1');
            hapticDot.classList.remove('bg-emerald-500');
            hapticDot.classList.add('bg-gray-500');
        }
    }
    
    // Sound toggle
    const soundToggle = document.getElementById('sound-toggle');
    const soundDot = document.getElementById('sound-toggle-dot');
    if (soundToggle && soundDot) {
        if (appSettings.soundEnabled) {
            soundToggle.classList.add('bg-cyan-500/30');
            soundToggle.classList.remove('bg-white/10');
            soundDot.classList.add('left-7');
            soundDot.classList.remove('left-1');
            soundDot.classList.add('bg-cyan-500');
            soundDot.classList.remove('bg-gray-500');
        } else {
            soundToggle.classList.remove('bg-cyan-500/30');
            soundToggle.classList.add('bg-white/10');
            soundDot.classList.remove('left-7');
            soundDot.classList.add('left-1');
            soundDot.classList.remove('bg-cyan-500');
            soundDot.classList.add('bg-gray-500');
        }
    }
    
    // Confirm toggle
    const confirmToggle = document.getElementById('confirm-toggle');
    const confirmDot = document.getElementById('confirm-toggle-dot');
    if (confirmToggle && confirmDot) {
        if (appSettings.confirmDestructive) {
            confirmToggle.classList.add('bg-emerald-500/30');
            confirmToggle.classList.remove('bg-white/10');
            confirmDot.classList.add('left-7');
            confirmDot.classList.remove('left-1');
            confirmDot.classList.add('bg-emerald-500');
            confirmDot.classList.remove('bg-gray-500');
        } else {
            confirmToggle.classList.remove('bg-emerald-500/30');
            confirmToggle.classList.add('bg-white/10');
            confirmDot.classList.remove('left-7');
            confirmDot.classList.add('left-1');
            confirmDot.classList.remove('bg-emerald-500');
            confirmDot.classList.add('bg-gray-500');
        }
    }
}

let settingsFocusCleanup = null;
function showSettingsModal() {
    const modal = document.getElementById('settings-modal');
    modal.classList.remove('hidden');
    updateSettingsToggles();
    if (typeof lucide !== 'undefined') lucide.createIcons();
    settingsFocusCleanup = trapFocus(modal, closeSettingsModal);
}

function closeSettingsModal() {
    document.getElementById('settings-modal').classList.add('hidden');
    if (settingsFocusCleanup) { settingsFocusCleanup(); settingsFocusCleanup = null; }
}

let clearDataBackup = null;
let clearDataTimeout = null;

function clearAllData() {
    closeSettingsModal();
    showConfirmDialog(
        'Clear All Data',
        'This will delete all local data including teams, games, stats, and settings. You\'ll have 5 seconds to undo.',
        () => {
            // Backup all ultistats keys
            clearDataBackup = {};
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('ultistats_')) {
                    clearDataBackup[key] = localStorage.getItem(key);
                }
            }
            // Clear the data
            Object.keys(clearDataBackup).forEach(key => localStorage.removeItem(key));

            // Show undo toast with countdown
            showUndoClearToast();
        }
    );
}

function showUndoClearToast() {
    const existing = document.getElementById('undo-clear-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'undo-clear-toast';
    toast.className = 'fixed bottom-20 left-1/2 transform -translate-x-1/2 bg-slate-800 border border-white/20 text-white px-5 py-3 rounded-xl shadow-lg z-50 flex items-center gap-4';
    toast.innerHTML = `
        <span>Data cleared.</span>
        <button onclick="undoClearData()" class="px-3 py-1 bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-medium rounded-lg transition-colors">Undo</button>
        <span id="undo-countdown" class="text-gray-400 text-sm">5s</span>
    `;
    document.body.appendChild(toast);

    let seconds = 5;
    const countdownEl = document.getElementById('undo-countdown');
    const countdownInterval = setInterval(() => {
        seconds--;
        if (countdownEl) countdownEl.textContent = seconds + 's';
        if (seconds <= 0) clearInterval(countdownInterval);
    }, 1000);

    clearDataTimeout = setTimeout(() => {
        clearDataBackup = null;
        toast.remove();
        showToast('All local data permanently deleted', 3000, 'success');
        setTimeout(() => { window.location.href = '/index.html'; }, 1500);
    }, 5000);
}

function undoClearData() {
    if (clearDataTimeout) {
        clearTimeout(clearDataTimeout);
        clearDataTimeout = null;
    }
    if (clearDataBackup) {
        Object.entries(clearDataBackup).forEach(([key, value]) => {
            localStorage.setItem(key, value);
        });
        clearDataBackup = null;
    }
    const toast = document.getElementById('undo-clear-toast');
    if (toast) toast.remove();
    showToast('Data restored!', 2000, 'success');
}

function toggleTheme() {
    appSettings.darkMode = !appSettings.darkMode;
    applyTheme(appSettings.darkMode);
    updateSettingsToggles();
    saveSettings();
    hapticFeedback('tap');
}

function toggleHaptic() {
    appSettings.hapticEnabled = !appSettings.hapticEnabled;
    updateSettingsToggles();
    saveSettings();
    if (appSettings.hapticEnabled) {
        hapticFeedback('success');
    }
}

function toggleSound() {
    appSettings.soundEnabled = !appSettings.soundEnabled;
    updateSettingsToggles();
    saveSettings();
    if (appSettings.soundEnabled) {
        playSound('tap');
    }
}

// ==================== OUTDOOR / SUNLIGHT MODE ====================
// High-contrast light theme optimized for outdoor glare readability
let _outdoorMode = false;

function toggleOutdoorMode() {
    _outdoorMode = !_outdoorMode;
    document.body.classList.toggle('outdoor-mode', _outdoorMode);

    // Update button appearance
    const btn = document.getElementById('outdoor-mode-btn');
    if (btn) {
        if (_outdoorMode) {
            btn.classList.remove('bg-amber-500/20', 'text-amber-400', 'border-amber-500/30');
            btn.classList.add('bg-amber-500', 'text-black', 'border-amber-400');
        } else {
            btn.classList.remove('bg-amber-500', 'text-black', 'border-amber-400');
            btn.classList.add('bg-amber-500/20', 'text-amber-400', 'border-amber-500/30');
        }
    }

    hapticFeedback('tap');
    showToast(_outdoorMode ? 'Outdoor mode ON' : 'Outdoor mode OFF', 1500);
}

function toggleConfirmActions() {
    appSettings.confirmDestructive = !appSettings.confirmDestructive;
    updateSettingsToggles();
    saveSettings();
    hapticFeedback('tap');
}

// ==================== AVATAR MANAGEMENT ====================

const AVATAR_COLORS = [
    'bg-red-500', 'bg-orange-500', 'bg-amber-500', 'bg-yellow-500',
    'bg-lime-500', 'bg-green-500', 'bg-emerald-500', 'bg-teal-500',
    'bg-cyan-500', 'bg-sky-500', 'bg-blue-500', 'bg-indigo-500',
    'bg-violet-500', 'bg-purple-500', 'bg-fuchsia-500', 'bg-pink-500'
];

let avatarFocusCleanup = null;
function showAvatarManager() {
    closeSettingsModal();
    const modal = document.getElementById('avatar-modal');
    modal.classList.remove('hidden');
    populateAvatarList();
    if (typeof lucide !== 'undefined') lucide.createIcons();
    avatarFocusCleanup = trapFocus(modal, closeAvatarModal);
}

function closeAvatarModal() {
    document.getElementById('avatar-modal').classList.add('hidden');
    if (avatarFocusCleanup) { avatarFocusCleanup(); avatarFocusCleanup = null; }
}

function populateAvatarList() {
    const list = document.getElementById('avatar-list');
    if (!list) return;
    
    const allPlayers = [...new Set([...gameState.players, ...savedRoster])];
    
    if (allPlayers.length === 0) {
        list.innerHTML = '<div class="text-center text-gray-400 py-8">No players added yet</div>';
        return;
    }
    
    list.innerHTML = allPlayers.map(player => {
        const avatar = playerAvatars[player] || { type: 'initials', color: getRandomAvatarColor(player) };
        const initials = getPlayerInitials(player);
        const color = avatar.color || getRandomAvatarColor(player);
        
        return `
            <div class="flex items-center gap-3 p-3 bg-white/5 rounded-xl">
                <div class="w-12 h-12 ${color} rounded-full flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
                    ${avatar.type === 'image' && avatar.value ? `<img src="${escapeHtml(avatar.value)}" class="w-full h-full rounded-full object-cover">` : escapeHtml(initials)}
                </div>
                <div class="flex-1 min-w-0">
                    <div class="font-medium text-white truncate">${escapeHtml(player)}</div>
                    <div class="text-xs text-gray-400">${escapeHtml(getPlayerPosition(player) || 'No position')}</div>
                </div>
                <div class="flex gap-2">
                    <button onclick="cycleAvatarColor('${escapeHtml(player).replace(/'/g, "\\'")}')" class="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-all" title="Change color">
                        <i data-lucide="palette" class="w-4 h-4 text-gray-400"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
    
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function getPlayerInitials(name) {
    const parts = name.split(' ');
    if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
}

function getRandomAvatarColor(name) {
    // Deterministic color based on name
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function cycleAvatarColor(playerName) {
    const current = playerAvatars[playerName] || { type: 'initials', color: getRandomAvatarColor(playerName) };
    const currentIndex = AVATAR_COLORS.indexOf(current.color);
    const nextIndex = (currentIndex + 1) % AVATAR_COLORS.length;
    
    playerAvatars[playerName] = {
        type: 'initials',
        color: AVATAR_COLORS[nextIndex]
    };
    
    saveAvatars();
    populateAvatarList();
    hapticFeedback('tap');
}

function getPlayerAvatar(playerName) {
    const avatar = playerAvatars[playerName] || { type: 'initials', color: getRandomAvatarColor(playerName) };
    const initials = getPlayerInitials(playerName);
    const color = avatar.color || getRandomAvatarColor(playerName);
    
    return `<div class="w-8 h-8 ${color} rounded-full flex items-center justify-center text-white font-bold text-xs flex-shrink-0">${initials}</div>`;
}

// ==================== CONFIRMATION DIALOGS ====================

let pendingConfirmAction = null;

let confirmFocusCleanup = null;

function showConfirmDialog(title, message, onConfirm) {
    if (!appSettings.confirmDestructive) {
        onConfirm();
        return;
    }

    pendingConfirmAction = onConfirm;
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    const modal = document.getElementById('confirm-modal');
    modal.classList.remove('hidden');
    if (typeof lucide !== 'undefined') lucide.createIcons();
    confirmFocusCleanup = trapFocus(modal, cancelConfirm);
}

function cancelConfirm() {
    pendingConfirmAction = null;
    document.getElementById('confirm-modal').classList.add('hidden');
    if (confirmFocusCleanup) { confirmFocusCleanup(); confirmFocusCleanup = null; }
}

function executeConfirm() {
    if (pendingConfirmAction) {
        pendingConfirmAction();
        pendingConfirmAction = null;
    }
    document.getElementById('confirm-modal').classList.add('hidden');
    if (confirmFocusCleanup) { confirmFocusCleanup(); confirmFocusCleanup = null; }
}

// Wire up confirm button
document.addEventListener('DOMContentLoaded', () => {
    const confirmBtn = document.getElementById('confirm-action-btn');
    if (confirmBtn) {
        confirmBtn.addEventListener('click', executeConfirm);
    }
});

// Offline/online status indicator
function updateOfflineBanner() {
    const banner = document.getElementById('offline-banner');
    if (!banner) return;
    if (navigator.onLine) {
        banner.classList.add('hidden');
    } else {
        banner.classList.remove('hidden');
    }
}
window.addEventListener('online', updateOfflineBanner);
window.addEventListener('offline', updateOfflineBanner);
document.addEventListener('DOMContentLoaded', updateOfflineBanner);

function restoreGameSession() {
    // Hide hero and show game sections (with null checks for game.html compatibility)
    const hero = document.getElementById('hero');
    const gameSetup = document.getElementById('game-setup');
    const playerRoster = document.getElementById('player-roster');
    const leaderboards = document.getElementById('leaderboards');
    const statsDashboard = document.getElementById('stats-dashboard');
    const recentActions = document.getElementById('recent-actions');
    const lineSelection = document.getElementById('line-selection');
    const fieldSection = document.getElementById('field-section');
    
    if (hero) hero.classList.add('hidden');
    if (gameSetup) gameSetup.classList.add('hidden');
    if (playerRoster) playerRoster.classList.remove('hidden');
    if (leaderboards) leaderboards.classList.remove('hidden');
    if (statsDashboard) statsDashboard.classList.remove('hidden');
    if (recentActions) recentActions.classList.remove('hidden');
    
    // Show appropriate section based on point state
    if (gameState.pointInProgress && gameState.onFieldPlayers.length === 7) {
        if (lineSelection) lineSelection.classList.add('hidden');
        if (fieldSection) fieldSection.classList.remove('hidden');
        updateOnFieldDisplay();
    } else {
        if (lineSelection) lineSelection.classList.remove('hidden');
        if (fieldSection) fieldSection.classList.add('hidden');
    }
    
    // Update displays
    updatePlayerList();
    updatePlayerDropdowns();
    updateQuickPlayerSelect();
    updateLineSelectionGrid();
    updateStatsDisplay();
    updateScoreDisplay();
    updateLeaderboard();
    updateTournamentStatus();
    
    // Re-initialize icons
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
    
    logAction('Session restored', 'system');
}

function setDefaultDate() {
    const today = new Date().toISOString().split('T')[0];
    const gameDateEl = document.getElementById('game-date');
    if (gameDateEl) gameDateEl.value = today;
}

function initializeEventListeners() {
    // Game setup (dashboard page only)
    const startGameBtn = document.getElementById('start-game');
    const addPlayerBtn = document.getElementById('add-player');
    const newPlayerInput = document.getElementById('new-player');
    const csvImport = document.getElementById('csv-import');
    
    if (startGameBtn) startGameBtn.addEventListener('click', startGame);
    if (addPlayerBtn) addPlayerBtn.addEventListener('click', addPlayer);
    if (newPlayerInput) newPlayerInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') addPlayer();
    });
    if (csvImport) csvImport.addEventListener('change', handleCSVImport);

    // Field interaction
    const fieldContainer = document.getElementById('field-container');
    const actionType = document.getElementById('action-type');
    
    if (fieldContainer) {
        // Touch: touchstart tracks multi-finger swipes, touchend handles taps + swipe-to-undo
        fieldContainer.addEventListener('touchstart', handleFieldTouchStart, { passive: true });
        fieldContainer.addEventListener('touchend', handleFieldTouch, { passive: false });
        fieldContainer.addEventListener('click', handleFieldClick);
        fieldContainer.addEventListener('keydown', handleFieldKeydown);
    }
    if (actionType) actionType.addEventListener('change', handleActionTypeChange);

    // Quick actions scroll fade indicator
    const quickActions = document.getElementById('quick-actions');
    if (quickActions) {
        const updateScrollFade = () => {
            const atStart = quickActions.scrollLeft <= 0;
            const atEnd = quickActions.scrollLeft + quickActions.clientWidth >= quickActions.scrollWidth - 1;
            quickActions.classList.toggle('scrolled-start', !atStart);
            quickActions.classList.toggle('scrolled-end', atEnd);
        };
        quickActions.addEventListener('scroll', updateScrollFade, { passive: true });
        updateScrollFade();
    }

    // Quick action buttons
    const btnScore = document.getElementById('btn-score');
    const btnTurnover = document.getElementById('btn-turnover');
    const btnTurnoverGained = document.getElementById('btn-turnover-gained');
    const btnUndo = document.getElementById('btn-undo');
    
    if (btnScore) btnScore.addEventListener('click', quickScore);
    if (btnTurnover) btnTurnover.addEventListener('click', quickTurnover);
    if (btnTurnoverGained) btnTurnoverGained.addEventListener('click', quickTurnoverGained);
    if (btnUndo) btnUndo.addEventListener('click', undoLastAction);

    // Line selection
    const startPointBtn = document.getElementById('start-point-btn');
    const clearLineBtn = document.getElementById('clear-line-btn');
    const endPointBtn = document.getElementById('end-point-btn');
    const injurySubBtn = document.getElementById('injury-sub-btn');
    const endGameBtn = document.getElementById('end-game-btn');
    
    if (startPointBtn) startPointBtn.addEventListener('click', startPoint);
    if (clearLineBtn) clearLineBtn.addEventListener('click', clearLineSelection);
    if (endPointBtn) endPointBtn.addEventListener('click', endPoint);
    if (injurySubBtn) injurySubBtn.addEventListener('click', initiateInjurySub);
    if (endGameBtn) endGameBtn.addEventListener('click', confirmEndGame);

    // Leaderboard tabs and sorting
    document.querySelectorAll('.leaderboard-tab').forEach(tab => {
        tab.addEventListener('click', () => switchLeaderboardTab(tab.id.replace('tab-', '')));
    });
    document.querySelectorAll('.sort-btn').forEach(btn => {
        btn.addEventListener('click', () => sortLeaderboard(btn.dataset.sort));
    });
    const manageTournamentBtn = document.getElementById('manage-tournament-btn');
    if (manageTournamentBtn) manageTournamentBtn.addEventListener('click', showTournamentModal);

    // Google Sheets API
    const authorizeBtn = document.getElementById('authorize_button');
    const signoutBtn = document.getElementById('signout_button');
    if (authorizeBtn) authorizeBtn.addEventListener('click', handleAuthClick);
    if (signoutBtn) signoutBtn.addEventListener('click', handleSignoutClick);
    
    // Keyboard shortcuts (game page only)
    if (window.isGamePage) {
        document.addEventListener('keydown', handleKeyboardShortcuts);
    }
}

function handleKeyboardShortcuts(event) {
    // Don't trigger shortcuts when typing in inputs
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;
    
    // Don't trigger with modifier keys (allow browser shortcuts)
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    
    switch (event.key.toLowerCase()) {
        case 'u':
            event.preventDefault();
            undoLastAction();
            break;
        case 'g':
            event.preventDefault();
            if (gameState.pointInProgress) recordScore();
            break;
        case 't':
            event.preventDefault();
            if (gameState.pointInProgress) recordTurnover();
            break;
        case 'b':
            event.preventDefault();
            if (gameState.pointInProgress) recordBlock();
            break;
        case 'o':
            event.preventDefault();
            if (gameState.pointInProgress) recordOpponentScore();
            break;
        case 'escape':
            closeFieldPlayerPopup();
            break;
    }
}

// Quick action functions for mobile
function quickScore() {
    if (!gameState.selectedThrower || !gameState.selectedReceiver) {
        vibrate();
        showToast('Select thrower then receiver first!', 'error');
        return;
    }
    
    const thrower = gameState.selectedThrower;
    const receiver = gameState.selectedReceiver;
    const hockeyAssister = gameState.previousThrower;
    
    // Save state for undo
    saveActionState('score', { thrower, receiver, hockeyAssister });
    
    // Update game stats
    gameState.playerStats[thrower].assists++;
    gameState.playerStats[receiver].goals++;
    gameState.teamStats.score++;
    
    // Update season/tournament stats
    updateAggregateStats(thrower, 'assists');
    updateAggregateStats(receiver, 'goals');
    
    // Hockey assist (the throw before the goal)
    if (hockeyAssister && hockeyAssister !== thrower && hockeyAssister !== receiver) {
        gameState.playerStats[hockeyAssister].hockeyAssists++;
        updateAggregateStats(hockeyAssister, 'hockeyAssists');
        logAction(`🎉 GOAL! ${hockeyAssister} → ${thrower} → ${receiver}`, 'score');
    } else {
        logAction(`🎉 GOAL! ${thrower} → ${receiver}`, 'score');
    }
    
    // Reset previous thrower after score
    gameState.previousThrower = null;
    
    clearPlayerSelection();
    updateAllDisplays();
    vibrate([50, 30, 50]);
}

function recordBlock() {
    // Quick-action block: open player selection popup centered on screen
    showBlockPlayerPopup(50, 50);
}

function quickTurnover() {
    // Save state for undo
    saveActionState('turnover', {});
    
    gameState.teamStats.turnovers++;
    
    // If thrower selected, assign turnover to them
    if (gameState.selectedThrower) {
        gameState.playerStats[gameState.selectedThrower].turnovers++;
        updateAggregateStats(gameState.selectedThrower, 'turnovers');
        logAction(`❌ Turnover by ${gameState.selectedThrower}`, 'turnover');
    } else {
        logAction('❌ Team turnover', 'turnover');
    }
    
    clearPlayerSelection();
    updateAllDisplays();
    vibrate();
}

function quickTurnoverGained() {
    // Save state for undo
    saveActionState('turnover-gained', {});
    
    gameState.teamStats.turnoversGained++;
    logAction('✅ Turnover gained!', 'turnover-gained');
    
    clearPlayerSelection();
    updateAllDisplays();
    vibrate([30, 20, 30]);
}

function saveActionState(type, data) {
    gameState.actionHistory.push({
        type,
        data,
        timestamp: Date.now(),
        previousState: JSON.parse(JSON.stringify({
            playerStats: gameState.playerStats,
            teamStats: gameState.teamStats
        }))
    });
    
    // Keep only last N undo states
    if (gameState.actionHistory.length > GAME_CONSTANTS.MAX_UNDO_HISTORY) {
        gameState.actionHistory.shift();
    }
}

function undoLastAction() {
    if (gameState.actionHistory.length === 0) {
        showToast('Nothing to undo', 'error');
        return;
    }
    
    const lastAction = gameState.actionHistory.pop();
    
    // Restore previous state
    gameState.playerStats = lastAction.previousState.playerStats;
    gameState.teamStats = lastAction.previousState.teamStats;
    
    logAction(`↩️ Undid: ${lastAction.type}`, 'system');
    updateAllDisplays();
    vibrate();
}

function togglePeriod() {
    const maxPeriods = gameState.periodType === 'quarter' ? 4 : 2;
    gameState.currentPeriod = (gameState.currentPeriod % maxPeriods) + 1;
    updatePeriodDisplay();
    logAction(`📍 ${gameState.periodType === 'quarter' ? 'Quarter' : 'Half'} ${gameState.currentPeriod}`, 'system');
    showToast(`${gameState.periodType === 'quarter' ? 'Quarter' : 'Half'} ${gameState.currentPeriod}`);
    hapticFeedback('halfTime');
    saveToStorage();
}

function updatePeriodDisplay() {
    const periodLabel = document.getElementById('period-label');
    const periodValue = document.getElementById('period-value');
    
    if (periodLabel) {
        periodLabel.textContent = gameState.periodType === 'quarter' ? 'Qtr' : 'Half';
    }
    if (periodValue) {
        periodValue.textContent = gameState.currentPeriod;
    }
}

function toggleGameTimer() {
    if (gameState.gameTimerRunning) {
        stopGameTimer();
    } else {
        startGameTimer();
    }
}

function startGameTimer() {
    if (gameState.gameTimerRunning) return;
    
    gameState.gameTimerRunning = true;
    gameState.gameTimerInterval = setInterval(() => {
        gameState.gameTimerSeconds++;
        updateGameTimerDisplay();
    }, 1000);
    
    showToast('Timer started');
    updateGameTimerDisplay();
}

function stopGameTimer() {
    if (!gameState.gameTimerRunning) return;
    
    gameState.gameTimerRunning = false;
    if (gameState.gameTimerInterval) {
        clearInterval(gameState.gameTimerInterval);
        gameState.gameTimerInterval = null;
    }
    
    showToast('Timer paused');
    updateGameTimerDisplay();
}

function resetGameTimer() {
    stopGameTimer();
    gameState.gameTimerSeconds = 0;
    updateGameTimerDisplay();
    showToast('Timer reset');
}

function updateGameTimerDisplay() {
    const timerEl = document.getElementById('game-timer');
    if (!timerEl) return;

    const minutes = Math.floor(gameState.gameTimerSeconds / 60);
    const seconds = gameState.gameTimerSeconds % 60;
    const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    timerEl.textContent = timeStr;

    // Visual indicator when running
    if (gameState.gameTimerRunning) {
        timerEl.classList.add('animate-pulse');
    } else {
        timerEl.classList.remove('animate-pulse');
    }

    // Update accessible label on the timer button
    const timerBtn = document.getElementById('game-timer-btn');
    if (timerBtn) {
        const state = gameState.gameTimerRunning ? 'running' : 'paused';
        const action = gameState.gameTimerRunning ? 'pause' : 'start';
        timerBtn.setAttribute('aria-label', `Game timer ${state} at ${timeStr} - click to ${action}`);
    }
}

function updateUndoButton() {
    const label = document.getElementById('undo-label');
    if (!label) return;
    const count = gameState.actionHistory ? gameState.actionHistory.length : 0;
    label.textContent = count > 0 ? `Undo (${count})` : 'Undo';
}

function updateAllDisplays() {
    updateStatsDisplay();
    updatePlayerList();
    updateQuickPlayerSelect();
    updateScoreDisplay();
    updateLeaderboard();
    updateTournamentStatus();
    updateUndoButton();
    saveToStorage();
}

function updateScoreDisplay() {
    const ourScoreEl = document.getElementById('our-score-display') || document.getElementById('our-score');
    const oppScoreEl = document.getElementById('opponent-score-display') || document.getElementById('opponent-score');
    const ourTeamEl = document.getElementById('our-team-label');
    const oppTeamEl = document.getElementById('opponent-team-label');
    
    // Check if scores changed for animation
    const prevOurScore = ourScoreEl ? parseInt(ourScoreEl.textContent) || 0 : 0;
    const prevOppScore = oppScoreEl ? parseInt(oppScoreEl.textContent) || 0 : 0;
    
    if (ourScoreEl) {
        ourScoreEl.textContent = gameState.teamStats.score;
        if (gameState.teamStats.score > prevOurScore) {
            animateScoreChange(ourScoreEl, 'emerald');
        }
    }
    if (oppScoreEl) {
        oppScoreEl.textContent = gameState.teamStats.opponentScore || 0;
        if ((gameState.teamStats.opponentScore || 0) > prevOppScore) {
            animateScoreChange(oppScoreEl, 'red');
        }
    }
    if (ourTeamEl) ourTeamEl.textContent = gameState.currentGame?.ourTeam || 'US';
    if (oppTeamEl) oppTeamEl.textContent = gameState.currentGame?.opponentTeam || 'THEM';
}

function animateScoreChange(element, color) {
    if (!element) return;
    element.style.transform = 'scale(1.3)';
    element.style.transition = 'transform 0.15s ease-out';
    setTimeout(() => {
        element.style.transform = 'scale(1)';
    }, 150);
}

/**
 * Trap keyboard focus within a container element.
 * @param {HTMLElement} container - The modal/dialog element
 * @param {Function} [onEscape] - Optional callback when Escape is pressed
 * @returns {Function} cleanup - Call to remove the listener
 */
function trapFocus(container, onEscape) {
    const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const handler = (e) => {
        if (e.key === 'Escape' && onEscape) {
            e.preventDefault();
            onEscape();
            return;
        }
        if (e.key !== 'Tab') return;
        const focusable = Array.from(container.querySelectorAll(FOCUSABLE)).filter(el => !el.disabled);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
            if (document.activeElement === first) { e.preventDefault(); last.focus(); }
        } else {
            if (document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
    };
    container.addEventListener('keydown', handler);
    // Focus the first focusable element
    const firstFocusable = container.querySelector(FOCUSABLE);
    if (firstFocusable) firstFocusable.focus();
    return () => container.removeEventListener('keydown', handler);
}

function showScoreInputModal(title, currentValue) {
    return new Promise((resolve) => {
        const modalId = 'score-input-modal';
        const titleId = modalId + '-title';
        const overlay = document.createElement('div');
        overlay.id = modalId;
        overlay.className = 'fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', titleId);
        overlay.innerHTML = `
            <div class="bg-slate-900/95 backdrop-blur-xl rounded-2xl border border-white/10 p-6 max-w-sm w-full shadow-2xl">
                <h3 id="${titleId}" class="text-xl font-bold text-white mb-4">${title}</h3>
                <input type="number" id="score-modal-input" min="0" max="999"
                    class="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-center text-2xl font-bold placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 mb-4"
                    value="${currentValue}">
                <div class="flex gap-3">
                    <button id="score-modal-cancel" class="flex-1 py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl transition-all font-medium">
                        Cancel
                    </button>
                    <button id="score-modal-ok" class="flex-1 py-3 bg-cyan-500 hover:bg-cyan-600 text-white rounded-xl transition-all font-medium">
                        OK
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const input = overlay.querySelector('#score-modal-input');
        const cancelBtn = overlay.querySelector('#score-modal-cancel');
        const okBtn = overlay.querySelector('#score-modal-ok');
        const focusable = [input, cancelBtn, okBtn];

        input.focus();
        input.select();

        const cleanup = (value) => {
            overlay.remove();
            resolve(value);
        };

        cancelBtn.onclick = () => cleanup(null);
        okBtn.onclick = () => cleanup(input.value);
        input.onkeydown = (e) => {
            if (e.key === 'Enter') cleanup(input.value);
            if (e.key === 'Escape') cleanup(null);
        };
        overlay.onclick = (e) => {
            if (e.target === overlay) cleanup(null);
        };

        // Focus trap
        overlay.addEventListener('keydown', (e) => {
            if (e.key !== 'Tab') return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (e.shiftKey) {
                if (document.activeElement === first) { e.preventDefault(); last.focus(); }
            } else {
                if (document.activeElement === last) { e.preventDefault(); first.focus(); }
            }
        });
    });
}

async function adjustOpponentScore() {
    const current = gameState.teamStats.opponentScore || 0;
    const newScore = await showScoreInputModal('Opponent Score', current);
    if (newScore !== null && !isNaN(newScore)) {
        gameState.teamStats.opponentScore = parseInt(newScore);
        updateScoreDisplay();
        saveToStorage();
        logAction(`Opponent score adjusted to ${newScore}`, 'system');
    }
}

async function adjustOurScore() {
    const current = gameState.teamStats.score || 0;
    const newScore = await showScoreInputModal('Our Score', current);
    if (newScore !== null && !isNaN(newScore)) {
        gameState.teamStats.score = parseInt(newScore);
        updateScoreDisplay();
        saveToStorage();
        logAction(`Our score adjusted to ${newScore}`, 'system');
    }
}

// Quick player selection - only shows on-field players during a point
function updateQuickPlayerSelect() {
    const container = document.getElementById('quick-player-select');
    if (!container) return;
    
    container.innerHTML = '';
    
    // During a point, ONLY show the 7 on-field players
    // Otherwise show present players for general selection
    let playersToShow;
    if (gameState.pointInProgress && gameState.onFieldPlayers.length === 7) {
        playersToShow = gameState.onFieldPlayers;
    } else if (gameState.onFieldPlayers.length === 7) {
        // Line is set but point not started yet - still show only on-field
        playersToShow = gameState.onFieldPlayers;
    } else {
        playersToShow = getPresentPlayers();
    }

    // Smart ordering: most recently active players first
    if (_recentFieldPlayers.length > 0) {
        playersToShow = sortPlayersByRecency(playersToShow);
    }

    playersToShow.forEach(player => {
        const position = getPlayerPosition(player);
        const posAbbrev = position === 'Hybrid' ? 'HY' : (position ? position.substring(0, 1).toUpperCase() : '');
        const avatar = playerAvatars[player] || { type: 'initials', color: getRandomAvatarColor(player) };
        const initials = getPlayerInitials(player);
        const avatarColor = avatar.color || getRandomAvatarColor(player);
        
        const btn = document.createElement('button');
        btn.className = 'player-quick-btn px-3 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2';
        btn.innerHTML = `
            <div class="w-7 h-7 ${avatarColor} rounded-full flex items-center justify-center text-white font-bold text-xs flex-shrink-0">${escapeHtml(initials)}</div>
            <div class="flex flex-col items-start">
                <span class="leading-tight">${escapeHtml(player.split(' ')[0])}</span>
                ${position ? `<span class="text-[10px] opacity-60 leading-tight">${escapeHtml(posAbbrev)}</span>` : ''}
            </div>
        `;
        btn.dataset.player = player;
        
        // Highlight if selected
        if (player === gameState.selectedThrower) {
            btn.className += ' bg-blue-500/30 text-white ring-2 ring-blue-400 shadow-lg shadow-blue-500/20';
        } else if (player === gameState.selectedReceiver) {
            btn.className += ' bg-emerald-500/30 text-white ring-2 ring-emerald-400 shadow-lg shadow-emerald-500/20';
        } else {
            btn.className += ' bg-white/10 text-white hover:bg-white/20 hover:scale-105';
        }
        
        btn.addEventListener('click', () => selectQuickPlayer(player));
        container.appendChild(btn);
    });
}

function selectQuickPlayer(player) {
    if (!gameState.selectedThrower) {
        // Track previous thrower for hockey assists before setting new one
        gameState.previousThrower = gameState.lastCompletedThrower || null;
        gameState.selectedThrower = player;
        updateSelectionStatus();
        hapticFeedback('select');
        playSound('tap');
    } else if (!gameState.selectedReceiver && player !== gameState.selectedThrower) {
        gameState.selectedReceiver = player;
        // Save thrower as last completed for next hockey assist
        gameState.lastCompletedThrower = gameState.selectedThrower;
        updateSelectionStatus();
        hapticFeedback('success');
        playSound('tap');
    } else {
        // After a completed pass OR clicking a new player:
        // Set clicked player as new thrower
        gameState.previousThrower = gameState.lastCompletedThrower || null;
        gameState.selectedThrower = player;
        gameState.selectedReceiver = null;
        updateSelectionStatus();
        hapticFeedback('select');
    }
    
    updateQuickPlayerSelect();
    updateOnFieldDisplay(); // Update to show current thrower
}

// After recording a throw, auto-set receiver as next thrower
function autoAdvanceThrower() {
    if (gameState.selectedReceiver) {
        gameState.previousThrower = gameState.lastCompletedThrower;
        gameState.lastCompletedThrower = gameState.selectedThrower;
        gameState.selectedThrower = gameState.selectedReceiver;
        gameState.selectedReceiver = null;
        updateSelectionStatus();
        updateQuickPlayerSelect();
    }
}

function updateSelectionStatus() {
    const statusEl = document.getElementById('selection-status');
    const statusLandscape = document.getElementById('selection-status-landscape');
    let text = '';
    if (gameState.selectedThrower && gameState.selectedReceiver) {
        text = `${gameState.selectedThrower} → ${gameState.selectedReceiver}`;
    } else if (gameState.selectedThrower) {
        text = `Thrower: ${gameState.selectedThrower}`;
    }
    if (statusEl) statusEl.textContent = text;
    if (statusLandscape) statusLandscape.textContent = text;
}

function clearPlayerSelection() {
    gameState.selectedThrower = null;
    gameState.selectedReceiver = null;
    const statusEl = document.getElementById('selection-status');
    const statusLandscape = document.getElementById('selection-status-landscape');
    if (statusEl) statusEl.textContent = '';
    if (statusLandscape) statusLandscape.textContent = '';
    updateQuickPlayerSelect();
}

// Haptic feedback with patterns
function vibrate(pattern = 30, type = null) {
    if (!appSettings.hapticEnabled) return;
    if ('vibrate' in navigator) {
        // Use predefined pattern if type is specified
        if (type && HAPTIC_PATTERNS[type]) {
            navigator.vibrate(HAPTIC_PATTERNS[type]);
        } else {
            navigator.vibrate(pattern);
        }
    }
}

function hapticFeedback(type) {
    if (!appSettings.hapticEnabled) return;
    if ('vibrate' in navigator && HAPTIC_PATTERNS[type]) {
        navigator.vibrate(HAPTIC_PATTERNS[type]);
    }
}

// Toast notifications
function showToast(message, durationOrType = 2000, type = 'info') {
    // Support showToast(msg, duration), showToast(msg, type), or showToast(msg, duration, type)
    let duration;
    if (typeof durationOrType === 'string') {
        type = durationOrType;
        duration = type === 'error' ? 4000 : 2000;
    } else {
        duration = durationOrType;
    }

    // Remove existing toast
    const existing = document.querySelector('.toast-notification');
    if (existing) existing.remove();

    const config = {
        success: { bg: 'bg-emerald-800 border border-emerald-600/40', icon: '&#x2713;', iconClass: 'text-emerald-300' },
        error:   { bg: 'bg-red-900 border border-red-600/40',         icon: '&#x2717;', iconClass: 'text-red-300' },
        info:    { bg: 'bg-gray-800 border border-white/10',          icon: '&#x2139;', iconClass: 'text-cyan-300' },
    };
    const c = config[type] || config.info;

    const toast = document.createElement('div');
    toast.className = `toast-notification fixed bottom-20 left-1/2 transform -translate-x-1/2 ${c.bg} text-white px-5 py-3 rounded-xl shadow-lg z-50 animate-fadeIn flex items-center gap-3`;
    toast.setAttribute('role', 'status');
    toast.innerHTML = `<span class="${c.iconClass} text-lg font-bold leading-none">${c.icon}</span><span>${message}</span>`;

    const container = document.getElementById('toast-container');
    if (container) {
        container.appendChild(toast);
    } else {
        document.body.appendChild(toast);
    }

    setTimeout(() => {
        toast.classList.add('animate-fadeOut');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// ==================== PLAYER SORTING ====================

function loadPlayerSortMode() {
    try {
        const saved = localStorage.getItem(PLAYER_SORT_KEY);
        if (saved) _playerSortMode = saved;
    } catch (e) { /* ignore */ }
}

function setPlayerSortMode(mode) {
    _playerSortMode = mode;
    try { localStorage.setItem(PLAYER_SORT_KEY, mode); } catch (e) { /* ignore */ }
    updateLineSelectionGrid();
    updateSortButtons();
}

function getPlayerImpactData() {
    const impact = {};
    for (const point of _pointHistory) {
        for (const player of point.line) {
            if (!impact[player]) impact[player] = { pointsPlayed: 0, pointsScored: 0, pointsAgainst: 0 };
            impact[player].pointsPlayed++;
            if (point.result === 'scored') impact[player].pointsScored++;
            if (point.result === 'scored-against') impact[player].pointsAgainst++;
        }
    }
    return impact;
}

function sortPlayers(players) {
    const sorted = [...players];
    const impact = getPlayerImpactData();

    switch (_playerSortMode) {
        case 'alphabetical':
            sorted.sort((a, b) => a.localeCompare(b));
            break;

        case 'playing-time':
            sorted.sort((a, b) => {
                const aTime = (impact[a]?.pointsPlayed || 0);
                const bTime = (impact[b]?.pointsPlayed || 0);
                return bTime - aTime || a.localeCompare(b);
            });
            break;

        case 'plus-minus':
            sorted.sort((a, b) => {
                const aPM = (impact[a]?.pointsScored || 0) - (impact[a]?.pointsAgainst || 0);
                const bPM = (impact[b]?.pointsScored || 0) - (impact[b]?.pointsAgainst || 0);
                return bPM - aPM || a.localeCompare(b);
            });
            break;

        case 'predictive': {
            const scores = {};
            sorted.forEach(player => {
                const stats = gameState.playerStats[player] || {};
                const imp = impact[player] || { pointsPlayed: 0, pointsScored: 0, pointsAgainst: 0 };
                const pp = Math.max(1, imp.pointsPlayed);
                const plusMinus = (imp.pointsScored - imp.pointsAgainst) / pp;
                const offContrib = ((stats.goals || 0) + (stats.assists || 0) + (stats.hockeyAssists || 0)) / pp;
                const defContrib = (stats.blocks || 0) / pp;
                const completionPct = (stats.catches || 0) / Math.max(1, (stats.catches || 0) + (stats.turnovers || 0));
                const turnoverPenalty = (stats.turnovers || 0) / pp;
                // Weighted composite: +/- most important, then offense, defense, completion, minus turnovers
                scores[player] = (plusMinus * 3) + (offContrib * 2) + (defContrib * 1.5) + (completionPct * 1) - (turnoverPenalty * 1.5);
            });
            sorted.sort((a, b) => (scores[b] || 0) - (scores[a] || 0) || a.localeCompare(b));
            break;
        }

        case 'position': {
            const posOrder = { 'Handler': 0, 'Hybrid': 1, 'Cutter': 2 };
            sorted.sort((a, b) => {
                const aPos = posOrder[getPlayerPosition(a)] ?? 3;
                const bPos = posOrder[getPlayerPosition(b)] ?? 3;
                return aPos - bPos || a.localeCompare(b);
            });
            break;
        }

        default:
            sorted.sort((a, b) => a.localeCompare(b));
    }
    return sorted;
}

function updateSortButtons() {
    const container = document.getElementById('sort-buttons');
    if (!container) return;
    container.querySelectorAll('.sort-pill').forEach(btn => {
        const mode = btn.dataset.sort;
        if (mode === _playerSortMode) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ==================== LINE SELECTION FUNCTIONS ====================

function updateLineSelectionGrid() {
    const container = document.getElementById('line-player-grid') || document.getElementById('line-selection-grid');
    if (!container) return;
    
    container.innerHTML = '';
    
    // Only show present players (or all if no attendance taken), sorted
    const playersToShow = sortPlayers(getPresentPlayers());
    const impactData = getPlayerImpactData();

    playersToShow.forEach(player => {
        const btn = document.createElement('button');
        const isOnField = gameState.onFieldPlayers.includes(player);
        const position = getPlayerPosition(player);
        const posLabel = position === 'Hybrid' ? 'HY' : (position ? position.substring(0, 1).toUpperCase() : '');

        btn.className = `line-select-btn px-3 py-3 rounded-xl text-sm font-medium transition-all active:scale-95 ${
            isOnField
                ? 'bg-cyan-500 text-white ring-2 ring-cyan-300'
                : 'bg-white/10 text-white hover:bg-white/20'
        }`;
        btn.setAttribute('role', 'switch');
        btn.setAttribute('aria-checked', String(isOnField));
        btn.setAttribute('aria-label', `${player} - ${isOnField ? 'on field' : 'on bench'}`);
        const checkmark = isOnField ? '<span class="opacity-80">✓</span> ' : '';
        const posHtml = posLabel ? `<span class="text-xs opacity-60">${escapeHtml(posLabel)}</span> ` : '';

        // Stat annotation based on sort mode
        let statHtml = '';
        const imp = impactData[player];
        const stats = gameState.playerStats[player] || {};
        if (_playerSortMode === 'playing-time' && imp) {
            statHtml = `<span class="sort-stat">${imp.pointsPlayed}pt</span>`;
        } else if (_playerSortMode === 'plus-minus' && imp) {
            const pm = imp.pointsScored - imp.pointsAgainst;
            const cls = pm > 0 ? 'plus-minus-pos' : pm < 0 ? 'plus-minus-neg' : 'plus-minus-zero';
            statHtml = `<span class="sort-stat ${cls}">${pm > 0 ? '+' : ''}${pm}</span>`;
        } else if (_playerSortMode === 'predictive' && imp) {
            const pp = Math.max(1, imp.pointsPlayed);
            const pm = (imp.pointsScored - imp.pointsAgainst) / pp;
            const off = ((stats.goals || 0) + (stats.assists || 0) + (stats.hockeyAssists || 0)) / pp;
            const def = (stats.blocks || 0) / pp;
            const comp = (stats.catches || 0) / Math.max(1, (stats.catches || 0) + (stats.turnovers || 0));
            const to = (stats.turnovers || 0) / pp;
            const score = (pm * 3) + (off * 2) + (def * 1.5) + (comp * 1) - (to * 1.5);
            const cls = score > 0 ? 'plus-minus-pos' : score < 0 ? 'plus-minus-neg' : 'plus-minus-zero';
            statHtml = `<span class="sort-stat ${cls}">${score.toFixed(1)}</span>`;
        }

        btn.innerHTML = `${checkmark}${posHtml}${escapeHtml(player)}${statHtml}`;
        btn.addEventListener('click', () => togglePlayerOnField(player));
        container.appendChild(btn);
    });
    
    // Update count
    const countEl = document.getElementById('line-count');
    if (countEl) {
        countEl.textContent = gameState.onFieldPlayers.length;
        countEl.className = `text-2xl font-bold ${gameState.onFieldPlayers.length === 7 ? 'text-emerald-400' : 'text-cyan-400'}`;
    }
    
    // Update start button
    const startBtn = document.getElementById('start-point-btn');
    if (startBtn) {
        if (gameState.onFieldPlayers.length === 7) {
            startBtn.disabled = false;
            startBtn.textContent = '▶️ Start Point';
            startBtn.className = 'flex-1 bg-emerald-500 hover:bg-emerald-400 text-white py-3 rounded-xl font-semibold transition-all';
        } else {
            startBtn.disabled = true;
            startBtn.textContent = `Select ${7 - gameState.onFieldPlayers.length} more`;
            startBtn.className = 'flex-1 bg-emerald-500/30 text-emerald-300 py-3 rounded-xl font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed';
        }
    }
}

function togglePlayerOnField(player) {
    const index = gameState.onFieldPlayers.indexOf(player);
    
    if (index > -1) {
        // Remove from field
        gameState.onFieldPlayers.splice(index, 1);
    } else if (gameState.onFieldPlayers.length < 7) {
        // Add to field
        gameState.onFieldPlayers.push(player);
    } else {
        showToast('Already have 7 players selected', 'error');
        vibrate();
        return;
    }
    
    vibrate(20);
    updateLineSelectionGrid();
    saveToStorage();
}

function clearLineSelection() {
    gameState.onFieldPlayers = [];
    updateLineSelectionGrid();
    saveToStorage();
}

// Track last used line for "Same Line" / "Last Line" functionality
// Using window. to make it accessible from test page
window.lastUsedLine = window.lastUsedLine || [];

function selectLastLine() {
    if (window.lastUsedLine.length === 0) {
        showToast('No previous line to select', 'error');
        return;
    }
    
    // Filter to only include players who are present
    const availablePlayers = window.lastUsedLine.filter(p => gameState.presentPlayers.includes(p));
    
    if (availablePlayers.length === 0) {
        showToast('Previous players not available', 'error');
        return;
    }
    
    gameState.onFieldPlayers = [...availablePlayers];
    updateLineSelectionGrid();
    
    if (availablePlayers.length < 7) {
        showToast(`${availablePlayers.length}/7 from last line available`);
    } else {
        showToast('Last line selected');
    }
    
    vibrate(30);
    saveToStorage();
}

function startPoint() {
    if (gameState.onFieldPlayers.length !== 7) {
        showToast('Select exactly 7 players', 'error');
        return;
    }
    
    // Save current line for "Last Line" button
    window.lastUsedLine = [...gameState.onFieldPlayers];
    
    gameState.pointInProgress = true;

    // Track this point's line for live analysis
    _pointHistory.push({
        pointNum: gameState.pointNumber,
        line: [...gameState.onFieldPlayers],
        startType: startingPossession,
        result: null
    });

    // Fade out line selection, fade in field
    const lineSel = document.getElementById('line-selection');
    const fieldSec = document.getElementById('field-section');
    if (lineSel) lineSel.classList.add('section-hidden');
    setTimeout(() => {
        if (fieldSec) fieldSec.classList.remove('section-hidden');
    }, 260);
    
    // Reset disc position for new point
    gameState.discPosition = null;
    gameState.currentThrower = null;
    gameState.pointThrows = 0;
    gameState.possessionThrows = 0;
    
    // Update on-field display and quick select to only show on-field players
    updateOnFieldDisplay();
    updateQuickPlayerSelect();
    clearPlayerSelection();
    
    // Ensure disc marker exists (don't remove, just hide)
    const discMarker = document.getElementById('disc-marker');
    if (discMarker) {
        discMarker.classList.add('hidden');
    }
    
    // Based on starting possession, either show thrower popup or go to defense mode
    if (startingPossession === 'offense') {
        showInitialThrowerPopup();
        logAction(`Point started (Offense) with: ${gameState.onFieldPlayers.join(', ')}`, 'system');
    } else {
        // Defense - opponent has disc, no thrower popup needed
        logAction(`Point started (Defense) with: ${gameState.onFieldPlayers.join(', ')}`, 'system');
        showToast('Defense - tap field when we get the disc');
    }
    
    saveToStorage();
    vibrate([30, 20, 30]);
    
    // Re-initialize icons
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

function showInitialThrowerPopup() {
    const existing = document.getElementById('initial-thrower-popup');
    if (existing) existing.remove();
    
    const popup = document.createElement('div');
    popup.id = 'initial-thrower-popup';
    popup.className = 'fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-modal', 'true');
    popup.setAttribute('aria-label', 'Select initial thrower');

    popup.innerHTML = `
        <div class="bg-slate-800 rounded-2xl p-6 w-[calc(100%-2rem)] sm:max-w-md border border-white/10">
            <h3 class="text-xl font-bold text-white mb-2">Who has the disc?</h3>
            <p class="text-gray-400 text-sm mb-4">Tap the field where they are, then select them</p>

            <div class="grid grid-cols-2 gap-2 mb-4">
                ${gameState.onFieldPlayers.map(player => {
                    const position = getPlayerPosition(player);
                    const posAbbrev = position === 'Hybrid' ? 'HY' : (position ? position.substring(0, 1).toUpperCase() : '');
                    const posColor = getPositionColor(position);
                    return `
                        <button onclick="selectInitialThrower('${escapeHtml(player).replace(/'/g, "\\'")}')"
                            class="p-3 rounded-xl bg-white/10 hover:bg-cyan-500/30 text-white text-sm font-medium transition-all flex items-center gap-2 border border-white/10 hover:border-cyan-500/50">
                            ${position ? `<span class="text-xs px-1.5 py-0.5 rounded ${posColor}">${escapeHtml(posAbbrev)}</span>` : ''}
                            <span class="truncate">${escapeHtml(player)}</span>
                        </button>
                    `;
                }).join('')}
            </div>

            <p class="text-xs text-gray-500 text-center">After selecting, tap the field to set their position</p>
        </div>
    `;

    document.body.appendChild(popup);
    trapFocus(popup);
}

function selectInitialThrower(player) {
    const popup = document.getElementById('initial-thrower-popup');
    if (popup) popup.remove();
    
    gameState.currentThrower = player;
    gameState.selectedThrower = player;
    updateSelectionStatus();
    updateQuickPlayerSelect();
    
    showToast(`${player} has the disc - tap field to set position`);

    // Now wait for field tap to set position
    waitingForInitialPosition = true;

    // Show persistent instruction overlay
    showFieldInstruction('Tap field to set disc position');
}

let waitingForInitialPosition = false;
let startingPossession = 'offense'; // 'offense' or 'defense'
let fieldInstructionTimer = null;

function showFieldInstruction(text, autoHideMs) {
    const el = document.getElementById('tap-instruction');
    if (!el) return;
    const inner = el.querySelector('div');
    if (inner) inner.textContent = text;
    el.classList.remove('hidden');
    if (fieldInstructionTimer) clearTimeout(fieldInstructionTimer);
    if (autoHideMs) {
        fieldInstructionTimer = setTimeout(() => el.classList.add('hidden'), autoHideMs);
    }
}

function hideFieldInstruction() {
    const el = document.getElementById('tap-instruction');
    if (el) el.classList.add('hidden');
    if (fieldInstructionTimer) { clearTimeout(fieldInstructionTimer); fieldInstructionTimer = null; }
}

function setStartingPossession(possession) {
    startingPossession = possession;
    
    const offenseBtn = document.getElementById('offense-btn');
    const defenseBtn = document.getElementById('defense-btn');
    
    if (possession === 'offense') {
        if (offenseBtn) {
            offenseBtn.classList.remove('bg-white/5', 'text-gray-400', 'border-white/10');
            offenseBtn.classList.add('bg-emerald-500/20', 'text-emerald-400', 'border-emerald-500/30');
        }
        if (defenseBtn) {
            defenseBtn.classList.remove('bg-amber-500/20', 'text-amber-400', 'border-amber-500/30');
            defenseBtn.classList.add('bg-white/5', 'text-gray-400', 'border-white/10');
        }
    } else {
        if (defenseBtn) {
            defenseBtn.classList.remove('bg-white/5', 'text-gray-400', 'border-white/10');
            defenseBtn.classList.add('bg-amber-500/20', 'text-amber-400', 'border-amber-500/30');
        }
        if (offenseBtn) {
            offenseBtn.classList.remove('bg-emerald-500/20', 'text-emerald-400', 'border-emerald-500/30');
            offenseBtn.classList.add('bg-white/5', 'text-gray-400', 'border-white/10');
        }
    }
    
    showToast(possession === 'offense' ? 'We have the disc' : 'They have the disc');
}

function endPoint() {
    gameState.pointInProgress = false;
    clearPlayerSelection();
    
    // Show line selection, keep field visible but disabled
    document.getElementById('line-selection').classList.remove('section-hidden');
    
    // Keep previous line as default for quick re-selection
    updateLineSelectionGrid();
    
    logAction('Point ended - set line for next point', 'system');
    saveToStorage();
    vibrate();
    
    // Re-initialize icons
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

function updateOnFieldDisplay() {
    const container = document.getElementById('on-field-display');
    if (!container) return;
    
    if (gameState.onFieldPlayers.length === 0) {
        container.innerHTML = '<span class="text-gray-500 text-sm">No players on field</span>';
        return;
    }
    
    const isCompact = window.innerWidth < 640;
    container.innerHTML = `
        <div class="flex items-center gap-1.5 sm:gap-2 w-full">
            <span class="text-[10px] sm:text-xs text-gray-400 font-medium flex-shrink-0">${isCompact ? 'ON:' : 'ON FIELD:'}</span>
            <div class="flex flex-wrap gap-1 sm:gap-1.5 flex-1">
                ${gameState.onFieldPlayers.map(player => {
                    const avatar = playerAvatars[player] || { type: 'initials', color: getRandomAvatarColor(player) };
                    const initials = getPlayerInitials(player);
                    const avatarColor = avatar.color || getRandomAvatarColor(player);
                    const isThrower = player === gameState.currentThrower;
                    const displayName = isCompact ? player.split(' ')[0].substring(0, 4) : player.split(' ')[0];

                    return `
                        <div class="flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2 py-0.5 sm:py-1 ${isThrower ? 'bg-blue-500/30 ring-1 ring-blue-400' : 'bg-white/5'} rounded-lg">
                            <div class="w-4 h-4 sm:w-5 sm:h-5 ${avatarColor} rounded-full flex items-center justify-center text-white font-bold text-[8px] sm:text-[10px]">${escapeHtml(initials)}</div>
                            <span class="text-[11px] sm:text-xs ${isThrower ? 'text-blue-300 font-semibold' : 'text-gray-300'}">${escapeHtml(displayName)}</span>
                            ${isThrower ? '<span class="text-[10px] text-blue-400">🎯</span>' : ''}
                        </div>
                    `;
                }).join('')}
            </div>
            <span class="text-[10px] sm:text-xs text-gray-500">${gameState.onFieldPlayers.length}/7</span>
        </div>
    `;
}

// ==================== INJURY SUBSTITUTION ====================

function initiateInjurySub() {
    if (!gameState.pointInProgress) {
        showToast('Start a point first', 'error');
        return;
    }
    
    // Show injury sub modal
    showInjurySubModal();
}

function showInjurySubModal() {
    // Remove existing modal
    const existing = document.getElementById('injury-modal');
    if (existing) existing.remove();
    
    const modal = document.createElement('div');
    modal.id = 'injury-modal';
    modal.className = 'fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Injury substitution');

    modal.innerHTML = `
        <div class="bg-slate-800 rounded-2xl p-6 w-[calc(100%-2rem)] sm:max-w-md border border-white/10">
            <h3 class="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <span class="text-orange-400">🏥</span> Injury Substitution
            </h3>
            
            <div class="mb-4">
                <p class="text-gray-400 text-sm mb-3">Select player leaving (injured):</p>
                <div id="injury-out-grid" class="flex flex-wrap gap-2">
                    ${gameState.onFieldPlayers.map(p => `
                        <button onclick="selectInjuredPlayer('${p}')" class="injury-out-btn px-4 py-2 bg-red-500/20 hover:bg-red-500/40 text-red-400 rounded-lg text-sm font-medium transition-all border border-red-500/30">
                            ${p}
                        </button>
                    `).join('')}
                </div>
            </div>
            
            <div id="injury-sub-in" class="mb-4 hidden">
                <p class="text-gray-400 text-sm mb-3">Select substitute coming in:</p>
                <div id="injury-in-grid" class="flex flex-wrap gap-2">
                    ${gameState.players.filter(p => !gameState.onFieldPlayers.includes(p)).map(p => `
                        <button onclick="selectSubPlayer('${p}')" class="injury-in-btn px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/40 text-emerald-400 rounded-lg text-sm font-medium transition-all border border-emerald-500/30">
                            ${p}
                        </button>
                    `).join('')}
                </div>
            </div>
            
            <div class="flex gap-3">
                <button onclick="closeInjuryModal()" class="flex-1 bg-gray-500/30 text-gray-300 py-3 rounded-xl font-semibold transition-all hover:bg-gray-500/50">
                    Cancel
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    trapFocus(modal, closeInjuryModal);

    // Close on background click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeInjuryModal();
    });
}

function selectInjuredPlayer(player) {
    gameState.injurySub = player;
    
    // Highlight selected
    document.querySelectorAll('.injury-out-btn').forEach(btn => {
        btn.classList.remove('ring-2', 'ring-red-400');
        if (btn.textContent.trim() === player) {
            btn.classList.add('ring-2', 'ring-red-400');
        }
    });
    
    // Show sub-in section
    document.getElementById('injury-sub-in').classList.remove('hidden');
    vibrate(20);
}

function selectSubPlayer(player) {
    if (!gameState.injurySub) {
        showToast('Select injured player first', 'error');
        return;
    }
    
    const injuredPlayer = gameState.injurySub;
    
    // Make the substitution
    const index = gameState.onFieldPlayers.indexOf(injuredPlayer);
    if (index > -1) {
        gameState.onFieldPlayers[index] = player;
    }
    
    logAction(`🏥 Injury sub: ${injuredPlayer} ➜ ${player}`, 'system');
    
    // Clear selection state
    gameState.injurySub = null;
    
    // Update displays
    updateOnFieldDisplay();
    updateQuickPlayerSelect();
    clearPlayerSelection();
    
    closeInjuryModal();
    saveToStorage();
    vibrate([30, 20, 30]);
}

function closeInjuryModal() {
    const modal = document.getElementById('injury-modal');
    if (modal) modal.remove();
    gameState.injurySub = null;
}

// ==================== LEADERBOARD FUNCTIONS ====================

let currentLeaderboardTab = 'career';
let currentSortField = 'points';

function switchLeaderboardTab(tab) {
    currentLeaderboardTab = tab;
    
    // Update tab styles
    document.querySelectorAll('.leaderboard-tab').forEach(t => {
        t.classList.remove('bg-emerald-500/20', 'text-emerald-400', 'border', 'border-emerald-500/30');
        t.classList.add('bg-white/5', 'text-gray-400');
    });
    
    const activeTab = document.getElementById(`tab-${tab}`);
    if (activeTab) {
        activeTab.classList.remove('bg-white/5', 'text-gray-400');
        activeTab.classList.add('bg-emerald-500/20', 'text-emerald-400', 'border', 'border-emerald-500/30');
    }
    
    // Show tournament selector when on tournament tab
    if (tab === 'tournament') {
        updateTournamentSelector();
    } else {
        // Hide tournament selector on other tabs
        const selectorContainer = document.getElementById('tournament-selector');
        if (selectorContainer) selectorContainer.classList.add('hidden');
    }
    
    updateLeaderboard();
}

function sortLeaderboard(field) {
    currentSortField = field;

    // Update sort button styles and aria-pressed
    document.querySelectorAll('.sort-btn').forEach(btn => {
        btn.classList.remove('bg-cyan-500/20', 'text-cyan-400', 'border', 'border-cyan-500/30');
        btn.classList.add('bg-white/5', 'text-gray-400');
        btn.setAttribute('aria-pressed', 'false');
    });

    const activeBtn = document.querySelector(`[data-sort="${field}"]`);
    if (activeBtn) {
        activeBtn.classList.remove('bg-white/5', 'text-gray-400');
        activeBtn.classList.add('bg-cyan-500/20', 'text-cyan-400', 'border', 'border-cyan-500/30');
        activeBtn.setAttribute('aria-pressed', 'true');
    }

    updateLeaderboard();
}

function updateLeaderboard() {
    const container = document.getElementById('leaderboard-content');
    if (!container) return;
    
    let statsData = {};
    
    // Get the right data source based on tab
    if (currentLeaderboardTab === 'game') {
        statsData = gameState.playerStats;
    } else if (currentLeaderboardTab === 'tournament') {
        // Check if viewing a past tournament or current
        if (selectedTournamentId && selectedTournamentId !== 'current') {
            const pastTournament = pastTournaments.find(t => t.id === selectedTournamentId);
            statsData = pastTournament ? pastTournament.players : {};
        } else {
            statsData = tournamentStats.players;
        }
    } else if (currentLeaderboardTab === 'season') {
        statsData = seasonStats.players;
    } else if (currentLeaderboardTab === 'career') {
        statsData = careerStats.players;
    }
    
    // Update tournament selector visibility
    updateTournamentSelector();
    
    // Convert to array and add calculated fields
    const players = Object.entries(statsData).map(([name, stats]) => ({
        name,
        goals: stats.goals || 0,
        assists: stats.assists || 0,
        hockeyAssists: stats.hockeyAssists || 0,
        blocks: stats.blocks || 0,
        turnovers: stats.turnovers || 0,
        points: (stats.goals || 0) + (stats.assists || 0),
        yardsThrown: stats.yardsThrown || 0,
        yardsCaught: stats.yardsCaught || 0,
        totalYards: (stats.yardsThrown || 0) + (stats.yardsCaught || 0),
        throws: stats.throws || 0,
        catches: stats.catches || 0,
        gamesPlayed: stats.gamesPlayed || 0
    }));
    
    // Sort by selected field (descending, except turnovers ascending is better)
    players.sort((a, b) => {
        if (currentSortField === 'turnovers') {
            return a[currentSortField] - b[currentSortField]; // Lower is better
        }
        return b[currentSortField] - a[currentSortField];
    });
    
    // Render leaderboard
    if (players.length === 0) {
        container.innerHTML = `
            <div class="text-center text-gray-400 py-8">
                <p>No stats recorded yet</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = players.map((player, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
        const showGames = currentLeaderboardTab === 'career';
        const isYardSort = ['yardsThrown', 'yardsCaught', 'totalYards'].includes(currentSortField);
        const isThrowCatchSort = ['throws', 'catches'].includes(currentSortField);
        const position = getPlayerPosition(player.name);
        const posColor = getPositionColor(position);
        
        return `
            <div class="leaderboard-row flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-all">
                <div class="w-8 text-center text-lg">${medal}</div>
                <div class="flex-1 flex items-center gap-2">
                    <span class="font-medium text-white">${escapeHtml(player.name)}</span>
                    ${position ? `<span class="text-xs px-1.5 py-0.5 rounded ${posColor}">${escapeHtml(position)}</span>` : ''}
                </div>
                <div class="flex gap-2 text-sm">
                    ${showGames ? `
                    <div class="text-center text-gray-400">
                        <div class="font-semibold">${player.gamesPlayed}</div>
                        <div class="text-xs opacity-60">GP</div>
                    </div>
                    ` : ''}
                    <div class="text-center ${currentSortField === 'goals' ? 'text-emerald-400 font-bold' : 'text-gray-400'}">
                        <div class="font-semibold">${player.goals}</div>
                        <div class="text-xs opacity-60">G</div>
                    </div>
                    <div class="text-center ${currentSortField === 'assists' ? 'text-cyan-400 font-bold' : 'text-gray-400'}">
                        <div class="font-semibold">${player.assists}</div>
                        <div class="text-xs opacity-60">A</div>
                    </div>
                    <div class="text-center ${currentSortField === 'hockeyAssists' ? 'text-pink-400 font-bold' : 'text-gray-400'}">
                        <div class="font-semibold">${player.hockeyAssists}</div>
                        <div class="text-xs opacity-60">HA</div>
                    </div>
                    <div class="text-center ${currentSortField === 'blocks' ? 'text-purple-400 font-bold' : 'text-gray-400'}">
                        <div class="font-semibold">${player.blocks}</div>
                        <div class="text-xs opacity-60">D</div>
                    </div>
                    <div class="text-center ${currentSortField === 'turnovers' ? 'text-red-400 font-bold' : 'text-gray-400'}">
                        <div class="font-semibold">${player.turnovers}</div>
                        <div class="text-xs opacity-60">T</div>
                    </div>
                    ${isYardSort ? `
                    <div class="text-center ${currentSortField === 'yardsThrown' ? 'text-blue-400 font-bold' : 'text-gray-400'}">
                        <div class="font-semibold">${Math.round(player.yardsThrown)}</div>
                        <div class="text-xs opacity-60">YT</div>
                    </div>
                    <div class="text-center ${currentSortField === 'yardsCaught' ? 'text-amber-400 font-bold' : 'text-gray-400'}">
                        <div class="font-semibold">${Math.round(player.yardsCaught)}</div>
                        <div class="text-xs opacity-60">YC</div>
                    </div>
                    <div class="text-center ${currentSortField === 'totalYards' ? 'text-orange-400 font-bold' : 'text-gray-400'}">
                        <div class="font-semibold">${Math.round(player.totalYards)}</div>
                        <div class="text-xs opacity-60">Tot</div>
                    </div>
                    ` : `
                    <div class="text-center text-gray-400">
                        <div class="font-semibold">${Math.round(player.totalYards)}</div>
                        <div class="text-xs opacity-60">Yds</div>
                    </div>
                    `}
                    ${isThrowCatchSort ? `
                    <div class="text-center ${currentSortField === 'throws' ? 'text-indigo-400 font-bold' : 'text-gray-400'}">
                        <div class="font-semibold">${player.throws}</div>
                        <div class="text-xs opacity-60">Thr</div>
                    </div>
                    <div class="text-center ${currentSortField === 'catches' ? 'text-lime-400 font-bold' : 'text-gray-400'}">
                        <div class="font-semibold">${player.catches}</div>
                        <div class="text-xs opacity-60">Cat</div>
                    </div>
                    ` : ''}
                    <div class="text-center ${currentSortField === 'points' ? 'text-yellow-400 font-bold' : 'text-gray-400'}">
                        <div class="font-semibold">${player.points}</div>
                        <div class="text-xs opacity-60">Pts</div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function updateTournamentStatus() {
    const statusEl = document.getElementById('tournament-status');
    if (!statusEl) return;
    
    if (tournamentStats.isActive) {
        statusEl.textContent = `${tournamentStats.name} (${tournamentStats.totalGames} games)`;
        statusEl.className = 'text-purple-400 text-sm font-medium';
    } else {
        statusEl.textContent = 'No active tournament';
        statusEl.className = 'text-gray-400 text-sm';
    }
}

function updateTournamentSelector() {
    const selectorContainer = document.getElementById('tournament-selector-container');
    if (!selectorContainer) return;
    
    // Only show selector when on tournament tab
    if (currentLeaderboardTab !== 'tournament') {
        selectorContainer.classList.add('hidden');
        return;
    }
    
    selectorContainer.classList.remove('hidden');
    
    // Build options: current tournament + past tournaments
    const hasCurrent = tournamentStats.isActive || Object.keys(tournamentStats.players).length > 0;
    const hasPast = pastTournaments.length > 0;
    
    if (!hasCurrent && !hasPast) {
        selectorContainer.innerHTML = `<div class="text-gray-400 text-sm mb-2">No tournaments yet</div>`;
        return;
    }
    
    let options = '';
    
    if (hasCurrent) {
        const currentName = tournamentStats.isActive ? tournamentStats.name : 'Current Tournament';
        options += `<option value="current" ${!selectedTournamentId || selectedTournamentId === 'current' ? 'selected' : ''}>${currentName}${tournamentStats.isActive ? ' (Active)' : ''}</option>`;
    }
    
    pastTournaments.forEach(t => {
        const date = new Date(t.startDate).toLocaleDateString();
        options += `<option value="${t.id}" ${selectedTournamentId === t.id ? 'selected' : ''}>${t.name} (${date}) - ${t.wins}W-${t.losses}L</option>`;
    });
    
    selectorContainer.innerHTML = `
        <select id="tournament-select" onchange="selectTournament(this.value)" 
            class="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500 mb-2">
            ${options}
        </select>
    `;
}

function selectTournament(tournamentId) {
    selectedTournamentId = tournamentId;
    updateLeaderboard();
}

// ==================== TOURNAMENT MANAGEMENT ====================

function showTournamentModal() {
    const existing = document.getElementById('tournament-modal');
    if (existing) existing.remove();
    
    const modal = document.createElement('div');
    modal.id = 'tournament-modal';
    modal.className = 'fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4';
    
    modal.innerHTML = `
        <div class="bg-slate-800 rounded-2xl p-6 w-[calc(100%-2rem)] sm:max-w-md border border-white/10">
            <h3 class="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <span class="text-purple-400">🏆</span> Tournament Management
            </h3>
            
            ${tournamentStats.isActive ? `
                <div class="mb-4 p-4 bg-purple-500/10 rounded-xl border border-purple-500/20">
                    <div class="text-purple-400 font-semibold mb-2">${tournamentStats.name}</div>
                    <div class="text-sm text-gray-400">
                        <div>Games: ${tournamentStats.totalGames}</div>
                        <div>Record: ${tournamentStats.wins}W - ${tournamentStats.losses}L</div>
                        <div>Started: ${new Date(tournamentStats.startDate).toLocaleDateString()}</div>
                    </div>
                </div>
                <button onclick="endTournament()" class="w-full bg-red-500/20 hover:bg-red-500/40 text-red-400 py-3 rounded-xl font-semibold transition-all border border-red-500/30 mb-3">
                    End Tournament
                </button>
            ` : `
                <div class="mb-4">
                    <label class="text-sm text-gray-400 mb-2 block">Tournament Name</label>
                    <input type="text" id="tournament-name-input" class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50" placeholder="e.g., Spring Sectionals 2026">
                </div>
                <button onclick="startTournament()" class="w-full bg-purple-500 hover:bg-purple-400 text-white py-3 rounded-xl font-semibold transition-all mb-3">
                    Start Tournament
                </button>
            `}
            
            <div class="border-t border-white/10 pt-4 mt-2">
                <h4 class="text-sm font-semibold text-gray-300 mb-3">Season Stats</h4>
                <div class="text-sm text-gray-400 mb-3">
                    <div>Total Games: ${seasonStats.totalGames}</div>
                    <div>Record: ${seasonStats.wins}W - ${seasonStats.losses}L</div>
                </div>
                <button onclick="confirmResetSeasonStats()" class="w-full bg-gray-500/20 hover:bg-gray-500/40 text-gray-400 py-2 rounded-xl text-sm font-medium transition-all">
                    Reset Season Stats
                </button>
            </div>
            
            <button onclick="closeTournamentModal()" class="w-full mt-4 bg-white/10 hover:bg-white/20 text-white py-3 rounded-xl font-semibold transition-all">
                Close
            </button>
        </div>
    `;
    
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeTournamentModal();
    });
}

function closeTournamentModal() {
    const modal = document.getElementById('tournament-modal');
    if (modal) modal.remove();
}

function startTournament() {
    const nameInput = document.getElementById('tournament-name-input');
    const name = nameInput?.value.trim() || `Tournament ${new Date().toLocaleDateString()}`;
    
    tournamentStats = {
        name,
        isActive: true,
        startDate: new Date().toISOString(),
        players: {},
        games: [],
        totalGames: 0,
        wins: 0,
        losses: 0
    };
    
    saveTournamentStats();
    updateTournamentStatus();
    updateLeaderboard();
    closeTournamentModal();
    
    showToast(`Started: ${name}`);
    logAction(`Tournament started: ${name}`, 'system');
}

function endTournament() {
    const name = tournamentStats.name;
    
    // Archive tournament with full player stats to pastTournaments
    if (tournamentStats.totalGames > 0) {
        const archivedTournament = {
            id: 'tournament-' + Date.now(),
            name: tournamentStats.name,
            startDate: tournamentStats.startDate,
            endDate: new Date().toISOString(),
            players: JSON.parse(JSON.stringify(tournamentStats.players)),
            games: [...tournamentStats.games],
            totalGames: tournamentStats.totalGames,
            wins: tournamentStats.wins,
            losses: tournamentStats.losses
        };
        pastTournaments.unshift(archivedTournament);
        savePastTournaments();
        
        // Also add summary to season stats
        seasonStats.games.push({
            type: 'tournament',
            name: tournamentStats.name,
            games: tournamentStats.totalGames,
            wins: tournamentStats.wins,
            losses: tournamentStats.losses,
            date: tournamentStats.startDate
        });
    }
    
    // Reset tournament
    tournamentStats = {
        name: '',
        isActive: false,
        startDate: null,
        players: {},
        games: [],
        totalGames: 0,
        wins: 0,
        losses: 0
    };
    
    saveTournamentStats();
    saveSeasonStats();
    updateTournamentStatus();
    updateLeaderboard();
    updateTournamentSelector();
    closeTournamentModal();
    
    showToast(`Tournament ended: ${name}`);
    logAction(`Tournament ended: ${name}`, 'system');
}

function confirmResetSeasonStats() {
    showConfirmDialog(
        'Reset Season Stats?',
        'This will reset ALL season stats. This cannot be undone.',
        () => {
            seasonStats = {
                players: {},
                games: [],
                totalGames: 0,
                wins: 0,
                losses: 0
            };
            saveSeasonStats();
            updateLeaderboard();
            closeTournamentModal();
            showToast('Season stats reset', 'success');
        }
    );
}

// ==================== GAME HISTORY FUNCTIONS ====================

function confirmEndGame() {
    const ourScore = gameState.teamStats.score;
    const theirScore = gameState.teamStats.opponentScore || 0;
    const result = ourScore > theirScore ? 'WIN' : ourScore < theirScore ? 'LOSS' : 'TIE';

    showConfirmDialog(
        'End Game?',
        `Final Score: ${ourScore} - ${theirScore} (${result}). This will save the game to history.`,
        endGame
    );
}

function endGameWithConfirm() {
    showConfirmDialog(
        'End Game?',
        'This will finalize the game and save all stats. You cannot undo this action.',
        endGame
    );
}

function endGame() {
    const ourScore = gameState.teamStats.score;
    const theirScore = gameState.teamStats.opponentScore || 0;
    const isWin = ourScore > theirScore;
    
    // Play sound effect
    playSound(isWin ? 'score' : 'turnover');
    
    // Create game record
    const gameRecord = {
        id: Date.now().toString(),
        date: gameState.currentGame.date || new Date().toISOString().split('T')[0],
        ourTeam: gameState.currentGame.ourTeam || 'Our Team',
        opponentTeam: gameState.currentGame.opponentTeam || 'Opponent',
        ourScore: ourScore,
        opponentScore: theirScore,
        result: ourScore > theirScore ? 'W' : ourScore < theirScore ? 'L' : 'T',
        playerStats: JSON.parse(JSON.stringify(gameState.playerStats)),
        teamStats: JSON.parse(JSON.stringify(gameState.teamStats)),
        actions: [...gameState.actions],
        tournament: tournamentStats.isActive ? tournamentStats.name : null
    };
    
    // Add to history
    gameHistory.unshift(gameRecord);
    saveGameHistory();
    
    // Update season stats
    seasonStats.totalGames++;
    if (isWin) seasonStats.wins++;
    else if (ourScore < theirScore) seasonStats.losses++;
    saveSeasonStats();
    
    // Update tournament stats if active
    if (tournamentStats.isActive) {
        tournamentStats.totalGames++;
        if (isWin) tournamentStats.wins++;
        else if (ourScore < theirScore) tournamentStats.losses++;
        tournamentStats.games.push(gameRecord.id);
        saveTournamentStats();
    }
    
    // Update career stats
    careerStats.totalGames++;
    // Update games played for each player who participated
    Object.keys(gameRecord.playerStats).forEach(playerName => {
        if (!careerStats.players[playerName]) {
            careerStats.players[playerName] = {
                goals: 0, assists: 0, hockeyAssists: 0, blocks: 0, turnovers: 0, yardsThrown: 0, yardsCaught: 0,
                throws: 0, catches: 0, gamesPlayed: 0, seasonsPlayed: 0, firstGame: new Date().toISOString()
            };
        }
        careerStats.players[playerName].gamesPlayed = (careerStats.players[playerName].gamesPlayed || 0) + 1;
    });
    saveCareerStats();
    
    // Update active team stats
    if (teamsData.currentTeamId && teamsData.teams[teamsData.currentTeamId]) {
        const team = teamsData.teams[teamsData.currentTeamId];
        
        // Update team career stats
        team.careerStats.totalGames = (team.careerStats.totalGames || 0) + 1;
        Object.entries(gameRecord.playerStats).forEach(([playerName, stats]) => {
            if (!team.careerStats.players[playerName]) {
                team.careerStats.players[playerName] = {
                    goals: 0, assists: 0, hockeyAssists: 0, blocks: 0, turnovers: 0, yardsThrown: 0, yardsCaught: 0,
                    throws: 0, catches: 0, gamesPlayed: 0
                };
            }
            const p = team.careerStats.players[playerName];
            p.goals = (p.goals || 0) + (stats.goals || 0);
            p.assists = (p.assists || 0) + (stats.assists || 0);
            p.hockeyAssists = (p.hockeyAssists || 0) + (stats.hockeyAssists || 0);
            p.blocks = (p.blocks || 0) + (stats.blocks || 0);
            p.turnovers = (p.turnovers || 0) + (stats.turnovers || 0);
            p.yardsThrown = (p.yardsThrown || 0) + (stats.yardsThrown || 0);
            p.yardsCaught = (p.yardsCaught || 0) + (stats.yardsCaught || 0);
            p.gamesPlayed = (p.gamesPlayed || 0) + 1;
        });
        
        // Update team season stats
        team.seasonStats.totalGames = (team.seasonStats.totalGames || 0) + 1;
        if (isWin) team.seasonStats.wins = (team.seasonStats.wins || 0) + 1;
        else if (ourScore < theirScore) team.seasonStats.losses = (team.seasonStats.losses || 0) + 1;
        
        // Add game to team history
        team.gameHistory = team.gameHistory || [];
        team.gameHistory.unshift(gameRecord.id);

        saveTeamsData();
    }

    // Update matchup if this game was part of a tournament or league
    const gameSetup = JSON.parse(localStorage.getItem('ultistats_game_setup') || '{}');
    if (gameSetup.tournamentId && gameSetup.matchupId && gameSetup.matchupType) {
        recordMatchupResult(
            gameSetup.tournamentId,
            gameSetup.matchupId,
            gameSetup.matchupType,
            ourScore,
            theirScore,
            gameRecord.id
        );
    } else if (gameSetup.leagueId && gameSetup.matchupId) {
        recordRegularSeasonResult(
            gameSetup.leagueId,
            gameSetup.matchupId,
            ourScore,
            theirScore,
            gameRecord.id
        );
    }

    // Release screen wake lock
    releaseWakeLock();

    // Reset game state but preserve players/roster
    gameState.currentGame.isActive = false;
    gameState.pointInProgress = false;
    // Reset player stats for next game but keep players
    gameState.players.forEach(player => {
        gameState.playerStats[player] = {
            goals: 0, assists: 0, hockeyAssists: 0, blocks: 0, turnovers: 0, yardsThrown: 0, yardsCaught: 0,
            throws: 0, catches: 0
        };
    });
    gameState.teamStats = { score: 0, opponentScore: 0, turnovers: 0, turnoversGained: 0, totalYardsThrown: 0, totalYardsCaught: 0 };
    gameState.actions = [];
    gameState.actionHistory = [];
    gameState.onFieldPlayers = [];
    gameState.presentPlayers = []; // Reset attendance for next game
    saveToStorage();
    
    // Clear game setup from localStorage
    localStorage.removeItem('ultistats_game_setup');
    
    // Check if we're on the game page - if so, redirect to dashboard
    if (window.isGamePage === true) {
        showToast(`Game saved: ${gameRecord.ourScore}-${gameRecord.opponentScore} ${gameRecord.result}`);
        setTimeout(() => {
            window.location.href = '/dashboard.html';
        }, 1500);
        return;
    }
    
    // Show home screen (for legacy SPA mode)
    const heroEl = document.getElementById('hero');
    const gameSetupEl = document.getElementById('game-setup');
    const gameHistoryEl = document.getElementById('game-history');
    const playerRosterEl = document.getElementById('player-roster');
    const attendanceEl = document.getElementById('attendance-section');
    const lineSelectionEl = document.getElementById('line-selection');
    const fieldSectionEl = document.getElementById('field-section');
    const leaderboardsEl = document.getElementById('leaderboards');
    const statsDashboardEl = document.getElementById('stats-dashboard');
    const recentActionsEl = document.getElementById('recent-actions');
    
    if (heroEl) heroEl.classList.remove('hidden');
    if (gameSetupEl) gameSetupEl.classList.remove('hidden');
    if (gameHistoryEl) gameHistoryEl.classList.remove('hidden');
    if (playerRosterEl) playerRosterEl.classList.add('hidden');
    if (attendanceEl) attendanceEl.classList.add('hidden');
    if (lineSelectionEl) lineSelectionEl.classList.add('hidden');
    if (fieldSectionEl) fieldSectionEl.classList.add('hidden');
    if (leaderboardsEl) leaderboardsEl.classList.add('hidden');
    if (statsDashboardEl) statsDashboardEl.classList.add('hidden');
    if (recentActionsEl) recentActionsEl.classList.add('hidden');
    
    updateGameHistoryDisplay();
    showToast(`Game saved: ${gameRecord.ourScore}-${gameRecord.opponentScore} ${gameRecord.result}`);
    
    // Re-initialize icons
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

function updateGameHistoryDisplay() {
    const container = document.getElementById('game-history-list');
    const countEl = document.getElementById('history-count');
    
    if (!container) return;
    
    if (countEl) {
        countEl.textContent = `${gameHistory.length} game${gameHistory.length !== 1 ? 's' : ''} recorded`;
    }
    
    if (gameHistory.length === 0) {
        container.innerHTML = `
            <div class="text-center text-gray-500 py-8">
                <i data-lucide="inbox" class="w-12 h-12 mx-auto mb-3 opacity-50"></i>
                <p>No games recorded yet</p>
                <p class="text-sm mt-1">Start a game and finish it to see it here</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = gameHistory.map(game => {
        const resultClass = game.result === 'W' ? 'text-emerald-400 bg-emerald-500/20' : 
                           game.result === 'L' ? 'text-red-400 bg-red-500/20' : 
                           'text-gray-400 bg-gray-500/20';
        const resultText = game.result === 'W' ? 'WIN' : game.result === 'L' ? 'LOSS' : 'TIE';
        
        return `
            <div class="game-history-item p-4 rounded-xl bg-white/5 hover:bg-white/10 transition-all cursor-pointer border border-white/5" onclick="showGameDetail('${game.id}')">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <div class="px-2 py-1 rounded-lg text-xs font-bold ${resultClass}">${resultText}</div>
                        <div>
                            <div class="font-semibold text-white">${escapeHtml(game.ourTeam)} vs ${escapeHtml(game.opponentTeam)}</div>
                            <div class="text-sm text-gray-400">${formatGameDate(game.date)}${game.tournament ? ` • ${escapeHtml(game.tournament)}` : ''}</div>
                        </div>
                    </div>
                    <div class="text-right">
                        <div class="text-2xl font-bold text-white">${game.ourScore} - ${game.opponentScore}</div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    // Re-initialize icons
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

function formatGameDate(dateStr) {
    try {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
        return dateStr;
    }
}

function showGameDetail(gameId) {
    const game = gameHistory.find(g => g.id === gameId);
    if (!game) return;
    
    const existing = document.getElementById('game-detail-modal');
    if (existing) existing.remove();
    
    // Calculate top performers
    const playerEntries = Object.entries(game.playerStats);
    const topScorer = playerEntries.sort((a, b) => (b[1].goals || 0) - (a[1].goals || 0))[0];
    const topAssist = playerEntries.sort((a, b) => (b[1].assists || 0) - (a[1].assists || 0))[0];
    
    const modal = document.createElement('div');
    modal.id = 'game-detail-modal';
    modal.className = 'fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto';
    
    modal.innerHTML = `
        <div class="bg-slate-800 rounded-2xl p-6 w-[calc(100%-2rem)] sm:max-w-2xl border border-white/10 my-8">
            <div class="flex items-center justify-between mb-6">
                <div>
                    <h3 class="text-xl font-bold text-white">${escapeHtml(game.ourTeam)} vs ${escapeHtml(game.opponentTeam)}</h3>
                    <p class="text-gray-400 text-sm">${formatGameDate(game.date)}${game.tournament ? ` • ${escapeHtml(game.tournament)}` : ''}</p>
                </div>
                <div class="text-right">
                    <div class="text-3xl font-bold text-white">${game.ourScore} - ${game.opponentScore}</div>
                    <div class="px-3 py-1 rounded-lg text-sm font-bold inline-block ${
                        game.result === 'W' ? 'text-emerald-400 bg-emerald-500/20' : 
                        game.result === 'L' ? 'text-red-400 bg-red-500/20' : 'text-gray-400 bg-gray-500/20'
                    }">${game.result === 'W' ? 'WIN' : game.result === 'L' ? 'LOSS' : 'TIE'}</div>
                </div>
            </div>
            
            ${topScorer || topAssist ? `
            <div class="grid grid-cols-2 gap-3 mb-6">
                ${topScorer ? `
                <div class="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                    <div class="text-xs text-emerald-400 mb-1">Top Scorer</div>
                    <div class="font-semibold text-white">${escapeHtml(topScorer[0])}</div>
                    <div class="text-sm text-gray-400">${topScorer[1].goals || 0} goals</div>
                </div>
                ` : ''}
                ${topAssist ? `
                <div class="p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/20">
                    <div class="text-xs text-cyan-400 mb-1">Top Assists</div>
                    <div class="font-semibold text-white">${escapeHtml(topAssist[0])}</div>
                    <div class="text-sm text-gray-400">${topAssist[1].assists || 0} assists</div>
                </div>
                ` : ''}
            </div>
            ` : ''}
            
            <div class="mb-6">
                <h4 class="text-sm font-semibold text-gray-300 mb-3">Player Stats</h4>
                <div class="space-y-2 max-h-64 overflow-y-auto">
                    ${playerEntries.map(([name, stats]) => `
                        <div class="flex items-center justify-between p-2 rounded-lg bg-white/5">
                            <span class="font-medium text-white">${escapeHtml(name)}</span>
                            <div class="flex gap-3 text-sm text-gray-400">
                                <span title="Goals">${stats.goals || 0}G</span>
                                <span title="Assists">${stats.assists || 0}A</span>
                                <span title="Blocks">${stats.blocks || 0}D</span>
                                <span title="Turnovers">${stats.turnovers || 0}T</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
            
            <div class="mb-6">
                <h4 class="text-sm font-semibold text-gray-300 mb-3">Team Stats</h4>
                <div class="grid grid-cols-3 gap-3 text-center">
                    <div class="p-3 rounded-xl bg-white/5">
                        <div class="text-2xl font-bold text-white">${game.teamStats.turnovers || 0}</div>
                        <div class="text-xs text-gray-400">Turnovers</div>
                    </div>
                    <div class="p-3 rounded-xl bg-white/5">
                        <div class="text-2xl font-bold text-white">${game.teamStats.turnoversGained || 0}</div>
                        <div class="text-xs text-gray-400">D's</div>
                    </div>
                    <div class="p-3 rounded-xl bg-white/5">
                        <div class="text-2xl font-bold text-white">${Math.round(game.teamStats.totalYardsThrown || 0)}</div>
                        <div class="text-xs text-gray-400">Yards</div>
                    </div>
                </div>
            </div>
            
            <div class="flex gap-3">
                <button onclick="closeGameDetailModal()" class="flex-1 bg-white/10 hover:bg-white/20 text-white py-3 rounded-xl font-semibold transition-all">
                    Close
                </button>
                <button onclick="exportGame('${game.id}'); closeGameDetailModal();" class="bg-emerald-500/20 hover:bg-emerald-500/40 text-emerald-400 px-6 py-3 rounded-xl font-semibold transition-all border border-emerald-500/30">
                    Export
                </button>
                <button onclick="deleteGame('${game.id}')" class="bg-red-500/20 hover:bg-red-500/40 text-red-400 px-6 py-3 rounded-xl font-semibold transition-all border border-red-500/30">
                    Delete
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeGameDetailModal();
    });
}

function closeGameDetailModal() {
    const modal = document.getElementById('game-detail-modal');
    if (modal) modal.remove();
}

function deleteGame(gameId) {
    showConfirmDialog(
        'Delete Game?',
        'Delete this game from history? This cannot be undone.',
        () => {
            gameHistory = gameHistory.filter(g => g.id !== gameId);
            saveGameHistory();
            updateGameHistoryDisplay();
            closeGameDetailModal();
            showToast('Game deleted', 'success');
        }
    );
}

// ==================== DATA EXPORT FUNCTIONS ====================

function downloadFile(content, filename, type = 'text/csv') {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function exportPlayerStats(playerName) {
    const seasonData = seasonStats.players[playerName] || {};
    const careerData = careerStats.players[playerName] || {};
    const position = getPlayerPosition(playerName);
    
    // Get all games this player participated in
    const playerGames = gameHistory.filter(g => g.playerStats[playerName]);
    
    const csv = [
        ['Player Stats Export', playerName],
        ['Position', position || 'Not Set'],
        ['Generated', new Date().toLocaleString()],
        [''],
        ['=== CAREER TOTALS ==='],
        ['Stat', 'Value'],
        ['Games Played', careerData.gamesPlayed || 0],
        ['Goals', careerData.goals || 0],
        ['Assists', careerData.assists || 0],
        ['Hockey Assists', careerData.hockeyAssists || 0],
        ['Blocks', careerData.blocks || 0],
        ['Turnovers', careerData.turnovers || 0],
        ['Points (G+A)', (careerData.goals || 0) + (careerData.assists || 0)],
        ['Yards Thrown', Math.round(careerData.yardsThrown || 0)],
        ['Yards Caught', Math.round(careerData.yardsCaught || 0)],
        ['Total Yards', Math.round((careerData.yardsThrown || 0) + (careerData.yardsCaught || 0))],
        ['First Game', careerData.firstGame ? new Date(careerData.firstGame).toLocaleDateString() : 'N/A'],
        [''],
        ['=== CURRENT SEASON ==='],
        ['Goals', seasonData.goals || 0],
        ['Assists', seasonData.assists || 0],
        ['Hockey Assists', seasonData.hockeyAssists || 0],
        ['Blocks', seasonData.blocks || 0],
        ['Turnovers', seasonData.turnovers || 0],
        ['Yards Thrown', Math.round(seasonData.yardsThrown || 0)],
        ['Yards Caught', Math.round(seasonData.yardsCaught || 0)],
        [''],
        ['=== GAME HISTORY ==='],
        ['Date', 'Opponent', 'Result', 'Score', 'Goals', 'Assists', 'Blocks', 'Turnovers', 'Yards Thrown', 'Yards Caught']
    ];
    
    playerGames.forEach(game => {
        const stats = game.playerStats[playerName];
        csv.push([
            game.date,
            game.opponentTeam,
            game.result,
            `${game.ourScore}-${game.opponentScore}`,
            stats.goals || 0,
            stats.assists || 0,
            stats.blocks || 0,
            stats.turnovers || 0,
            Math.round(stats.yardsThrown || 0),
            Math.round(stats.yardsCaught || 0)
        ]);
    });
    
    const csvContent = csv.map(row => row.join(',')).join('\n');
    downloadFile(csvContent, `${playerName.replace(/\s+/g, '_')}_stats.csv`);
    showToast(`Exported ${playerName}'s stats`);
}

function exportGame(gameId) {
    const game = gameHistory.find(g => g.id === gameId);
    if (!game) return;
    
    const csv = [
        ['Game Export'],
        ['Date', game.date],
        ['Teams', `${game.ourTeam} vs ${game.opponentTeam}`],
        ['Score', `${game.ourScore} - ${game.opponentScore}`],
        ['Result', game.result === 'W' ? 'Win' : game.result === 'L' ? 'Loss' : 'Tie'],
        ['Tournament', game.tournament || 'N/A'],
        [''],
        ['=== TEAM STATS ==='],
        ['Turnovers', game.teamStats.turnovers || 0],
        ['Ds/Turnovers Gained', game.teamStats.turnoversGained || 0],
        ['Total Yards', Math.round(game.teamStats.totalYardsThrown || 0)],
        [''],
        ['=== PLAYER STATS ==='],
        ['Player', 'Position', 'Goals', 'Assists', 'Blocks', 'Turnovers', 'Yards Thrown', 'Yards Caught']
    ];
    
    Object.entries(game.playerStats).forEach(([player, stats]) => {
        const pos = getPlayerPosition(player);
        csv.push([
            player,
            pos,
            stats.goals || 0,
            stats.assists || 0,
            stats.blocks || 0,
            stats.turnovers || 0,
            Math.round(stats.yardsThrown || 0),
            Math.round(stats.yardsCaught || 0)
        ]);
    });
    
    const filename = `game_${game.ourTeam}_vs_${game.opponentTeam}_${game.date}.csv`.replace(/\s+/g, '_');
    const csvContent = csv.map(row => row.join(',')).join('\n');
    downloadFile(csvContent, filename);
    showToast('Game exported');
}

function exportTournament() {
    if (!tournamentStats.isActive && tournamentStats.totalGames === 0) {
        showToast('No tournament data to export', 'error');
        return;
    }
    
    const csv = [
        ['Tournament Export'],
        ['Name', tournamentStats.name || 'Tournament'],
        ['Start Date', tournamentStats.startDate ? new Date(tournamentStats.startDate).toLocaleDateString() : 'N/A'],
        ['Games Played', tournamentStats.totalGames],
        ['Record', `${tournamentStats.wins}W - ${tournamentStats.losses}L`],
        [''],
        ['=== PLAYER STATS ==='],
        ['Player', 'Goals', 'Assists', 'Blocks', 'Turnovers', 'Points']
    ];
    
    Object.entries(tournamentStats.players)
        .sort((a, b) => ((b[1].goals || 0) + (b[1].assists || 0)) - ((a[1].goals || 0) + (a[1].assists || 0)))
        .forEach(([name, stats]) => {
            csv.push([
                name,
                stats.goals || 0,
                stats.assists || 0,
                stats.blocks || 0,
                stats.turnovers || 0,
                (stats.goals || 0) + (stats.assists || 0)
            ]);
        });
    
    // Add games from this tournament
    csv.push(['']);
    csv.push(['=== GAMES ===']);
    csv.push(['Date', 'Opponent', 'Result', 'Score']);
    
    tournamentStats.games.forEach(gameId => {
        const game = gameHistory.find(g => g.id === gameId);
        if (game) {
            csv.push([game.date, game.opponentTeam, game.result, `${game.ourScore}-${game.opponentScore}`]);
        }
    });
    
    const filename = `tournament_${(tournamentStats.name || 'export').replace(/\s+/g, '_')}.csv`;
    const csvContent = csv.map(row => row.join(',')).join('\n');
    downloadFile(csvContent, filename);
    showToast('Tournament exported');
}

function exportSeason() {
    const csv = [
        ['Season Stats Export'],
        ['Generated', new Date().toLocaleString()],
        ['Total Games', seasonStats.totalGames],
        ['Record', `${seasonStats.wins}W - ${seasonStats.losses}L`],
        ['Win %', seasonStats.totalGames > 0 ? Math.round((seasonStats.wins / seasonStats.totalGames) * 100) + '%' : 'N/A'],
        [''],
        ['=== PLAYER SEASON TOTALS ==='],
        ['Player', 'Goals', 'Assists', 'Blocks', 'Turnovers', 'Points', 'Games']
    ];
    
    // Count games per player
    const gamesPerPlayer = {};
    gameHistory.forEach(game => {
        Object.keys(game.playerStats).forEach(name => {
            gamesPerPlayer[name] = (gamesPerPlayer[name] || 0) + 1;
        });
    });
    
    Object.entries(seasonStats.players)
        .sort((a, b) => ((b[1].goals || 0) + (b[1].assists || 0)) - ((a[1].goals || 0) + (a[1].assists || 0)))
        .forEach(([name, stats]) => {
            csv.push([
                name,
                stats.goals || 0,
                stats.assists || 0,
                stats.blocks || 0,
                stats.turnovers || 0,
                (stats.goals || 0) + (stats.assists || 0),
                gamesPerPlayer[name] || 0
            ]);
        });
    
    csv.push(['']);
    csv.push(['=== ALL GAMES ===']);
    csv.push(['Date', 'Opponent', 'Result', 'Score', 'Tournament']);
    
    gameHistory.forEach(game => {
        csv.push([
            game.date,
            game.opponentTeam,
            game.result,
            `${game.ourScore}-${game.opponentScore}`,
            game.tournament || ''
        ]);
    });
    
    const csvContent = csv.map(row => row.join(',')).join('\n');
    downloadFile(csvContent, `season_stats_${new Date().toISOString().split('T')[0]}.csv`);
    showToast('Season stats exported');
}

function exportCareer() {
    const csv = [
        ['Career Stats Export'],
        ['Generated', new Date().toLocaleString()],
        ['Tracking Since', careerStats.startDate ? new Date(careerStats.startDate).toLocaleDateString() : 'N/A'],
        ['Total Games', careerStats.totalGames],
        [''],
        ['=== CAREER TOTALS ==='],
        ['Player', 'Games', 'Goals', 'Assists', 'Hockey Assists', 'Blocks', 'Turnovers', 'Points', 'Yards Thrown', 'Yards Caught', 'Total Yards', 'G/Game', 'A/Game', 'First Game']
    ];
    
    Object.entries(careerStats.players)
        .sort((a, b) => ((b[1].goals || 0) + (b[1].assists || 0)) - ((a[1].goals || 0) + (a[1].assists || 0)))
        .forEach(([name, stats]) => {
            const games = stats.gamesPlayed || 1;
            const yardsThrown = stats.yardsThrown || 0;
            const yardsCaught = stats.yardsCaught || 0;
            csv.push([
                name,
                stats.gamesPlayed || 0,
                stats.goals || 0,
                stats.assists || 0,
                stats.hockeyAssists || 0,
                stats.blocks || 0,
                stats.turnovers || 0,
                (stats.goals || 0) + (stats.assists || 0),
                Math.round(yardsThrown),
                Math.round(yardsCaught),
                Math.round(yardsThrown + yardsCaught),
                ((stats.goals || 0) / games).toFixed(2),
                ((stats.assists || 0) / games).toFixed(2),
                stats.firstGame ? new Date(stats.firstGame).toLocaleDateString() : 'N/A'
            ]);
        });
    
    const csvContent = csv.map(row => row.join(',')).join('\n');
    downloadFile(csvContent, `career_stats_${new Date().toISOString().split('T')[0]}.csv`);
    showToast('Career stats exported');
}

function exportAllData() {
    const allData = {
        exportDate: new Date().toISOString(),
        roster: savedRoster,
        careerStats: careerStats,
        seasonStats: seasonStats,
        tournamentStats: tournamentStats,
        gameHistory: gameHistory,
        currentGame: gameState.currentGame.isActive ? {
            game: gameState.currentGame,
            playerStats: gameState.playerStats,
            teamStats: gameState.teamStats
        } : null
    };
    
    const jsonContent = JSON.stringify(allData, null, 2);
    downloadFile(jsonContent, `ultistats_backup_${new Date().toISOString().split('T')[0]}.json`, 'application/json');
    showToast('Full backup exported');
}

function showExportModal() {
    const existing = document.getElementById('export-modal');
    if (existing) existing.remove();
    
    const modal = document.createElement('div');
    modal.id = 'export-modal';
    modal.className = 'fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4';
    
    modal.innerHTML = `
        <div class="bg-slate-800 rounded-2xl p-6 w-[calc(100%-2rem)] sm:max-w-md border border-white/10">
            <h3 class="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <span>📊</span> Export Data
            </h3>
            
            <div class="space-y-3 mb-6">
                <button onclick="exportCareer(); closeExportModal();" class="w-full flex items-center gap-3 p-4 rounded-xl bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/30 text-left transition-all">
                    <span class="text-2xl">🌟</span>
                    <div>
                        <div class="font-semibold text-white">Career Stats</div>
                        <div class="text-sm text-gray-400">${careerStats.totalGames} total games, ${Object.keys(careerStats.players).length} players</div>
                    </div>
                </button>
                
                <button onclick="exportSeason(); closeExportModal();" class="w-full flex items-center gap-3 p-4 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-left transition-all">
                    <span class="text-2xl">📅</span>
                    <div>
                        <div class="font-semibold text-white">Season Stats</div>
                        <div class="text-sm text-gray-400">${seasonStats.totalGames} games, ${Object.keys(seasonStats.players).length} players</div>
                    </div>
                </button>
                
                <button onclick="exportTournament(); closeExportModal();" class="w-full flex items-center gap-3 p-4 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/30 text-left transition-all ${!tournamentStats.isActive && tournamentStats.totalGames === 0 ? 'opacity-50' : ''}">
                    <span class="text-2xl">🏆</span>
                    <div>
                        <div class="font-semibold text-white">Tournament</div>
                        <div class="text-sm text-gray-400">${tournamentStats.isActive ? tournamentStats.name : 'No active tournament'}</div>
                    </div>
                </button>
                
                <button onclick="showPlayerExportList();" class="w-full flex items-center gap-3 p-4 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/30 text-left transition-all">
                    <span class="text-2xl">👤</span>
                    <div>
                        <div class="font-semibold text-white">Individual Player</div>
                        <div class="text-sm text-gray-400">Export specific player's stats</div>
                    </div>
                </button>
                
                <button onclick="exportAllData(); closeExportModal();" class="w-full flex items-center gap-3 p-4 rounded-xl bg-yellow-500/20 hover:bg-yellow-500/30 border border-yellow-500/30 text-left transition-all">
                    <span class="text-2xl">💾</span>
                    <div>
                        <div class="font-semibold text-white">Full Backup (JSON)</div>
                        <div class="text-sm text-gray-400">All data for backup/restore</div>
                    </div>
                </button>
            </div>
            
            <button onclick="closeExportModal()" class="w-full bg-white/10 hover:bg-white/20 text-white py-3 rounded-xl font-semibold transition-all">
                Cancel
            </button>
        </div>
    `;
    
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeExportModal();
    });
    window._exportFocusCleanup = trapFocus(modal, closeExportModal);
}

function showPlayerExportList() {
    const container = document.querySelector('#export-modal > div');
    if (!container) return;
    
    const players = Object.keys(seasonStats.players);
    
    container.innerHTML = `
        <h3 class="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <span>👤</span> Select Player to Export
        </h3>
        
        <div class="space-y-2 max-h-80 overflow-y-auto mb-4">
            ${players.length === 0 ? '<p class="text-gray-400 text-center py-4">No players with stats</p>' : ''}
            ${players.map(name => {
                const stats = seasonStats.players[name];
                return `
                    <button onclick="exportPlayerStats('${name}'); closeExportModal();" class="w-full flex items-center justify-between p-3 rounded-xl bg-white/5 hover:bg-white/10 text-left transition-all">
                        <span class="font-medium text-white">${name}</span>
                        <span class="text-sm text-gray-400">${(stats.goals || 0) + (stats.assists || 0)} pts</span>
                    </button>
                `;
            }).join('')}
        </div>
        
        <button onclick="showExportModal()" class="w-full bg-white/10 hover:bg-white/20 text-white py-3 rounded-xl font-semibold transition-all">
            Back
        </button>
    `;
}

function closeExportModal() {
    if (window._exportFocusCleanup) { window._exportFocusCleanup(); window._exportFocusCleanup = null; }
    const modal = document.getElementById('export-modal');
    if (modal) modal.remove();
}

// ==================== DASHBOARD DISPLAY ====================

function updateDashboardTournaments() {
    const container = document.getElementById('dashboard-tournaments-list');
    if (!container) return;

    const tournaments = Object.values(tournamentsData.tournaments);

    if (tournaments.length === 0) {
        container.innerHTML = '<p class="text-gray-500 text-sm py-4 text-center">No tournaments yet. Import one from USAU or create your own.</p>';
        return;
    }

    const formatLabels = {
        'pool-play': 'Pool Play',
        'bracket': 'Bracket',
        'pool-to-bracket': 'Pool → Bracket'
    };

    // Sort by most recent first
    const sorted = tournaments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    container.innerHTML = sorted.slice(0, 3).map(tournament => {
        const teamCount = getEntityTeamCount(tournament.id);
        const completedMatchups = [...(tournament.poolMatchups || []), ...(tournament.bracketMatchups || [])].filter(m => m.status === 'completed').length;
        const totalMatchups = (tournament.poolMatchups || []).length + (tournament.bracketMatchups || []).length;
        const sharedBadge = tournament.sharedTournamentId ? '<span class="text-xs bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded-full ml-2">Shared</span>' : '';
        const leagueBadge = tournament.leagueId ? '<span class="text-xs bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded-full ml-2">In League</span>' : '';

        let dateStr = '';
        if (tournament.startDate) {
            const start = new Date(tournament.startDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            if (tournament.endDate && tournament.endDate !== tournament.startDate) {
                const end = new Date(tournament.endDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                dateStr = ` | ${start} - ${end}`;
            } else {
                dateStr = ` | ${start}`;
            }
        }

        return `
            <a href="tournament.html?id=${tournament.id}" class="flex items-center justify-between p-3 bg-white/5 hover:bg-white/10 rounded-xl border border-white/10 transition-all">
                <div>
                    <h3 class="font-medium text-white">${escapeHtml(tournament.name)}${sharedBadge}${leagueBadge}</h3>
                    <p class="text-xs text-gray-400">${teamCount} teams | ${formatLabels[tournament.format] || tournament.format}${dateStr}</p>
                </div>
                <div class="text-right">
                    <span class="text-sm text-emerald-400">${completedMatchups}/${totalMatchups}</span>
                    <p class="text-xs text-gray-500">games played</p>
                </div>
            </a>
        `;
    }).join('');

    if (tournaments.length > 3) {
        container.innerHTML += `
            <a href="tournament.html" class="block text-center text-sm text-cyan-400 hover:text-cyan-300 py-2">
                View all ${tournaments.length} tournaments →
            </a>
        `;
    }
}

function updateDashboardLeagues() {
    const container = document.getElementById('dashboard-leagues-list');
    if (!container) return;

    const leagues = Object.values(leaguesData.leagues);

    if (leagues.length === 0) {
        container.innerHTML = '<p class="text-gray-500 text-sm py-4 text-center">No leagues yet. Create one to organize your season.</p>';
        return;
    }

    container.innerHTML = leagues.slice(0, 3).map(league => {
        const teamCount = (league.teamIds || []).length;
        const tournamentCount = (league.tournamentIds || []).length;
        const completedMatchups = (league.regularSeasonMatchups || []).filter(m => m.status === 'completed').length;
        const totalMatchups = (league.regularSeasonMatchups || []).length;

        return `
            <a href="league.html" class="flex items-center justify-between p-3 bg-white/5 hover:bg-white/10 rounded-xl border border-white/10 transition-all">
                <div>
                    <h3 class="font-medium text-white">${escapeHtml(league.name)}</h3>
                    <p class="text-xs text-gray-400">${teamCount} teams | ${tournamentCount} tournaments${league.season ? ' | ' + escapeHtml(league.season) : ''}</p>
                </div>
                <div class="text-right">
                    <span class="text-sm text-emerald-400">${completedMatchups}/${totalMatchups}</span>
                    <p class="text-xs text-gray-500">reg. season</p>
                </div>
            </a>
        `;
    }).join('');

    if (leagues.length > 3) {
        container.innerHTML += `
            <a href="league.html" class="block text-center text-sm text-amber-400 hover:text-amber-300 py-2">
                View all ${leagues.length} leagues →
            </a>
        `;
    }
}

// Update shared tournaments display on dashboard
async function updateSharedTournaments() {
    const section = document.getElementById('shared-tournaments-section');
    const container = document.getElementById('shared-tournaments-list');

    if (!section || !container) return;

    // Only show if user is logged in
    if (!currentUser) {
        section.classList.add('hidden');
        return;
    }

    try {
        const tournaments = await getLinkedSharedTournaments();

        if (tournaments.length === 0) {
            section.classList.add('hidden');
            return;
        }

        section.classList.remove('hidden');

        // Fetch linked teams for each tournament to show connected coaches
        const tournamentsWithLinks = await Promise.all(tournaments.map(async (tournament) => {
            try {
                const response = await fetch(`${API_BASE_URL}/api/shared-tournaments/${tournament.id}`, {
                    credentials: 'include'
                });
                if (response.ok) {
                    const data = await response.json();
                    return { ...tournament, linkedTeams: data.linkedTeams || [] };
                }
            } catch (e) {
                console.error('Error fetching linked teams:', e);
            }
            return { ...tournament, linkedTeams: [] };
        }));

        container.innerHTML = tournamentsWithLinks.map(tournament => {
            const poolCount = tournament.pools ? Object.keys(tournament.pools).length : 0;
            const teamCount = tournament.teams ? tournament.teams.length : 0;
            const linkedCoachCount = tournament.linkedTeams?.length || 0;
            const lastUpdated = tournament.last_updated
                ? new Date(tournament.last_updated).toLocaleDateString()
                : 'Never';

            // Build linked coaches preview (show first 2)
            const linkedTeamsPreview = (tournament.linkedTeams || []).slice(0, 3).map(link =>
                `<span class="text-emerald-400">${escapeHtml(link.team_name)}</span>`
            ).join(', ');
            const moreCount = linkedCoachCount > 3 ? linkedCoachCount - 3 : 0;

            return `
                <div class="p-4 bg-white/5 hover:bg-white/10 rounded-xl border border-white/10 transition-all">
                    <div class="flex items-center justify-between">
                        <div class="flex-1">
                            <div class="flex items-center gap-2">
                                <h3 class="font-medium text-white">${escapeHtml(tournament.name)}</h3>
                                <span class="text-xs px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded-full">Shared</span>
                            </div>
                            <p class="text-xs text-gray-400 mt-1">
                                ${teamCount} teams | ${poolCount} pools |
                                Your team: <span class="text-cyan-400">${escapeHtml(tournament.linked_team_name || 'Unknown')}</span>
                                ${tournament.pool_name ? ` in ${escapeHtml(tournament.pool_name)}` : ''}
                            </p>
                            <p class="text-xs text-gray-500 mt-1">Last updated: ${lastUpdated}</p>
                        </div>
                        <div class="flex gap-2">
                            <button onclick="updateSharedTournamentUI('${tournament.id}')" class="p-2 bg-orange-500/20 hover:bg-orange-500/40 text-orange-400 rounded-lg transition-all" title="Update Results">
                                <i data-lucide="refresh-cw" class="w-4 h-4"></i>
                            </button>
                            <button onclick="viewSharedTournament('${tournament.id}')" class="p-2 bg-purple-500/20 hover:bg-purple-500/40 text-purple-400 rounded-lg transition-all" title="View Details">
                                <i data-lucide="eye" class="w-4 h-4"></i>
                            </button>
                        </div>
                    </div>
                    ${linkedCoachCount > 0 ? `
                    <div class="mt-3 pt-3 border-t border-white/10">
                        <button onclick="showLinkedCoaches('${tournament.id}')" class="flex items-center gap-2 text-xs text-gray-400 hover:text-white transition-all w-full">
                            <i data-lucide="users" class="w-3.5 h-3.5 text-emerald-400"></i>
                            <span><span class="text-emerald-400 font-medium">${linkedCoachCount}</span> connected coach${linkedCoachCount !== 1 ? 'es' : ''}: ${linkedTeamsPreview}${moreCount > 0 ? ` <span class="text-gray-500">+${moreCount} more</span>` : ''}</span>
                            <i data-lucide="chevron-right" class="w-3.5 h-3.5 ml-auto"></i>
                        </button>
                    </div>
                    ` : `
                    <div class="mt-3 pt-3 border-t border-white/10">
                        <p class="flex items-center gap-2 text-xs text-gray-500">
                            <i data-lucide="user-x" class="w-3.5 h-3.5"></i>
                            No other coaches connected yet
                        </p>
                    </div>
                    `}
                </div>
            `;
        }).join('');

        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }

    } catch (error) {
        console.error('Error loading shared tournaments:', error);
        section.classList.add('hidden');
    }
}

// Refresh shared tournaments
async function refreshSharedTournaments() {
    const section = document.getElementById('shared-tournaments-section');
    if (section) {
        section.querySelector('button')?.classList.add('animate-spin');
    }

    await updateSharedTournaments();

    if (section) {
        section.querySelector('button')?.classList.remove('animate-spin');
    }

    showToast('Tournaments refreshed', 'success');
}

// Update a specific shared tournament from USAU
async function updateSharedTournamentUI(tournamentId) {
    showToast('Updating tournament results...', 'info');

    try {
        const result = await updateSharedTournamentResults(tournamentId);

        if (result.success) {
            showToast(`Updated: ${result.teamCount} teams, ${result.poolCount} pools`, 'success');
            await updateSharedTournaments();
        } else {
            showToast('Update failed', 'error');
        }
    } catch (error) {
        showToast('Failed to update: ' + error.message, 'error');
    }
}

// View shared tournament details
function viewSharedTournament(tournamentId) {
    // Navigate to league page with the tournament ID
    window.location.href = `league.html?sharedTournament=${tournamentId}`;
}

// Show modal with connected coaches for a tournament
async function showLinkedCoaches(tournamentId) {
    if (!currentUser) return;

    try {
        const response = await fetch(`${API_BASE_URL}/api/shared-tournaments/${tournamentId}`, {
            credentials: 'include'
        });

        if (!response.ok) {
            showToast('Failed to load coaches', 'error');
            return;
        }

        const tournament = await response.json();
        const linkedTeams = tournament.linkedTeams || [];

        // Group linked teams by pool
        const teamsByPool = {};
        linkedTeams.forEach(link => {
            const pool = link.pool_name || 'Unknown Pool';
            if (!teamsByPool[pool]) teamsByPool[pool] = [];
            teamsByPool[pool].push(link);
        });

        // Count total coaches across all teams
        const totalCoaches = linkedTeams.reduce((sum, link) => sum + (link.coaches?.length || 1), 0);

        // Create modal content
        const poolSections = Object.entries(teamsByPool).map(([poolName, teams]) => `
            <div class="mb-4">
                <h4 class="text-sm font-medium text-gray-400 mb-2">${escapeHtml(poolName)}</h4>
                <div class="space-y-3">
                    ${teams.map(link => {
                        const coaches = link.coaches || [{ user_name: link.user_name, role: 'coach' }];
                        const coachCount = coaches.length;
                        return `
                        <div class="p-3 bg-white/5 rounded-lg border border-white/10">
                            <div class="flex items-center gap-3">
                                <div class="w-10 h-10 bg-gradient-to-br from-emerald-500 to-cyan-600 rounded-full flex items-center justify-center flex-shrink-0">
                                    <span class="text-white font-bold text-sm">${escapeHtml(link.team_name.charAt(0))}</span>
                                </div>
                                <div class="flex-1 min-w-0">
                                    <p class="font-medium text-white truncate">${escapeHtml(link.team_name)}</p>
                                    <p class="text-xs text-gray-400 truncate">
                                        ${link.local_team_name ? `UltiStats team: ${escapeHtml(link.local_team_name)}` : ''}
                                    </p>
                                </div>
                                <div class="flex-shrink-0">
                                    <span class="text-xs px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded-full">
                                        ${coachCount} coach${coachCount !== 1 ? 'es' : ''}
                                    </span>
                                </div>
                            </div>
                            <div class="mt-3 pt-3 border-t border-white/5">
                                <div class="flex flex-wrap gap-2">
                                    ${coaches.map(coach => `
                                        <div class="flex items-center gap-2 px-2 py-1 bg-white/5 rounded-lg">
                                            <div class="w-6 h-6 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center">
                                                <span class="text-white text-xs font-medium">${escapeHtml((coach.user_name || 'U').charAt(0))}</span>
                                            </div>
                                            <span class="text-xs text-white">${escapeHtml(coach.user_name || 'Unknown')}</span>
                                            ${coach.role === 'owner' ? '<span class="text-xs text-yellow-400">★</span>' : ''}
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        </div>
                    `}).join('')}
                </div>
            </div>
        `).join('');

        // Show modal
        const modalHtml = `
            <div id="linked-coaches-modal" class="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4" onclick="if(event.target === this) this.remove()">
                <div class="bg-gray-900 rounded-2xl max-w-lg w-full max-h-[80vh] overflow-hidden border border-white/10 shadow-2xl">
                    <div class="p-6 border-b border-white/10">
                        <div class="flex items-center justify-between">
                            <div>
                                <h3 class="text-xl font-bold text-white">Connected Coaches</h3>
                                <p class="text-sm text-gray-400 mt-1">${escapeHtml(tournament.name)}</p>
                            </div>
                            <button onclick="document.getElementById('linked-coaches-modal').remove()" class="p-2 hover:bg-white/10 rounded-lg transition-all">
                                <i data-lucide="x" class="w-5 h-5 text-gray-400"></i>
                            </button>
                        </div>
                    </div>
                    <div class="p-6 overflow-y-auto max-h-[60vh]">
                        <div class="flex items-center gap-2 mb-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                            <i data-lucide="info" class="w-4 h-4 text-emerald-400 flex-shrink-0"></i>
                            <p class="text-xs text-emerald-400">
                                <span class="font-medium">${totalCoaches} coach${totalCoaches !== 1 ? 'es' : ''}</span> across
                                <span class="font-medium">${linkedTeams.length} team${linkedTeams.length !== 1 ? 's' : ''}</span> are using UltiStats at this tournament.
                                Results and stats are shared across all connected coaches.
                            </p>
                        </div>
                        ${poolSections || '<p class="text-gray-500 text-center py-8">No connected coaches yet</p>'}
                    </div>
                </div>
            </div>
        `;

        // Remove existing modal if any
        document.getElementById('linked-coaches-modal')?.remove();

        // Add modal to DOM
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // Initialize icons
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }

    } catch (error) {
        console.error('Error showing linked coaches:', error);
        showToast('Failed to load coaches', 'error');
    }
}

// ==================== TEAM MANAGEMENT FUNCTIONS ====================

function updateTeamSelector() {
    const container = document.getElementById('team-list');
    if (!container) return;
    
    // Use API-fetched userTeams if available, otherwise fall back to local teamsData
    const teams = userTeams.length > 0 ? userTeams : Object.values(teamsData.teams);
    
    if (teams.length === 0) {
        container.innerHTML = `
            <div class="col-span-full text-center text-gray-500 py-8">
                <p>No teams yet. Create your first team!</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = teams.map(team => {
        const isActive = currentTeam && team.id === currentTeam.id;
        const playerCount = team.roster ? team.roster.length : 0;
        const record = team.seasonStats ? `${team.seasonStats.wins || 0}W-${team.seasonStats.losses || 0}L` : '0W-0L';
        const gamesPlayed = team.gameHistory ? team.gameHistory.length : 0;
        
        return `
            <div class="team-card p-4 rounded-xl ${isActive ? 'bg-blue-500/20 border-2 border-blue-500/50' : 'bg-white/5 border border-white/10'} hover:bg-white/10 transition-all cursor-pointer" onclick="viewTeamStats('${team.id}')">
                <div class="flex items-center justify-between mb-2">
                    <h3 class="font-bold text-white">${escapeHtml(team.name)}</h3>
                    ${isActive ? '<span class="text-xs bg-blue-500/30 text-blue-400 px-2 py-0.5 rounded-full">Active</span>' : ''}
                </div>
                <div class="text-sm text-gray-400 space-y-1">
                    <div class="flex justify-between">
                        <span>Players:</span>
                        <span class="text-white">${playerCount}</span>
                    </div>
                    <div class="flex justify-between">
                        <span>Games:</span>
                        <span class="text-white">${gamesPlayed}</span>
                    </div>
                    <div class="flex justify-between">
                        <span>Record:</span>
                        <span class="text-white">${record}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

function showTeamModal(editTeamId = null) {
    const existing = document.getElementById('team-modal');
    if (existing) existing.remove();
    
    const team = editTeamId ? teamsData.teams[editTeamId] : null;
    const isEdit = !!team;
    
    const modal = document.createElement('div');
    modal.id = 'team-modal';
    modal.className = 'fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4';
    
    modal.innerHTML = `
        <div class="bg-slate-800 rounded-2xl p-6 w-[calc(100%-2rem)] sm:max-w-md border border-white/10">
            <h3 class="text-xl font-bold text-white mb-4">${isEdit ? 'Edit Team' : 'Create New Team'}</h3>
            
            <div class="space-y-4 mb-6">
                <div>
                    <label class="block text-sm text-gray-400 mb-2">Team Name</label>
                    <input type="text" id="team-name-input" value="${team?.name || ''}" placeholder="Enter team name" class="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500">
                </div>
            </div>
            
            <div class="flex gap-3">
                <button onclick="closeTeamModal()" class="flex-1 bg-white/10 hover:bg-white/20 text-white py-3 rounded-xl font-semibold transition-all">
                    Cancel
                </button>
                <button onclick="${isEdit ? `saveTeamEdit('${editTeamId}')` : 'createNewTeam()'}" class="flex-1 bg-blue-500 hover:bg-blue-600 text-white py-3 rounded-xl font-semibold transition-all">
                    ${isEdit ? 'Save' : 'Create'}
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeTeamModal();
    });
    window._teamFocusCleanup = trapFocus(modal, closeTeamModal);
}

function closeTeamModal() {
    if (window._teamFocusCleanup) { window._teamFocusCleanup(); window._teamFocusCleanup = null; }
    const modal = document.getElementById('team-modal');
    if (modal) modal.remove();
}

function createNewTeam() {
    const nameInput = document.getElementById('team-name-input');
    const name = nameInput?.value.trim();

    if (!name) {
        showToast('Please enter a team name', 'error');
        return;
    }

    // Show loading state on save button
    const saveBtn = document.querySelector('#team-modal button[onclick*="createNewTeam"]');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin inline"></i> Creating...';
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    const newTeam = createEmptyTeam(name);
    teamsData.teams[newTeam.id] = newTeam;
    saveTeamsData();

    closeTeamModal();
    updateTeamSelector();
    showToast(`Team "${name}" created!`, 'success');
}

function saveTeamEdit(teamId) {
    const nameInput = document.getElementById('team-name-input');
    const name = nameInput?.value.trim();

    if (!name) {
        showToast('Please enter a team name', 'error');
        return;
    }

    // Show loading state on save button
    const saveBtn = document.querySelector('#team-modal button[onclick*="saveTeamEdit"]');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin inline"></i> Saving...';
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    if (teamsData.teams[teamId]) {
        teamsData.teams[teamId].name = name;
        saveTeamsData();
        closeTeamModal();
        updateTeamSelector();
        showToast('Team updated!', 'success');
    }
}

function viewTeamStats(teamId) {
    const team = teamsData.teams[teamId];
    if (!team) return;
    
    const existing = document.getElementById('team-stats-modal');
    if (existing) existing.remove();
    
    const stats = team.careerStats || { players: {} };
    const seasonStats = team.seasonStats || { wins: 0, losses: 0, totalGames: 0 };
    const playerEntries = Object.entries(stats.players)
        .sort((a, b) => ((b[1].goals || 0) + (b[1].assists || 0)) - ((a[1].goals || 0) + (a[1].assists || 0)));
    
    const modal = document.createElement('div');
    modal.id = 'team-stats-modal';
    modal.className = 'fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto';
    
    modal.innerHTML = `
        <div class="bg-slate-800 rounded-2xl p-6 w-[calc(100%-2rem)] sm:max-w-2xl border border-white/10 my-8">
            <div class="flex items-center justify-between mb-6">
                <div>
                    <h3 class="text-xl font-bold text-white">${escapeHtml(team.name)}</h3>
                    <p class="text-gray-400 text-sm">Created ${new Date(team.createdAt).toLocaleDateString()}</p>
                </div>
                <div class="text-right">
                    <div class="text-2xl font-bold text-white">${seasonStats.wins}W - ${seasonStats.losses}L</div>
                    <div class="text-sm text-gray-400">${stats.totalGames || 0} career games</div>
                </div>
            </div>
            
            <div class="grid grid-cols-4 gap-3 mb-6">
                <div class="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center">
                    <div class="text-2xl font-bold text-emerald-400">${playerEntries.reduce((sum, [,s]) => sum + (s.goals || 0), 0)}</div>
                    <div class="text-xs text-gray-400">Goals</div>
                </div>
                <div class="p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-center">
                    <div class="text-2xl font-bold text-cyan-400">${playerEntries.reduce((sum, [,s]) => sum + (s.assists || 0), 0)}</div>
                    <div class="text-xs text-gray-400">Assists</div>
                </div>
                <div class="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 text-center">
                    <div class="text-2xl font-bold text-purple-400">${playerEntries.reduce((sum, [,s]) => sum + (s.blocks || 0), 0)}</div>
                    <div class="text-xs text-gray-400">Blocks</div>
                </div>
                <div class="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-center">
                    <div class="text-2xl font-bold text-blue-400">${Math.round(playerEntries.reduce((sum, [,s]) => sum + (s.yardsThrown || 0) + (s.yardsCaught || 0), 0))}</div>
                    <div class="text-xs text-gray-400">Yards</div>
                </div>
            </div>
            
            <div class="mb-6">
                <h4 class="text-sm font-semibold text-gray-300 mb-3">Player Stats (${playerEntries.length} players)</h4>
                <div class="space-y-2 max-h-64 overflow-y-auto">
                    ${playerEntries.length === 0 ? '<p class="text-gray-500 text-center py-4">No player stats yet</p>' : ''}
                    ${playerEntries.map(([name, s], idx) => `
                        <div class="flex items-center justify-between p-2 rounded-lg bg-white/5">
                            <div class="flex items-center gap-2">
                                <span class="text-gray-500 w-6">${idx + 1}.</span>
                                <span class="font-medium text-white">${escapeHtml(name)}</span>
                            </div>
                            <div class="flex gap-3 text-sm text-gray-400">
                                <span class="text-emerald-400">${s.goals || 0}G</span>
                                <span class="text-cyan-400">${s.assists || 0}A</span>
                                <span class="text-pink-400">${s.hockeyAssists || 0}HA</span>
                                <span class="text-purple-400">${s.blocks || 0}D</span>
                                <span class="text-red-400">${s.turnovers || 0}T</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
            
            <div class="flex gap-3">
                <button onclick="closeTeamStatsModal()" class="flex-1 bg-white/10 hover:bg-white/20 text-white py-3 rounded-xl font-semibold transition-all">
                    Close
                </button>
                <button onclick="setActiveTeam('${team.id}')" class="bg-blue-500/20 hover:bg-blue-500/40 text-blue-400 px-6 py-3 rounded-xl font-semibold transition-all border border-blue-500/30">
                    Set Active
                </button>
                <button onclick="showTeamModal('${team.id}')" class="bg-gray-500/20 hover:bg-gray-500/40 text-gray-400 px-6 py-3 rounded-xl font-semibold transition-all border border-gray-500/30">
                    Edit
                </button>
                <button onclick="exportTeamStats('${team.id}')" class="bg-emerald-500/20 hover:bg-emerald-500/40 text-emerald-400 px-6 py-3 rounded-xl font-semibold transition-all border border-emerald-500/30">
                    Export
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeTeamStatsModal();
    });
}

function closeTeamStatsModal() {
    const modal = document.getElementById('team-stats-modal');
    if (modal) modal.remove();
}

function setActiveTeam(teamId) {
    if (teamsData.teams[teamId]) {
        teamsData.currentTeamId = teamId;
        saveTeamsData();
        updateTeamSelector();
        closeTeamStatsModal();
        showToast(`Switched to ${teamsData.teams[teamId].name}`);
    }
}

function exportTeamStats(teamId) {
    const team = teamsData.teams[teamId];
    if (!team) return;
    
    const stats = team.careerStats || { players: {} };
    const seasonStats = team.seasonStats || {};
    
    const csv = [
        ['Team Stats Export'],
        ['Team Name', team.name],
        ['Created', new Date(team.createdAt).toLocaleDateString()],
        ['Total Games', stats.totalGames || 0],
        ['Record', `${seasonStats.wins || 0}W - ${seasonStats.losses || 0}L`],
        [''],
        ['=== PLAYER CAREER STATS ==='],
        ['Player', 'Goals', 'Assists', 'Hockey Assists', 'Blocks', 'Turnovers', 'Points', 'Yards Thrown', 'Yards Caught', 'Total Yards']
    ];
    
    Object.entries(stats.players)
        .sort((a, b) => ((b[1].goals || 0) + (b[1].assists || 0)) - ((a[1].goals || 0) + (a[1].assists || 0)))
        .forEach(([name, s]) => {
            csv.push([
                name,
                s.goals || 0,
                s.assists || 0,
                s.hockeyAssists || 0,
                s.blocks || 0,
                s.turnovers || 0,
                (s.goals || 0) + (s.assists || 0),
                Math.round(s.yardsThrown || 0),
                Math.round(s.yardsCaught || 0),
                Math.round((s.yardsThrown || 0) + (s.yardsCaught || 0))
            ]);
        });
    
    const csvContent = csv.map(row => row.join(',')).join('\n');
    downloadFile(csvContent, `${team.name.replace(/\s+/g, '_')}_stats.csv`);
    showToast(`Exported ${team.name} stats`);
}

// Update season, tournament, and career stats when game stats change
function updateAggregateStats(playerName, statType, value = 1) {
    // Ensure player exists in season stats
    if (!seasonStats.players[playerName]) {
        seasonStats.players[playerName] = {
            goals: 0, assists: 0, hockeyAssists: 0, blocks: 0, turnovers: 0, yardsThrown: 0, yardsCaught: 0,
            throws: 0, catches: 0
        };
    }
    seasonStats.players[playerName][statType] = (seasonStats.players[playerName][statType] || 0) + value;
    
    // Update tournament stats if active
    if (tournamentStats.isActive) {
        if (!tournamentStats.players[playerName]) {
            tournamentStats.players[playerName] = {
                goals: 0, assists: 0, hockeyAssists: 0, blocks: 0, turnovers: 0, yardsThrown: 0, yardsCaught: 0,
                throws: 0, catches: 0
            };
        }
        tournamentStats.players[playerName][statType] = (tournamentStats.players[playerName][statType] || 0) + value;
        saveTournamentStats();
    }
    
    // Update career stats (never resets)
    if (!careerStats.players[playerName]) {
        careerStats.players[playerName] = {
            goals: 0, assists: 0, hockeyAssists: 0, blocks: 0, turnovers: 0, yardsThrown: 0, yardsCaught: 0,
            gamesPlayed: 0, seasonsPlayed: 0, firstGame: new Date().toISOString()
        };
    }
    careerStats.players[playerName][statType] = (careerStats.players[playerName][statType] || 0) + value;
    saveCareerStats();
    
    saveSeasonStats();
}

function drawField() {
    const svg = document.getElementById('field-svg');
    if (!svg) return;
    svg.innerHTML = '';

    // Create gradients
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    
    // Field gradient
    const fieldGradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
    fieldGradient.setAttribute('id', 'fieldGradient');
    fieldGradient.setAttribute('x1', '0%');
    fieldGradient.setAttribute('y1', '0%');
    fieldGradient.setAttribute('x2', '0%');
    fieldGradient.setAttribute('y2', '100%');
    
    const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop1.setAttribute('offset', '0%');
    stop1.setAttribute('style', 'stop-color:#22c55e;stop-opacity:1');
    
    const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop2.setAttribute('offset', '100%');
    stop2.setAttribute('style', 'stop-color:#16a34a;stop-opacity:1');
    
    fieldGradient.appendChild(stop1);
    fieldGradient.appendChild(stop2);
    defs.appendChild(fieldGradient);
    svg.appendChild(defs);

    // Background
    const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    background.setAttribute('width', FIELD_DIMENSIONS.totalLength);
    background.setAttribute('height', FIELD_DIMENSIONS.width);
    background.setAttribute('fill', 'url(#fieldGradient)');
    svg.appendChild(background);

    // End zones
    const leftEndzone = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    leftEndzone.setAttribute('x', 0);
    leftEndzone.setAttribute('y', 0);
    leftEndzone.setAttribute('width', FIELD_DIMENSIONS.endZoneDepth);
    leftEndzone.setAttribute('height', FIELD_DIMENSIONS.width);
    leftEndzone.setAttribute('class', 'endzone');
    svg.appendChild(leftEndzone);

    const rightEndzone = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rightEndzone.setAttribute('x', FIELD_DIMENSIONS.totalLength - FIELD_DIMENSIONS.endZoneDepth);
    rightEndzone.setAttribute('y', 0);
    rightEndzone.setAttribute('width', FIELD_DIMENSIONS.endZoneDepth);
    rightEndzone.setAttribute('height', FIELD_DIMENSIONS.width);
    rightEndzone.setAttribute('class', 'endzone');
    svg.appendChild(rightEndzone);

    // Field lines
    // Sidelines
    const topSideline = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    topSideline.setAttribute('x1', 0);
    topSideline.setAttribute('y1', 0);
    topSideline.setAttribute('x2', FIELD_DIMENSIONS.totalLength);
    topSideline.setAttribute('y2', 0);
    topSideline.setAttribute('class', 'field-line');
    svg.appendChild(topSideline);

    const bottomSideline = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    bottomSideline.setAttribute('x1', 0);
    bottomSideline.setAttribute('y1', FIELD_DIMENSIONS.width);
    bottomSideline.setAttribute('x2', FIELD_DIMENSIONS.totalLength);
    bottomSideline.setAttribute('y2', FIELD_DIMENSIONS.width);
    bottomSideline.setAttribute('class', 'field-line');
    svg.appendChild(bottomSideline);

    // Goal lines
    const leftGoalLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    leftGoalLine.setAttribute('x1', FIELD_DIMENSIONS.endZoneDepth);
    leftGoalLine.setAttribute('y1', 0);
    leftGoalLine.setAttribute('x2', FIELD_DIMENSIONS.endZoneDepth);
    leftGoalLine.setAttribute('y2', FIELD_DIMENSIONS.width);
    leftGoalLine.setAttribute('class', 'field-line');
    svg.appendChild(leftGoalLine);

    const rightGoalLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    rightGoalLine.setAttribute('x1', FIELD_DIMENSIONS.totalLength - FIELD_DIMENSIONS.endZoneDepth);
    rightGoalLine.setAttribute('y1', 0);
    rightGoalLine.setAttribute('x2', FIELD_DIMENSIONS.totalLength - FIELD_DIMENSIONS.endZoneDepth);
    rightGoalLine.setAttribute('y2', FIELD_DIMENSIONS.width);
    rightGoalLine.setAttribute('class', 'field-line');
    svg.appendChild(rightGoalLine);

    // Brick marks
    const leftBrickMark = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    leftBrickMark.setAttribute('x1', FIELD_DIMENSIONS.endZoneDepth + FIELD_DIMENSIONS.brickMarkDistance);
    leftBrickMark.setAttribute('y1', 0);
    leftBrickMark.setAttribute('x2', FIELD_DIMENSIONS.endZoneDepth + FIELD_DIMENSIONS.brickMarkDistance);
    leftBrickMark.setAttribute('y2', FIELD_DIMENSIONS.width);
    leftBrickMark.setAttribute('class', 'brick-mark');
    svg.appendChild(leftBrickMark);

    const rightBrickMark = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    rightBrickMark.setAttribute('x1', FIELD_DIMENSIONS.totalLength - FIELD_DIMENSIONS.endZoneDepth - FIELD_DIMENSIONS.brickMarkDistance);
    rightBrickMark.setAttribute('y1', 0);
    rightBrickMark.setAttribute('x2', FIELD_DIMENSIONS.totalLength - FIELD_DIMENSIONS.endZoneDepth - FIELD_DIMENSIONS.brickMarkDistance);
    rightBrickMark.setAttribute('y2', FIELD_DIMENSIONS.width);
    rightBrickMark.setAttribute('class', 'brick-mark');
    svg.appendChild(rightBrickMark);

    // Center line
    const centerLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    centerLine.setAttribute('x1', FIELD_DIMENSIONS.totalLength / 2);
    centerLine.setAttribute('y1', 0);
    centerLine.setAttribute('x2', FIELD_DIMENSIONS.totalLength / 2);
    centerLine.setAttribute('y2', FIELD_DIMENSIONS.width);
    centerLine.setAttribute('class', 'field-line');
    svg.appendChild(centerLine);

    // End zone labels
    const leftEndzoneText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    leftEndzoneText.setAttribute('x', FIELD_DIMENSIONS.endZoneDepth / 2);
    leftEndzoneText.setAttribute('y', FIELD_DIMENSIONS.width / 2);
    leftEndzoneText.setAttribute('class', 'endzone-text');
    leftEndzoneText.textContent = 'END ZONE';
    svg.appendChild(leftEndzoneText);

    const rightEndzoneText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    rightEndzoneText.setAttribute('x', FIELD_DIMENSIONS.totalLength - FIELD_DIMENSIONS.endZoneDepth / 2);
    rightEndzoneText.setAttribute('y', FIELD_DIMENSIONS.width / 2);
    rightEndzoneText.setAttribute('class', 'endzone-text');
    rightEndzoneText.textContent = 'END ZONE';
    svg.appendChild(rightEndzoneText);
}

function updateGameSetupUI() {
    // Auto-fill team name from auth
    const ourTeamInput = document.getElementById('our-team');
    const teamBadge = document.getElementById('current-team-badge');
    const teamBadgeInitials = document.getElementById('team-badge-initials');
    const teamBadgeName = document.getElementById('team-badge-name');
    const gameSetupTeamName = document.getElementById('game-setup-team-name');
    
    if (currentTeam && ourTeamInput) {
        ourTeamInput.value = currentTeam.name;
        ourTeamInput.classList.remove('readonly');
        
        // Show team badge
        if (teamBadge) {
            teamBadge.classList.remove('hidden');
            const initials = currentTeam.name.split(' ').map(w => w[0]).join('').toUpperCase().substring(0, 2);
            if (teamBadgeInitials) teamBadgeInitials.textContent = initials;
            if (teamBadgeName) teamBadgeName.textContent = currentTeam.name;
        }
        
        if (gameSetupTeamName) {
            gameSetupTeamName.textContent = `Playing as ${currentTeam.name}`;
        }
    }
    
    // Update roster preview
    updateRosterPreview();
}

function updateRosterPreview() {
    const container = document.getElementById('roster-preview');
    const countBadge = document.getElementById('roster-count-badge');
    if (!container) return;
    
    const players = savedRoster.length > 0 ? savedRoster : gameState.players;
    
    if (players.length === 0) {
        container.innerHTML = '<span class="text-gray-500 text-sm">No players added yet. Add players after starting the game.</span>';
        if (countBadge) countBadge.textContent = '0 players';
        return;
    }
    
    if (countBadge) countBadge.textContent = `${players.length} players`;
    
    // Show first 10 players with avatars
    const displayPlayers = players.slice(0, 10);
    const remaining = players.length - 10;
    
    container.innerHTML = displayPlayers.map(player => {
        const avatar = playerAvatars[player] || { type: 'initials', color: getRandomAvatarColor(player) };
        const initials = getPlayerInitials(player);
        const avatarColor = avatar.color || getRandomAvatarColor(player);

        // Get player position from registry
        const playerObj = getPlayerByName(player);
        const position = playerObj ? playerObj.position : null;
        let positionBadge = '';
        if (position) {
            const posClass = position === 'Handler' ? 'bg-blue-500/30 text-blue-400' :
                            position === 'Cutter' ? 'bg-green-500/30 text-green-400' :
                            'bg-purple-500/30 text-purple-400';
            positionBadge = `<span class="text-[9px] px-1 rounded ${posClass}">${position[0]}</span>`;
        }

        return `
            <div class="flex items-center gap-1.5 px-2 py-1 bg-white/5 rounded-lg" title="${escapeHtml(player)}${position ? ' (' + position + ')' : ''}">
                <div class="w-5 h-5 ${avatarColor} rounded-full flex items-center justify-center text-white font-bold text-[10px]">${escapeHtml(initials)}</div>
                <span class="text-xs text-gray-300">${escapeHtml(player.split(' ')[0])}</span>
                ${positionBadge}
            </div>
        `;
    }).join('') + (remaining > 0 ? `<span class="text-xs text-gray-500 px-2 py-1">+${remaining} more</span>` : '');
}

function initGameSetupValidation() {
    const opponent = document.getElementById('opponent-team');
    const date = document.getElementById('game-date');
    const btn = document.getElementById('start-game-btn');
    if (!opponent || !date || !btn) return;

    function validateGameSetup() {
        const isValid = opponent.value.trim() !== '' && date.value !== '';
        btn.disabled = !isValid;
        if (isValid) {
            btn.classList.remove('opacity-50', 'cursor-not-allowed');
        } else {
            btn.classList.add('opacity-50', 'cursor-not-allowed');
        }
    }

    opponent.addEventListener('input', validateGameSetup);
    date.addEventListener('change', validateGameSetup);
    // Run once on init to set initial state
    validateGameSetup();
}

function startGame() {
    const ourTeam = document.getElementById('our-team')?.value || (currentTeam ? currentTeam.name : '');
    const opponentTeam = document.getElementById('opponent-team')?.value;
    const date = document.getElementById('game-date')?.value;
    const sheetId = document.getElementById('sheet-id')?.value || document.getElementById('spreadsheet-id')?.value || '';
    const gameType = document.getElementById('game-type')?.value || 'regular';

    if (!ourTeam || !opponentTeam || !date) {
        showToast('Please fill in opponent name and date', 'error');
        hapticFeedback('error');
        return;
    }

    // Save game setup to localStorage for game.html to access
    const gameSetup = {
        ourTeam,
        opponentTeam,
        date,
        sheetId,
        gameType,
        teamId: currentTeam ? currentTeam.id : null,
        players: gameState.players,
        isActive: true,
        startedAt: new Date().toISOString()
    };
    
    localStorage.setItem('ultistats_game_setup', JSON.stringify(gameSetup));
    
    hapticFeedback('success');
    playSound('tap');
    
    // Redirect to game page
    window.location.href = '/game.html';
}

function initializeGameFromSetup() {
    const gameSetupStr = localStorage.getItem('ultistats_game_setup');
    if (!gameSetupStr) {
        console.error('No game setup found in localStorage');
        return false;
    }
    
    let gameSetup;
    try {
        gameSetup = JSON.parse(gameSetupStr);
    } catch (e) {
        console.error('Failed to parse game setup:', e);
        return false;
    }
    
    gameState.currentGame = {
        ourTeam: gameSetup.ourTeam,
        opponentTeam: gameSetup.opponentTeam,
        date: gameSetup.date,
        sheetId: gameSetup.sheetId,
        gameType: gameSetup.gameType,
        isActive: true
    };
    
    // Try multiple sources for players in order of priority:
    // 1. Players from game setup
    // 2. Players from currentTeam roster (already loaded by loadAuthState)
    // 3. Players from savedRoster (loaded by loadRoster)
    
    let players = [];
    
    if (gameSetup.players && gameSetup.players.length > 0) {
        players = [...gameSetup.players];
    } else if (currentTeam && currentTeam.roster && currentTeam.roster.length > 0) {
        players = [...currentTeam.roster];
    } else if (savedRoster && savedRoster.length > 0) {
        players = [...savedRoster];
    }
    
    gameState.players = players;
    
    // Update header display (desktop + mobile spans)
    const ourTeamEl = document.getElementById('game-our-team');
    const opponentEl = document.getElementById('game-opponent');
    if (ourTeamEl) ourTeamEl.textContent = gameSetup.ourTeam;
    if (opponentEl) opponentEl.textContent = gameSetup.opponentTeam;
    const ourTeamMobile = document.getElementById('game-our-team-mobile');
    const opponentMobile = document.getElementById('game-opponent-mobile');
    if (ourTeamMobile) ourTeamMobile.textContent = gameSetup.ourTeam;
    if (opponentMobile) opponentMobile.textContent = gameSetup.opponentTeam;
    
    // Initialize attendance with all players present by default
    if (gameState.players.length > 0) {
        gameState.presentPlayers = [...gameState.players];
    }
    
    updateAttendanceGrid();
    
    // Initialize player stats
    gameState.players.forEach(player => {
        if (!gameState.playerStats[player]) {
            gameState.playerStats[player] = {
                goals: 0,
                assists: 0,
                blocks: 0,
                turnovers: 0,
                yardsThrown: 0,
                yardsCaught: 0
            };
        }
    });

    updatePlayerDropdowns();
    updateQuickPlayerSelect();
    updateLineSelectionGrid();
    updateStatsDisplay();
    updateScoreDisplay();
    saveToStorage();
    logAction('Game started', 'system');

    // Keep screen awake during game
    requestWakeLock();

    return true;
}

function handleCSVImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const content = e.target.result;
        const players = parseCSV(content);
        
        let addedCount = 0;
        players.forEach(playerName => {
            if (playerName && !gameState.players.includes(playerName)) {
                gameState.players.push(playerName);
                gameState.playerStats[playerName] = {
                    goals: 0,
                    assists: 0,
                    blocks: 0,
                    turnovers: 0,
                    yardsThrown: 0,
                    yardsCaught: 0
                };
                
                // Save to persistent roster
                if (!savedRoster.includes(playerName)) {
                    savedRoster.push(playerName);
                }
                
                // Initialize in season stats
                if (!seasonStats.players[playerName]) {
                    seasonStats.players[playerName] = {
                        goals: 0, assists: 0, hockeyAssists: 0, blocks: 0, turnovers: 0, yardsThrown: 0, yardsCaught: 0,
                        throws: 0, catches: 0
                    };
                }
                
                // Initialize in career stats
                if (!careerStats.players[playerName]) {
                    careerStats.players[playerName] = {
                        goals: 0, assists: 0, hockeyAssists: 0, blocks: 0, turnovers: 0, yardsThrown: 0, yardsCaught: 0,
                        gamesPlayed: 0, seasonsPlayed: 0, firstGame: new Date().toISOString(),
                        throws: 0, catches: 0
                    };
                }

                addedCount++;
            }
        });

        saveRoster();
        saveSeasonStats();
        saveCareerStats();
        saveToStorage();
        updatePlayerList();
        updatePlayerDropdowns();
        updateQuickPlayerSelect();
        updateLineSelectionGrid();
        updateStatsDisplay();
        
        if (addedCount > 0) {
            logAction(`Imported ${addedCount} players from CSV`, 'system');
            showToast(`Successfully imported ${addedCount} players!`);
        } else {
            showToast('No new players found in CSV file.');
        }
        
        // Reset file input
        event.target.value = '';
    };
    reader.readAsText(file);
}

function parseCSV(content) {
    const lines = content.split(/\r?\n/);
    const players = [];
    
    // Check if first line is a header
    const firstLine = lines[0].trim().toLowerCase();
    const hasHeader = firstLine.includes('name') || firstLine.includes('player');
    const startIndex = hasHeader ? 1 : 0;
    
    // Try to detect delimiter
    const delimiter = content.includes(',') ? ',' : (content.includes('\t') ? '\t' : ',');
    
    // Find the name column index if there's a header
    let nameColumnIndex = 0;
    if (hasHeader) {
        const headers = lines[0].split(delimiter).map(h => h.trim().toLowerCase());
        const nameIndex = headers.findIndex(h => h === 'name' || h === 'player' || h === 'player name');
        if (nameIndex !== -1) {
            nameColumnIndex = nameIndex;
        }
    }
    
    for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const columns = line.split(delimiter);
        let playerName = columns[nameColumnIndex]?.trim();
        
        // Remove quotes if present
        if (playerName) {
            playerName = playerName.replace(/^["']|["']$/g, '').trim();
        }
        
        if (playerName && playerName.length > 0) {
            players.push(playerName);
        }
    }
    
    return players;
}

function addPlayer() {
    const input = document.getElementById('new-player');
    const playerName = input.value.trim();

    if (!playerName) return;

    if (gameState.players.includes(playerName)) {
        showToast('Player already exists', 'error');
        return;
    }

    // Register player with unique ID and number
    let player = getPlayerByName(playerName);
    if (!player) {
        player = createPlayer(playerName);
        playerRegistry[player.id] = player;
        savePlayerRegistry();
    }

    gameState.players.push(playerName);
    gameState.playerStats[playerName] = {
        goals: 0,
        assists: 0,
        blocks: 0,
        turnovers: 0,
        yardsThrown: 0,
        yardsCaught: 0
    };

    // Save to persistent roster
    if (!savedRoster.includes(playerName)) {
        savedRoster.push(playerName);
        saveRoster();
    }
    
    // Initialize in season stats if not exists
    if (!seasonStats.players[playerName]) {
        seasonStats.players[playerName] = {
            goals: 0, assists: 0, hockeyAssists: 0, blocks: 0, turnovers: 0, yardsThrown: 0, yardsCaught: 0,
            throws: 0, catches: 0
        };
        saveSeasonStats();
    }
    
    // Initialize in career stats if not exists
    if (!careerStats.players[playerName]) {
        careerStats.players[playerName] = {
            goals: 0, assists: 0, hockeyAssists: 0, blocks: 0, turnovers: 0, yardsThrown: 0, yardsCaught: 0,
            gamesPlayed: 0, seasonsPlayed: 0, firstGame: new Date().toISOString()
        };
        saveCareerStats();
    }

    input.value = '';
    updatePlayerList();
    updatePlayerDropdowns();
    updateQuickPlayerSelect();
    updateLineSelectionGrid();
    updateStatsDisplay();
    saveToStorage();
    
    hapticFeedback('success');
    showToast(`Added ${playerName} (#${player.number})`);
}

function updatePlayerList() {
    const playerList = document.getElementById('player-list');
    if (!playerList) return;
    playerList.innerHTML = '';

    gameState.players.forEach(player => {
        const stats = gameState.playerStats[player];
        const position = getPlayerPosition(player);
        const positionColor = getPositionColor(position);
        const playerData = getPlayerByName(player);
        const playerNumber = playerData?.number || '';
        const playerCard = document.createElement('div');
        playerCard.className = 'player-card';
        playerCard.innerHTML = `
            <div class="flex items-center justify-between mb-2">
                <div class="flex items-center gap-2">
                    <div class="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center">
                        <span class="text-sm font-bold text-white">${escapeHtml(playerNumber || player.charAt(0).toUpperCase())}</span>
                    </div>
                    <div>
                        <div class="font-semibold truncate">${escapeHtml(player)}</div>
                        ${playerNumber ? `<div class="text-xs text-gray-400">#${escapeHtml(playerNumber)}</div>` : ''}
                    </div>
                </div>
                <button onclick="event.stopPropagation(); showPositionModal('${escapeHtml(player).replace(/'/g, "\\'")}')" class="text-xs px-2 py-1 rounded-lg ${position ? positionColor : 'bg-white/10 text-gray-400'} hover:opacity-80 transition-all">
                    ${escapeHtml(position || 'Set Pos')}
                </button>
            </div>
            <div class="grid grid-cols-3 gap-2 text-xs">
                <div class="bg-white/10 rounded px-2 py-1 text-center">
                    <div class="font-bold text-emerald-400">${stats.goals}</div>
                    <div class="opacity-60">Goals</div>
                </div>
                <div class="bg-white/10 rounded px-2 py-1 text-center">
                    <div class="font-bold text-cyan-400">${stats.assists}</div>
                    <div class="opacity-60">Assists</div>
                </div>
                <div class="bg-white/10 rounded px-2 py-1 text-center">
                    <div class="font-bold text-purple-400">${stats.blocks}</div>
                    <div class="opacity-60">Blocks</div>
                </div>
            </div>
        `;
        playerCard.addEventListener('click', () => selectPlayerForBlock(player));
        playerList.appendChild(playerCard);
    });
}

function getPositionColor(position) {
    switch(position) {
        case 'Handler': return 'bg-blue-500/30 text-blue-400';
        case 'Cutter': return 'bg-orange-500/30 text-orange-400';
        case 'Hybrid': return 'bg-purple-500/30 text-purple-400';
        default: return 'bg-teal-500/30 text-teal-400';
    }
}

function showPositionModal(playerName) {
    const existing = document.getElementById('position-modal');
    if (existing) existing.remove();
    
    const currentPosition = getPlayerPosition(playerName);
    const allPositions = getAllPositions();
    
    const modal = document.createElement('div');
    modal.id = 'position-modal';
    modal.className = 'fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4';
    
    modal.innerHTML = `
        <div class="bg-slate-800 rounded-2xl p-6 w-[calc(100%-2rem)] sm:max-w-md border border-white/10">
            <h3 class="text-xl font-bold text-white mb-2">Set Position</h3>
            <p class="text-gray-400 text-sm mb-4">${playerName}</p>
            
            <div class="space-y-3 mb-4">
                <div class="grid grid-cols-3 gap-2">
                    ${allPositions.map(pos => `
                        <button onclick="selectPosition('${playerName.replace(/'/g, "\\'")}', '${pos}')" 
                            class="px-3 py-2 rounded-xl text-sm font-medium transition-all ${currentPosition === pos ? 'ring-2 ring-white ' + getPositionColor(pos) : 'bg-white/10 text-gray-300 hover:bg-white/20'}">
                            ${pos}
                        </button>
                    `).join('')}
                </div>
                
                <div class="border-t border-white/10 pt-3">
                    <p class="text-xs text-gray-500 mb-2">Add custom position:</p>
                    <div class="flex gap-2">
                        <input type="text" id="custom-position-input" placeholder="e.g., D-Line, O-Line" 
                            class="flex-1 bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-teal-500">
                        <button onclick="addAndSelectCustomPosition('${playerName.replace(/'/g, "\\'")}')" 
                            class="bg-teal-500/20 hover:bg-teal-500/40 text-teal-400 px-4 py-2 rounded-lg text-sm font-medium transition-all border border-teal-500/30">
                            Add
                        </button>
                    </div>
                </div>
            </div>
            
            <div class="flex gap-3">
                <button onclick="closePositionModal()" class="flex-1 bg-white/10 hover:bg-white/20 text-white py-3 rounded-xl font-semibold transition-all">
                    Cancel
                </button>
                <button onclick="selectPosition('${playerName.replace(/'/g, "\\'")}', '')" class="bg-red-500/20 hover:bg-red-500/40 text-red-400 px-6 py-3 rounded-xl font-semibold transition-all border border-red-500/30">
                    Clear
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closePositionModal();
    });
}

function closePositionModal() {
    const modal = document.getElementById('position-modal');
    if (modal) modal.remove();
}

function selectPosition(playerName, position) {
    setPlayerPosition(playerName, position);
    closePositionModal();
    updatePlayerList();
    updateQuickPlayerSelect();
    if (position) {
        showToast(`${playerName} set as ${position}`);
    } else {
        showToast(`Position cleared for ${playerName}`);
    }
}

function addAndSelectCustomPosition(playerName) {
    const input = document.getElementById('custom-position-input');
    const position = input?.value.trim();
    
    if (!position) {
        showToast('Please enter a position name', 'error');
        return;
    }
    
    addCustomPosition(position);
    setPlayerPosition(playerName, position);
    closePositionModal();
    updatePlayerList();
    updateQuickPlayerSelect();
    showToast(`${playerName} set as ${position}`);
}

// ==================== ATTENDANCE FUNCTIONS ====================

function updateAttendanceGrid() {
    const container = document.getElementById('attendance-grid');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (gameState.players.length === 0) {
        container.innerHTML = '<div class="col-span-full text-center text-gray-400 py-4">No players loaded. Return to dashboard to set up the game.</div>';
        return;
    }
    
    gameState.players.forEach(player => {
        const isPresent = gameState.presentPlayers.includes(player);
        const position = getPlayerPosition(player);
        const posAbbrev = position === 'Hybrid' ? 'HY' : (position ? position.substring(0, 1).toUpperCase() : '');
        
        const btn = document.createElement('button');
        btn.className = `attendance-btn p-3 rounded-xl text-sm font-medium transition-all border ${
            isPresent
                ? 'bg-emerald-500/30 border-emerald-500/50 text-emerald-400'
                : 'bg-white/5 border-white/10 text-gray-500 opacity-60'
        }`;
        btn.setAttribute('role', 'switch');
        btn.setAttribute('aria-checked', String(isPresent));
        btn.setAttribute('aria-label', `${player} - ${isPresent ? 'present' : 'absent'}`);
        btn.innerHTML = `
            <div class="flex items-center justify-center gap-1">
                ${isPresent ? '<i data-lucide="check" class="w-4 h-4"></i>' : '<i data-lucide="x" class="w-4 h-4"></i>'}
            </div>
            <div class="mt-1 truncate">${escapeHtml(player)}</div>
            ${position ? `<div class="text-xs opacity-60">${escapeHtml(posAbbrev)}</div>` : ''}
        `;
        btn.addEventListener('click', () => toggleAttendance(player));
        container.appendChild(btn);
    });
    
    updateAttendanceCount();
    
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

function toggleAttendance(player) {
    const index = gameState.presentPlayers.indexOf(player);
    if (index === -1) {
        gameState.presentPlayers.push(player);
    } else {
        gameState.presentPlayers.splice(index, 1);
        // Also remove from on-field if they were on field
        const fieldIndex = gameState.onFieldPlayers.indexOf(player);
        if (fieldIndex !== -1) {
            gameState.onFieldPlayers.splice(fieldIndex, 1);
        }
    }
    updateAttendanceGrid();
    updateLineSelectionGrid();
    updateQuickPlayerSelect();
    saveToStorage();
}

function markAllPresent() {
    gameState.presentPlayers = [...gameState.players];
    updateAttendanceGrid();
    updateLineSelectionGrid();
    updateQuickPlayerSelect();
    saveToStorage();
    showToast('All players marked present');
}

function markAllAbsent() {
    gameState.presentPlayers = [];
    gameState.onFieldPlayers = [];
    updateAttendanceGrid();
    updateLineSelectionGrid();
    updateQuickPlayerSelect();
    saveToStorage();
    showToast('Attendance cleared');
}

function updateAttendanceCount() {
    const countEl = document.getElementById('attendance-count');
    if (countEl) {
        countEl.textContent = gameState.presentPlayers.length;
    }
}

function getPresentPlayers() {
    // If no attendance taken, return all players
    if (gameState.presentPlayers.length === 0 && gameState.players.length > 0) {
        return gameState.players;
    }
    return gameState.presentPlayers;
}

function confirmAttendance() {
    const attendanceSection = document.getElementById('attendance-section');
    const lineSelection = document.getElementById('line-selection');

    // Fade out attendance
    if (attendanceSection) attendanceSection.classList.add('section-hidden');

    setTimeout(() => {
        // Fade in line selection
        if (lineSelection) lineSelection.classList.remove('section-hidden');
        updateLineSelectionGrid();
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }, 260);

    showToast(`${gameState.presentPlayers.length} players present`);
}

function updatePlayerDropdowns() {
    const throwerSelect = document.getElementById('thrower');
    const receiverSelect = document.getElementById('receiver');

    if (!throwerSelect || !receiverSelect) return;

    const currentThrower = throwerSelect.value;
    const currentReceiver = receiverSelect.value;

    throwerSelect.innerHTML = '<option value="">Select Thrower</option>';
    receiverSelect.innerHTML = '<option value="">Select Receiver</option>';

    gameState.players.forEach(player => {
        throwerSelect.innerHTML += `<option value="${escapeHtml(player)}">${escapeHtml(player)}</option>`;
        receiverSelect.innerHTML += `<option value="${escapeHtml(player)}">${escapeHtml(player)}</option>`;
    });

    throwerSelect.value = currentThrower;
    receiverSelect.value = currentReceiver;
}

// Track whether field touch was handled to suppress the subsequent click
let _fieldTouchHandled = false;

// Quick-throw popup: skip "What happened?" and show receiver list directly
function showQuickCatchPopup(screenX, screenY, fieldX, fieldY) {
    const existing = document.getElementById('field-player-popup');
    if (existing) existing.remove();

    const popup = document.createElement('div');
    popup.id = 'field-player-popup';
    popup.className = 'fixed z-50 bg-slate-800 rounded-xl border border-white/20 shadow-2xl p-2 min-w-[160px] max-w-[calc(100vw-20px)]';
    popup.style.left = `${screenX}px`;
    popup.style.top = `${screenY}px`;
    popup.style.transform = 'translate(-50%, -100%)';

    const otherPlayers = gameState.onFieldPlayers.filter(p => p !== gameState.currentThrower);
    if (otherPlayers.length === 0) {
        showToast('No other players on field');
        return;
    }
    const sorted = sortByConnection(gameState.currentThrower, otherPlayers);

    popup.innerHTML = `
        <div class="text-xs text-gray-400 px-2 py-1 border-b border-white/10 mb-1 flex justify-between items-center">
            <span>${escapeHtml(gameState.currentThrower)} \u2192</span>
            <button onclick="event.stopPropagation(); showFieldPlayerPopup(${screenX}, ${screenY}, ${fieldX}, ${fieldY})" class="text-gray-500 hover:text-white text-[10px] px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10">\u22ef more</button>
        </div>
        ${sorted.map((player, i) => {
            const freq = getConnectionScore(gameState.currentThrower, player);
            const hot = freq > 2 ? '<span class="text-amber-400 text-[10px] ml-auto">\u2605</span>' : '';
            const highlight = i === 0 && freq > 0 ? ' bg-emerald-500/10 border border-emerald-500/20' : '';
            return `
                <button onclick="event.stopPropagation(); selectFieldReceiver('${escapeHtml(player).replace(/'/g, "\\'")}', ${fieldX}, ${fieldY})"
                    class="w-full text-left px-3 py-3 rounded-lg hover:bg-emerald-500/20 text-white text-sm font-medium transition-all flex items-center gap-2${highlight}">
                    <span class="text-lg">\ud83e\udd4f</span>
                    <span>${escapeHtml(player)}</span>
                    ${hot}
                </button>`;
        }).join('')}
        <button onclick="closeFieldPlayerPopup()" class="w-full text-center px-3 py-2 mt-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 text-xs transition-all border-t border-white/10">
            Cancel
        </button>
    `;

    document.body.appendChild(popup);
    adjustPopupPosition(popup, screenX, screenY);
    setTimeout(() => {
        document.addEventListener('click', closeFieldPlayerPopupOnOutside, { once: true });
    }, 100);
}

// ==================== SWIPE-TO-UNDO GESTURE ====================
// Two-finger horizontal swipe on the field triggers undo
let _swipeStartX = 0;
let _swipeStartY = 0;
let _swipeStartTouches = 0;

function handleFieldTouchStart(event) {
    _swipeStartTouches = event.touches.length;
    if (event.touches.length === 2) {
        // Record midpoint of two fingers
        _swipeStartX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
        _swipeStartY = (event.touches[0].clientY + event.touches[1].clientY) / 2;
    }
}

function handleFieldTouch(event) {
    // Two-finger swipe detection: check before single-tap processing
    if (_swipeStartTouches === 2 && event.changedTouches.length > 0) {
        const endX = event.changedTouches[0].clientX;
        const endY = event.changedTouches[0].clientY;
        const dx = endX - _swipeStartX;
        const dy = endY - _swipeStartY;

        // Horizontal swipe > 80px threshold, vertical < half of horizontal
        if (Math.abs(dx) > 80 && Math.abs(dy) < Math.abs(dx) / 2) {
            event.preventDefault();
            _swipeStartTouches = 0;
            hapticFeedback('swipeUndo');
            undoLastAction();
            return;
        }
        _swipeStartTouches = 0;
    }

    if (!gameState.currentGame.isActive) return;
    if (!gameState.pointInProgress) return;
    if (!event.changedTouches || event.changedTouches.length === 0) return;
    // Only process single-finger taps (not multi-touch gestures)
    if (event.touches.length > 0) return;

    const touch = event.changedTouches[0];
    event.preventDefault(); // Prevent the emulated click event

    _fieldTouchHandled = true;
    setTimeout(() => { _fieldTouchHandled = false; }, 400);

    // Build a synthetic coordinate object compatible with getContentAreaCoordinates
    const syntheticEvent = { clientX: touch.clientX, clientY: touch.clientY };
    processFieldInteraction(syntheticEvent);
}

function handleFieldClick(event) {
    // Skip if this click was already handled by touchend
    if (_fieldTouchHandled) return;

    if (!gameState.currentGame.isActive) return;
    if (!gameState.pointInProgress) return;
    processFieldInteraction(event);
}

function processFieldInteraction(event) {
    const container = document.getElementById('field-container');
    if (!container) return;

    // Use utility function that accounts for border (border-4 = 4px)
    const coords = getContentAreaCoordinates(event, container);
    const x = coords.percentX;
    const y = coords.percentY;

    // If waiting for initial disc position, set it
    if (waitingForInitialPosition && gameState.currentThrower) {
        gameState.discPosition = { x, y };
        updateDiscMarker(x, y, gameState.currentThrower);
        waitingForInitialPosition = false;
        hideFieldInstruction();
        showFieldInstruction('Tap to select next receiver', 2500);
        showToast(`Disc at ${gameState.currentThrower} - tap next catch location`);
        vibrate(30);
        return;
    }

    // If no current thrower set (opponent has disc), show defense options
    if (!gameState.currentThrower) {
        showDefensePopup(event.clientX, event.clientY, x, y);
        return;
    }

    // Quick-throw mode: skip "What happened?" menu and go straight to receiver list
    if (_quickThrowMode && gameState.currentThrower) {
        showQuickCatchPopup(event.clientX, event.clientY, x, y);
    } else {
        showFieldPlayerPopup(event.clientX, event.clientY, x, y);
    }
}

function handleFieldKeydown(event) {
    if (!gameState.currentGame.isActive) return;
    if (!gameState.pointInProgress) return;

    const STEP = 2; // percentage per key press
    const arrowKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

    if (arrowKeys.includes(event.key)) {
        event.preventDefault();
        if (!gameState.discPosition) {
            gameState.discPosition = { x: 50, y: 50 };
        }
        let { x, y } = gameState.discPosition;
        if (event.key === 'ArrowUp') y = Math.max(0, y - STEP);
        if (event.key === 'ArrowDown') y = Math.min(100, y + STEP);
        if (event.key === 'ArrowLeft') x = Math.max(0, x - STEP);
        if (event.key === 'ArrowRight') x = Math.min(100, x + STEP);
        gameState.discPosition = { x, y };
        updateDiscMarker(x, y, gameState.currentThrower || '');
        return;
    }

    if (event.key === 'Enter') {
        event.preventDefault();
        if (!gameState.discPosition) return;
        const { x, y } = gameState.discPosition;
        const container = document.getElementById('field-container');
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const screenX = rect.left + (x / 100) * rect.width;
        const screenY = rect.top + (y / 100) * rect.height;

        if (waitingForInitialPosition && gameState.currentThrower) {
            updateDiscMarker(x, y, gameState.currentThrower);
            waitingForInitialPosition = false;
            hideFieldInstruction();
            showFieldInstruction('Press Enter to select receiver', 2500);
            showToast(`Disc at ${gameState.currentThrower} - press Enter to select receiver`);
            vibrate(30);
            return;
        }
        if (!gameState.currentThrower) {
            showDefensePopup(screenX, screenY, x, y);
            return;
        }
        showFieldPlayerPopup(screenX, screenY, x, y);
    }
}

function showDefensePopup(screenX, screenY, fieldX, fieldY) {
    // Remove existing popup
    const existing = document.getElementById('field-player-popup');
    if (existing) existing.remove();
    
    const popup = document.createElement('div');
    popup.id = 'field-player-popup';
    popup.className = 'fixed z-50 bg-slate-800 rounded-xl border border-white/20 shadow-2xl p-2 min-w-[160px] max-w-[calc(100vw-20px)]';
    popup.style.left = `${screenX}px`;
    popup.style.top = `${screenY}px`;
    popup.style.transform = 'translate(-50%, -100%)';
    
    // Defense options - opponent has disc
    popup.innerHTML = `
        <div class="text-xs text-amber-400 px-2 py-1 border-b border-white/10 mb-1">⚔️ Defense - What happened?</div>
        <button onclick="recordFieldBlock(${fieldX}, ${fieldY})" 
            class="w-full text-left px-3 py-3 rounded-lg hover:bg-purple-500/20 text-purple-400 text-sm font-bold transition-all flex items-center gap-2 border-b border-white/5">
            <span class="text-lg">🛡️</span> Block
        </button>
        <button onclick="recordDefenseTurnover(${fieldX}, ${fieldY})" 
            class="w-full text-left px-3 py-3 rounded-lg hover:bg-emerald-500/20 text-emerald-400 text-sm font-bold transition-all flex items-center gap-2 border-b border-white/5">
            <span class="text-lg">✅</span> D-Turn (They dropped)
        </button>
        <button onclick="recordOpponentScore()" 
            class="w-full text-left px-3 py-3 rounded-lg hover:bg-red-500/20 text-red-400 text-sm font-bold transition-all flex items-center gap-2">
            <span class="text-lg">😞</span> They Scored
        </button>
        <button onclick="closeFieldPlayerPopup()" class="w-full text-center px-3 py-2 mt-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 text-xs transition-all border-t border-white/10">
            Cancel
        </button>
    `;
    
    document.body.appendChild(popup);
    adjustPopupPosition(popup, screenX, screenY);
    
    // Close on outside click
    setTimeout(() => {
        document.addEventListener('click', closeFieldPlayerPopupOnOutside, { once: true });
    }, 100);
}

function recordDefenseTurnover(fieldX, fieldY) {
    closeFieldPlayerPopup();
    
    // We gained possession from opponent turnover
    gameState.teamStats.turnoversGained++;
    resetPossessionThrows();
    
    // Show popup to select who picks up the disc
    showPickupPlayerPopup(fieldX, fieldY);
}

function showPickupPlayerPopup(fieldX, fieldY) {
    const popup = document.createElement('div');
    popup.id = 'field-player-popup';
    popup.className = 'fixed z-50 bg-slate-800 rounded-xl border border-white/20 shadow-2xl p-2 min-w-[160px] max-w-[calc(100vw-20px)]';
    popup.style.left = '50%';
    popup.style.top = '50%';
    popup.style.transform = 'translate(-50%, -50%)';
    
    popup.innerHTML = `
        <div class="text-xs text-gray-400 px-2 py-1 border-b border-white/10 mb-1">Who picks up the disc?</div>
        ${gameState.onFieldPlayers.map(player => {
            const position = getPlayerPosition(player);
            const posAbbrev = position === 'Hybrid' ? 'HY' : (position ? position.substring(0, 1).toUpperCase() : '');
            const posColor = getPositionColor(position);
            return `
                <button onclick="setDiscPickup('${escapeHtml(player).replace(/'/g, "\\'")}', ${fieldX}, ${fieldY})"
                    class="w-full text-left px-3 py-2 rounded-lg hover:bg-emerald-500/20 text-white text-sm font-medium transition-all flex items-center gap-2">
                    ${position ? `<span class="text-xs px-1.5 py-0.5 rounded ${posColor}">${escapeHtml(posAbbrev)}</span>` : ''}
                    <span>${escapeHtml(player)}</span>
                </button>
            `;
        }).join('')}
        <button onclick="closeFieldPlayerPopup()" class="w-full text-center px-3 py-2 mt-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 text-xs transition-all border-t border-white/10">
            Cancel
        </button>
    `;
    
    document.body.appendChild(popup);
}

function setDiscPickup(playerName, fieldX, fieldY) {
    closeFieldPlayerPopup();
    
    // Set player as thrower with disc at location
    gameState.discPosition = { x: fieldX, y: fieldY };
    gameState.currentThrower = playerName;
    gameState.selectedThrower = playerName;
    gameState.previousThrower = null;
    gameState.lastCompletedThrower = null;
    
    updateDiscMarker(fieldX, fieldY, playerName);
    updateSelectionStatus();
    updateQuickPlayerSelect();
    updateThrowCountDisplay();
    
    logAction(`✅ D-TURN! ${playerName} picks up`, 'turnover-gained');
    showToast(`${playerName} has the disc!`);
    vibrate([30, 20, 30]);
}

function recordOpponentScore() {
    closeFieldPlayerPopup();
    
    // Save state for undo
    saveActionState('opponent-score', {});
    
    // Opponent scored
    gameState.teamStats.opponentScore++;
    
    logAction(`😞 Opponent scored`, 'opponent-score');
    showToast('Opponent scored. Next point.');
    
    updateStatsDisplay();
    saveToStorage();

    // Mark this point as "scored-against" in analysis tracking
    const oppPoint = _pointHistory.find(p => p.pointNum === gameState.pointNumber);
    if (oppPoint) oppPoint.result = 'scored-against';
    refreshAnalysis();
}

function showFieldPlayerPopup(screenX, screenY, fieldX, fieldY) {
    // Remove existing popup
    const existing = document.getElementById('field-player-popup');
    if (existing) existing.remove();
    
    const popup = document.createElement('div');
    popup.id = 'field-player-popup';
    popup.className = 'fixed z-50 bg-slate-800 rounded-xl border border-white/20 shadow-2xl p-2 min-w-[160px] max-w-[calc(100vw-20px)]';
    popup.style.left = `${screenX}px`;
    popup.style.top = `${screenY}px`;
    popup.style.transform = 'translate(-50%, -100%)';
    
    // Show event type selection first
    popup.innerHTML = `
        <div class="text-xs text-gray-400 px-2 py-1 border-b border-white/10 mb-1">What happened?</div>
        <button onclick="event.stopPropagation(); showCatchPlayerList(${screenX}, ${screenY}, ${fieldX}, ${fieldY})" 
            class="w-full text-left px-3 py-3 rounded-lg hover:bg-emerald-500/20 text-emerald-400 text-sm font-bold transition-all flex items-center gap-2 border-b border-white/5">
            <span class="text-lg">🥏</span> Catch
        </button>
        <button onclick="event.stopPropagation(); recordFieldBlock(${fieldX}, ${fieldY})" 
            class="w-full text-left px-3 py-3 rounded-lg hover:bg-purple-500/20 text-purple-400 text-sm font-bold transition-all flex items-center gap-2 border-b border-white/5">
            <span class="text-lg">🛡️</span> Block
        </button>
        <button onclick="event.stopPropagation(); recordFieldTurnover(${fieldX}, ${fieldY})" 
            class="w-full text-left px-3 py-3 rounded-lg hover:bg-red-500/20 text-red-400 text-sm font-bold transition-all flex items-center gap-2">
            <span class="text-lg">❌</span> Turnover
        </button>
        <button onclick="closeFieldPlayerPopup()" class="w-full text-center px-3 py-2 mt-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 text-xs transition-all border-t border-white/10">
            Cancel
        </button>
    `;
    
    document.body.appendChild(popup);
    adjustPopupPosition(popup, screenX, screenY);
    
    // Close on outside click
    setTimeout(() => {
        document.addEventListener('click', closeFieldPlayerPopupOnOutside, { once: true });
    }, 100);
}

function showCatchPlayerList(screenX, screenY, fieldX, fieldY) {
    const popup = document.getElementById('field-player-popup');
    if (!popup) return;
    
    // Get other on-field players (exclude current thrower)
    const otherPlayers = gameState.onFieldPlayers.filter(p => p !== gameState.currentThrower);
    
    if (otherPlayers.length === 0) {
        showToast('No other players on field');
        closeFieldPlayerPopup();
        return;
    }
    
    // Header showing current thrower
    const header = gameState.currentThrower 
        ? `<div class="text-xs text-gray-400 px-2 py-1 border-b border-white/10 mb-1">${escapeHtml(gameState.currentThrower)} throws to:</div>`
        : `<div class="text-xs text-gray-400 px-2 py-1 border-b border-white/10 mb-1">Select receiver:</div>`;
    
    // Sort receivers by connection frequency with current thrower
    const sorted = sortByConnection(gameState.currentThrower, otherPlayers);

    popup.innerHTML = header + sorted.map((player, i) => {
        const position = getPlayerPosition(player);
        const posAbbrev = position === 'Hybrid' ? 'HY' : (position ? position.substring(0, 1).toUpperCase() : '');
        const posColor = getPositionColor(position);
        const freq = getConnectionScore(gameState.currentThrower, player);
        const hot = freq > 2 ? '<span class="text-amber-400 text-[10px] ml-auto">\u2605</span>' : '';
        const highlight = i === 0 && freq > 0 ? ' bg-emerald-500/10' : '';
        return `
            <button onclick="event.stopPropagation(); selectFieldReceiver('${escapeHtml(player).replace(/'/g, "\\'")}', ${fieldX}, ${fieldY})"
                class="w-full text-left px-3 py-2 rounded-lg hover:bg-white/10 text-white text-sm font-medium transition-all flex items-center gap-2${highlight}">
                ${position ? `<span class="text-xs px-1.5 py-0.5 rounded ${posColor}">${escapeHtml(posAbbrev)}</span>` : ''}
                <span>${escapeHtml(player)}</span>
                ${hot}
            </button>
        `;
    }).join('');
    
    // Add back/cancel button
    popup.innerHTML += `
        <button onclick="event.stopPropagation(); showFieldPlayerPopup(${screenX}, ${screenY}, ${fieldX}, ${fieldY})" class="w-full text-center px-3 py-2 mt-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 text-xs transition-all border-t border-white/10">
            ← Back
        </button>
    `;
}

function recordFieldBlock(fieldX, fieldY) {
    closeFieldPlayerPopup();
    
    // Show player selection for who got the block
    showBlockPlayerPopup(fieldX, fieldY);
}

function showBlockPlayerPopup(fieldX, fieldY) {
    const popup = document.createElement('div');
    popup.id = 'field-player-popup';
    popup.className = 'fixed z-50 bg-slate-800 rounded-xl border border-white/20 shadow-2xl p-2 min-w-[160px] max-w-[calc(100vw-20px)]';
    popup.style.left = '50%';
    popup.style.top = '50%';
    popup.style.transform = 'translate(-50%, -50%)';
    
    popup.innerHTML = `
        <div class="text-xs text-gray-400 px-2 py-1 border-b border-white/10 mb-1">Who got the block?</div>
        ${gameState.onFieldPlayers.map(player => {
            const position = getPlayerPosition(player);
            const posAbbrev = position === 'Hybrid' ? 'HY' : (position ? position.substring(0, 1).toUpperCase() : '');
            const posColor = getPositionColor(position);
            return `
                <button onclick="confirmBlock('${escapeHtml(player).replace(/'/g, "\\'")}', ${fieldX}, ${fieldY})"
                    class="w-full text-left px-3 py-2 rounded-lg hover:bg-purple-500/20 text-white text-sm font-medium transition-all flex items-center gap-2">
                    ${position ? `<span class="text-xs px-1.5 py-0.5 rounded ${posColor}">${escapeHtml(posAbbrev)}</span>` : ''}
                    <span>${escapeHtml(player)}</span>
                </button>
            `;
        }).join('')}
        <button onclick="closeFieldPlayerPopup()" class="w-full text-center px-3 py-2 mt-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 text-xs transition-all border-t border-white/10">
            Cancel
        </button>
    `;
    
    document.body.appendChild(popup);
}

function confirmBlock(playerName, fieldX, fieldY) {
    closeFieldPlayerPopup();
    
    // Save state for undo
    saveActionState('block', { player: playerName, fieldX, fieldY });
    
    // Record the block
    gameState.playerStats[playerName].blocks = (gameState.playerStats[playerName].blocks || 0) + 1;
    updateAggregateStats(playerName, 'blocks');
    gameState.teamStats.turnoversGained++;
    
    // Reset possession - we gained it
    resetPossessionThrows();
    
    // Update disc position to block location, player who blocked now has disc
    gameState.discPosition = { x: fieldX, y: fieldY };
    gameState.previousThrower = null;
    gameState.lastCompletedThrower = null;
    gameState.currentThrower = playerName;
    gameState.selectedThrower = playerName;
    
    updateDiscMarker(fieldX, fieldY, playerName);
    updateSelectionStatus();
    updateQuickPlayerSelect();
    updateThrowCountDisplay();
    updateStatsDisplay();
    updatePlayerList();
    
    logAction(`🛡️ BLOCK by ${playerName}!`, 'block');
    showToast(`Block by ${playerName}! Your possession.`);
    hapticFeedback('block');
    playSound('block');
    refreshAnalysis();
}

function recordFieldTurnover(fieldX, fieldY) {
    closeFieldPlayerPopup();
    
    // Record turnover for our team
    gameState.teamStats.turnovers++;
    
    // Assign to current thrower if we have one
    if (gameState.currentThrower && gameState.playerStats[gameState.currentThrower]) {
        gameState.playerStats[gameState.currentThrower].turnovers = 
            (gameState.playerStats[gameState.currentThrower].turnovers || 0) + 1;
        updateAggregateStats(gameState.currentThrower, 'turnovers');
    }
    
    // Reset possession
    resetPossessionThrows();
    
    // Clear disc state - opponent has it now
    gameState.discPosition = null;
    gameState.currentThrower = null;
    gameState.selectedThrower = null;
    gameState.previousThrower = null;
    gameState.lastCompletedThrower = null;
    
    // Remove disc marker
    const marker = document.getElementById('disc-marker');
    if (marker) marker.remove();
    
    updateSelectionStatus();
    updateQuickPlayerSelect();
    updateThrowCountDisplay();
    updateStatsDisplay();
    updatePlayerList();
    
    logAction(`❌ TURNOVER - Opponent's disc`, 'turnover');
    showToast('Turnover! Opponent possession.');
    hapticFeedback('turnover');
    playSound('turnover');
}

function adjustPopupPosition(popup, screenX, screenY) {
    const popupRect = popup.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Bottom overflow: reposition so popup fits above the bottom edge
    if (popupRect.bottom > vh - 10) {
        popup.style.top = `${Math.max(10, vh - popupRect.height - 10)}px`;
        popup.style.transform = 'translate(-50%, 0)';
    }
    // Top overflow
    if (popupRect.top < 10) {
        popup.style.top = '10px';
        popup.style.transform = 'translate(-50%, 0)';
    }
    // Left overflow
    if (popupRect.left < 10) {
        popup.style.left = '10px';
        popup.style.transform = 'translateY(-100%)';
    }
    // Right overflow
    if (popupRect.right > vw - 10) {
        popup.style.left = `${vw - popupRect.width - 10}px`;
        popup.style.transform = 'translateY(-100%)';
    }
}

function closeFieldPlayerPopup() {
    const popup = document.getElementById('field-player-popup');
    if (popup) popup.remove();
    // Remove the outside click listener to prevent it from closing the next popup
    document.removeEventListener('click', closeFieldPlayerPopupOnOutside);
}

function closeFieldPlayerPopupOnOutside(event) {
    const popup = document.getElementById('field-player-popup');
    // Don't close if clicking inside the field container (let handleFieldClick handle it)
    const fieldContainer = document.getElementById('field-container');
    if (fieldContainer && fieldContainer.contains(event.target)) {
        return; // Let the field click handler create a new popup
    }
    if (popup && !popup.contains(event.target)) {
        popup.remove();
    }
}

function selectFieldReceiver(receiver, fieldX, fieldY) {
    closeFieldPlayerPopup();
    
    const thrower = gameState.currentThrower;
    const startPos = gameState.discPosition || { x: 50, y: 20 }; // Default to center if no position
    const endPos = { x: fieldX, y: fieldY };
    
    // Calculate distance
    const distance = calculateDistance(startPos, endPos);
    
    // Check if catch is in the endzone (GOAL!) - check Y coordinate (vertical position)
    const endzone = isInEndzone(fieldY);
    if (endzone === 'their') {
        // This is a GOAL!
        recordEndzoneScore(thrower, receiver, distance, startPos, endPos);
        return;
    }
    
    if (thrower) {
        // Record the throw
        recordThrow(thrower, receiver, distance, startPos, endPos);
    }
    
    // Update disc position and current thrower
    gameState.discPosition = endPos;
    gameState.previousThrower = gameState.lastCompletedThrower;
    gameState.lastCompletedThrower = thrower;
    gameState.currentThrower = receiver;
    
    // Update disc marker on field
    updateDiscMarker(fieldX, fieldY, receiver);
    
    // Update quick select to show current thrower
    gameState.selectedThrower = receiver;
    gameState.selectedReceiver = null;
    updateSelectionStatus();
    updateQuickPlayerSelect();
    
    vibrate(30);
}

function recordEndzoneScore(thrower, receiver, distance, startPos, endPos) {
    // Save state for undo
    saveActionState('goal', { thrower, receiver, distance });
    trackConnection(thrower, receiver);

    // Record the throw stats
    if (thrower) {
        gameState.playerStats[thrower].throws = (gameState.playerStats[thrower].throws || 0) + 1;
        gameState.playerStats[thrower].assists = (gameState.playerStats[thrower].assists || 0) + 1;
        gameState.playerStats[thrower].yardsThrown += distance;
        updateAggregateStats(thrower, 'throws');
        updateAggregateStats(thrower, 'assists');
        updateAggregateStats(thrower, 'yardsThrown', distance);
    }
    
    // Record receiver stats (goal + catch)
    gameState.playerStats[receiver].catches = (gameState.playerStats[receiver].catches || 0) + 1;
    gameState.playerStats[receiver].goals = (gameState.playerStats[receiver].goals || 0) + 1;
    gameState.playerStats[receiver].yardsCaught += distance;
    updateAggregateStats(receiver, 'catches');
    updateAggregateStats(receiver, 'goals');
    updateAggregateStats(receiver, 'yardsCaught', distance);
    
    // Hockey assist
    if (gameState.lastCompletedThrower && gameState.lastCompletedThrower !== thrower) {
        gameState.playerStats[gameState.lastCompletedThrower].hockeyAssists = 
            (gameState.playerStats[gameState.lastCompletedThrower].hockeyAssists || 0) + 1;
        updateAggregateStats(gameState.lastCompletedThrower, 'hockeyAssists');
    }
    
    // Update point and possession throw counts
    gameState.pointThrows = (gameState.pointThrows || 0) + 1;
    gameState.possessionThrows = (gameState.possessionThrows || 0) + 1;
    
    // Store point throws for this point
    gameState.totalPointThrows.push(gameState.pointThrows);
    
    // Update team score
    gameState.teamStats.score++;
    gameState.teamStats.totalYardsThrown += distance;
    gameState.teamStats.totalYardsCaught += distance;
    
    // Add visual elements
    addThrowLine(startPos, endPos);
    addClickPoint(endPos.x, endPos.y, 'score');
    
    // Update disc marker briefly at score location
    updateDiscMarker(endPos.x, endPos.y, receiver);
    
    // Log and notify
    const throwerName = thrower || 'Unknown';
    logAction(`🎉 GOAL! ${throwerName} → ${receiver} (${distance} yards)`, 'score');
    showToast(`🎉 GOAL! ${receiver} scores!`);
    hapticFeedback('endzoneScore');
    playSound('score');
    
    updateStatsDisplay();
    updatePlayerList();
    saveToStorage();
    
    // End the point and go to next point setup
    endPointAfterScore();
}

function endPointAfterScore() {
    // Mark this point as "scored" in analysis tracking
    const scoredPoint = _pointHistory.find(p => p.pointNum === gameState.pointNumber);
    if (scoredPoint) scoredPoint.result = 'scored';
    refreshAnalysis();

    gameState.pointInProgress = false;

    // Increment point counter
    gameState.pointNumber = (gameState.pointNumber || 1) + 1;
    updatePointCounter();
    
    // Clear disc state
    gameState.discPosition = null;
    gameState.currentThrower = null;
    gameState.selectedThrower = null;
    gameState.selectedReceiver = null;
    gameState.previousThrower = null;
    gameState.lastCompletedThrower = null;
    
    // Hide disc marker (don't remove - it's defined in HTML)
    const marker = document.getElementById('disc-marker');
    if (marker) marker.classList.add('hidden');
    
    // Clear field visual elements (throw lines, click points)
    clearFieldVisuals();
    
    // Fade out field, fade in line selection for next point
    safeElement('field-section', el => el.classList.add('section-hidden'));
    setTimeout(() => {
        safeElement('line-selection', el => el.classList.remove('section-hidden'));
    }, 260);
    
    // Reset on-field players for next point selection
    gameState.onFieldPlayers = [];
    updateLineSelectionGrid();
    updateOnFieldDisplay();
    
    logAction(`Point ${gameState.pointNumber - 1} complete - select line for next point`, 'system');
    
    // Show brief point summary
    showPointSummary();
}

function showPointSummary() {
    const pointNum = gameState.pointNumber - 1;
    const throws = gameState.pointThrows || 0;
    const score = gameState.teamStats.score;
    const oppScore = gameState.teamStats.opponentScore || 0;
    
    // Create summary toast
    const summaryEl = document.createElement('div');
    summaryEl.className = 'fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-slate-800/95 backdrop-blur-xl p-6 rounded-2xl border border-white/20 shadow-2xl z-50 text-center animate-pulse';
    summaryEl.innerHTML = `
        <div class="text-2xl font-bold text-emerald-400 mb-2">Point ${pointNum} Complete!</div>
        <div class="flex items-center justify-center gap-6 mb-4">
            <div class="text-center">
                <div class="text-3xl font-bold text-white">${score}</div>
                <div class="text-xs text-gray-400">Us</div>
            </div>
            <div class="text-gray-500">-</div>
            <div class="text-center">
                <div class="text-3xl font-bold text-white">${oppScore}</div>
                <div class="text-xs text-gray-400">Them</div>
            </div>
        </div>
        <div class="text-sm text-gray-400">${throws} throw${throws !== 1 ? 's' : ''} this point</div>
    `;
    
    document.body.appendChild(summaryEl);
    
    // Auto-dismiss after 2 seconds
    setTimeout(() => {
        summaryEl.style.opacity = '0';
        summaryEl.style.transition = 'opacity 0.3s';
        setTimeout(() => summaryEl.remove(), 300);
    }, 2000);
    
    // Reset point throws for next point
    gameState.pointThrows = 0;
}

function clearFieldVisuals() {
    const container = document.getElementById('field-container');
    if (!container) return;
    
    // Only remove dynamically-added elements (throw lines and click points)
    // These have specific classes we add: 'throw-line', 'click-point', 'throw-arc'
    const throwLines = container.querySelectorAll('.throw-line, .click-point, .throw-arc');
    throwLines.forEach(el => el.remove());
}

function updateDiscMarker(x, y, playerName) {
    const marker = document.getElementById('disc-marker');
    const label = document.getElementById('disc-player-label');
    
    if (!marker) return;
    
    // Position the disc marker using percentage-based left/top
    marker.style.left = `${x}%`;
    marker.style.top = `${y}%`;
    marker.classList.remove('hidden');
    
    // Visual feedback - brief scale animation
    const discCircle = marker.querySelector('div');
    if (discCircle) {
        discCircle.style.transform = 'scale(1.3)';
        setTimeout(() => { discCircle.style.transform = 'scale(1)'; }, 150);
    }
    
    // Update player label
    if (label) {
        label.textContent = playerName ? playerName.split(' ')[0] : '';
    }
}

function hideDiscMarker() {
    const marker = document.getElementById('disc-marker');
    if (marker) marker.classList.add('hidden');
}

function setInitialDiscPosition(x, y, player) {
    gameState.discPosition = { x, y };
    gameState.currentThrower = player;
    updateDiscMarker(x, y, player);
    gameState.selectedThrower = player;
    updateSelectionStatus();
    updateQuickPlayerSelect();
}

function updateThrowCountDisplay() {
    const pointEl = document.getElementById('point-throws-count');
    const possessionEl = document.getElementById('possession-throws-count');
    const throwerEl = document.getElementById('current-thrower-display');
    
    if (pointEl) pointEl.textContent = gameState.pointThrows || 0;
    if (possessionEl) possessionEl.textContent = gameState.possessionThrows || 0;
    if (throwerEl && gameState.currentThrower) {
        const pos = getPlayerPosition(gameState.currentThrower);
        const posAbbrev = pos === 'Hybrid' ? 'HY' : (pos ? pos.substring(0, 1).toUpperCase() : '');
        throwerEl.innerHTML = `<span class="text-gray-500">Disc:</span> <span class="font-bold text-white">${posAbbrev ? escapeHtml(posAbbrev) + ' ' : ''}${escapeHtml(gameState.currentThrower)}</span>`;
    } else if (throwerEl) {
        throwerEl.innerHTML = '';
    }
    
    // Update possession indicator
    updatePossessionIndicator();
}

function updatePossessionIndicator() {
    const indicator = document.getElementById('possession-indicator');
    if (!indicator) return;
    
    const hasDisc = gameState.currentThrower !== null;
    
    if (hasDisc) {
        indicator.innerHTML = `
            <div class="w-3 h-3 rounded-full bg-emerald-500 animate-pulse"></div>
            <span class="text-sm font-bold text-emerald-400">OFFENSE</span>
        `;
    } else {
        indicator.innerHTML = `
            <div class="w-3 h-3 rounded-full bg-amber-500 animate-pulse"></div>
            <span class="text-sm font-bold text-amber-400">DEFENSE</span>
        `;
    }
}

function resetPossessionThrows() {
    gameState.possessionThrows = 0;
    updateThrowCountDisplay();
}

function calculateDistance(point1, point2) {
    // Convert percentage coordinates to real-world yards
    // Field is 120 yards long (Y axis: 0-100%) and 40 yards wide (X axis: 0-100%)
    const yardsDeltaY = (point2.y - point1.y) * 1.2; // 100% = 120 yards
    const yardsDeltaX = (point2.x - point1.x) * 0.4; // 100% = 40 yards
    const realWorldDistance = Math.sqrt(yardsDeltaX * yardsDeltaX + yardsDeltaY * yardsDeltaY);
    return Math.round(realWorldDistance);
}

function recordThrow(thrower, receiver, distance, startPoint, endPoint) {
    // Save state for undo
    saveActionState('throw', { thrower, receiver, distance });
    trackConnection(thrower, receiver);

    // Update player stats - throws and catches
    gameState.playerStats[thrower].throws = (gameState.playerStats[thrower].throws || 0) + 1;
    gameState.playerStats[receiver].catches = (gameState.playerStats[receiver].catches || 0) + 1;
    gameState.playerStats[thrower].yardsThrown += distance;
    gameState.playerStats[receiver].yardsCaught += distance;

    // Update point and possession throw counts
    gameState.pointThrows = (gameState.pointThrows || 0) + 1;
    gameState.possessionThrows = (gameState.possessionThrows || 0) + 1;
    updateThrowCountDisplay();

    // Update team stats
    gameState.teamStats.totalYardsThrown += distance;
    gameState.teamStats.totalYardsCaught += distance;

    // Update aggregate stats (season/tournament/career)
    updateAggregateStats(thrower, 'throws');
    updateAggregateStats(receiver, 'catches');
    updateAggregateStats(thrower, 'yardsThrown', distance);
    updateAggregateStats(receiver, 'yardsCaught', distance);

    // Add visual elements
    addThrowLine(startPoint, endPoint);
    addClickPoint(endPoint.x, endPoint.y, 'throw-end');

    // Log action
    logAction(`${thrower} → ${receiver} (${distance} yards)`, 'throw');

    // Update displays
    updateStatsDisplay();
    updatePlayerList();
    saveToStorage();
    
    // Auto-advance: receiver becomes the new thrower (for quick select)
    autoAdvanceThrower();
    
    // Also update dropdowns: receiver becomes thrower for next throw
    const throwerSelect = document.getElementById('thrower');
    const receiverSelect = document.getElementById('receiver');
    if (throwerSelect && receiverSelect) {
        throwerSelect.value = receiver;
        receiverSelect.value = '';
    }
}

function recordTurnover(x, y, team) {
    if (team === 'our') {
        gameState.teamStats.turnovers++;
        // Find nearest player to assign turnover (simplified)
        const nearestPlayer = findNearestPlayer(x, y);
        if (nearestPlayer) {
            gameState.playerStats[nearestPlayer].turnovers++;
            updateAggregateStats(nearestPlayer, 'turnovers');
        }
        logAction(`Turnover by our team`, 'turnover');
    } else {
        // D/Block - we gained possession
        gameState.teamStats.turnoversGained++;
        logAction(`Turnover gained from opponent`, 'turnover-gained');
    }
    
    // Reset possession throw counter on any turnover
    resetPossessionThrows();

    addTurnoverMarker(x, y, team);
    updateStatsDisplay();
    updatePlayerList();
}

function recordScore(thrower, receiver, x, y) {
    // Update player stats
    gameState.playerStats[thrower].assists++;
    gameState.playerStats[receiver].goals++;
    gameState.playerStats[thrower].yardsThrown += 20; // Estimated scoring distance
    gameState.playerStats[receiver].yardsCaught += 20;

    // Update team stats
    gameState.teamStats.score++;
    gameState.teamStats.totalYardsThrown += 20;
    gameState.teamStats.totalYardsCaught += 20;

    // Update aggregate stats (season/tournament/career)
    updateAggregateStats(thrower, 'assists');
    updateAggregateStats(receiver, 'goals');
    updateAggregateStats(thrower, 'yardsThrown', 20);
    updateAggregateStats(receiver, 'yardsCaught', 20);

    // Add visual elements
    addClickPoint(x, y, 'score');

    // Log action
    logAction(`GOAL! ${thrower} → ${receiver}`, 'score');

    // Update displays
    updateStatsDisplay();
    saveToStorage();
    updatePlayerList();
}

async function selectPlayerForBlock(playerName) {
    const blocks = await showScoreInputModal(`Blocks for ${playerName}`, 1);
    if (blocks && !isNaN(blocks) && parseInt(blocks) > 0) {
        const blockCount = parseInt(blocks);
        gameState.playerStats[playerName].blocks += blockCount;
        updateAggregateStats(playerName, 'blocks', blockCount);

        // Reset possession counter - we gained possession
        resetPossessionThrows();

        updateStatsDisplay();
        updatePlayerList();
        logAction(`${playerName} +${blockCount} block${blockCount > 1 ? 's' : ''}`, 'block');
    }
}

function findNearestPlayer(x, y) {
    // Return a player from on-field players if available, otherwise from current thrower
    // Priority: current thrower > on-field players > all players
    if (gameState.currentThrower) {
        return gameState.currentThrower;
    }
    if (gameState.onFieldPlayers.length > 0) {
        return gameState.onFieldPlayers[0];
    }
    return gameState.players.length > 0 ? gameState.players[0] : null;
}

function addClickPoint(x, y, type) {
    const container = document.getElementById('field-container');
    if (!container) return;
    
    const point = document.createElement('div');
    point.className = 'click-point absolute w-2 h-2 rounded-full pointer-events-none -translate-x-1/2 -translate-y-1/2';
    point.style.left = `${x}%`;
    point.style.top = `${y}%`;
    
    if (type === 'score') {
        point.classList.add('bg-emerald-500');
    } else if (type === 'throw-end') {
        point.classList.add('bg-cyan-400');
    } else {
        point.classList.add('bg-white/50');
    }
    
    container.appendChild(point);
}

function addThrowLine(startPoint, endPoint) {
    const container = document.getElementById('field-container');
    if (!container) return;
    
    // Get actual container dimensions to account for aspect ratio
    const containerWidth = container.offsetWidth;
    const containerHeight = container.offsetHeight;
    
    // Convert percentage to pixels for proper angle calculation
    const startX = (startPoint.x / 100) * containerWidth;
    const startY = (startPoint.y / 100) * containerHeight;
    const endX = (endPoint.x / 100) * containerWidth;
    const endY = (endPoint.y / 100) * containerHeight;
    
    // Calculate in pixels
    const dx = endX - startX;
    const dy = endY - startY;
    const lengthPx = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    
    const line = document.createElement('div');
    line.className = 'throw-line absolute h-0.5 bg-white/30 pointer-events-none origin-left';
    line.style.left = `${startPoint.x}%`;
    line.style.top = `${startPoint.y}%`;
    line.style.width = `${lengthPx}px`;
    line.style.transform = `rotate(${angle}deg)`;
    
    container.appendChild(line);
}

function addTurnoverMarker(x, y, team) {
    const container = document.getElementById('turnover-markers');
    if (!container) return;
    
    const marker = document.createElement('div');
    marker.className = `turnover-marker turnover-${team}`;
    // x and y are already percentage coordinates (0-100)
    marker.style.left = `${x}%`;
    marker.style.top = `${y}%`;
    container.appendChild(marker);
}

function handleActionTypeChange() {
    const actionType = document.getElementById('action-type').value;
    const throwerSelect = document.getElementById('thrower');
    const receiverSelect = document.getElementById('receiver');

    if (actionType === 'throw' || actionType === 'score') {
        throwerSelect.style.display = 'inline-block';
        receiverSelect.style.display = 'inline-block';
    } else {
        throwerSelect.style.display = 'none';
        receiverSelect.style.display = 'none';
    }

    // Reset throw progress
    gameState.throwInProgress = false;
    gameState.lastClickPoint = null;
}

function updateStatsDisplay() {
    // Update team stats (with null checks)
    const teamScoreEl = document.getElementById('team-score');
    const teamTurnoversEl = document.getElementById('team-turnovers');
    const totalYardsThrownEl = document.getElementById('total-yards-thrown');
    const totalYardsCaughtEl = document.getElementById('total-yards-caught');
    
    if (teamScoreEl) teamScoreEl.textContent = gameState.teamStats.score;
    if (teamTurnoversEl) teamTurnoversEl.textContent = gameState.teamStats.turnovers;
    if (totalYardsThrownEl) totalYardsThrownEl.textContent = gameState.teamStats.totalYardsThrown;
    if (totalYardsCaughtEl) totalYardsCaughtEl.textContent = gameState.teamStats.totalYardsCaught;
    
    // Update field score display
    const ourScoreDisplay = document.getElementById('our-score-display');
    const opponentScoreDisplay = document.getElementById('opponent-score-display');
    const ourTeamLabel = document.getElementById('our-team-label');
    const opponentTeamLabel = document.getElementById('opponent-team-label');
    
    if (ourScoreDisplay) ourScoreDisplay.textContent = gameState.teamStats.score;
    if (opponentScoreDisplay) opponentScoreDisplay.textContent = gameState.teamStats.opponentScore || 0;
    
    // Use team name from auth or game setup
    if (ourTeamLabel) {
        ourTeamLabel.textContent = currentTeam?.name || gameState.currentGame?.ourTeam || 'US';
    }
    if (opponentTeamLabel) {
        opponentTeamLabel.textContent = gameState.currentGame?.opponentTeam || 'THEM';
    }

    // Update player stats table
    const tbody = document.getElementById('player-stats-table');
    if (!tbody) return;
    tbody.innerHTML = '';

    gameState.players.forEach(player => {
        const stats = gameState.playerStats[player];
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="px-4 py-3 font-medium text-white">${escapeHtml(player)}</td>
            <td class="px-4 py-3 text-center stat-number text-emerald-400 font-semibold">${stats.goals}</td>
            <td class="px-4 py-3 text-center stat-number text-cyan-400 font-semibold">${stats.assists}</td>
            <td class="px-4 py-3 text-center stat-number text-purple-400 font-semibold">${stats.blocks}</td>
            <td class="px-4 py-3 text-center stat-number text-red-400 font-semibold">${stats.turnovers}</td>
            <td class="px-4 py-3 text-center stat-number text-blue-400 font-semibold">${stats.yardsThrown}</td>
            <td class="px-4 py-3 text-center stat-number text-amber-400 font-semibold">${stats.yardsCaught}</td>
        `;
        tbody.appendChild(row);
    });
}

function clearActionsList() {
    const actionLog = document.getElementById('action-log') || document.getElementById('actions-list');
    if (actionLog) {
        actionLog.innerHTML = '<div class="text-gray-500">Actions cleared</div>';
    }
    gameState.actions = [];
    showToast('Actions cleared');
}

function toggleActionsExpanded() {
    const actionsList = document.getElementById('actions-list');
    const chevron = document.getElementById('actions-chevron');

    if (!actionsList) return;

    const isExpanding = actionsList.classList.contains('max-h-32');
    if (isExpanding) {
        actionsList.classList.remove('max-h-32');
        actionsList.classList.add('max-h-96');
        if (chevron) chevron.style.transform = 'rotate(180deg)';
    } else {
        actionsList.classList.remove('max-h-96');
        actionsList.classList.add('max-h-32');
        if (chevron) chevron.style.transform = 'rotate(0deg)';
    }

    const toggleBtn = chevron?.closest('button');
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', String(isExpanding));
}

function updatePointCounter() {
    const pointCounter = document.getElementById('point-counter');
    if (pointCounter) {
        pointCounter.textContent = `Point ${gameState.pointNumber}`;
    }
}

function logAction(description, type) {
    const actionLog = document.getElementById('action-log') || document.getElementById('actions-list');
    
    if (actionLog) {
        const actionItem = document.createElement('div');
        actionItem.className = `action-item action-log-item ${type}`;
        
        const timestamp = new Date().toLocaleTimeString();
        actionItem.innerHTML = `
            <div class="flex justify-between items-center">
                <span class="font-medium text-white">${escapeHtml(description)}</span>
                <span class="text-xs text-gray-400">${timestamp}</span>
            </div>
        `;
        
        actionLog.insertBefore(actionItem, actionLog.firstChild);
        
        // Keep only last 20 actions
        while (actionLog.children.length > 20) {
            actionLog.removeChild(actionLog.lastChild);
        }
    }

    // Store action for Google Sheets sync
    gameState.actions.push({
        timestamp: new Date().toISOString(),
        description,
        type,
        gameState: JSON.parse(JSON.stringify(gameState))
    });

    // Queue to IndexedDB sync queue for offline resilience
    if (syncQueue && gameState.currentGame.isActive && type !== 'system') {
        syncQueue.enqueue({
            type: 'gameAction',
            gameId: gameState.currentGame.id,
            action: { timestamp: new Date().toISOString(), description, type }
        }).catch(() => {});
    }
}

function exportGameData() {
    const game = gameState.currentGame;
    const stats = gameState.teamStats;
    const playerStats = gameState.playerStats;
    
    // Build CSV content
    let csv = 'Ultimate Stats Export\n';
    csv += `Game: ${game.ourTeam} vs ${game.opponentTeam}\n`;
    csv += `Date: ${game.date}\n`;
    csv += `Final Score: ${stats.score} - ${stats.opponentScore || 0}\n`;
    csv += `Total Points: ${gameState.pointNumber - 1}\n`;
    csv += `Game Time: ${formatTime(gameState.gameTimerSeconds)}\n\n`;
    
    // Player stats header
    csv += 'Player,Goals,Assists,Blocks,Turnovers,Yards Thrown,Yards Caught\n';
    
    // Player stats rows
    Object.entries(playerStats).forEach(([player, pStats]) => {
        csv += `${player},${pStats.goals || 0},${pStats.assists || 0},${pStats.blocks || 0},${pStats.turnovers || 0},${pStats.yardsThrown || 0},${pStats.yardsCaught || 0}\n`;
    });
    
    // Create and trigger download
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `game-stats-${game.ourTeam}-vs-${game.opponentTeam}-${game.date}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showToast('Game data exported!', 'success');
    logAction('Game data exported to CSV', 'system');
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// Google Sheets API Functions
function gapiLoaded() {
    gapi.load('client', initializeGapiClient);
}

function gisLoaded() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: ''
    });
    gisInited = true;
    maybeEnableButtons();
}

async function initializeGapiClient() {
    await gapi.client.init({
        apiKey: API_KEY,
        discoveryDocs: [DISCOVERY_DOC],
    });
    gapiInited = true;
    maybeEnableButtons();
}

function maybeEnableButtons() {
    if (gapiInited && gisInited) {
        document.getElementById('authorize_button').style.visibility = 'visible';
    }
}

function handleAuthClick() {
    tokenClient.callback = async (resp) => {
        if (resp.error !== undefined) {
            throw (resp);
        }
        document.getElementById('signout_button').style.visibility = 'visible';
        document.getElementById('authorize_button').innerText = 'Refresh';
        await syncToGoogleSheets();
    };

    if (gapi.client.getToken() === null) {
        tokenClient.requestAccessToken({prompt: 'consent'});
    } else {
        tokenClient.requestAccessToken({prompt: ''});
    }
}

function handleSignoutClick() {
    const token = gapi.client.getToken();
    if (token !== null) {
        google.accounts.oauth2.revoke(token.access_token);
        gapi.client.setToken('');
        document.getElementById('authorize_button').innerText = 'Connect Google Sheets';
        document.getElementById('signout_button').style.visibility = 'hidden';
    }
}

async function syncToGoogleSheets() {
    if (!gameState.currentGame.sheetId) {
        showToast('Please enter a Google Sheet ID', 'error');
        return;
    }

    try {
        // Create or update the spreadsheet with game data
        await createGameDataSheet();
        await syncPlayerStats();
        await syncTeamStats();
        
        logAction('Data synced to Google Sheets', 'system');
    } catch (error) {
        console.error('Error syncing to Google Sheets:', error);
        showToast('Error syncing to Google Sheets: ' + error.message, 'error');
    }
}

async function createGameDataSheet() {
    const sheetId = gameState.currentGame.sheetId;
    
    // Create game info sheet
    const gameInfoRange = 'Game Info!A1:D4';
    const gameInfoValues = [
        ['Game Information', '', '', ''],
        ['Date', gameState.currentGame.date, 'Our Team', gameState.currentGame.ourTeam],
        ['Opponent', gameState.currentGame.opponentTeam, 'Final Score', `${gameState.teamStats.score} - ?`],
        ['Total Actions', gameState.actions.length, 'Sync Time', new Date().toLocaleString()]
    ];

    await gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: gameInfoRange,
        valueInputOption: 'USER_ENTERED',
        resource: { values: gameInfoValues }
    });
}

async function syncPlayerStats() {
    const sheetId = gameState.currentGame.sheetId;
    const playerStatsRange = 'Player Stats!A1:H' + (gameState.players.length + 1);
    
    const headers = ['Player', 'Goals', 'Assists', 'Blocks', 'Turnovers', 'Yards Thrown', 'Yards Caught', 'Total Points'];
    const values = [headers];
    
    gameState.players.forEach(player => {
        const stats = gameState.playerStats[player];
        const totalPoints = stats.goals + stats.assists + stats.blocks;
        values.push([
            player,
            stats.goals,
            stats.assists,
            stats.blocks,
            stats.turnovers,
            stats.yardsThrown,
            stats.yardsCaught,
            totalPoints
        ]);
    });

    await gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: playerStatsRange,
        valueInputOption: 'USER_ENTERED',
        resource: { values }
    });
}

async function syncTeamStats() {
    const sheetId = gameState.currentGame.sheetId;
    const teamStatsRange = 'Team Stats!A1:B5';
    
    const values = [
        ['Team Statistic', 'Value'],
        ['Team Score', gameState.teamStats.score],
        ['Team Turnovers', gameState.teamStats.turnovers],
        ['Total Yards Thrown', gameState.teamStats.totalYardsThrown],
        ['Total Yards Caught', gameState.teamStats.totalYardsCaught]
    ];

    await gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: teamStatsRange,
        valueInputOption: 'USER_ENTERED',
        resource: { values }
    });
}

// Auto-sync every 30 seconds
setInterval(() => {
    if (gameState.currentGame.isActive) {
        syncToAPI();
        if (gapi.client && gapi.client.getToken()) {
            syncToGoogleSheets();
        }
    }
}, 30000);

// ==================== API SYNC FUNCTIONS ====================

async function syncToAPI() {
    if (!gameState.currentGame.isActive) return;
    
    try {
        const syncData = {
            game: {
                id: gameState.currentGame.id || generateGameId(),
                ourTeam: gameState.currentGame.ourTeam,
                opponentTeam: gameState.currentGame.opponentTeam,
                date: gameState.currentGame.date,
                ourScore: gameState.teamStats.score,
                opponentScore: 0,
                status: 'in_progress'
            },
            players: gameState.players,
            playerStats: gameState.playerStats,
            teamStats: gameState.teamStats,
            actions: gameState.actions.map(a => ({
                ...a,
                id: a.id || uuidv4()
            }))
        };
        
        const response = await fetch(`${API_BASE_URL}/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(syncData)
        });
        
        if (response.ok) {
            console.log('✅ Synced to API');
        } else {
            console.warn('⚠️ API sync failed:', await response.text());
        }
    } catch (error) {
        console.warn('⚠️ API sync error:', error.message);
    }
}

function generateGameId() {
    if (!gameState.currentGame.id) {
        gameState.currentGame.id = 'game-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    }
    return gameState.currentGame.id;
}

function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Load Google APIs
gapiLoaded();
gisLoaded();

// ==================== SAMPLE DATA GENERATOR ====================
function generateSampleData() {
    // 21 players for main team with positions
    const myPlayersWithPositions = [
        { name: 'Alex Thompson', position: 'Handler' },
        { name: 'Jordan Rivera', position: 'Handler' },
        { name: 'Casey Morgan', position: 'Handler' },
        { name: 'Taylor Chen', position: 'Handler' },
        { name: 'Riley Johnson', position: 'Hybrid' },
        { name: 'Morgan Smith', position: 'Hybrid' },
        { name: 'Jamie Williams', position: 'Hybrid' },
        { name: 'Drew Anderson', position: 'Hybrid' },
        { name: 'Avery Martinez', position: 'Cutter' },
        { name: 'Quinn Davis', position: 'Cutter' },
        { name: 'Skyler Brown', position: 'Cutter' },
        { name: 'Parker Wilson', position: 'Cutter' },
        { name: 'Reese Garcia', position: 'Cutter' },
        { name: 'Cameron Lee', position: 'Cutter' },
        { name: 'Blake Miller', position: 'Cutter' },
        { name: 'Hayden Taylor', position: 'Hybrid' },
        { name: 'Kendall White', position: 'Handler' },
        { name: 'Peyton Harris', position: 'Cutter' },
        { name: 'Logan Clark', position: 'Hybrid' },
        { name: 'Charlie Lewis', position: 'Handler' },
        { name: 'Dakota Robinson', position: 'Cutter' }
    ];
    
    const myPlayers = myPlayersWithPositions.map(p => p.name);
    
    // Register players with unique IDs and numbers
    myPlayersWithPositions.forEach((p, index) => {
        if (!getPlayerByName(p.name)) {
            const player = createPlayer(p.name, p.position);
            player.number = index + 1; // Assign sequential numbers 1-21
            playerRegistry[player.id] = player;
        }
        setPlayerPosition(p.name, p.position);
    });
    savePlayerRegistry();
    
    // Opponent teams with players
    const opponentTeams = {
        'Thunder Hawks': ['Mike Storm', 'Jake Thunder', 'Chris Hawk', 'Sam Flash', 'Ben Volt', 'Kyle Blaze', 'Matt Wind'],
        'Coastal Waves': ['Dylan Shore', 'Ryan Tide', 'Cole Beach', 'Evan Surf', 'Luke Current', 'Max Reef', 'Zach Pearl'],
        'Mountain Lions': ['Leo Peak', 'Milo Ridge', 'Oscar Stone', 'Felix Cliff', 'Hugo Summit', 'Axel Rock', 'Ivan Crest'],
        'Urban Legends': ['Nate Metro', 'Theo City', 'Gabe Street', 'Eli Block', 'Noah Plaza', 'Liam Tower', 'Owen Bridge'],
        'Forest Spirits': ['Ash Grove', 'Birch Leaf', 'Cedar Wood', 'Elm Root', 'Fern Moss', 'Glen Brook', 'Heath Meadow'],
        'Desert Storm': ['Dune Rider', 'Sand Walker', 'Cactus Jack', 'Mesa Verde', 'Canyon Red', 'Dust Devil', 'Oasis Blue'],
        'Northern Lights': ['Frost King', 'Snow Peak', 'Ice Berg', 'Cold Front', 'Winter Storm', 'Polar Bear', 'Arctic Fox'],
        'Pacific Rim': ['Ocean Deep', 'Wave Crest', 'Island Hopper', 'Bay Runner', 'Coast Guard', 'Sea Breeze', 'Tide Pool'],
        'Valley Vipers': ['Snake Eyes', 'Venom Strike', 'Scale Master', 'Fang Quick', 'Coil Spring', 'Rattle King', 'Pit Boss'],
        'Sky Raiders': ['Cloud Nine', 'Air Strike', 'Jet Stream', 'Wind Rider', 'Storm Chaser', 'Thunder Bolt', 'Lightning Rod'],
        'River Runners': ['Stream Fast', 'Rapids Rush', 'Delta Force', 'Current Flow', 'Waterfall', 'Creek Side', 'Spring Fresh'],
        'Fire Phoenix': ['Flame On', 'Blaze Trail', 'Ember Glow', 'Spark Plug', 'Inferno Heat', 'Ash Rise', 'Burn Bright']
    };
    
    const opponentNames = Object.keys(opponentTeams);
    
    // Create main team
    const mainTeam = createEmptyTeam('Disc Dynasty');
    mainTeam.roster = [...myPlayers];
    
    // Initialize player stats
    myPlayers.forEach(player => {
        mainTeam.careerStats.players[player] = {
            goals: 0, assists: 0, hockeyAssists: 0, blocks: 0, turnovers: 0,
            yardsThrown: 0, yardsCaught: 0, throws: 0, catches: 0, gamesPlayed: 0
        };
    });
    
    // Create opponent teams
    opponentNames.forEach(name => {
        const oppTeam = createEmptyTeam(name);
        oppTeam.roster = opponentTeams[name];
        opponentTeams[name].forEach(player => {
            oppTeam.careerStats.players[player] = {
                goals: 0, assists: 0, hockeyAssists: 0, blocks: 0, turnovers: 0,
                yardsThrown: 0, yardsCaught: 0, throws: 0, catches: 0, gamesPlayed: 0
            };
        });
        teamsData.teams[oppTeam.id] = oppTeam;
    });
    
    // Tournament 1: Spring Showdown (6 games)
    const tournament1Games = [
        { opponent: 'Thunder Hawks', ourScore: 15, theirScore: 12 },
        { opponent: 'Coastal Waves', ourScore: 13, theirScore: 15 },
        { opponent: 'Mountain Lions', ourScore: 15, theirScore: 10 },
        { opponent: 'Urban Legends', ourScore: 15, theirScore: 14 },
        { opponent: 'Forest Spirits', ourScore: 11, theirScore: 15 },
        { opponent: 'Desert Storm', ourScore: 15, theirScore: 8 }
    ];
    
    // Tournament 2: Fall Classic (6 games)
    const tournament2Games = [
        { opponent: 'Northern Lights', ourScore: 15, theirScore: 13 },
        { opponent: 'Pacific Rim', ourScore: 14, theirScore: 15 },
        { opponent: 'Valley Vipers', ourScore: 15, theirScore: 11 },
        { opponent: 'Sky Raiders', ourScore: 15, theirScore: 9 },
        { opponent: 'River Runners', ourScore: 12, theirScore: 15 },
        { opponent: 'Fire Phoenix', ourScore: 15, theirScore: 13 }
    ];
    
    const allGames = [...tournament1Games, ...tournament2Games];
    let gameIdCounter = Date.now();
    
    // Generate games with realistic stats
    allGames.forEach((game, gameIndex) => {
        const isWin = game.ourScore > game.theirScore;
        const tournament = gameIndex < 6 ? 'Spring Showdown' : 'Fall Classic';
        const gameDate = new Date();
        gameDate.setDate(gameDate.getDate() - (12 - gameIndex) * 7); // Spread games over weeks
        
        // Select 7 players for this game (rotating lineup)
        const startIdx = (gameIndex * 3) % myPlayers.length;
        const activePlayers = [];
        for (let i = 0; i < 14; i++) {
            const playerIdx = (startIdx + i) % myPlayers.length;
            if (!activePlayers.includes(myPlayers[playerIdx])) {
                activePlayers.push(myPlayers[playerIdx]);
            }
            if (activePlayers.length >= 14) break;
        }
        
        // Generate player stats for this game
        const playerStats = {};
        let goalsRemaining = game.ourScore;
        let assistsRemaining = game.ourScore;
        let hockeyAssistsRemaining = Math.floor(game.ourScore * 0.7);
        
        activePlayers.forEach(player => {
            const goals = Math.min(goalsRemaining, Math.floor(Math.random() * 4));
            goalsRemaining -= goals;
            
            const assists = Math.min(assistsRemaining, Math.floor(Math.random() * 4));
            assistsRemaining -= assists;
            
            const ha = Math.min(hockeyAssistsRemaining, Math.floor(Math.random() * 3));
            hockeyAssistsRemaining -= ha;
            
            playerStats[player] = {
                goals: goals,
                assists: assists,
                hockeyAssists: ha,
                blocks: Math.floor(Math.random() * 3),
                turnovers: Math.floor(Math.random() * 2),
                yardsThrown: Math.floor(Math.random() * 150) + 50,
                yardsCaught: Math.floor(Math.random() * 120) + 30
            };
            
            // Update team career stats
            const p = mainTeam.careerStats.players[player];
            p.goals += playerStats[player].goals;
            p.assists += playerStats[player].assists;
            p.hockeyAssists += playerStats[player].hockeyAssists;
            p.blocks += playerStats[player].blocks;
            p.turnovers += playerStats[player].turnovers;
            p.yardsThrown += playerStats[player].yardsThrown;
            p.yardsCaught += playerStats[player].yardsCaught;
            p.gamesPlayed++;
        });
        
        // Distribute remaining goals/assists
        if (goalsRemaining > 0 || assistsRemaining > 0) {
            const randomPlayer = activePlayers[Math.floor(Math.random() * activePlayers.length)];
            playerStats[randomPlayer].goals += goalsRemaining;
            playerStats[randomPlayer].assists += assistsRemaining;
            mainTeam.careerStats.players[randomPlayer].goals += goalsRemaining;
            mainTeam.careerStats.players[randomPlayer].assists += assistsRemaining;
        }
        
        // Create game record
        const gameRecord = {
            id: 'game-' + (gameIdCounter++),
            date: gameDate.toISOString(),
            ourTeam: 'Disc Dynasty',
            opponent: game.opponent,
            tournament: tournament,
            ourScore: game.ourScore,
            opponentScore: game.theirScore,
            isWin: isWin,
            playerStats: playerStats,
            actions: []
        };
        
        // Add to game history
        gameHistory.unshift(gameRecord);
        mainTeam.gameHistory.push(gameRecord.id);
        
        // Update team season stats
        mainTeam.seasonStats.totalGames++;
        mainTeam.careerStats.totalGames++;
        if (isWin) mainTeam.seasonStats.wins++;
        else mainTeam.seasonStats.losses++;
    });
    
    // Add main team to teams data
    teamsData.teams[mainTeam.id] = mainTeam;
    teamsData.currentTeamId = mainTeam.id;
    
    // Also populate global career stats
    myPlayers.forEach(player => {
        careerStats.players[player] = { ...mainTeam.careerStats.players[player] };
    });
    careerStats.totalGames = 12;
    
    // Create past tournaments from the game data
    const springTournament = {
        id: 'tournament-spring-showdown',
        name: 'Spring Showdown',
        startDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
        endDate: new Date(Date.now() - 87 * 24 * 60 * 60 * 1000).toISOString(),
        players: {},
        games: [],
        totalGames: 6,
        wins: 4,
        losses: 2
    };
    
    const fallTournament = {
        id: 'tournament-fall-classic',
        name: 'Fall Classic',
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        endDate: new Date(Date.now() - 27 * 24 * 60 * 60 * 1000).toISOString(),
        players: {},
        games: [],
        totalGames: 6,
        wins: 4,
        losses: 2
    };
    
    // Distribute player stats between tournaments
    myPlayers.forEach(player => {
        const career = mainTeam.careerStats.players[player];
        springTournament.players[player] = {
            goals: Math.floor(career.goals * 0.5),
            assists: Math.floor(career.assists * 0.5),
            hockeyAssists: Math.floor(career.hockeyAssists * 0.5),
            blocks: Math.floor(career.blocks * 0.5),
            turnovers: Math.floor(career.turnovers * 0.5),
            yardsThrown: Math.floor(career.yardsThrown * 0.5),
            yardsCaught: Math.floor(career.yardsCaught * 0.5)
        };
        fallTournament.players[player] = {
            goals: career.goals - springTournament.players[player].goals,
            assists: career.assists - springTournament.players[player].assists,
            hockeyAssists: career.hockeyAssists - springTournament.players[player].hockeyAssists,
            blocks: career.blocks - springTournament.players[player].blocks,
            turnovers: career.turnovers - springTournament.players[player].turnovers,
            yardsThrown: career.yardsThrown - springTournament.players[player].yardsThrown,
            yardsCaught: career.yardsCaught - springTournament.players[player].yardsCaught
        };
    });
    
    pastTournaments = [fallTournament, springTournament];
    savePastTournaments();
    
    // Save everything
    saveTeamsData();
    saveGameHistory();
    saveCareerStats();
    
    // Update roster
    savedRoster = [...myPlayers];
    gameState.players = [...myPlayers];
    myPlayers.forEach(player => {
        gameState.playerStats[player] = {
            goals: 0, assists: 0, hockeyAssists: 0, blocks: 0, turnovers: 0, yardsThrown: 0, yardsCaught: 0,
            throws: 0, catches: 0
        };
    });
    saveRoster();
    
    // Update UI
    updateTeamSelector();
    updateGameHistoryDisplay();
    updatePlayerList();
    updateLeaderboard();
    
    showToast('Sample data generated: 21 players, 12 games, 13 teams!');
    console.log('Sample data generated successfully!');
}

// Call from console: generateSampleData()

// ==================== LIVE STAT ANALYSIS ====================
// Real-time pairings, line performance, and player impact analysis

function countScoringConnections(thrower, receiver) {
    let count = 0;
    for (const action of gameState.actions) {
        if (action.type === 'score' && action.description) {
            if (action.description.includes(thrower) && action.description.includes(receiver) && action.description.includes('\u2192')) {
                count++;
            }
        }
    }
    return count;
}

function computePairingStats() {
    const pairs = [];
    for (const thrower in _throwConnections) {
        for (const receiver in _throwConnections[thrower]) {
            pairs.push({
                thrower,
                receiver,
                completions: _throwConnections[thrower][receiver],
                scores: countScoringConnections(thrower, receiver)
            });
        }
    }
    return pairs.sort((a, b) => b.completions - a.completions).slice(0, 10);
}

function computeLineStats() {
    const lineMap = {};
    for (const point of _pointHistory) {
        const key = [...point.line].sort().join('|');
        if (!lineMap[key]) {
            lineMap[key] = { players: [...point.line], played: 0, scored: 0, scoredAgainst: 0 };
        }
        lineMap[key].played++;
        if (point.result === 'scored') lineMap[key].scored++;
        if (point.result === 'scored-against') lineMap[key].scoredAgainst++;
    }
    return Object.values(lineMap).sort((a, b) =>
        (b.scored - b.scoredAgainst) - (a.scored - a.scoredAgainst)
    );
}

function computePlayerImpact() {
    const impact = {};
    for (const point of _pointHistory) {
        for (const player of point.line) {
            if (!impact[player]) {
                impact[player] = { pointsPlayed: 0, pointsScored: 0, pointsAgainst: 0 };
            }
            impact[player].pointsPlayed++;
            if (point.result === 'scored') impact[player].pointsScored++;
            if (point.result === 'scored-against') impact[player].pointsAgainst++;
        }
    }
    return Object.entries(impact).map(([name, data]) => {
        const stats = gameState.playerStats[name] || {};
        return {
            name,
            ...data,
            plusMinus: data.pointsScored - data.pointsAgainst,
            offRating: ((stats.goals || 0) + (stats.assists || 0) + (stats.hockeyAssists || 0)) / Math.max(1, data.pointsPlayed),
            defRating: (stats.blocks || 0) / Math.max(1, data.pointsPlayed),
            completionPct: (stats.catches || 0) / Math.max(1, (stats.catches || 0) + (stats.turnovers || 0)) * 100
        };
    }).sort((a, b) => b.plusMinus - a.plusMinus || b.offRating - a.offRating);
}

function posAbbrev(name) {
    const pos = getPlayerPosition(name);
    if (!pos) return '';
    if (pos === 'Handler') return 'H';
    if (pos === 'Hybrid') return 'HY';
    if (pos === 'Cutter') return 'C';
    return pos.substring(0, 2).toUpperCase();
}

function renderPairingsTab() {
    const container = document.getElementById('analysis-content');
    if (!container) return;
    const pairs = computePairingStats();
    if (pairs.length === 0) {
        container.innerHTML = '<div class="text-gray-500 text-center py-4">Complete some throws to see pairings</div>';
        return;
    }
    const maxComp = pairs[0].completions;
    container.innerHTML = pairs.map(p => {
        const pct = Math.round((p.completions / maxComp) * 100);
        const scoreTag = p.scores > 0
            ? `<span class="text-emerald-400 font-semibold ml-1">${p.scores} goal${p.scores > 1 ? 's' : ''}</span>`
            : '';
        return `<div class="analysis-pair-row flex items-center gap-2 py-1.5 border-b border-white/5">
            <div class="flex-shrink-0 w-28 sm:w-40 truncate">
                <span class="text-gray-500 text-[10px]">${posAbbrev(p.thrower)}</span>
                <span class="text-white font-medium">${escapeHtml(p.thrower.split(' ')[0])}</span>
                <span class="text-gray-500 mx-0.5">&rarr;</span>
                <span class="text-gray-500 text-[10px]">${posAbbrev(p.receiver)}</span>
                <span class="text-white font-medium">${escapeHtml(p.receiver.split(' ')[0])}</span>
            </div>
            <div class="flex-1 min-w-0">
                <div class="stat-bar"><div class="stat-bar-fill" style="width:${pct}%"></div></div>
            </div>
            <div class="flex-shrink-0 text-gray-400 whitespace-nowrap">
                ${p.completions} comp${scoreTag}
            </div>
        </div>`;
    }).join('');
}

function renderLinesTab() {
    const container = document.getElementById('analysis-content');
    if (!container) return;
    const lines = computeLineStats();
    if (lines.length === 0) {
        container.innerHTML = '<div class="text-gray-500 text-center py-4">Play some points to see line stats</div>';
        return;
    }
    container.innerHTML = lines.map(l => {
        const diff = l.scored - l.scoredAgainst;
        const diffClass = diff > 0 ? 'plus-minus-pos' : diff < 0 ? 'plus-minus-neg' : 'plus-minus-zero';
        const diffStr = diff > 0 ? `+${diff}` : `${diff}`;
        const initials = l.players.map(n => {
            const parts = n.split(' ');
            const abbr = posAbbrev(n);
            const ini = parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].substring(0, 2);
            return abbr ? abbr + '\u00A0' + ini : ini;
        }).join(', ');
        return `<div class="py-2 border-b border-white/5">
            <div class="flex items-center justify-between mb-1">
                <div class="flex items-center gap-2">
                    <span class="${diffClass} font-bold text-sm">${diffStr}</span>
                    <span class="text-gray-400">${l.played} pt${l.played !== 1 ? 's' : ''}</span>
                </div>
                <div class="flex items-center gap-2 text-gray-400">
                    <span class="text-emerald-400">${l.scored} scored</span>
                    <span class="text-gray-600">/</span>
                    <span class="text-red-400">${l.scoredAgainst} allowed</span>
                </div>
            </div>
            <div class="text-gray-500 text-[10px] truncate" title="${l.players.map(n => escapeHtml(n)).join(', ')}">${initials}</div>
        </div>`;
    }).join('');
}

function renderImpactTab() {
    const container = document.getElementById('analysis-content');
    if (!container) return;
    const players = computePlayerImpact();
    if (players.length === 0) {
        container.innerHTML = '<div class="text-gray-500 text-center py-4">Play some points to see player impact</div>';
        return;
    }
    container.innerHTML = `
        <div class="flex items-center gap-2 text-[10px] text-gray-600 uppercase tracking-wider pb-1 border-b border-white/5 mb-1">
            <span class="w-24 sm:w-32">Player</span>
            <span class="w-10 text-center">+/-</span>
            <span class="w-10 text-center">OFF</span>
            <span class="w-10 text-center">DEF</span>
            <span class="w-10 text-center">CMP%</span>
            <span class="flex-1 text-center">Pts</span>
        </div>
    ` + players.map(p => {
        const diffClass = p.plusMinus > 0 ? 'plus-minus-pos' : p.plusMinus < 0 ? 'plus-minus-neg' : 'plus-minus-zero';
        const diffStr = p.plusMinus > 0 ? `+${p.plusMinus}` : `${p.plusMinus}`;
        const firstName = p.name.split(' ')[0];
        const pos = posAbbrev(p.name);
        const posTag = pos ? `<span class="text-gray-500 text-[10px] mr-0.5">${pos}</span>` : '';
        return `<div class="flex items-center gap-2 py-1.5 border-b border-white/5">
            <span class="w-24 sm:w-32 text-white font-medium truncate">${posTag}${escapeHtml(firstName)}</span>
            <span class="w-10 text-center font-bold ${diffClass}">${diffStr}</span>
            <span class="w-10 text-center text-amber-400">${p.offRating.toFixed(1)}</span>
            <span class="w-10 text-center text-purple-400">${p.defRating.toFixed(1)}</span>
            <span class="w-10 text-center text-cyan-400">${Math.round(p.completionPct)}%</span>
            <span class="flex-1 text-center text-gray-400">${p.pointsPlayed}</span>
        </div>`;
    }).join('');
}

function toggleStatsAnalysis() {
    const section = document.getElementById('stats-analysis');
    if (!section) return;
    const isHidden = section.classList.contains('section-hidden');
    if (isHidden) {
        section.classList.remove('section-hidden');
        refreshAnalysis();
    } else {
        section.classList.add('section-hidden');
    }
}

function switchAnalysisTab(tab) {
    _activeAnalysisTab = tab;
    const tabs = document.querySelectorAll('#analysis-tabs .analysis-tab');
    tabs.forEach(t => {
        const isActive = t.textContent.trim().toLowerCase().startsWith(tab.substring(0, 4));
        t.classList.toggle('active', isActive);
    });
    refreshAnalysis();
}

function refreshAnalysis() {
    const section = document.getElementById('stats-analysis');
    if (!section || section.classList.contains('section-hidden')) return;
    switch (_activeAnalysisTab) {
        case 'pairings': renderPairingsTab(); break;
        case 'lines': renderLinesTab(); break;
        case 'impact': renderImpactTab(); break;
    }
}

// ==================== QUICK DEMO TEAM GENERATOR ====================
/**
 * Creates a demo team with 21 random players
 * Call from console: createDemoTeam() or createDemoTeam('My Team Name')
 */
function createDemoTeam(teamName = 'Demo Squad') {
    // 21 players with realistic ultimate frisbee names
    const demoPlayers = [
        { name: 'Alex Thompson', position: 'Handler', number: 1 },
        { name: 'Jordan Rivera', position: 'Handler', number: 2 },
        { name: 'Casey Morgan', position: 'Handler', number: 3 },
        { name: 'Taylor Chen', position: 'Handler', number: 4 },
        { name: 'Riley Johnson', position: 'Hybrid', number: 5 },
        { name: 'Morgan Smith', position: 'Hybrid', number: 6 },
        { name: 'Jamie Williams', position: 'Hybrid', number: 7 },
        { name: 'Drew Anderson', position: 'Hybrid', number: 8 },
        { name: 'Avery Martinez', position: 'Cutter', number: 9 },
        { name: 'Quinn Davis', position: 'Cutter', number: 10 },
        { name: 'Skyler Brown', position: 'Cutter', number: 11 },
        { name: 'Parker Wilson', position: 'Cutter', number: 12 },
        { name: 'Reese Garcia', position: 'Cutter', number: 13 },
        { name: 'Cameron Lee', position: 'Cutter', number: 14 },
        { name: 'Blake Miller', position: 'Cutter', number: 15 },
        { name: 'Hayden Taylor', position: 'Hybrid', number: 17 },
        { name: 'Kendall White', position: 'Handler', number: 21 },
        { name: 'Peyton Harris', position: 'Cutter', number: 22 },
        { name: 'Logan Clark', position: 'Hybrid', number: 23 },
        { name: 'Charlie Lewis', position: 'Handler', number: 24 },
        { name: 'Dakota Robinson', position: 'Cutter', number: 25 }
    ];

    // Create the team
    const newTeam = createEmptyTeam(teamName);
    newTeam.roster = demoPlayers.map(p => p.name);

    // Register players with positions and numbers
    demoPlayers.forEach(p => {
        // Create player in registry
        let player = getPlayerByName(p.name);
        if (!player) {
            player = createPlayer(p.name, p.position);
            player.number = p.number;
            playerRegistry[player.id] = player;
        }
        setPlayerPosition(p.name, p.position);

        // Initialize career stats for team
        newTeam.careerStats.players[p.name] = {
            goals: 0, assists: 0, hockeyAssists: 0, blocks: 0, turnovers: 0,
            yardsThrown: 0, yardsCaught: 0, throws: 0, catches: 0, gamesPlayed: 0
        };
    });

    // Save everything
    savePlayerRegistry();
    teamsData.teams[newTeam.id] = newTeam;
    teamsData.currentTeamId = newTeam.id;
    saveTeamsData();

    // Update roster for gameplay
    savedRoster = [...newTeam.roster];
    gameState.players = [...newTeam.roster];
    newTeam.roster.forEach(player => {
        gameState.playerStats[player] = {
            goals: 0, assists: 0, hockeyAssists: 0, blocks: 0, turnovers: 0,
            yardsThrown: 0, yardsCaught: 0, throws: 0, catches: 0
        };
    });
    saveRoster();

    // Update UI if on dashboard
    if (typeof updateTeamSelector === 'function') updateTeamSelector();
    if (typeof updatePlayerList === 'function') updatePlayerList();

    showToast(`Created "${teamName}" with 21 players!`, 'success');
    console.log(`Demo team "${teamName}" created with ${demoPlayers.length} players:`);
    console.table(demoPlayers);

    return newTeam;
}

// Call from console: createDemoTeam() or createDemoTeam('Custom Name')
