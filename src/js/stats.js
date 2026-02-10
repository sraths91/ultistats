/**
 * @fileoverview Statistics calculation and management module
 * @module stats
 */

import { GAME_CONSTANTS, FIELD_DIMENSIONS } from './constants.js';

/**
 * @typedef {Object} PlayerStats
 * @property {number} goals - Number of goals scored
 * @property {number} assists - Number of assists
 * @property {number} hockeyAssists - Number of hockey assists
 * @property {number} blocks - Number of blocks
 * @property {number} turnovers - Number of turnovers
 * @property {number} yardsThrown - Total yards thrown
 * @property {number} yardsCaught - Total yards caught
 * @property {number} throws - Number of throws
 * @property {number} catches - Number of catches
 */

/**
 * @typedef {Object} TeamStats
 * @property {number} score - Team score
 * @property {number} opponentScore - Opponent score
 * @property {number} turnovers - Team turnovers
 * @property {number} turnoversGained - Turnovers gained from opponent
 * @property {number} totalYardsThrown - Total yards thrown by team
 * @property {number} totalYardsCaught - Total yards caught by team
 */

/**
 * Create empty player stats object
 * @returns {PlayerStats}
 */
export function createEmptyPlayerStats() {
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

/**
 * Create empty team stats object
 * @returns {TeamStats}
 */
export function createEmptyTeamStats() {
    return {
        score: 0,
        opponentScore: 0,
        turnovers: 0,
        turnoversGained: 0,
        totalYardsThrown: 0,
        totalYardsCaught: 0
    };
}

/**
 * Calculate distance between two field positions
 * @param {Object} startPos - Start position {x, y} in percentages
 * @param {Object} endPos - End position {x, y} in percentages
 * @returns {number} Distance in yards
 */
export function calculateDistance(startPos, endPos) {
    if (!startPos || !endPos) return 0;
    
    // Convert percentage to yards
    // Field is 120 yards long (with end zones), 40 yards wide
    const xYards = Math.abs(endPos.x - startPos.x) * (GAME_CONSTANTS.FIELD_WIDTH_YARDS / 100);
    const yYards = Math.abs(endPos.y - startPos.y) * (GAME_CONSTANTS.FIELD_LENGTH_YARDS / 100);
    
    // Calculate Euclidean distance
    const distance = Math.sqrt(xYards * xYards + yYards * yYards);
    
    return Math.round(distance);
}

/**
 * Check if a Y coordinate is in an endzone
 * @param {number} y - Y coordinate as percentage (0-100)
 * @returns {'their'|'our'|null} - Which endzone or null if not in endzone
 */
export function isInEndzone(y) {
    const ENDZONE_PERCENT = GAME_CONSTANTS.ENDZONE_PERCENT;
    if (y <= ENDZONE_PERCENT) return 'their';
    if (y >= (100 - ENDZONE_PERCENT)) return 'our';
    return null;
}

/**
 * Update player stat by incrementing a value
 * @param {PlayerStats} stats - Player stats object
 * @param {keyof PlayerStats} stat - Stat to update
 * @param {number} [amount=1] - Amount to add
 * @returns {PlayerStats} Updated stats
 */
export function incrementPlayerStat(stats, stat, amount = 1) {
    if (stat in stats && typeof stats[stat] === 'number') {
        stats[stat] += amount;
    }
    return stats;
}

/**
 * Merge two player stats objects
 * @param {PlayerStats} base - Base stats
 * @param {PlayerStats} addition - Stats to add
 * @returns {PlayerStats} Merged stats
 */
export function mergePlayerStats(base, addition) {
    const result = { ...base };
    Object.keys(addition).forEach(key => {
        if (typeof result[key] === 'number' && typeof addition[key] === 'number') {
            result[key] += addition[key];
        }
    });
    return result;
}

/**
 * Calculate completion percentage
 * @param {number} completions - Number of completions
 * @param {number} attempts - Number of attempts
 * @returns {number} Percentage (0-100)
 */
export function calculateCompletionPercentage(completions, attempts) {
    if (attempts === 0) return 0;
    return Math.round((completions / attempts) * 100);
}

/**
 * Calculate plus/minus for a player
 * @param {PlayerStats} stats - Player stats
 * @returns {number} Plus/minus value
 */
export function calculatePlusMinus(stats) {
    const positive = stats.goals + stats.assists + stats.hockeyAssists + stats.blocks;
    const negative = stats.turnovers;
    return positive - negative;
}

/**
 * Get leaderboard for a specific stat
 * @param {Object<string, PlayerStats>} playerStats - Map of player name to stats
 * @param {keyof PlayerStats} stat - Stat to rank by
 * @param {number} [limit=10] - Max number of results
 * @returns {Array<{player: string, value: number}>}
 */
export function getLeaderboard(playerStats, stat, limit = 10) {
    return Object.entries(playerStats)
        .map(([player, stats]) => ({
            player,
            value: stats[stat] || 0
        }))
        .sort((a, b) => b.value - a.value)
        .slice(0, limit);
}

/**
 * Calculate aggregate stats for all players
 * @param {Object<string, PlayerStats>} playerStats - Map of player name to stats
 * @returns {Object} Aggregate statistics
 */
export function calculateAggregateStats(playerStats) {
    const totals = createEmptyPlayerStats();
    let playerCount = 0;
    
    Object.values(playerStats).forEach(stats => {
        playerCount++;
        Object.keys(totals).forEach(key => {
            if (typeof stats[key] === 'number') {
                totals[key] += stats[key];
            }
        });
    });
    
    return {
        totals,
        playerCount,
        averages: playerCount > 0 ? {
            goals: (totals.goals / playerCount).toFixed(1),
            assists: (totals.assists / playerCount).toFixed(1),
            blocks: (totals.blocks / playerCount).toFixed(1),
            turnovers: (totals.turnovers / playerCount).toFixed(1),
            yardsThrown: Math.round(totals.yardsThrown / playerCount),
            yardsCaught: Math.round(totals.yardsCaught / playerCount)
        } : null
    };
}

/**
 * Format yards for display
 * @param {number} yards - Yards value
 * @returns {string} Formatted string
 */
export function formatYards(yards) {
    if (yards >= 1000) {
        return `${(yards / 1000).toFixed(1)}k`;
    }
    return yards.toString();
}

/**
 * Calculate efficiency rating for a player
 * @param {PlayerStats} stats - Player stats
 * @returns {number} Efficiency rating (0-100)
 */
export function calculateEfficiency(stats) {
    const totalActions = stats.throws + stats.catches + stats.blocks;
    if (totalActions === 0) return 0;
    
    const positiveActions = stats.catches + stats.blocks + stats.goals + stats.assists;
    const negativeActions = stats.turnovers;
    
    const efficiency = ((positiveActions - negativeActions) / totalActions) * 100;
    return Math.max(0, Math.min(100, Math.round(efficiency + 50))); // Normalize to 0-100
}

/**
 * Generate game summary statistics
 * @param {TeamStats} teamStats - Team stats
 * @param {Object<string, PlayerStats>} playerStats - Player stats
 * @returns {Object} Game summary
 */
export function generateGameSummary(teamStats, playerStats) {
    const aggregate = calculateAggregateStats(playerStats);
    
    // Find top performers
    const topScorer = getLeaderboard(playerStats, 'goals', 1)[0];
    const topAssister = getLeaderboard(playerStats, 'assists', 1)[0];
    const topBlocker = getLeaderboard(playerStats, 'blocks', 1)[0];
    
    return {
        score: `${teamStats.score} - ${teamStats.opponentScore}`,
        isWin: teamStats.score > teamStats.opponentScore,
        totalYards: teamStats.totalYardsThrown,
        turnovers: teamStats.turnovers,
        turnoversGained: teamStats.turnoversGained,
        turnoverMargin: teamStats.turnoversGained - teamStats.turnovers,
        topScorer: topScorer ? `${topScorer.player} (${topScorer.value})` : 'N/A',
        topAssister: topAssister ? `${topAssister.player} (${topAssister.value})` : 'N/A',
        topBlocker: topBlocker ? `${topBlocker.player} (${topBlocker.value})` : 'N/A',
        playersUsed: aggregate.playerCount
    };
}

/**
 * Calculate season record
 * @param {Array<{ourScore: number, opponentScore: number}>} games - Array of game results
 * @returns {{wins: number, losses: number, ties: number, winPercentage: number}}
 */
export function calculateRecord(games) {
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

/**
 * Calculate point differential
 * @param {Array<{ourScore: number, opponentScore: number}>} games - Array of game results
 * @returns {number} Point differential
 */
export function calculatePointDifferential(games) {
    return games.reduce((diff, game) => diff + (game.ourScore - game.opponentScore), 0);
}
