/**
 * @fileoverview Test helpers for API integration tests
 * Sets up an in-memory SQLite database and provides HTTP utilities.
 */

'use strict';

const http = require('node:http');

// Set env BEFORE requiring the server
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-integration-tests';
process.env.DATABASE_URL = ':memory:';

const { app, startServer } = require('../server-sqlite.js');
const db = require('../db/database.js');

let server = null;
let baseUrl = '';

/** Boot the server on a random port with a fresh in-memory DB. */
async function setup() {
    await db.initDatabase();
    return new Promise((resolve, reject) => {
        server = app.listen(0, () => {
            const port = server.address().port;
            baseUrl = `http://127.0.0.1:${port}`;
            resolve({ port, baseUrl });
        });
        server.on('error', reject);
    });
}

/** Stop the server and close the database. */
async function teardown() {
    return new Promise((resolve) => {
        if (server) {
            server.close(async () => {
                await db.closeDatabase();
                resolve();
            });
        } else {
            resolve();
        }
    });
}

/**
 * Lightweight HTTP client using node:http.
 * @param {string} method - HTTP method
 * @param {string} path - URL path (e.g. /api/health)
 * @param {object} [options]
 * @param {object} [options.body] - JSON body
 * @param {string} [options.token] - Bearer token
 * @returns {Promise<{status: number, body: any, headers: object}>}
 */
function request(method, path, { body, token } = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, baseUrl);
        const payload = body ? JSON.stringify(body) : undefined;

        const opts = {
            method,
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            headers: {
                'Accept': 'application/json',
            },
        };

        if (payload) {
            opts.headers['Content-Type'] = 'application/json';
            opts.headers['Content-Length'] = Buffer.byteLength(payload);
        }
        if (token) {
            opts.headers['Authorization'] = `Bearer ${token}`;
        }

        const req = http.request(opts, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                let parsed;
                try { parsed = JSON.parse(data); } catch { parsed = data; }
                resolve({ status: res.statusCode, body: parsed, headers: res.headers });
            });
        });

        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

let userCounter = 0;

/** Register a fresh user and return { token, user }. */
async function createTestUser(overrides = {}) {
    userCounter++;
    const email = overrides.email || `testuser${userCounter}@example.com`;
    const name = overrides.name || `Test User ${userCounter}`;
    const password = overrides.password || 'SecurePass123!';

    const res = await request('POST', '/api/auth/register', {
        body: { email, name, password },
    });

    if (res.status !== 201) {
        throw new Error(`createTestUser failed (${res.status}): ${JSON.stringify(res.body)}`);
    }
    return { token: res.body.token, user: res.body.user };
}

/** Register a user AND create a team. Returns { token, user, team }. */
async function createTestUserWithTeam(teamName = 'Test Team') {
    const { token, user } = await createTestUser();
    const res = await request('POST', '/api/teams', {
        body: { name: teamName },
        token,
    });
    if (res.status !== 201) {
        throw new Error(`createTestUserWithTeam failed (${res.status}): ${JSON.stringify(res.body)}`);
    }
    return { token, user, team: res.body };
}

module.exports = { setup, teardown, request, createTestUser, createTestUserWithTeam };
