/**
 * @fileoverview Games endpoint integration tests
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown, request, createTestUserWithTeam } = require('./helpers.cjs');

describe('Games endpoints', () => {
    before(async () => { await setup(); });
    after(async () => { await teardown(); });

    // ── CRUD ──────────────────────────────────────────────

    describe('POST /api/teams/:teamId/games', () => {
        it('creates a game', async () => {
            const { token, team } = await createTestUserWithTeam('Game Team');
            const res = await request('POST', `/api/teams/${team.id}/games`, {
                body: { opponentName: 'Rival Squad' },
                token,
            });
            assert.equal(res.status, 201);
            assert.equal(res.body.opponent_name, 'Rival Squad');
            assert.ok(res.body.id);
        });

        it('rejects missing opponent name', async () => {
            const { token, team } = await createTestUserWithTeam('No Opp Team');
            const res = await request('POST', `/api/teams/${team.id}/games`, {
                body: {},
                token,
            });
            assert.equal(res.status, 400);
        });

        it('rejects unauthenticated request', async () => {
            const res = await request('POST', '/api/teams/some-id/games', {
                body: { opponentName: 'Rival' },
            });
            assert.equal(res.status, 401);
        });
    });

    describe('GET /api/teams/:teamId/games', () => {
        it('lists games for a team', async () => {
            const { token, team } = await createTestUserWithTeam('List Games Team');
            // Create a game first
            await request('POST', `/api/teams/${team.id}/games`, {
                body: { opponentName: 'Opponent A' },
                token,
            });
            const res = await request('GET', `/api/teams/${team.id}/games`, { token });
            assert.equal(res.status, 200);
            assert.ok(Array.isArray(res.body));
            assert.ok(res.body.length >= 1);
        });
    });

    describe('PUT /api/games/:gameId', () => {
        it('updates a game', async () => {
            const { token, team } = await createTestUserWithTeam('Update Game Team');
            const created = await request('POST', `/api/teams/${team.id}/games`, {
                body: { opponentName: 'Old Opponent' },
                token,
            });
            const res = await request('PUT', `/api/games/${created.body.id}`, {
                body: { location: 'Central Park' },
                token,
            });
            assert.equal(res.status, 200);
        });
    });

    // ── End game ──────────────────────────────────────────

    describe('POST /api/games/:gameId/end', () => {
        it('ends a game with scores', async () => {
            const { token, team } = await createTestUserWithTeam('End Game Team');
            const created = await request('POST', `/api/teams/${team.id}/games`, {
                body: { opponentName: 'Finals Opponent' },
                token,
            });
            const res = await request('POST', `/api/games/${created.body.id}/end`, {
                body: {
                    ourScore: 15,
                    opponentScore: 12,
                    playerStats: {
                        Alice: { goals: 5, assists: 3, turns: 1 },
                        Bob: { goals: 4, assists: 2, turns: 0 },
                    },
                },
                token,
            });
            assert.equal(res.status, 200);
            assert.equal(res.body.is_complete, 1);
        });

        it('ends a game without player stats', async () => {
            const { token, team } = await createTestUserWithTeam('No Stats Team');
            const created = await request('POST', `/api/teams/${team.id}/games`, {
                body: { opponentName: 'Quick Opponent' },
                token,
            });
            const res = await request('POST', `/api/games/${created.body.id}/end`, {
                body: { ourScore: 10, opponentScore: 8 },
                token,
            });
            assert.equal(res.status, 200);
        });
    });

    // ── Stats ─────────────────────────────────────────────

    describe('GET /api/teams/:teamId/stats', () => {
        it('returns team stats', async () => {
            const { token, team } = await createTestUserWithTeam('Stats Team');
            const res = await request('GET', `/api/teams/${team.id}/stats`, { token });
            assert.equal(res.status, 200);
            assert.ok(res.body.team);
            assert.equal(typeof res.body.team.totalGames, 'number');
            assert.equal(typeof res.body.team.wins, 'number');
        });
    });

    describe('POST /api/teams/:teamId/stats/sync', () => {
        it('syncs stats', async () => {
            const { token, team } = await createTestUserWithTeam('Sync Team');
            const res = await request('POST', `/api/teams/${team.id}/stats/sync`, {
                body: {},
                token,
            });
            assert.equal(res.status, 200);
            assert.ok(res.body.message);
        });
    });
});
