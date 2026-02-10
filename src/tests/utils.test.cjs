/**
 * @fileoverview Unit tests for utils module
 * @module tests/utils
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

// Utils functions to test (copied for Node.js compatibility)
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj.getTime());
    if (obj instanceof Array) return obj.map(item => deepClone(item));
    if (typeof obj === 'object') {
        const cloned = {};
        Object.keys(obj).forEach(key => {
            cloned[key] = deepClone(obj[key]);
        });
        return cloned;
    }
    return obj;
}

function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function getInitials(name) {
    if (!name) return '';
    return name
        .split(' ')
        .map(word => word.charAt(0).toUpperCase())
        .slice(0, 2)
        .join('');
}

function safeJsonParse(str, fallback = null) {
    try {
        return JSON.parse(str);
    } catch (e) {
        return fallback;
    }
}

function isEmpty(value) {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'object') return Object.keys(value).length === 0;
    return false;
}

function clamp(num, min, max) {
    return Math.min(Math.max(num, min), max);
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ==================== TESTS ====================

describe('Utils Module', () => {
    
    describe('generateUUID', () => {
        it('should generate a valid UUID v4 format', () => {
            const uuid = generateUUID();
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
            assert.match(uuid, uuidRegex);
        });
        
        it('should generate unique UUIDs', () => {
            const uuid1 = generateUUID();
            const uuid2 = generateUUID();
            assert.notStrictEqual(uuid1, uuid2);
        });
    });
    
    describe('deepClone', () => {
        it('should clone primitive values', () => {
            assert.strictEqual(deepClone(5), 5);
            assert.strictEqual(deepClone('hello'), 'hello');
            assert.strictEqual(deepClone(null), null);
            assert.strictEqual(deepClone(true), true);
        });
        
        it('should clone arrays', () => {
            const original = [1, 2, [3, 4]];
            const cloned = deepClone(original);
            
            assert.deepStrictEqual(cloned, original);
            assert.notStrictEqual(cloned, original);
            assert.notStrictEqual(cloned[2], original[2]);
        });
        
        it('should clone objects', () => {
            const original = { a: 1, b: { c: 2 } };
            const cloned = deepClone(original);
            
            assert.deepStrictEqual(cloned, original);
            assert.notStrictEqual(cloned, original);
            assert.notStrictEqual(cloned.b, original.b);
        });
        
        it('should clone dates', () => {
            const original = new Date('2024-01-01');
            const cloned = deepClone(original);
            
            assert.strictEqual(cloned.getTime(), original.getTime());
            assert.notStrictEqual(cloned, original);
        });
    });
    
    describe('capitalize', () => {
        it('should capitalize first letter', () => {
            assert.strictEqual(capitalize('hello'), 'Hello');
            assert.strictEqual(capitalize('world'), 'World');
        });
        
        it('should handle empty string', () => {
            assert.strictEqual(capitalize(''), '');
        });
        
        it('should handle null/undefined', () => {
            assert.strictEqual(capitalize(null), '');
            assert.strictEqual(capitalize(undefined), '');
        });
        
        it('should handle already capitalized', () => {
            assert.strictEqual(capitalize('Hello'), 'Hello');
        });
    });
    
    describe('getInitials', () => {
        it('should get initials from full name', () => {
            assert.strictEqual(getInitials('John Doe'), 'JD');
            assert.strictEqual(getInitials('Alice Smith'), 'AS');
        });
        
        it('should handle single name', () => {
            assert.strictEqual(getInitials('John'), 'J');
        });
        
        it('should limit to 2 initials', () => {
            assert.strictEqual(getInitials('John Paul Smith'), 'JP');
        });
        
        it('should handle empty string', () => {
            assert.strictEqual(getInitials(''), '');
            assert.strictEqual(getInitials(null), '');
        });
    });
    
    describe('safeJsonParse', () => {
        it('should parse valid JSON', () => {
            const result = safeJsonParse('{"a": 1}');
            assert.deepStrictEqual(result, { a: 1 });
        });
        
        it('should return fallback for invalid JSON', () => {
            const result = safeJsonParse('invalid json', { default: true });
            assert.deepStrictEqual(result, { default: true });
        });
        
        it('should return null by default for invalid JSON', () => {
            const result = safeJsonParse('invalid');
            assert.strictEqual(result, null);
        });
    });
    
    describe('isEmpty', () => {
        it('should return true for null/undefined', () => {
            assert.strictEqual(isEmpty(null), true);
            assert.strictEqual(isEmpty(undefined), true);
        });
        
        it('should return true for empty string', () => {
            assert.strictEqual(isEmpty(''), true);
            assert.strictEqual(isEmpty('   '), true);
        });
        
        it('should return true for empty array', () => {
            assert.strictEqual(isEmpty([]), true);
        });
        
        it('should return true for empty object', () => {
            assert.strictEqual(isEmpty({}), true);
        });
        
        it('should return false for non-empty values', () => {
            assert.strictEqual(isEmpty('hello'), false);
            assert.strictEqual(isEmpty([1, 2]), false);
            assert.strictEqual(isEmpty({ a: 1 }), false);
        });
    });
    
    describe('clamp', () => {
        it('should clamp value to min', () => {
            assert.strictEqual(clamp(-5, 0, 10), 0);
        });
        
        it('should clamp value to max', () => {
            assert.strictEqual(clamp(15, 0, 10), 10);
        });
        
        it('should return value if within range', () => {
            assert.strictEqual(clamp(5, 0, 10), 5);
        });
    });
    
    describe('randomInt', () => {
        it('should return integer within range', () => {
            for (let i = 0; i < 100; i++) {
                const result = randomInt(1, 10);
                assert.ok(result >= 1 && result <= 10);
                assert.strictEqual(result, Math.floor(result));
            }
        });
        
        it('should include min and max values', () => {
            const results = new Set();
            for (let i = 0; i < 1000; i++) {
                results.add(randomInt(1, 3));
            }
            assert.ok(results.has(1));
            assert.ok(results.has(3));
        });
    });
});

console.log('Utils tests loaded. Run with: node --test src/tests/utils.test.js');
