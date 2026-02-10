/**
 * @fileoverview Unit tests for stats module
 * @module tests/stats
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

// Mock the constants module for Node.js testing
const GAME_CONSTANTS = {
    FIELD_LENGTH_YARDS: 120,
    FIELD_WIDTH_YARDS: 40,
    ENDZONE_PERCENT: 13.3,
    BRICK_MARK_PERCENT: 26.6,
    MAX_LINE_SIZE: 7,
    MAX_UNDO_HISTORY: 20,
    DEFAULT_SCORE_DISTANCE: 20
};

// Stats functions to test (copied from stats.js for Node.js compatibility)
function createEmptyPlayerStats() {
    return {
        goals: 0,
        assists: 0,
        hockeyAssists: 0,
        blocks: 0,
        turnovers: 0,
        yardsThrown: 0,
        yardsCaught: 0,
        throws: 0,
        catches: 0
    };
}

function createEmptyTeamStats() {
    return {
        score: 0,
        opponentScore: 0,
        turnovers: 0,
        turnoversGained: 0,
        totalYardsThrown: 0,
        totalYardsCaught: 0
    };
}

function calculateDistance(startPos, endPos) {
    if (!startPos || !endPos) return 0;
    
    const xYards = Math.abs(endPos.x - startPos.x) * (GAME_CONSTANTS.FIELD_WIDTH_YARDS / 100);
    const yYards = Math.abs(endPos.y - startPos.y) * (GAME_CONSTANTS.FIELD_LENGTH_YARDS / 100);
    
    const distance = Math.sqrt(xYards * xYards + yYards * yYards);
    return Math.round(distance);
}

function isInEndzone(y) {
    const ENDZONE_PERCENT = GAME_CONSTANTS.ENDZONE_PERCENT;
    if (y <= ENDZONE_PERCENT) return 'their';
    if (y >= (100 - ENDZONE_PERCENT)) return 'our';
    return null;
}

function incrementPlayerStat(stats, stat, amount = 1) {
    if (stat in stats && typeof stats[stat] === 'number') {
        stats[stat] += amount;
    }
    return stats;
}

function mergePlayerStats(base, addition) {
    const result = { ...base };
    Object.keys(addition).forEach(key => {
        if (typeof result[key] === 'number' && typeof addition[key] === 'number') {
            result[key] += addition[key];
        }
    });
    return result;
}

function calculateCompletionPercentage(completions, attempts) {
    if (attempts === 0) return 0;
    return Math.round((completions / attempts) * 100);
}

function calculatePlusMinus(stats) {
    const positive = stats.goals + stats.assists + stats.hockeyAssists + stats.blocks;
    const negative = stats.turnovers;
    return positive - negative;
}

function getLeaderboard(playerStats, stat, limit = 10) {
    return Object.entries(playerStats)
        .map(([player, stats]) => ({
            player,
            value: stats[stat] || 0
        }))
        .sort((a, b) => b.value - a.value)
        .slice(0, limit);
}

function calculateRecord(games) {
    let wins = 0, losses = 0, ties = 0;
    
    games.forEach(game => {
        if (game.ourScore > game.opponentScore) wins++;
        else if (game.ourScore < game.opponentScore) losses++;
        else ties++;
    });
    
    const totalGames = wins + losses + ties;
    const winPercentage = totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0;
    
    return { wins, losses, ties, winPercentage };
}

// ==================== TESTS ====================

describe('Stats Module', () => {
    
    describe('createEmptyPlayerStats', () => {
        it('should create stats with all zero values', () => {
            const stats = createEmptyPlayerStats();
            assert.strictEqual(stats.goals, 0);
            assert.strictEqual(stats.assists, 0);
            assert.strictEqual(stats.hockeyAssists, 0);
            assert.strictEqual(stats.blocks, 0);
            assert.strictEqual(stats.turnovers, 0);
            assert.strictEqual(stats.yardsThrown, 0);
            assert.strictEqual(stats.yardsCaught, 0);
            assert.strictEqual(stats.throws, 0);
            assert.strictEqual(stats.catches, 0);
        });
        
        it('should create independent objects', () => {
            const stats1 = createEmptyPlayerStats();
            const stats2 = createEmptyPlayerStats();
            stats1.goals = 5;
            assert.strictEqual(stats2.goals, 0);
        });
    });
    
    describe('createEmptyTeamStats', () => {
        it('should create team stats with all zero values', () => {
            const stats = createEmptyTeamStats();
            assert.strictEqual(stats.score, 0);
            assert.strictEqual(stats.opponentScore, 0);
            assert.strictEqual(stats.turnovers, 0);
            assert.strictEqual(stats.turnoversGained, 0);
        });
    });
    
    describe('calculateDistance', () => {
        it('should return 0 for null positions', () => {
            assert.strictEqual(calculateDistance(null, { x: 50, y: 50 }), 0);
            assert.strictEqual(calculateDistance({ x: 50, y: 50 }, null), 0);
            assert.strictEqual(calculateDistance(null, null), 0);
        });
        
        it('should return 0 for same position', () => {
            assert.strictEqual(calculateDistance({ x: 50, y: 50 }, { x: 50, y: 50 }), 0);
        });
        
        it('should calculate horizontal distance correctly', () => {
            // 50% of 40 yards = 20 yards
            const distance = calculateDistance({ x: 0, y: 50 }, { x: 50, y: 50 });
            assert.strictEqual(distance, 20);
        });
        
        it('should calculate vertical distance correctly', () => {
            // 50% of 120 yards = 60 yards
            const distance = calculateDistance({ x: 50, y: 0 }, { x: 50, y: 50 });
            assert.strictEqual(distance, 60);
        });
        
        it('should calculate diagonal distance correctly', () => {
            // Pythagorean theorem: sqrt(20^2 + 60^2) = sqrt(400 + 3600) = sqrt(4000) ≈ 63
            const distance = calculateDistance({ x: 0, y: 0 }, { x: 50, y: 50 });
            assert.strictEqual(distance, 63);
        });
    });
    
    describe('isInEndzone', () => {
        it('should return "their" for top endzone', () => {
            assert.strictEqual(isInEndzone(0), 'their');
            assert.strictEqual(isInEndzone(5), 'their');
            assert.strictEqual(isInEndzone(13.3), 'their');
        });
        
        it('should return "our" for bottom endzone', () => {
            assert.strictEqual(isInEndzone(100), 'our');
            assert.strictEqual(isInEndzone(95), 'our');
            assert.strictEqual(isInEndzone(86.7), 'our');
        });
        
        it('should return null for field area', () => {
            assert.strictEqual(isInEndzone(50), null);
            assert.strictEqual(isInEndzone(14), null);
            assert.strictEqual(isInEndzone(86), null);
        });
    });
    
    describe('incrementPlayerStat', () => {
        it('should increment a stat by 1 by default', () => {
            const stats = createEmptyPlayerStats();
            incrementPlayerStat(stats, 'goals');
            assert.strictEqual(stats.goals, 1);
        });
        
        it('should increment by specified amount', () => {
            const stats = createEmptyPlayerStats();
            incrementPlayerStat(stats, 'yardsThrown', 25);
            assert.strictEqual(stats.yardsThrown, 25);
        });
        
        it('should not modify invalid stats', () => {
            const stats = createEmptyPlayerStats();
            incrementPlayerStat(stats, 'invalidStat', 10);
            assert.strictEqual(stats.invalidStat, undefined);
        });
    });
    
    describe('mergePlayerStats', () => {
        it('should merge two stats objects', () => {
            const base = createEmptyPlayerStats();
            base.goals = 2;
            base.assists = 3;
            
            const addition = createEmptyPlayerStats();
            addition.goals = 1;
            addition.blocks = 2;
            
            const merged = mergePlayerStats(base, addition);
            
            assert.strictEqual(merged.goals, 3);
            assert.strictEqual(merged.assists, 3);
            assert.strictEqual(merged.blocks, 2);
        });
        
        it('should not modify original objects', () => {
            const base = createEmptyPlayerStats();
            base.goals = 2;
            
            const addition = createEmptyPlayerStats();
            addition.goals = 1;
            
            mergePlayerStats(base, addition);
            
            assert.strictEqual(base.goals, 2);
            assert.strictEqual(addition.goals, 1);
        });
    });
    
    describe('calculateCompletionPercentage', () => {
        it('should return 0 for zero attempts', () => {
            assert.strictEqual(calculateCompletionPercentage(0, 0), 0);
        });
        
        it('should calculate percentage correctly', () => {
            assert.strictEqual(calculateCompletionPercentage(8, 10), 80);
            assert.strictEqual(calculateCompletionPercentage(1, 3), 33);
            assert.strictEqual(calculateCompletionPercentage(10, 10), 100);
        });
    });
    
    describe('calculatePlusMinus', () => {
        it('should calculate positive plus/minus', () => {
            const stats = createEmptyPlayerStats();
            stats.goals = 3;
            stats.assists = 2;
            stats.blocks = 1;
            stats.turnovers = 1;
            
            assert.strictEqual(calculatePlusMinus(stats), 5); // 3+2+0+1-1 = 5
        });
        
        it('should calculate negative plus/minus', () => {
            const stats = createEmptyPlayerStats();
            stats.turnovers = 5;
            
            assert.strictEqual(calculatePlusMinus(stats), -5);
        });
    });
    
    describe('getLeaderboard', () => {
        it('should return sorted leaderboard', () => {
            const playerStats = {
                'Alice': { goals: 5, assists: 2 },
                'Bob': { goals: 3, assists: 4 },
                'Charlie': { goals: 7, assists: 1 }
            };
            
            const leaderboard = getLeaderboard(playerStats, 'goals');
            
            assert.strictEqual(leaderboard[0].player, 'Charlie');
            assert.strictEqual(leaderboard[0].value, 7);
            assert.strictEqual(leaderboard[1].player, 'Alice');
            assert.strictEqual(leaderboard[2].player, 'Bob');
        });
        
        it('should limit results', () => {
            const playerStats = {
                'A': { goals: 1 },
                'B': { goals: 2 },
                'C': { goals: 3 },
                'D': { goals: 4 },
                'E': { goals: 5 }
            };
            
            const leaderboard = getLeaderboard(playerStats, 'goals', 3);
            assert.strictEqual(leaderboard.length, 3);
        });
    });
    
    describe('calculateRecord', () => {
        it('should calculate wins, losses, ties correctly', () => {
            const games = [
                { ourScore: 15, opponentScore: 10 }, // win
                { ourScore: 8, opponentScore: 15 },  // loss
                { ourScore: 13, opponentScore: 13 }, // tie
                { ourScore: 15, opponentScore: 12 }, // win
            ];
            
            const record = calculateRecord(games);
            
            assert.strictEqual(record.wins, 2);
            assert.strictEqual(record.losses, 1);
            assert.strictEqual(record.ties, 1);
            assert.strictEqual(record.winPercentage, 50);
        });
        
        it('should return zeros for empty games', () => {
            const record = calculateRecord([]);
            
            assert.strictEqual(record.wins, 0);
            assert.strictEqual(record.losses, 0);
            assert.strictEqual(record.ties, 0);
            assert.strictEqual(record.winPercentage, 0);
        });
    });
});

console.log('Stats tests loaded. Run with: node --test src/tests/stats.test.js');
