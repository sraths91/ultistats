/**
 * @fileoverview Teams endpoint integration tests
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown, request, createTestUser, createTestUserWithTeam } = require('./helpers.cjs');

describe('Teams endpoints', () => {
    before(async () => { await setup(); });
    after(async () => { await teardown(); });

    // ── CRUD ──────────────────────────────────────────────

    describe('POST /api/teams', () => {
        it('creates a team', async () => {
            const { token } = await createTestUser();
            const res = await request('POST', '/api/teams', {
                body: { name: 'Disc Destroyers' },
                token,
            });
            assert.equal(res.status, 201);
            assert.equal(res.body.name, 'Disc Destroyers');
            assert.ok(res.body.id);
        });

        it('rejects unauthenticated request', async () => {
            const res = await request('POST', '/api/teams', {
                body: { name: 'No Auth Team' },
            });
            assert.equal(res.status, 401);
        });

        it('rejects empty name', async () => {
            const { token } = await createTestUser();
            const res = await request('POST', '/api/teams', {
                body: { name: '' },
                token,
            });
            assert.equal(res.status, 400);
        });
    });

    describe('GET /api/teams', () => {
        it('lists teams for authenticated user', async () => {
            const { token } = await createTestUserWithTeam('Listed Team');
            const res = await request('GET', '/api/teams', { token });
            assert.equal(res.status, 200);
            assert.ok(Array.isArray(res.body));
            assert.ok(res.body.length >= 1);
        });
    });

    describe('GET /api/teams/:teamId', () => {
        it('returns team details for a member', async () => {
            const { token, team } = await createTestUserWithTeam('Detail Team');
            const res = await request('GET', `/api/teams/${team.id}`, { token });
            assert.equal(res.status, 200);
            assert.equal(res.body.id, team.id);
        });

        it('returns 404 for unknown team', async () => {
            const { token } = await createTestUser();
            const res = await request('GET', '/api/teams/nonexistent-id', { token });
            assert.equal(res.status, 404);
        });
    });

    describe('PUT /api/teams/:teamId', () => {
        it('owner can update team', async () => {
            const { token, team } = await createTestUserWithTeam('Old Name');
            const res = await request('PUT', `/api/teams/${team.id}`, {
                body: { name: 'New Name' },
                token,
            });
            assert.equal(res.status, 200);
        });

        it('non-owner cannot update team', async () => {
            const { team } = await createTestUserWithTeam('Protected Team');
            const { token: otherToken } = await createTestUser();
            const res = await request('PUT', `/api/teams/${team.id}`, {
                body: { name: 'Hacked Name' },
                token: otherToken,
            });
            assert.equal(res.status, 403);
        });
    });

    describe('DELETE /api/teams/:teamId', () => {
        it('owner can delete team', async () => {
            const { token, team } = await createTestUserWithTeam('Doomed Team');
            const res = await request('DELETE', `/api/teams/${team.id}`, { token });
            assert.equal(res.status, 200);
        });

        it('non-owner cannot delete team', async () => {
            const { team } = await createTestUserWithTeam('Safe Team');
            const { token: otherToken } = await createTestUser();
            const res = await request('DELETE', `/api/teams/${team.id}`, { token: otherToken });
            assert.equal(res.status, 403);
        });
    });

    // ── Roster ────────────────────────────────────────────

    describe('PUT /api/teams/:teamId/roster', () => {
        it('updates the roster', async () => {
            const { token, team } = await createTestUserWithTeam('Roster Team');
            const roster = ['Alice', 'Bob', 'Charlie'];
            const res = await request('PUT', `/api/teams/${team.id}/roster`, {
                body: { roster },
                token,
            });
            assert.equal(res.status, 200);
        });

        it('rejects non-array roster', async () => {
            const { token, team } = await createTestUserWithTeam('Bad Roster');
            const res = await request('PUT', `/api/teams/${team.id}/roster`, {
                body: { roster: 'not an array' },
                token,
            });
            assert.equal(res.status, 400);
        });
    });

    // ── Invitations ───────────────────────────────────────

    describe('POST /api/teams/:teamId/invite', () => {
        it('creates an invitation', async () => {
            const { token, team } = await createTestUserWithTeam('Invite Team');
            const res = await request('POST', `/api/teams/${team.id}/invite`, {
                body: { email: 'invitee@example.com', role: 'coach' },
                token,
            });
            assert.equal(res.status, 201);
            assert.ok(res.body.id);
        });

        it('rejects invalid email', async () => {
            const { token, team } = await createTestUserWithTeam('Email Team');
            const res = await request('POST', `/api/teams/${team.id}/invite`, {
                body: { email: 'not-an-email', role: 'coach' },
                token,
            });
            assert.equal(res.status, 400);
        });
    });
});
