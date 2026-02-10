/**
 * @fileoverview Health endpoint integration tests
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown, request } = require('./helpers.cjs');

describe('GET /api/health', () => {
    before(async () => { await setup(); });
    after(async () => { await teardown(); });

    it('returns status ok', async () => {
        const res = await request('GET', '/api/health');
        assert.equal(res.status, 200);
        assert.equal(res.body.status, 'ok');
    });

    it('includes a timestamp', async () => {
        const res = await request('GET', '/api/health');
        assert.ok(res.body.timestamp);
        // Should be a valid ISO date
        assert.ok(!isNaN(Date.parse(res.body.timestamp)));
    });
});
