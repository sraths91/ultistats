/**
 * @fileoverview Unit tests for analytics computation functions
 * Tests the pure functions from analytics.worker.js
 * @module tests/analytics
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

// ─── Copy pure functions from analytics.worker.js for Node.js testing ─────

function computeChemScore(data) {
    const winRate = data.scoredTogether / Math.max(1, data.pointsTogether);
    const pointDiffRate = (data.scoredTogether - data.allowedTogether) / Math.max(1, data.pointsTogether);
    const connectionFreq = Math.min(data.connectionCount || 0, 20) / 20;
    const defWinRate = (data.defScored || 0) / Math.max(1, data.defPointsTogether || 0);
    const breakBonus = defWinRate * Math.min(data.defPointsTogether || 0, 10) / 10;
    return (winRate * 40) + (pointDiffRate * 25) + (connectionFreq * 15) + (breakBonus * 20);
}

function computeChemScoreForSide(data, side) {
    const pts = side === 'off' ? (data.offPointsTogether || 0) : (data.defPointsTogether || 0);
    if (pts < 1) return 0;
    const scored = side === 'off' ? (data.offScored || 0) : (data.defScored || 0);
    const allowed = side === 'off' ? (data.offAllowed || 0) : (data.defAllowed || 0);
    const winRate = scored / Math.max(1, pts);
    const pointDiffRate = (scored - allowed) / Math.max(1, pts);
    return (winRate * 55) + (pointDiffRate * 35) + (Math.min(data.connectionCount || 0, 15) / 15 * 10);
}

function getChemistryScoreFromData(player1, player2, side, playerPairs) {
    const key = [player1, player2].sort().join('|');
    const data = playerPairs[key];
    if (!data || data.pointsTogether < 1) return 0;
    if (side === 'off') return computeChemScoreForSide(data, 'off');
    if (side === 'def') return computeChemScoreForSide(data, 'def');
    return computeChemScore(data);
}

function countScoringConnectionsFromActions(actions, thrower, receiver) {
    let count = 0;
    for (const action of actions) {
        if (action.type === 'score' && action.description) {
            if (action.description.includes(thrower) && action.description.includes(receiver) && action.description.includes('\u2192')) {
                count++;
            }
        }
    }
    return count;
}

function computePairingStats(throwConnections, actions) {
    const pairs = [];
    for (const thrower in throwConnections) {
        for (const receiver in throwConnections[thrower]) {
            pairs.push({
                thrower,
                receiver,
                completions: throwConnections[thrower][receiver],
                scores: countScoringConnectionsFromActions(actions, thrower, receiver)
            });
        }
    }
    return pairs.sort((a, b) => b.completions - a.completions).slice(0, 10);
}

function computeLineStats(pointHistory) {
    const lineMap = {};
    for (const point of pointHistory) {
        const key = [...point.line].sort().join('|');
        if (!lineMap[key]) {
            lineMap[key] = { players: [...point.line], played: 0, scored: 0, scoredAgainst: 0, oPlayed: 0, oScored: 0, dPlayed: 0, dScored: 0 };
        }
        const l = lineMap[key];
        l.played++;
        if (point.result === 'scored') l.scored++;
        if (point.result === 'scored-against') l.scoredAgainst++;
        if (point.startType === 'offense') {
            l.oPlayed++;
            if (point.result === 'scored') l.oScored++;
        } else {
            l.dPlayed++;
            if (point.result === 'scored') l.dScored++;
        }
    }
    return Object.values(lineMap).sort((a, b) =>
        (b.scored - b.scoredAgainst) - (a.scored - a.scoredAgainst)
    );
}

function computePageRank(throwConnections, chemistryPairings, iterations = 20, damping = 0.85) {
    const nodes = new Set();
    const edges = {};
    const inDegree = {};

    for (const thrower in throwConnections) {
        nodes.add(thrower);
        if (!edges[thrower]) edges[thrower] = [];
        for (const receiver in throwConnections[thrower]) {
            nodes.add(receiver);
            edges[thrower].push({ target: receiver, weight: throwConnections[thrower][receiver] });
            inDegree[receiver] = (inDegree[receiver] || 0) + throwConnections[thrower][receiver];
        }
    }

    for (const key in chemistryPairings) {
        const [thrower, receiver] = key.split('|');
        nodes.add(thrower);
        nodes.add(receiver);
        if (!edges[thrower]) edges[thrower] = [];
        if (!throwConnections[thrower]?.[receiver]) {
            edges[thrower].push({ target: receiver, weight: chemistryPairings[key].completions });
            inDegree[receiver] = (inDegree[receiver] || 0) + chemistryPairings[key].completions;
        }
    }

    const nodeList = [...nodes];
    const n = nodeList.length;
    if (n === 0) return {};

    let rank = {};
    nodeList.forEach(node => rank[node] = 1 / n);

    for (let iter = 0; iter < iterations; iter++) {
        const newRank = {};
        nodeList.forEach(node => newRank[node] = (1 - damping) / n);

        for (const source of nodeList) {
            const outEdges = edges[source] || [];
            const totalWeight = outEdges.reduce((s, e) => s + e.weight, 0);
            if (totalWeight === 0) {
                nodeList.forEach(node => newRank[node] += damping * rank[source] / n);
            } else {
                for (const edge of outEdges) {
                    newRank[edge.target] += damping * rank[source] * (edge.weight / totalWeight);
                }
            }
        }
        rank = newRank;
    }

    const maxRank = Math.max(...Object.values(rank), 0.0001);
    const result = {};
    for (const node of nodeList) {
        result[node] = Math.round((rank[node] / maxRank) * 100);
    }
    return result;
}

function computePlayerPER(playerName, careerPlayers) {
    const career = careerPlayers?.[playerName];
    if (!career || !career.gamesPlayed) return 0;
    const gp = career.gamesPlayed;
    const completionPct = (career.catches || 0) / Math.max(1, (career.catches || 0) + (career.turnovers || 0));
    const rawPER = (
        (career.goals || 0) * 3 +
        (career.assists || 0) * 3 +
        (career.hockeyAssists || 0) * 1.5 +
        (career.blocks || 0) * 3 -
        (career.turnovers || 0) * 2 +
        completionPct * gp * 0.5
    );
    return Math.round(rawPER * 10) / 10;
}

function computePlayerImpact(pointHistory, playerStats, careerPlayers, throwConnections, chemistryPairings) {
    const impact = {};
    const oPoints = {};
    const dPoints = {};
    for (const point of pointHistory) {
        const isOff = point.startType === 'offense';
        for (const player of point.line) {
            if (!impact[player]) impact[player] = { pointsPlayed: 0, pointsScored: 0, pointsAgainst: 0 };
            if (!oPoints[player]) oPoints[player] = { played: 0, scored: 0, allowed: 0 };
            if (!dPoints[player]) dPoints[player] = { played: 0, scored: 0, allowed: 0 };
            impact[player].pointsPlayed++;
            if (point.result === 'scored') impact[player].pointsScored++;
            if (point.result === 'scored-against') impact[player].pointsAgainst++;
            const bucket = isOff ? oPoints[player] : dPoints[player];
            bucket.played++;
            if (point.result === 'scored') bucket.scored++;
            if (point.result === 'scored-against') bucket.allowed++;
        }
    }
    const pageRank = computePageRank(throwConnections, chemistryPairings);
    return Object.entries(impact).map(([name, data]) => {
        const stats = playerStats[name] || {};
        const pp = Math.max(1, data.pointsPlayed);
        const oData = oPoints[name] || { played: 0, scored: 0, allowed: 0 };
        const dData = dPoints[name] || { played: 0, scored: 0, allowed: 0 };
        const holdRate = oData.played > 0 ? oData.scored / oData.played : null;
        const breakRate = dData.played > 0 ? dData.scored / dData.played : null;
        return {
            name,
            ...data,
            plusMinus: data.pointsScored - data.pointsAgainst,
            offRating: ((stats.goals || 0) + (stats.assists || 0) + (stats.hockeyAssists || 0)) / pp,
            defRating: (stats.blocks || 0) / pp,
            completionPct: (stats.catches || 0) / Math.max(1, (stats.catches || 0) + (stats.turnovers || 0)) * 100,
            per: computePlayerPER(name, careerPlayers),
            hubScore: pageRank[name] || 0,
            holdRate,
            breakRate,
            oPointsPlayed: oData.played,
            dPointsPlayed: dData.played
        };
    }).sort((a, b) => b.plusMinus - a.plusMinus || b.offRating - a.offRating);
}

function computeCrossGamePairings(pairings, limit = 10) {
    const pairs = [];
    for (const key in pairings) {
        const [thrower, receiver] = key.split('|');
        const data = pairings[key];
        const avgThrowValue = data.throwValue ? Math.round(data.throwValue / Math.max(1, data.completions)) : 0;
        pairs.push({ thrower, receiver, ...data, avgThrowValue });
    }
    return pairs.sort((a, b) => b.completions - a.completions).slice(0, limit);
}

function computeCrossGameLines(lineHistory, limit = 8) {
    const lines = [];
    for (const key in lineHistory) {
        const data = lineHistory[key];
        const diff = data.scored - data.scoredAgainst;
        lines.push({ players: data.players || key.split('|'), ...data, plusMinus: diff });
    }
    return lines.sort((a, b) => b.plusMinus - a.plusMinus || b.scored - a.scored).slice(0, limit);
}

function computePlayerChemistry(playerPairs, limit = 15) {
    const pairs = [];
    for (const key in playerPairs) {
        const [p1, p2] = key.split('|');
        const data = playerPairs[key];
        if (data.pointsTogether < 2) continue;
        const chemScore = computeChemScore(data);
        const offChem = computeChemScoreForSide(data, 'off');
        const defChem = computeChemScoreForSide(data, 'def');
        const winRate = data.scoredTogether / Math.max(1, data.pointsTogether);
        pairs.push({ player1: p1, player2: p2, ...data, winRate, chemistryScore: Math.round(chemScore), offChemistry: Math.round(offChem), defChemistry: Math.round(defChem) });
    }
    return pairs.sort((a, b) => b.chemistryScore - a.chemistryScore).slice(0, limit);
}

function suggestLineCompute({ allPlayers, pointHistory, playerStats, careerPlayers, playerPairs, throwConnections, chemistryPairings, playerPositions }) {
    const impact = {};
    for (const point of pointHistory) {
        for (const player of point.line) {
            if (!impact[player]) impact[player] = { pointsPlayed: 0, pointsScored: 0, pointsAgainst: 0 };
            impact[player].pointsPlayed++;
            if (point.result === 'scored') impact[player].pointsScored++;
            if (point.result === 'scored-against') impact[player].pointsAgainst++;
        }
    }

    const hasChemData = Object.keys(playerPairs).length > 0;
    const hasGameData = pointHistory.length > 0;
    const pageRank = computePageRank(throwConnections, chemistryPairings);

    const lastPoint = pointHistory.length > 0 ? pointHistory[pointHistory.length - 1] : null;
    const suggestSide = lastPoint?.result === 'scored' ? 'defense' : lastPoint?.result === 'scored-against' ? 'offense' : null;

    const playerScores = {};
    const playerReasons = {};
    allPlayers.forEach(player => {
        const stats = playerStats[player] || {};
        const imp = impact[player] || { pointsPlayed: 0, pointsScored: 0, pointsAgainst: 0 };
        const pp = Math.max(1, imp.pointsPlayed);

        const avgPts = pointHistory.length > 0 ? pointHistory.length / Math.max(1, allPlayers.length) * 7 : 0;
        const restFactor = avgPts > 0 ? Math.max(0, 1 - (imp.pointsPlayed / avgPts) * 0.5) : 0.5;

        const plusMinus = hasGameData ? (imp.pointsScored - imp.pointsAgainst) / pp : 0;
        const offContrib = ((stats.goals || 0) + (stats.assists || 0) + (stats.hockeyAssists || 0)) / pp;
        const defContrib = (stats.blocks || 0) / pp;
        const turnPenalty = (stats.turnovers || 0) / pp;

        const per = computePlayerPER(player, careerPlayers);
        const perBonus = per > 0 ? Math.min(per / 20, 1) * 0.5 : 0;

        const hubBonus = (pageRank[player] || 0) / 100 * 0.3;

        let contextBonus = 0;
        if (suggestSide === 'offense') {
            contextBonus = offContrib * 0.5 - defContrib * 0.2;
        } else if (suggestSide === 'defense') {
            contextBonus = defContrib * 0.5 - offContrib * 0.1;
        }

        playerScores[player] = (plusMinus * 2) + (offContrib * 1.5) + (defContrib * 1) - (turnPenalty * 1) + (restFactor * 1.5) + perBonus + hubBonus + contextBonus;

        const reasons = [];
        if (restFactor > 0.7) reasons.push('rested');
        if (plusMinus > 0.3) reasons.push('+/-');
        if (offContrib > 0.5) reasons.push('offense');
        if (defContrib > 0.3) reasons.push('defense');
        if (perBonus > 0.3) reasons.push('PER');
        if (hubBonus > 0.2) reasons.push('hub');
        playerReasons[player] = reasons;
    });

    const sorted = [...allPlayers].sort((a, b) => (playerScores[b] || 0) - (playerScores[a] || 0));
    const selected = [sorted[0]];

    while (selected.length < 7) {
        let bestCandidate = null;
        let bestScore = -Infinity;

        for (const candidate of allPlayers) {
            if (selected.includes(candidate)) continue;
            let score = playerScores[candidate] || 0;

            if (hasChemData) {
                let chemSum = 0;
                for (const sel of selected) {
                    chemSum += getChemistryScoreFromData(candidate, sel, suggestSide === 'offense' ? 'off' : suggestSide === 'defense' ? 'def' : undefined, playerPairs);
                }
                const chemBonus = (chemSum / selected.length) * 0.05;
                score += chemBonus;
                if (chemBonus > 0.5 && !playerReasons[candidate].includes('chemistry')) {
                    playerReasons[candidate].push('chemistry');
                }
            }

            const pos = playerPositions[candidate] || null;
            const selectedPositions = selected.map(p => playerPositions[p] || null);
            const handlers = selectedPositions.filter(p => p === 'Handler').length;
            const cutters = selectedPositions.filter(p => p === 'Cutter').length;
            if (pos === 'Handler' && handlers < 3) score += 0.3;
            else if (pos === 'Cutter' && cutters < 4) score += 0.2;
            else if (pos === 'Hybrid') score += 0.1;

            if (score > bestScore) {
                bestScore = score;
                bestCandidate = candidate;
            }
        }

        if (bestCandidate) selected.push(bestCandidate);
        else break;
    }

    return { selected: selected.slice(0, 7), playerReasons, suggestSide };
}

// ─── Test fixtures ──────────────────────────────────────────────────────

console.log('Analytics tests loaded. Run with: node --test src/tests/analytics.test.cjs');

describe('Analytics Module', () => {
    // ─── computeChemScore ──────────────────────────────────────────────

    describe('computeChemScore', () => {
        it('should return 0 for empty data', () => {
            const score = computeChemScore({
                scoredTogether: 0, pointsTogether: 0, allowedTogether: 0,
                connectionCount: 0, defScored: 0, defPointsTogether: 0
            });
            assert.strictEqual(score, 0);
        });

        it('should return max score for perfect pair', () => {
            const score = computeChemScore({
                scoredTogether: 10, pointsTogether: 10, allowedTogether: 0,
                connectionCount: 20, defScored: 5, defPointsTogether: 5
            });
            // winRate=1→40, pointDiffRate=1→25, connectionFreq=1→15, breakBonus=1*0.5→10
            assert.ok(score > 80, `Expected >80, got ${score}`);
        });

        it('should be negative for losing pair', () => {
            const score = computeChemScore({
                scoredTogether: 0, pointsTogether: 10, allowedTogether: 10,
                connectionCount: 0, defScored: 0, defPointsTogether: 10
            });
            // winRate=0→0, pointDiffRate=-1→-25, connectionFreq=0→0, breakBonus=0→0
            assert.ok(score < 0, `Expected negative, got ${score}`);
        });

        it('should weight win rate highest', () => {
            const highWinLowConn = computeChemScore({
                scoredTogether: 8, pointsTogether: 10, allowedTogether: 2,
                connectionCount: 2, defScored: 0, defPointsTogether: 0
            });
            const lowWinHighConn = computeChemScore({
                scoredTogether: 3, pointsTogether: 10, allowedTogether: 7,
                connectionCount: 20, defScored: 0, defPointsTogether: 0
            });
            assert.ok(highWinLowConn > lowWinHighConn, 'Win rate should outweigh connection frequency');
        });

        it('should cap connection frequency at 20', () => {
            const at20 = computeChemScore({
                scoredTogether: 5, pointsTogether: 10, allowedTogether: 5,
                connectionCount: 20, defScored: 0, defPointsTogether: 0
            });
            const at100 = computeChemScore({
                scoredTogether: 5, pointsTogether: 10, allowedTogether: 5,
                connectionCount: 100, defScored: 0, defPointsTogether: 0
            });
            assert.strictEqual(at20, at100);
        });
    });

    // ─── computeChemScoreForSide ───────────────────────────────────────

    describe('computeChemScoreForSide', () => {
        it('should return 0 for offense with no O-points', () => {
            const score = computeChemScoreForSide({ offPointsTogether: 0, offScored: 0, offAllowed: 0, connectionCount: 5 }, 'off');
            assert.strictEqual(score, 0);
        });

        it('should return 0 for defense with no D-points', () => {
            const score = computeChemScoreForSide({ defPointsTogether: 0, defScored: 0, defAllowed: 0, connectionCount: 5 }, 'def');
            assert.strictEqual(score, 0);
        });

        it('should compute offense chemistry correctly', () => {
            const score = computeChemScoreForSide({
                offPointsTogether: 10, offScored: 8, offAllowed: 2, connectionCount: 10
            }, 'off');
            // winRate=0.8→44, pointDiffRate=0.6→21, connectionFreq=10/15*10→6.67
            assert.ok(score > 60, `Expected >60, got ${score}`);
        });

        it('should compute defense chemistry correctly', () => {
            const score = computeChemScoreForSide({
                defPointsTogether: 8, defScored: 6, defAllowed: 2, connectionCount: 5
            }, 'def');
            assert.ok(score > 0, `Expected positive score, got ${score}`);
        });
    });

    // ─── getChemistryScoreFromData ─────────────────────────────────────

    describe('getChemistryScoreFromData', () => {
        it('should return 0 for missing pair', () => {
            assert.strictEqual(getChemistryScoreFromData('Alice', 'Bob', null, {}), 0);
        });

        it('should return 0 for pair with 0 points together', () => {
            const pairs = { 'Alice|Bob': { pointsTogether: 0, scoredTogether: 0, allowedTogether: 0, connectionCount: 0, defScored: 0, defPointsTogether: 0 } };
            assert.strictEqual(getChemistryScoreFromData('Alice', 'Bob', null, pairs), 0);
        });

        it('should sort player names to find the pair', () => {
            const pairs = { 'Alice|Bob': { pointsTogether: 5, scoredTogether: 5, allowedTogether: 0, connectionCount: 10, defScored: 0, defPointsTogether: 0 } };
            // Reversed order should still match
            const score = getChemistryScoreFromData('Bob', 'Alice', null, pairs);
            assert.ok(score > 0, 'Should find pair regardless of name order');
        });

        it('should use side-specific scoring when requested', () => {
            const pairs = {
                'Alice|Bob': {
                    pointsTogether: 10, scoredTogether: 8, allowedTogether: 2,
                    connectionCount: 5, defScored: 2, defPointsTogether: 4,
                    offPointsTogether: 6, offScored: 6, offAllowed: 0,
                    offAllowed: 0, defAllowed: 2
                }
            };
            const offScore = getChemistryScoreFromData('Alice', 'Bob', 'off', pairs);
            const defScore = getChemistryScoreFromData('Alice', 'Bob', 'def', pairs);
            assert.ok(offScore !== defScore, 'Offense and defense scores should differ');
        });
    });

    // ─── computePairingStats ───────────────────────────────────────────

    describe('computePairingStats', () => {
        it('should return empty array for empty data', () => {
            const result = computePairingStats({}, []);
            assert.deepStrictEqual(result, []);
        });

        it('should count completions correctly', () => {
            const connections = { 'Alice': { 'Bob': 5, 'Charlie': 3 } };
            const result = computePairingStats(connections, []);
            assert.strictEqual(result.length, 2);
            assert.strictEqual(result[0].thrower, 'Alice');
            assert.strictEqual(result[0].receiver, 'Bob');
            assert.strictEqual(result[0].completions, 5);
        });

        it('should count scoring connections from actions', () => {
            const connections = { 'Alice': { 'Bob': 5 } };
            const actions = [
                { type: 'score', description: 'Alice \u2192 Bob scored' },
                { type: 'score', description: 'Alice \u2192 Bob scored' },
                { type: 'throw', description: 'Alice \u2192 Bob' }
            ];
            const result = computePairingStats(connections, actions);
            assert.strictEqual(result[0].scores, 2);
        });

        it('should sort by completions descending', () => {
            const connections = {
                'Alice': { 'Bob': 3 },
                'Charlie': { 'Dave': 7 }
            };
            const result = computePairingStats(connections, []);
            assert.strictEqual(result[0].thrower, 'Charlie');
            assert.strictEqual(result[0].completions, 7);
        });

        it('should limit results to 10', () => {
            const connections = {};
            for (let i = 0; i < 15; i++) {
                connections[`Player${i}`] = { [`Player${i + 100}`]: i + 1 };
            }
            const result = computePairingStats(connections, []);
            assert.strictEqual(result.length, 10);
        });
    });

    // ─── computeLineStats ──────────────────────────────────────────────

    describe('computeLineStats', () => {
        it('should return empty array for no points', () => {
            const result = computeLineStats([]);
            assert.deepStrictEqual(result, []);
        });

        it('should aggregate same line across points', () => {
            const history = [
                { line: ['A', 'B', 'C'], result: 'scored', startType: 'offense' },
                { line: ['A', 'B', 'C'], result: 'scored', startType: 'offense' },
                { line: ['A', 'B', 'C'], result: 'scored-against', startType: 'defense' }
            ];
            const result = computeLineStats(history);
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].played, 3);
            assert.strictEqual(result[0].scored, 2);
            assert.strictEqual(result[0].scoredAgainst, 1);
        });

        it('should treat same players in different order as same line', () => {
            const history = [
                { line: ['A', 'B', 'C'], result: 'scored', startType: 'offense' },
                { line: ['C', 'A', 'B'], result: 'scored', startType: 'offense' }
            ];
            const result = computeLineStats(history);
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].played, 2);
        });

        it('should track O/D splits', () => {
            const history = [
                { line: ['A', 'B'], result: 'scored', startType: 'offense' },
                { line: ['A', 'B'], result: 'scored', startType: 'defense' },
                { line: ['A', 'B'], result: 'scored-against', startType: 'defense' }
            ];
            const result = computeLineStats(history);
            assert.strictEqual(result[0].oPlayed, 1);
            assert.strictEqual(result[0].oScored, 1);
            assert.strictEqual(result[0].dPlayed, 2);
            assert.strictEqual(result[0].dScored, 1);
        });

        it('should sort by plus/minus descending', () => {
            const history = [
                { line: ['A', 'B'], result: 'scored', startType: 'offense' },
                { line: ['C', 'D'], result: 'scored-against', startType: 'defense' }
            ];
            const result = computeLineStats(history);
            assert.strictEqual(result[0].players.sort().join(','), 'A,B');
        });
    });

    // ─── computePageRank ───────────────────────────────────────────────

    describe('computePageRank', () => {
        it('should return empty object for no data', () => {
            const result = computePageRank({}, {});
            assert.deepStrictEqual(result, {});
        });

        it('should assign scores to all players in throw graph', () => {
            const connections = { 'Alice': { 'Bob': 5 }, 'Bob': { 'Charlie': 3 } };
            const result = computePageRank(connections, {});
            assert.ok('Alice' in result);
            assert.ok('Bob' in result);
            assert.ok('Charlie' in result);
        });

        it('should give highest score to most-connected player', () => {
            const connections = {
                'Alice': { 'Hub': 10 },
                'Bob': { 'Hub': 10 },
                'Charlie': { 'Hub': 10 },
                'Hub': { 'Alice': 1 }
            };
            const result = computePageRank(connections, {});
            assert.strictEqual(result['Hub'], 100, 'Hub player should have score 100');
        });

        it('should normalize max score to 100', () => {
            const connections = { 'A': { 'B': 5 }, 'B': { 'A': 3 } };
            const result = computePageRank(connections, {});
            const maxScore = Math.max(...Object.values(result));
            assert.strictEqual(maxScore, 100);
        });

        it('should include chemistry pairings in graph', () => {
            const connections = {};
            const chemPairings = { 'X|Y': { completions: 10 } };
            const result = computePageRank(connections, chemPairings);
            assert.ok('X' in result);
            assert.ok('Y' in result);
        });
    });

    // ─── computePlayerPER ──────────────────────────────────────────────

    describe('computePlayerPER', () => {
        it('should return 0 for missing player', () => {
            assert.strictEqual(computePlayerPER('Unknown', {}), 0);
        });

        it('should return 0 for player with no games', () => {
            assert.strictEqual(computePlayerPER('Alice', { Alice: { gamesPlayed: 0 } }), 0);
        });

        it('should compute PER for a good player', () => {
            const career = {
                Alice: { gamesPlayed: 10, goals: 15, assists: 10, hockeyAssists: 5, blocks: 8, turnovers: 3, catches: 50 }
            };
            const per = computePlayerPER('Alice', career);
            // (15*3)+(10*3)+(5*1.5)+(8*3)-(3*2) + completionPct*10*0.5
            // = 45+30+7.5+24-6 + (50/53)*5 = 100.5 + 4.72 = 105.2
            assert.ok(per > 100, `Expected >100, got ${per}`);
        });

        it('should penalize turnovers', () => {
            const low = computePlayerPER('A', { A: { gamesPlayed: 5, goals: 5, assists: 3, turnovers: 0, catches: 20 } });
            const high = computePlayerPER('B', { B: { gamesPlayed: 5, goals: 5, assists: 3, turnovers: 10, catches: 20 } });
            assert.ok(low > high, 'Higher turnovers should reduce PER');
        });
    });

    // ─── computePlayerImpact ───────────────────────────────────────────

    describe('computePlayerImpact', () => {
        it('should return empty array for no points', () => {
            const result = computePlayerImpact([], {}, {}, {}, {});
            assert.deepStrictEqual(result, []);
        });

        it('should compute plus/minus correctly', () => {
            const pointHistory = [
                { line: ['A', 'B'], result: 'scored', startType: 'offense' },
                { line: ['A', 'B'], result: 'scored', startType: 'offense' },
                { line: ['A', 'C'], result: 'scored-against', startType: 'defense' }
            ];
            const result = computePlayerImpact(pointHistory, {}, {}, {}, {});
            const playerA = result.find(r => r.name === 'A');
            assert.strictEqual(playerA.plusMinus, 1); // 2 scored - 1 against
            assert.strictEqual(playerA.pointsPlayed, 3);
        });

        it('should sort by plus/minus descending', () => {
            const pointHistory = [
                { line: ['Best', 'Ok'], result: 'scored', startType: 'offense' },
                { line: ['Best', 'Ok'], result: 'scored', startType: 'offense' },
                { line: ['Worst'], result: 'scored-against', startType: 'defense' },
                { line: ['Worst'], result: 'scored-against', startType: 'defense' }
            ];
            const result = computePlayerImpact(pointHistory, {}, {}, {}, {});
            assert.strictEqual(result[0].name, 'Best');
            assert.strictEqual(result[result.length - 1].name, 'Worst');
        });

        it('should track O/D splits', () => {
            const pointHistory = [
                { line: ['A'], result: 'scored', startType: 'offense' },
                { line: ['A'], result: 'scored-against', startType: 'defense' }
            ];
            const result = computePlayerImpact(pointHistory, {}, {}, {}, {});
            const playerA = result.find(r => r.name === 'A');
            assert.strictEqual(playerA.oPointsPlayed, 1);
            assert.strictEqual(playerA.dPointsPlayed, 1);
            assert.strictEqual(playerA.holdRate, 1);
            assert.strictEqual(playerA.breakRate, 0);
        });
    });

    // ─── computeCrossGamePairings ──────────────────────────────────────

    describe('computeCrossGamePairings', () => {
        it('should return empty array for empty data', () => {
            assert.deepStrictEqual(computeCrossGamePairings({}), []);
        });

        it('should compute average throw value', () => {
            const pairings = { 'A|B': { completions: 10, throwValue: 50 } };
            const result = computeCrossGamePairings(pairings);
            assert.strictEqual(result[0].avgThrowValue, 5);
        });

        it('should limit results', () => {
            const pairings = {};
            for (let i = 0; i < 20; i++) {
                pairings[`P${i}|Q${i}`] = { completions: i + 1 };
            }
            const result = computeCrossGamePairings(pairings, 5);
            assert.strictEqual(result.length, 5);
        });
    });

    // ─── computeCrossGameLines ─────────────────────────────────────────

    describe('computeCrossGameLines', () => {
        it('should return empty for empty data', () => {
            assert.deepStrictEqual(computeCrossGameLines({}), []);
        });

        it('should compute plus/minus and sort', () => {
            const lineHistory = {
                'A|B|C': { players: ['A', 'B', 'C'], scored: 5, scoredAgainst: 1 },
                'D|E|F': { players: ['D', 'E', 'F'], scored: 2, scoredAgainst: 4 }
            };
            const result = computeCrossGameLines(lineHistory);
            assert.strictEqual(result[0].plusMinus, 4);
            assert.strictEqual(result[1].plusMinus, -2);
        });
    });

    // ─── computePlayerChemistry ────────────────────────────────────────

    describe('computePlayerChemistry', () => {
        it('should filter pairs with fewer than 2 points together', () => {
            const pairs = {
                'A|B': { pointsTogether: 1, scoredTogether: 1, allowedTogether: 0, connectionCount: 5, defScored: 0, defPointsTogether: 0, offPointsTogether: 1, offScored: 1, offAllowed: 0, defAllowed: 0 }
            };
            const result = computePlayerChemistry(pairs);
            assert.strictEqual(result.length, 0);
        });

        it('should compute chemistry scores and sort', () => {
            const pairs = {
                'A|B': { pointsTogether: 10, scoredTogether: 9, allowedTogether: 1, connectionCount: 15, defScored: 4, defPointsTogether: 5, offPointsTogether: 5, offScored: 5, offAllowed: 0, defAllowed: 1 },
                'C|D': { pointsTogether: 10, scoredTogether: 3, allowedTogether: 7, connectionCount: 2, defScored: 1, defPointsTogether: 5, offPointsTogether: 5, offScored: 2, offAllowed: 3, defAllowed: 4 }
            };
            const result = computePlayerChemistry(pairs);
            assert.strictEqual(result.length, 2);
            assert.ok(result[0].chemistryScore > result[1].chemistryScore, 'Should sort by chemistry score');
        });
    });

    // ─── suggestLineCompute ────────────────────────────────────────────

    describe('suggestLineCompute', () => {
        const players = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10'];
        const emptyInput = {
            allPlayers: players,
            pointHistory: [],
            playerStats: {},
            careerPlayers: {},
            playerPairs: {},
            throwConnections: {},
            chemistryPairings: {},
            playerPositions: {}
        };

        it('should return exactly 7 players', () => {
            const result = suggestLineCompute(emptyInput);
            assert.strictEqual(result.selected.length, 7);
        });

        it('should return unique players', () => {
            const result = suggestLineCompute(emptyInput);
            const uniquePlayers = new Set(result.selected);
            assert.strictEqual(uniquePlayers.size, 7);
        });

        it('should only select from the provided player list', () => {
            const result = suggestLineCompute(emptyInput);
            for (const player of result.selected) {
                assert.ok(players.includes(player), `${player} should be in the player list`);
            }
        });

        it('should suggest defense after scoring', () => {
            const result = suggestLineCompute({
                ...emptyInput,
                pointHistory: [{ line: players.slice(0, 7), result: 'scored', startType: 'offense' }]
            });
            assert.strictEqual(result.suggestSide, 'defense');
        });

        it('should suggest offense after being scored on', () => {
            const result = suggestLineCompute({
                ...emptyInput,
                pointHistory: [{ line: players.slice(0, 7), result: 'scored-against', startType: 'defense' }]
            });
            assert.strictEqual(result.suggestSide, 'offense');
        });

        it('should return fewer than 7 if roster is small', () => {
            const result = suggestLineCompute({
                ...emptyInput,
                allPlayers: ['A', 'B', 'C']
            });
            assert.strictEqual(result.selected.length, 3);
        });
    });
});
