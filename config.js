/**
 * @fileoverview Client-side configuration loader
 * Loads configuration from environment or defaults
 */

(function() {
    'use strict';
    
    // Default configuration
    const defaults = {
        API_BASE_URL: 'http://localhost:3001/api',
        GOOGLE_CLIENT_ID: '',
        GOOGLE_API_KEY: '',
        DEBUG: false
    };
    
    // Try to load from config endpoint or use defaults
    window.ULTISTATS_CONFIG = { ...defaults };
    
    // For production, you can override these by setting window.ULTISTATS_CONFIG before loading this script
    // Or by creating a config.json file that gets loaded
    
    // Attempt to load config.json if it exists
    fetch('/config.json')
        .then(response => {
            if (response.ok) return response.json();
            return null;
        })
        .then(config => {
            if (config) {
                window.ULTISTATS_CONFIG = { ...defaults, ...config };
                console.log('Configuration loaded from config.json');
            }
        })
        .catch(() => {
            // Config file doesn't exist, use defaults
            console.log('Using default configuration');
        });
})();
