import js from '@eslint/js';
import prettier from 'eslint-config-prettier';

export default [
    js.configs.recommended,
    prettier,
    {
        languageOptions: {
            ecmaVersion: 2020,
            sourceType: 'module',
            globals: {
                // Browser globals
                window: 'readonly',
                document: 'readonly',
                navigator: 'readonly',
                localStorage: 'readonly',
                sessionStorage: 'readonly',
                fetch: 'readonly',
                console: 'readonly',
                setTimeout: 'readonly',
                setInterval: 'readonly',
                clearTimeout: 'readonly',
                clearInterval: 'readonly',
                requestAnimationFrame: 'readonly',
                cancelAnimationFrame: 'readonly',
                URL: 'readonly',
                Blob: 'readonly',
                Worker: 'readonly',
                AudioParam: 'readonly',
                HTMLElement: 'readonly',
                Event: 'readonly',
                CustomEvent: 'readonly',
                MutationObserver: 'readonly',
                IntersectionObserver: 'readonly',
                ResizeObserver: 'readonly',
                alert: 'readonly',
                confirm: 'readonly',
                prompt: 'readonly',
                location: 'readonly',
                history: 'readonly',
                performance: 'readonly',
                // CDN globals
                tailwind: 'writable',
                lucide: 'readonly',
            },
        },
        rules: {
            'no-var': 'error',
            'prefer-const': 'warn',
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
            'eqeqeq': ['error', 'always'],
            'no-console': 'off',
            'no-empty': ['error', { allowEmptyCatch: true }],
        },
    },
    {
        files: ['script.js'],
        languageOptions: {
            sourceType: 'script',
        },
    },
    {
        ignores: ['dist/', 'node_modules/', 'ios/', 'api/', 'src/tests/'],
    },
];
