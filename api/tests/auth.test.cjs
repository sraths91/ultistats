/**
 * @fileoverview Auth endpoint integration tests
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown, request, createTestUser } = require('./helpers.cjs');

describe('Auth endpoints', () => {
    before(async () => { await setup(); });
    after(async () => { await teardown(); });

    // ── Register ──────────────────────────────────────────

    describe('POST /api/auth/register', () => {
        it('registers a new user', async () => {
            const res = await request('POST', '/api/auth/register', {
                body: { email: 'new@example.com', name: 'New User', password: 'SecurePass123!' },
            });
            assert.equal(res.status, 201);
            assert.ok(res.body.token);
            assert.equal(res.body.user.email, 'new@example.com');
            assert.equal(res.body.user.name, 'New User');
            assert.ok(res.body.user.id);
        });

        it('rejects duplicate email', async () => {
            await request('POST', '/api/auth/register', {
                body: { email: 'dupe@example.com', name: 'First', password: 'SecurePass123!' },
            });
            const res = await request('POST', '/api/auth/register', {
                body: { email: 'dupe@example.com', name: 'Second', password: 'SecurePass123!' },
            });
            assert.equal(res.status, 400);
            assert.match(res.body.error, /already registered/i);
        });

        it('rejects short password', async () => {
            const res = await request('POST', '/api/auth/register', {
                body: { email: 'short@example.com', name: 'Short', password: 'Ab1' },
            });
            assert.equal(res.status, 400);
        });

        it('rejects weak password (no uppercase)', async () => {
            const res = await request('POST', '/api/auth/register', {
                body: { email: 'weak@example.com', name: 'Weak', password: 'alllowercase123' },
            });
            assert.equal(res.status, 400);
        });

        it('rejects missing email', async () => {
            const res = await request('POST', '/api/auth/register', {
                body: { name: 'NoEmail', password: 'SecurePass123!' },
            });
            assert.equal(res.status, 400);
        });

        it('rejects missing name', async () => {
            const res = await request('POST', '/api/auth/register', {
                body: { email: 'noname@example.com', password: 'SecurePass123!' },
            });
            assert.equal(res.status, 400);
        });
    });

    // ── Login ─────────────────────────────────────────────

    describe('POST /api/auth/login', () => {
        const email = 'login@example.com';
        const password = 'SecurePass123!';

        before(async () => {
            await request('POST', '/api/auth/register', {
                body: { email, name: 'Login User', password },
            });
        });

        it('logs in with valid credentials', async () => {
            const res = await request('POST', '/api/auth/login', {
                body: { email, password },
            });
            assert.equal(res.status, 200);
            assert.ok(res.body.token);
            assert.equal(res.body.user.email, email);
        });

        it('rejects wrong password', async () => {
            const res = await request('POST', '/api/auth/login', {
                body: { email, password: 'WrongPassword123!' },
            });
            assert.equal(res.status, 401);
        });

        it('rejects non-existent email', async () => {
            const res = await request('POST', '/api/auth/login', {
                body: { email: 'ghost@example.com', password },
            });
            assert.equal(res.status, 401);
        });

        it('rejects missing password', async () => {
            const res = await request('POST', '/api/auth/login', {
                body: { email },
            });
            assert.equal(res.status, 400);
        });
    });

    // ── Me ────────────────────────────────────────────────

    describe('GET /api/auth/me', () => {
        it('returns profile with valid token', async () => {
            const { token, user } = await createTestUser();
            const res = await request('GET', '/api/auth/me', { token });
            assert.equal(res.status, 200);
            assert.equal(res.body.id, user.id);
            assert.equal(res.body.email, user.email);
        });

        it('rejects request without token', async () => {
            const res = await request('GET', '/api/auth/me');
            assert.equal(res.status, 401);
        });

        it('rejects invalid token', async () => {
            const res = await request('GET', '/api/auth/me', { token: 'bad.token.value' });
            assert.equal(res.status, 403);
        });
    });

    // ── Forgot password ──────────────────────────────────

    describe('POST /api/auth/forgot-password', () => {
        it('always returns success (prevents enumeration)', async () => {
            const res = await request('POST', '/api/auth/forgot-password', {
                body: { email: 'anyone@example.com' },
            });
            assert.equal(res.status, 200);
            assert.ok(res.body.message);
        });
    });
});
