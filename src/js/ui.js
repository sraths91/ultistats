/**
 * @fileoverview UI utilities and components module
 * @module ui
 */

import { HAPTIC_PATTERNS, DEFAULT_SETTINGS } from './constants.js';
import * as storage from './storage.js';

// ==================== STATE ====================

let appSettings = storage.loadSettings() || { ...DEFAULT_SETTINGS };
let audioContext = null;

// ==================== DOM UTILITIES ====================

/**
 * Safely get element by ID and optionally execute callback
 * @param {string} id - Element ID
 * @param {Function} [callback] - Optional callback to execute with element
 * @returns {HTMLElement|null}
 */
export function safeElement(id, callback) {
    const el = document.getElementById(id);
    if (el && callback) callback(el);
    return el;
}

/**
 * Create element with classes and attributes
 * @param {string} tag - HTML tag name
 * @param {Object} options - Element options
 * @param {string} [options.className] - CSS classes
 * @param {string} [options.id] - Element ID
 * @param {string} [options.innerHTML] - Inner HTML
 * @param {Object} [options.attrs] - Additional attributes
 * @returns {HTMLElement}
 */
export function createElement(tag, options = {}) {
    const el = document.createElement(tag);
    if (options.className) el.className = options.className;
    if (options.id) el.id = options.id;
    if (options.innerHTML) el.innerHTML = options.innerHTML;
    if (options.attrs) {
        Object.entries(options.attrs).forEach(([key, value]) => {
            el.setAttribute(key, value);
        });
    }
    return el;
}

/**
 * Remove element by ID if it exists
 * @param {string} id - Element ID
 */
export function removeElement(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

// ==================== LOADING STATES ====================

/**
 * Show loading state on a button
 * @param {HTMLButtonElement} buttonEl - Button element
 * @param {string} [loadingText='Loading...'] - Loading text
 */
export function showLoadingState(buttonEl, loadingText = 'Loading...') {
    if (!buttonEl) return;
    buttonEl.dataset.originalText = buttonEl.innerHTML;
    buttonEl.disabled = true;
    buttonEl.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin inline-block"></i> ${loadingText}`;
    refreshIcons();
}

/**
 * Hide loading state on a button
 * @param {HTMLButtonElement} buttonEl - Button element
 */
export function hideLoadingState(buttonEl) {
    if (!buttonEl || !buttonEl.dataset.originalText) return;
    buttonEl.disabled = false;
    buttonEl.innerHTML = buttonEl.dataset.originalText;
    delete buttonEl.dataset.originalText;
    refreshIcons();
}

// ==================== VISUAL FEEDBACK ====================

/**
 * Flash element with color ring
 * @param {HTMLElement} element - Element to flash
 * @param {string} [color='emerald'] - Tailwind color name
 */
export function flashElement(element, color = 'emerald') {
    if (!element) return;
    element.classList.add(`ring-2`, `ring-${color}-500`, 'ring-opacity-75');
    setTimeout(() => {
        element.classList.remove(`ring-2`, `ring-${color}-500`, 'ring-opacity-75');
    }, 300);
}

/**
 * Refresh Lucide icons
 */
export function refreshIcons() {
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

// ==================== TOAST NOTIFICATIONS ====================

/**
 * Show toast notification
 * @param {string} message - Message to display
 * @param {string} [type='info'] - Toast type: 'info', 'success', 'error', 'warning'
 * @param {number} [duration=3000] - Duration in milliseconds
 */
export function showToast(message, type = 'info', duration = 3000) {
    // Remove existing toasts
    const existing = document.querySelectorAll('.toast-notification');
    existing.forEach(t => t.remove());
    
    const colors = {
        info: 'bg-slate-800 border-cyan-500/30',
        success: 'bg-slate-800 border-emerald-500/30',
        error: 'bg-slate-800 border-red-500/30',
        warning: 'bg-slate-800 border-amber-500/30'
    };
    
    const icons = {
        info: 'info',
        success: 'check-circle',
        error: 'alert-circle',
        warning: 'alert-triangle'
    };
    
    const iconColors = {
        info: 'text-cyan-400',
        success: 'text-emerald-400',
        error: 'text-red-400',
        warning: 'text-amber-400'
    };
    
    const toast = createElement('div', {
        className: `toast-notification fixed bottom-20 left-1/2 -translate-x-1/2 px-4 py-3 rounded-xl border ${colors[type]} text-white text-sm font-medium shadow-xl z-[100] flex items-center gap-2 animate-fade-in-up`,
        innerHTML: `
            <i data-lucide="${icons[type]}" class="w-4 h-4 ${iconColors[type]}"></i>
            <span>${message}</span>
        `
    });
    
    document.body.appendChild(toast);
    refreshIcons();
    
    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-2');
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// ==================== HAPTIC FEEDBACK ====================

/**
 * Trigger haptic feedback
 * @param {number|number[]} [pattern] - Vibration pattern or duration
 */
export function vibrate(pattern) {
    if (!appSettings.hapticEnabled) return;
    if (!navigator.vibrate) return;
    
    try {
        if (Array.isArray(pattern)) {
            navigator.vibrate(pattern);
        } else if (typeof pattern === 'number') {
            navigator.vibrate(pattern);
        } else {
            navigator.vibrate(HAPTIC_PATTERNS.tap);
        }
    } catch (e) {
        // Vibration not supported
    }
}

/**
 * Trigger named haptic feedback pattern
 * @param {string} type - Pattern name from HAPTIC_PATTERNS
 */
export function hapticFeedback(type) {
    const pattern = HAPTIC_PATTERNS[type] || HAPTIC_PATTERNS.tap;
    vibrate(pattern);
}

// ==================== AUDIO ====================

/**
 * Initialize audio context
 */
function initAudio() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
}

/**
 * Play sound effect
 * @param {string} type - Sound type: 'score', 'turnover', 'block', 'tap'
 */
export function playSound(type) {
    if (!appSettings.soundEnabled) return;
    initAudio();
    
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    const sounds = {
        score: () => {
            oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
            oscillator.frequency.setValueAtTime(1100, audioContext.currentTime + 0.1);
            oscillator.frequency.setValueAtTime(1320, audioContext.currentTime + 0.2);
            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.4);
            oscillator.start();
            oscillator.stop(audioContext.currentTime + 0.4);
        },
        turnover: () => {
            oscillator.frequency.setValueAtTime(300, audioContext.currentTime);
            oscillator.frequency.setValueAtTime(200, audioContext.currentTime + 0.1);
            gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
            oscillator.start();
            oscillator.stop(audioContext.currentTime + 0.2);
        },
        block: () => {
            oscillator.frequency.setValueAtTime(600, audioContext.currentTime);
            oscillator.frequency.setValueAtTime(800, audioContext.currentTime + 0.05);
            gainNode.gain.setValueAtTime(0.25, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15);
            oscillator.start();
            oscillator.stop(audioContext.currentTime + 0.15);
        },
        tap: () => {
            oscillator.frequency.setValueAtTime(500, audioContext.currentTime);
            gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.05);
            oscillator.start();
            oscillator.stop(audioContext.currentTime + 0.05);
        }
    };
    
    const soundFn = sounds[type] || sounds.tap;
    soundFn();
}

// ==================== MODALS ====================

/**
 * Show confirmation modal
 * @param {Object} options - Modal options
 * @param {string} options.title - Modal title
 * @param {string} options.message - Modal message
 * @param {string} [options.confirmText='Confirm'] - Confirm button text
 * @param {string} [options.cancelText='Cancel'] - Cancel button text
 * @param {string} [options.confirmClass] - Confirm button class
 * @returns {Promise<boolean>} - Resolves to true if confirmed
 */
export function showConfirmModal({ title, message, confirmText = 'Confirm', cancelText = 'Cancel', confirmClass = 'bg-red-500 hover:bg-red-600' }) {
    return new Promise((resolve) => {
        const modal = createElement('div', {
            id: 'confirm-modal',
            className: 'fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4',
            innerHTML: `
                <div class="bg-slate-900/95 backdrop-blur-xl rounded-2xl border border-white/10 p-6 max-w-sm w-full">
                    <h3 class="text-xl font-bold text-white mb-2">${title}</h3>
                    <p class="text-gray-400 mb-6">${message}</p>
                    <div class="flex gap-3">
                        <button id="confirm-cancel" class="flex-1 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-all">
                            ${cancelText}
                        </button>
                        <button id="confirm-ok" class="flex-1 py-2 ${confirmClass} text-white rounded-lg transition-all">
                            ${confirmText}
                        </button>
                    </div>
                </div>
            `
        });
        
        document.body.appendChild(modal);
        
        const cleanup = (result) => {
            modal.remove();
            resolve(result);
        };
        
        modal.querySelector('#confirm-cancel').onclick = () => cleanup(false);
        modal.querySelector('#confirm-ok').onclick = () => cleanup(true);
        modal.onclick = (e) => {
            if (e.target === modal) cleanup(false);
        };
    });
}

/**
 * Show input modal
 * @param {Object} options - Modal options
 * @param {string} options.title - Modal title
 * @param {string} [options.placeholder] - Input placeholder
 * @param {string} [options.defaultValue] - Default input value
 * @param {string} [options.inputType='text'] - Input type
 * @returns {Promise<string|null>} - Resolves to input value or null if cancelled
 */
export function showInputModal({ title, placeholder = '', defaultValue = '', inputType = 'text' }) {
    return new Promise((resolve) => {
        const modal = createElement('div', {
            id: 'input-modal',
            className: 'fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4',
            innerHTML: `
                <div class="bg-slate-900/95 backdrop-blur-xl rounded-2xl border border-white/10 p-6 max-w-sm w-full">
                    <h3 class="text-xl font-bold text-white mb-4">${title}</h3>
                    <input type="${inputType}" id="modal-input" 
                        class="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 mb-4"
                        placeholder="${placeholder}" value="${defaultValue}">
                    <div class="flex gap-3">
                        <button id="input-cancel" class="flex-1 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-all">
                            Cancel
                        </button>
                        <button id="input-ok" class="flex-1 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-all">
                            OK
                        </button>
                    </div>
                </div>
            `
        });
        
        document.body.appendChild(modal);
        
        const input = modal.querySelector('#modal-input');
        input.focus();
        input.select();
        
        const cleanup = (value) => {
            modal.remove();
            resolve(value);
        };
        
        modal.querySelector('#input-cancel').onclick = () => cleanup(null);
        modal.querySelector('#input-ok').onclick = () => cleanup(input.value);
        input.onkeydown = (e) => {
            if (e.key === 'Enter') cleanup(input.value);
            if (e.key === 'Escape') cleanup(null);
        };
        modal.onclick = (e) => {
            if (e.target === modal) cleanup(null);
        };
    });
}

// ==================== SETTINGS ====================

/**
 * Update app settings
 * @param {Object} newSettings - New settings to merge
 */
export function updateSettings(newSettings) {
    appSettings = { ...appSettings, ...newSettings };
    storage.saveSettings(appSettings);
}

/**
 * Get current settings
 * @returns {Object}
 */
export function getSettings() {
    return { ...appSettings };
}

/**
 * Load settings from storage
 */
export function loadAppSettings() {
    appSettings = storage.loadSettings() || { ...DEFAULT_SETTINGS };
}

// ==================== COORDINATE UTILITIES ====================

/**
 * Get click coordinates relative to element's content area
 * @param {MouseEvent|TouchEvent} event - Click/touch event
 * @param {HTMLElement} element - Target element
 * @returns {Object} Coordinate data
 */
export function getContentAreaCoordinates(event, element) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    
    const borderLeft = parseFloat(style.borderLeftWidth) || 0;
    const borderTop = parseFloat(style.borderTopWidth) || 0;
    const borderRight = parseFloat(style.borderRightWidth) || 0;
    const borderBottom = parseFloat(style.borderBottomWidth) || 0;
    
    const contentWidth = rect.width - borderLeft - borderRight;
    const contentHeight = rect.height - borderTop - borderBottom;
    
    const clientX = event.clientX || event.touches?.[0]?.clientX || 0;
    const clientY = event.clientY || event.touches?.[0]?.clientY || 0;
    
    return {
        x: clientX - rect.left - borderLeft,
        y: clientY - rect.top - borderTop,
        percentX: ((clientX - rect.left - borderLeft) / contentWidth) * 100,
        percentY: ((clientY - rect.top - borderTop) / contentHeight) * 100,
        contentWidth,
        contentHeight
    };
}
