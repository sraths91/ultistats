/**
 * @fileoverview Web Worker for compute-heavy analytics.
 * All functions accept explicit data parameters (no globals).
 * Exposed via Comlink so the main thread can call them like async functions.
 */

import { expose } from 'comlink';

// ─── Pure helper functions ──────────────────────────────────────────────

function computeChemScore(data) {
    const winRate = data.scoredTogether / Math.max(1, data.pointsTogether);
    const pointDiffRate = (data.scoredTogether - data.allowedTogether) / Math.max(1, data.pointsTogether);
    const connectionFreq = Math.min(data.connectionCount || 0, 20) / 20;
    const defWinRate = (data.defScored || 0) / Math.max(1, data.defPointsTogether || 0);
    const breakBonus = (defWinRate * Math.min(data.defPointsTogether || 0, 10)) / 10;
    return winRate * 40 + pointDiffRate * 25 + connectionFreq * 15 + breakBonus * 20;
}

function computeChemScoreForSide(data, side) {
    const pts = side === 'off' ? data.offPointsTogether || 0 : data.defPointsTogether || 0;
    if (pts < 1) return 0;
    const scored = side === 'off' ? data.offScored || 0 : data.defScored || 0;
    const allowed = side === 'off' ? data.offAllowed || 0 : data.defAllowed || 0;
    const winRate = scored / Math.max(1, pts);
    const pointDiffRate = (scored - allowed) / Math.max(1, pts);
    return winRate * 55 + pointDiffRate * 35 + (Math.min(data.connectionCount || 0, 15) / 15) * 10;
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
            if (
                action.description.includes(thrower) &&
                action.description.includes(receiver) &&
                action.description.includes('\u2192')
            ) {
                count++;
            }
        }
    }
    return count;
}

// ─── Exported compute functions ─────────────────────────────────────────

function computePairingStats(throwConnections, actions) {
    const pairs = [];
    for (const thrower in throwConnections) {
        for (const receiver in throwConnections[thrower]) {
            pairs.push({
                thrower,
                receiver,
                completions: throwConnections[thrower][receiver],
                scores: countScoringConnectionsFromActions(actions, thrower, receiver),
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
            lineMap[key] = {
                players: [...point.line],
                played: 0,
                scored: 0,
                scoredAgainst: 0,
                oPlayed: 0,
                oScored: 0,
                dPlayed: 0,
                dScored: 0,
            };
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
    return Object.values(lineMap).sort((a, b) => b.scored - b.scoredAgainst - (a.scored - a.scoredAgainst));
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
    nodeList.forEach((node) => (rank[node] = 1 / n));

    for (let iter = 0; iter < iterations; iter++) {
        const newRank = {};
        nodeList.forEach((node) => (newRank[node] = (1 - damping) / n));

        for (const source of nodeList) {
            const outEdges = edges[source] || [];
            const totalWeight = outEdges.reduce((s, e) => s + e.weight, 0);
            if (totalWeight === 0) {
                nodeList.forEach((node) => (newRank[node] += (damping * rank[source]) / n));
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
    const rawPER =
        (career.goals || 0) * 3 +
        (career.assists || 0) * 3 +
        (career.hockeyAssists || 0) * 1.5 +
        (career.blocks || 0) * 3 -
        (career.turnovers || 0) * 2 +
        completionPct * gp * 0.5;
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
    return Object.entries(impact)
        .map(([name, data]) => {
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
                completionPct:
                    ((stats.catches || 0) / Math.max(1, (stats.catches || 0) + (stats.turnovers || 0))) * 100,
                per: computePlayerPER(name, careerPlayers),
                hubScore: pageRank[name] || 0,
                holdRate,
                breakRate,
                oPointsPlayed: oData.played,
                dPointsPlayed: dData.played,
            };
        })
        .sort((a, b) => b.plusMinus - a.plusMinus || b.offRating - a.offRating);
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
        pairs.push({
            player1: p1,
            player2: p2,
            ...data,
            winRate,
            chemistryScore: Math.round(chemScore),
            offChemistry: Math.round(offChem),
            defChemistry: Math.round(defChem),
        });
    }
    return pairs.sort((a, b) => b.chemistryScore - a.chemistryScore).slice(0, limit);
}

/**
 * Compute the optimal 7-player line suggestion.
 * Returns { selected, playerReasons, suggestSide } — UI updates happen on main thread.
 */
function suggestLineCompute({
    allPlayers,
    pointHistory,
    playerStats,
    careerPlayers,
    playerPairs,
    throwConnections,
    chemistryPairings,
    playerPositions,
}) {
    // Build impact data
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
    const suggestSide =
        lastPoint?.result === 'scored' ? 'defense' : lastPoint?.result === 'scored-against' ? 'offense' : null;

    const playerScores = {};
    const playerReasons = {};
    allPlayers.forEach((player) => {
        const stats = playerStats[player] || {};
        const imp = impact[player] || { pointsPlayed: 0, pointsScored: 0, pointsAgainst: 0 };
        const pp = Math.max(1, imp.pointsPlayed);

        const avgPts = pointHistory.length > 0 ? (pointHistory.length / Math.max(1, allPlayers.length)) * 7 : 0;
        const restFactor = avgPts > 0 ? Math.max(0, 1 - (imp.pointsPlayed / avgPts) * 0.5) : 0.5;

        const plusMinus = hasGameData ? (imp.pointsScored - imp.pointsAgainst) / pp : 0;
        const offContrib = ((stats.goals || 0) + (stats.assists || 0) + (stats.hockeyAssists || 0)) / pp;
        const defContrib = (stats.blocks || 0) / pp;
        const turnPenalty = (stats.turnovers || 0) / pp;

        const per = computePlayerPER(player, careerPlayers);
        const perBonus = per > 0 ? Math.min(per / 20, 1) * 0.5 : 0;

        const hubBonus = ((pageRank[player] || 0) / 100) * 0.3;

        let contextBonus = 0;
        if (suggestSide === 'offense') {
            contextBonus = offContrib * 0.5 - defContrib * 0.2;
        } else if (suggestSide === 'defense') {
            contextBonus = defContrib * 0.5 - offContrib * 0.1;
        }

        playerScores[player] =
            plusMinus * 2 +
            offContrib * 1.5 +
            defContrib * 1 -
            turnPenalty * 1 +
            restFactor * 1.5 +
            perBonus +
            hubBonus +
            contextBonus;

        const reasons = [];
        if (restFactor > 0.7) reasons.push('rested');
        if (plusMinus > 0.3) reasons.push('+/-');
        if (offContrib > 0.5) reasons.push('offense');
        if (defContrib > 0.3) reasons.push('defense');
        if (perBonus > 0.3) reasons.push('PER');
        if (hubBonus > 0.2) reasons.push('hub');
        playerReasons[player] = reasons;
    });

    // Greedy selection
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
                    chemSum += getChemistryScoreFromData(
                        candidate,
                        sel,
                        suggestSide === 'offense' ? 'off' : suggestSide === 'defense' ? 'def' : undefined,
                        playerPairs
                    );
                }
                const chemBonus = (chemSum / selected.length) * 0.05;
                score += chemBonus;
                if (chemBonus > 0.5 && !playerReasons[candidate].includes('chemistry')) {
                    playerReasons[candidate].push('chemistry');
                }
            }

            // Position balance bonus
            const pos = playerPositions[candidate] || null;
            const selectedPositions = selected.map((p) => playerPositions[p] || null);
            const handlers = selectedPositions.filter((p) => p === 'Handler').length;
            const cutters = selectedPositions.filter((p) => p === 'Cutter').length;
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

// Expose all functions via Comlink
expose({
    computePairingStats,
    computeLineStats,
    computePlayerImpact,
    computePageRank,
    computePlayerPER,
    computeChemScore,
    computeChemScoreForSide,
    computeCrossGamePairings,
    computeCrossGameLines,
    computePlayerChemistry,
    suggestLineCompute,
});
