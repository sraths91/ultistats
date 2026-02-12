/**
 * @fileoverview Analytics compute, render, cross-game chemistry, and dashboard chemistry module
 * Extracted from script.js lines 10895-11940
 * @module engine/analytics-render
 */

// State accessor – reads from the bridge exposed by script.js
const S = new Proxy(
    {},
    {
        get(_, prop) {
            return window.__state?.[prop];
        },
        set(_, prop, val) {
            if (window.__state) window.__state[prop] = val;
            return true;
        },
    }
);

// Aliases for script.js global functions (function declarations are on window automatically)
const escapeHtml = (...a) => window.escapeHtml(...a);
const showToast = (...a) => window.showToast(...a);
const vibrate = (...a) => window.vibrate(...a);

// ==================== HELPERS ====================

function posAbbrev(name) {
    const pos = window.getPlayerPosition?.(name);
    if (!pos) return '';
    if (pos === 'Handler') return 'H';
    if (pos === 'Hybrid') return 'HY';
    if (pos === 'Cutter') return 'C';
    return pos.substring(0, 2).toUpperCase();
}

function countScoringConnections(thrower, receiver) {
    let count = 0;
    const actions = S.gameState?.actions || [];
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

// ==================== COMPUTE (sync fallbacks — Worker has copies) ====================

function computePairingStats() {
    const tc = S.throwConnections || {};
    const pairs = [];
    for (const thrower in tc) {
        for (const receiver in tc[thrower]) {
            pairs.push({
                thrower,
                receiver,
                completions: tc[thrower][receiver],
                scores: countScoringConnections(thrower, receiver),
            });
        }
    }
    return pairs.sort((a, b) => b.completions - a.completions).slice(0, 10);
}

function computeLineStats() {
    const lineMap = {};
    for (const point of S.pointHistory || []) {
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

function computePlayerImpact() {
    const impact = {};
    const oPoints = {};
    const dPoints = {};
    for (const point of S.pointHistory || []) {
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
    const pageRank = computePageRank();
    const playerStats = S.gameState?.playerStats || {};
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
                per: computePlayerPER(name),
                hubScore: pageRank[name] || 0,
                holdRate,
                breakRate,
                oPointsPlayed: oData.played,
                dPointsPlayed: dData.played,
            };
        })
        .sort((a, b) => b.plusMinus - a.plusMinus || b.offRating - a.offRating);
}

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

function getRecencyWeight(gameIndex) {
    const totalGames = S.chemistryData?.gamesAnalyzed || 1;
    const gamesAgo = totalGames - 1 - gameIndex;
    const LAMBDA = 0.1;
    return Math.exp(-LAMBDA * gamesAgo);
}

function getChemistryScore(player1, player2, side) {
    const key = [player1, player2].sort().join('|');
    const data = S.chemistryData?.playerPairs?.[key];
    if (!data || data.pointsTogether < 1) return 0;
    if (side === 'off') return computeChemScoreForSide(data, 'off');
    if (side === 'def') return computeChemScoreForSide(data, 'def');
    return computeChemScore(data);
}

function computePlayerPER(playerName) {
    const career = S.careerStats?.players?.[playerName];
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

function computePageRank(iterations = 20, damping = 0.85) {
    const tc = S.throwConnections || {};
    const cd = S.chemistryData || {};
    const nodes = new Set();
    const edges = {};
    const inDegree = {};

    for (const thrower in tc) {
        nodes.add(thrower);
        if (!edges[thrower]) edges[thrower] = [];
        for (const receiver in tc[thrower]) {
            nodes.add(receiver);
            edges[thrower].push({ target: receiver, weight: tc[thrower][receiver] });
            inDegree[receiver] = (inDegree[receiver] || 0) + tc[thrower][receiver];
        }
    }

    for (const key in cd.pairings || {}) {
        const [thrower, receiver] = key.split('|');
        nodes.add(thrower);
        nodes.add(receiver);
        if (!edges[thrower]) edges[thrower] = [];
        if (!tc[thrower]?.[receiver]) {
            edges[thrower].push({ target: receiver, weight: cd.pairings[key].completions });
            inDegree[receiver] = (inDegree[receiver] || 0) + cd.pairings[key].completions;
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

// ==================== CROSS-GAME CHEMISTRY ====================

function computeCrossGamePairings(limit = 10) {
    const cd = S.chemistryData || {};
    const pairs = [];
    for (const key in cd.pairings || {}) {
        const [thrower, receiver] = key.split('|');
        const data = cd.pairings[key];
        const avgThrowValue = data.throwValue ? Math.round(data.throwValue / Math.max(1, data.completions)) : 0;
        pairs.push({ thrower, receiver, ...data, avgThrowValue });
    }
    return pairs.sort((a, b) => b.completions - a.completions).slice(0, limit);
}

function computeCrossGameLines(limit = 8) {
    const cd = S.chemistryData || {};
    const lines = [];
    for (const key in cd.lineHistory || {}) {
        const data = cd.lineHistory[key];
        const diff = data.scored - data.scoredAgainst;
        lines.push({ players: data.players || key.split('|'), ...data, plusMinus: diff });
    }
    return lines.sort((a, b) => b.plusMinus - a.plusMinus || b.scored - a.scored).slice(0, limit);
}

function computePlayerChemistry(limit = 15) {
    const cd = S.chemistryData || {};
    const pairs = [];
    for (const key in cd.playerPairs || {}) {
        const [p1, p2] = key.split('|');
        const data = cd.playerPairs[key];
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

// ==================== AGGREGATION ====================

function aggregateChemistryData() {
    const cd = S.chemistryData;
    const tc = S.throwConnections || {};
    const ph = S.pointHistory || [];
    const tv = S.throwValues || {};
    const gameTimestamp = Date.now();

    for (const thrower in tc) {
        for (const receiver in tc[thrower]) {
            const key = thrower + '|' + receiver;
            if (!cd.pairings[key]) {
                cd.pairings[key] = { completions: 0, goals: 0, games: 0, throwValue: 0 };
            }
            const p = cd.pairings[key];
            p.completions += tc[thrower][receiver];
            p.goals += countScoringConnections(thrower, receiver);
            p.games++;
            const tvKey = thrower + '|' + receiver;
            if (tv[tvKey]) {
                p.throwValue = (p.throwValue || 0) + tv[tvKey].totalYards;
            }
        }
    }

    for (const point of ph) {
        if (!point.result) continue;
        const key = [...point.line].sort().join('|');
        if (!cd.lineHistory[key]) {
            cd.lineHistory[key] = {
                players: [...point.line].sort(),
                played: 0,
                scored: 0,
                scoredAgainst: 0,
                games: new Set(),
            };
        }
        const entry = cd.lineHistory[key];
        entry.played++;
        if (point.result === 'scored') entry.scored++;
        if (point.result === 'scored-against') entry.scoredAgainst++;
        if (entry.games instanceof Set) entry.games.add(cd.gamesAnalyzed);
        else {
            entry.games = new Set([cd.gamesAnalyzed]);
        }

        const isOffense = point.startType === 'offense';
        for (let i = 0; i < point.line.length; i++) {
            for (let j = i + 1; j < point.line.length; j++) {
                const pairKey = [point.line[i], point.line[j]].sort().join('|');
                if (!cd.playerPairs[pairKey]) {
                    cd.playerPairs[pairKey] = {
                        pointsTogether: 0,
                        scoredTogether: 0,
                        allowedTogether: 0,
                        connectionCount: 0,
                        games: 0,
                        offPointsTogether: 0,
                        offScored: 0,
                        offAllowed: 0,
                        defPointsTogether: 0,
                        defScored: 0,
                        defAllowed: 0,
                    };
                }
                const pair = cd.playerPairs[pairKey];
                pair.pointsTogether++;
                if (point.result === 'scored') pair.scoredTogether++;
                if (point.result === 'scored-against') pair.allowedTogether++;
                if (isOffense) {
                    pair.offPointsTogether = (pair.offPointsTogether || 0) + 1;
                    if (point.result === 'scored') pair.offScored = (pair.offScored || 0) + 1;
                    if (point.result === 'scored-against') pair.offAllowed = (pair.offAllowed || 0) + 1;
                } else {
                    pair.defPointsTogether = (pair.defPointsTogether || 0) + 1;
                    if (point.result === 'scored') pair.defScored = (pair.defScored || 0) + 1;
                    if (point.result === 'scored-against') pair.defAllowed = (pair.defAllowed || 0) + 1;
                }
            }
        }
    }

    for (const thrower in tc) {
        for (const receiver in tc[thrower]) {
            const pairKey = [thrower, receiver].sort().join('|');
            if (cd.playerPairs[pairKey]) {
                cd.playerPairs[pairKey].connectionCount += tc[thrower][receiver];
            }
        }
    }

    for (const key in cd.lineHistory) {
        const entry = cd.lineHistory[key];
        if (entry.games instanceof Set) entry.games = entry.games.size;
    }

    cd.gamesAnalyzed++;
    if (!cd.gameTimestamps) cd.gameTimestamps = [];
    cd.gameTimestamps.push(gameTimestamp);
    S.throwValues = {};
    window.saveChemistryData?.();
}

// ==================== RENDER: GAME ANALYSIS TABS ====================

async function renderPairingsTab() {
    const container = document.getElementById('analysis-content');
    if (!container) return;
    let pairs;
    if (window.__analyticsWorker) {
        try {
            pairs = await window.__analyticsWorker.computePairingStats(
                S.throwConnections || {},
                S.gameState?.actions || []
            );
        } catch {
            pairs = computePairingStats();
        }
    } else {
        pairs = computePairingStats();
    }
    if (pairs.length === 0) {
        container.innerHTML = '<div class="text-gray-500 text-center py-4">Complete some throws to see pairings</div>';
        return;
    }
    const maxComp = pairs[0].completions;
    const tv = S.throwValues || {};
    const tvData = {};
    for (const key in tv) {
        if (tv[key].count > 0) tvData[key] = Math.round(tv[key].totalYards / tv[key].count);
    }
    container.innerHTML = pairs
        .map((p) => {
            const pct = Math.round((p.completions / maxComp) * 100);
            const scoreTag =
                p.scores > 0 ? `<span class="text-emerald-400 font-semibold ml-1">${p.scores}G</span>` : '';
            const tvKey = p.thrower + '|' + p.receiver;
            const avgTV = tvData[tvKey];
            const tvTag =
                avgTV !== undefined
                    ? `<span class="${avgTV > 0 ? 'text-cyan-400' : avgTV < 0 ? 'text-red-400' : 'text-gray-500'} text-[10px] ml-1" title="Avg yards gained per throw">${avgTV > 0 ? '+' : ''}${avgTV}y</span>`
                    : '';
            return `<div class="analysis-pair-row flex items-center gap-2 py-1.5 border-b border-white/5">
            <div class="flex-shrink-0 w-28 sm:w-40 truncate">
                <span class="text-gray-500 text-[10px]">${posAbbrev(p.thrower)}</span>
                <span class="text-white font-medium">${escapeHtml(p.thrower.split(' ')[0])}</span>
                <span class="text-gray-500 mx-0.5">&rarr;</span>
                <span class="text-gray-500 text-[10px]">${posAbbrev(p.receiver)}</span>
                <span class="text-white font-medium">${escapeHtml(p.receiver.split(' ')[0])}</span>
            </div>
            <div class="flex-1 min-w-0">
                <div class="stat-bar"><div class="stat-bar-fill" style="width:${pct}%"></div></div>
            </div>
            <div class="flex-shrink-0 text-gray-400 whitespace-nowrap">
                ${p.completions}${scoreTag}${tvTag}
            </div>
        </div>`;
        })
        .join('');
}

async function renderLinesTab() {
    const container = document.getElementById('analysis-content');
    if (!container) return;
    let lines;
    if (window.__analyticsWorker) {
        try {
            lines = await window.__analyticsWorker.computeLineStats(S.pointHistory || []);
        } catch {
            lines = computeLineStats();
        }
    } else {
        lines = computeLineStats();
    }
    if (lines.length === 0) {
        container.innerHTML = '<div class="text-gray-500 text-center py-4">Play some points to see line stats</div>';
        return;
    }
    container.innerHTML = lines
        .map((l) => {
            const diff = l.scored - l.scoredAgainst;
            const diffClass = diff > 0 ? 'plus-minus-pos' : diff < 0 ? 'plus-minus-neg' : 'plus-minus-zero';
            const diffStr = diff > 0 ? `+${diff}` : `${diff}`;
            const initials = l.players
                .map((n) => {
                    const parts = n.split(' ');
                    const abbr = posAbbrev(n);
                    const ini = parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].substring(0, 2);
                    return abbr ? abbr + '\u00A0' + ini : ini;
                })
                .join(', ');
            const holdRate = l.oPlayed > 0 ? Math.round((l.oScored / l.oPlayed) * 100) : null;
            const breakRate = l.dPlayed > 0 ? Math.round((l.dScored / l.dPlayed) * 100) : null;
            const holdTag =
                holdRate !== null
                    ? `<span class="text-amber-400 text-[10px]" title="Hold rate">${holdRate}% hold</span>`
                    : '';
            const breakTag =
                breakRate !== null
                    ? `<span class="${breakRate >= 40 ? 'text-emerald-400 font-semibold' : 'text-red-400'} text-[10px]" title="Break rate">${breakRate}% break</span>`
                    : '';
            return `<div class="py-2 border-b border-white/5">
            <div class="flex items-center justify-between mb-1">
                <div class="flex items-center gap-2">
                    <span class="${diffClass} font-bold text-sm">${diffStr}</span>
                    <span class="text-gray-400">${l.played} pt${l.played !== 1 ? 's' : ''}</span>
                </div>
                <div class="flex items-center gap-2 text-gray-400">
                    <span class="text-emerald-400">${l.scored} scored</span>
                    <span class="text-gray-600">/</span>
                    <span class="text-red-400">${l.scoredAgainst} allowed</span>
                </div>
            </div>
            <div class="flex items-center justify-between">
                <div class="text-gray-500 text-[10px] truncate flex-1" title="${l.players.map((n) => escapeHtml(n)).join(', ')}">${initials}</div>
                <div class="flex items-center gap-2 ml-2">${holdTag}${breakTag}</div>
            </div>
        </div>`;
        })
        .join('');
}

async function renderImpactTab() {
    const container = document.getElementById('analysis-content');
    if (!container) return;
    let players;
    if (window.__analyticsWorker) {
        try {
            players = await window.__analyticsWorker.computePlayerImpact(
                S.pointHistory || [],
                S.gameState?.playerStats || {},
                S.careerStats?.players || {},
                S.throwConnections || {},
                S.chemistryData?.pairings || {}
            );
        } catch {
            players = computePlayerImpact();
        }
    } else {
        players = computePlayerImpact();
    }
    if (players.length === 0) {
        container.innerHTML = '<div class="text-gray-500 text-center py-4">Play some points to see player impact</div>';
        return;
    }
    container.innerHTML =
        `
        <div class="flex items-center gap-1 text-[10px] text-gray-600 uppercase tracking-wider pb-1 border-b border-white/5 mb-1">
            <span class="w-20 sm:w-28">Player</span>
            <span class="w-8 text-center">+/-</span>
            <span class="w-8 text-center">OFF</span>
            <span class="w-8 text-center">DEF</span>
            <span class="w-8 text-center">CMP</span>
            <span class="w-8 text-center hidden sm:block" title="Player Efficiency Rating">PER</span>
            <span class="w-8 text-center hidden sm:block" title="Hub Score (PageRank)">HUB</span>
            <span class="flex-1 text-center">O/D</span>
        </div>
    ` +
        players
            .map((p) => {
                const diffClass =
                    p.plusMinus > 0 ? 'plus-minus-pos' : p.plusMinus < 0 ? 'plus-minus-neg' : 'plus-minus-zero';
                const diffStr = p.plusMinus > 0 ? `+${p.plusMinus}` : `${p.plusMinus}`;
                const firstName = p.name.split(' ')[0];
                const pos = posAbbrev(p.name);
                const posTag = pos ? `<span class="text-gray-500 text-[10px] mr-0.5">${pos}</span>` : '';
                const holdStr = p.holdRate !== null ? `${Math.round(p.holdRate * 100)}%` : '-';
                const breakStr = p.breakRate !== null ? `${Math.round(p.breakRate * 100)}%` : '-';
                const breakHighlight =
                    p.breakRate !== null && p.breakRate >= 0.4 ? 'text-emerald-400 font-semibold' : 'text-red-400';
                return `<div class="flex items-center gap-1 py-1.5 border-b border-white/5">
            <span class="w-20 sm:w-28 text-white font-medium truncate">${posTag}${escapeHtml(firstName)}</span>
            <span class="w-8 text-center font-bold ${diffClass}">${diffStr}</span>
            <span class="w-8 text-center text-amber-400">${p.offRating.toFixed(1)}</span>
            <span class="w-8 text-center text-purple-400">${p.defRating.toFixed(1)}</span>
            <span class="w-8 text-center text-cyan-400">${Math.round(p.completionPct)}%</span>
            <span class="w-8 text-center text-orange-400 hidden sm:block">${p.per > 0 ? p.per : '-'}</span>
            <span class="w-8 text-center text-pink-400 hidden sm:block">${p.hubScore > 0 ? p.hubScore : '-'}</span>
            <span class="flex-1 text-center text-[10px]"><span class="text-amber-400">${holdStr}</span><span class="text-gray-600">/</span><span class="${breakHighlight}">${breakStr}</span></span>
        </div>`;
            })
            .join('');
}

async function renderChemistryTab() {
    const container = document.getElementById('analysis-content');
    if (!container) return;
    const cd = S.chemistryData || {};

    let pairs;
    if (window.__analyticsWorker) {
        try {
            pairs = await window.__analyticsWorker.computePlayerChemistry(cd.playerPairs || {}, 8);
        } catch {
            pairs = computePlayerChemistry(8);
        }
    } else {
        pairs = computePlayerChemistry(8);
    }
    if (pairs.length === 0) {
        container.innerHTML =
            '<div class="text-gray-500 text-center py-4">Complete a game to see cross-game chemistry</div>';
        return;
    }

    const maxScore = pairs[0].chemistryScore || 1;
    const onField = new Set(S.gameState?.onFieldPlayers || []);

    container.innerHTML =
        `<div class="text-[10px] text-gray-500 mb-2">${cd.gamesAnalyzed || 0} game${(cd.gamesAnalyzed || 0) !== 1 ? 's' : ''} analyzed &middot; Break bonus weighted 2&times;</div>` +
        pairs
            .map((p) => {
                const pct = Math.round((p.chemistryScore / maxScore) * 100);
                const pm = p.scoredTogether - p.allowedTogether;
                const pmClass = pm > 0 ? 'plus-minus-pos' : pm < 0 ? 'plus-minus-neg' : 'plus-minus-zero';
                const pmStr = pm > 0 ? '+' + pm : '' + pm;
                const onFieldBoth = onField.has(p.player1) && onField.has(p.player2);
                const highlight = onFieldBoth ? ' border-l-2 border-emerald-400 pl-2' : '';
                const offBadge =
                    p.offChemistry > 0
                        ? `<span class="text-amber-400 text-[9px]" title="O-line chemistry">O${p.offChemistry}</span>`
                        : '';
                const defBadge =
                    p.defChemistry > 0
                        ? `<span class="text-red-400 text-[9px]" title="D-line chemistry">D${p.defChemistry}</span>`
                        : '';
                return `<div class="flex items-center gap-2 py-1.5 border-b border-white/5${highlight}">
                <div class="flex-shrink-0 w-28 sm:w-36 truncate">
                    <span class="text-white font-medium">${escapeHtml(p.player1.split(' ')[0])}</span>
                    <span class="text-violet-400 mx-0.5">&amp;</span>
                    <span class="text-white font-medium">${escapeHtml(p.player2.split(' ')[0])}</span>
                </div>
                <div class="flex-1 min-w-0">
                    <div class="stat-bar"><div class="stat-bar-fill chemistry-bar" style="width:${pct}%"></div></div>
                </div>
                <div class="flex-shrink-0 flex items-center gap-1.5 text-gray-400 whitespace-nowrap">
                    <span class="${pmClass} font-semibold">${pmStr}</span>
                    ${offBadge}${defBadge}
                    <span class="text-violet-400 font-medium">${p.chemistryScore}</span>
                    <span class="text-gray-600 text-[10px]">${p.pointsTogether}pt</span>
                </div>
            </div>`;
            })
            .join('');
}

// ==================== ANALYSIS PANEL CONTROLS ====================

function toggleStatsAnalysis() {
    const section = document.getElementById('stats-analysis');
    if (!section) return;
    const isHidden = section.classList.contains('section-hidden');
    if (isHidden) {
        section.classList.remove('section-hidden');
        refreshAnalysis();
    } else {
        section.classList.add('section-hidden');
    }
}

function switchAnalysisTab(tab) {
    S.activeAnalysisTab = tab;
    const tabs = document.querySelectorAll('#analysis-tabs .analysis-tab');
    tabs.forEach((t) => {
        t.classList.toggle('active', (t.dataset.tab || '') === tab);
    });
    refreshAnalysis();
}

async function refreshAnalysis() {
    const section = document.getElementById('stats-analysis');
    if (!section || section.classList.contains('section-hidden')) return;
    switch (S.activeAnalysisTab) {
        case 'pairings':
            await renderPairingsTab();
            break;
        case 'lines':
            await renderLinesTab();
            break;
        case 'impact':
            await renderImpactTab();
            break;
        case 'chemistry':
            await renderChemistryTab();
            break;
    }
}

// ==================== CHEMISTRY RECOMMENDATIONS ====================

function updateChemistryRecommendations() {
    const strip = document.getElementById('chemistry-recommendations');
    if (!strip) return;

    const selected = S.gameState?.onFieldPlayers || [];
    const cd = S.chemistryData || {};
    const hasChemData = Object.keys(cd.playerPairs || {}).length > 0;

    if (!hasChemData || selected.length === 0 || selected.length >= 7) {
        strip.classList.add('hidden');
        return;
    }

    const bench = (window.getPresentPlayers?.() || []).filter((p) => !selected.includes(p));
    const scored = bench
        .map((player) => {
            let totalChem = 0;
            for (const sel of selected) {
                totalChem += getChemistryScore(player, sel);
            }
            return { name: player, avgChem: Math.round(totalChem / selected.length) };
        })
        .filter((p) => p.avgChem > 0)
        .sort((a, b) => b.avgChem - a.avgChem)
        .slice(0, 3);

    if (scored.length === 0) {
        strip.classList.add('hidden');
        return;
    }

    strip.classList.remove('hidden');
    strip.innerHTML =
        `<span class="text-violet-400 text-[10px] font-semibold mr-1.5">Best chemistry:</span>` +
        scored
            .map((p) => {
                const pos = window.getPlayerPosition?.(p.name);
                const posTag = pos ? `<span class="text-gray-500 text-[9px]">${pos.substring(0, 1)}</span> ` : '';
                return `<button onclick="togglePlayerOnField('${escapeHtml(p.name.replace(/'/g, "\\'"))}')" class="chem-rec-chip">
                ${posTag}<span class="text-white">${escapeHtml(p.name.split(' ')[0])}</span>
                <span class="chem-rec-score">${p.avgChem}</span>
            </button>`;
            })
            .join('');
}

// ==================== SUGGEST LINE ====================

async function suggestLine() {
    const allPlayers = window.getPresentPlayers?.() || [];
    if (allPlayers.length < 7) {
        showToast('Need at least 7 players to suggest a line', 'error');
        return;
    }

    let selected, playerReasons, suggestSide;

    if (window.__analyticsWorker) {
        try {
            const result = await window.__analyticsWorker.suggestLineCompute({
                allPlayers,
                pointHistory: S.pointHistory || [],
                playerStats: S.gameState?.playerStats || {},
                careerPlayers: S.careerStats?.players || {},
                playerPairs: S.chemistryData?.playerPairs || {},
                throwConnections: S.throwConnections || {},
                chemistryPairings: S.chemistryData?.pairings || {},
                playerPositions: S.playerPositions || {},
            });
            selected = result.selected;
            playerReasons = result.playerReasons;
            suggestSide = result.suggestSide;
        } catch {
            // Fall through to synchronous computation below
        }
    }

    if (!selected) {
        const ph = S.pointHistory || [];
        const impact = {};
        for (const point of ph) {
            for (const player of point.line) {
                if (!impact[player]) impact[player] = { pointsPlayed: 0, pointsScored: 0, pointsAgainst: 0 };
                impact[player].pointsPlayed++;
                if (point.result === 'scored') impact[player].pointsScored++;
                if (point.result === 'scored-against') impact[player].pointsAgainst++;
            }
        }
        const cd = S.chemistryData || {};
        const hasChemData = Object.keys(cd.playerPairs || {}).length > 0;
        const hasGameData = ph.length > 0;
        const pageRank = computePageRank();

        const lastPoint = ph.length > 0 ? ph[ph.length - 1] : null;
        suggestSide =
            lastPoint?.result === 'scored' ? 'defense' : lastPoint?.result === 'scored-against' ? 'offense' : null;

        const playerScores = {};
        playerReasons = {};
        const playerStats = S.gameState?.playerStats || {};
        allPlayers.forEach((player) => {
            const stats = playerStats[player] || {};
            const imp = impact[player] || { pointsPlayed: 0, pointsScored: 0, pointsAgainst: 0 };
            const pp = Math.max(1, imp.pointsPlayed);

            const avgPts = ph.length > 0 ? (ph.length / Math.max(1, allPlayers.length)) * 7 : 0;
            const restFactor = avgPts > 0 ? Math.max(0, 1 - (imp.pointsPlayed / avgPts) * 0.5) : 0.5;

            const plusMinus = hasGameData ? (imp.pointsScored - imp.pointsAgainst) / pp : 0;
            const offContrib = ((stats.goals || 0) + (stats.assists || 0) + (stats.hockeyAssists || 0)) / pp;
            const defContrib = (stats.blocks || 0) / pp;
            const turnPenalty = (stats.turnovers || 0) / pp;

            const per = computePlayerPER(player);
            const perBonus = per > 0 ? Math.min(per / 20, 1) * 0.5 : 0;
            const hubBonus = ((pageRank[player] || 0) / 100) * 0.3;

            let contextBonus = 0;
            if (suggestSide === 'offense') contextBonus = offContrib * 0.5 - defContrib * 0.2;
            else if (suggestSide === 'defense') contextBonus = defContrib * 0.5 - offContrib * 0.1;

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

        const sorted = [...allPlayers].sort((a, b) => (playerScores[b] || 0) - (playerScores[a] || 0));
        selected = [sorted[0]];

        while (selected.length < 7) {
            let bestCandidate = null;
            let bestScore = -Infinity;

            for (const candidate of allPlayers) {
                if (selected.includes(candidate)) continue;
                let score = playerScores[candidate] || 0;

                if (hasChemData) {
                    let chemSum = 0;
                    for (const sel of selected) {
                        chemSum += getChemistryScore(
                            candidate,
                            sel,
                            suggestSide === 'offense' ? 'off' : suggestSide === 'defense' ? 'def' : undefined
                        );
                    }
                    const chemBonus = (chemSum / selected.length) * 0.05;
                    score += chemBonus;
                    if (chemBonus > 0.5 && !playerReasons[candidate].includes('chemistry')) {
                        playerReasons[candidate].push('chemistry');
                    }
                }

                const pos = window.getPlayerPosition?.(candidate);
                const selectedPositions = selected.map((p) => window.getPlayerPosition?.(p));
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
        selected = selected.slice(0, 7);
    }

    // Apply the suggestion
    if (S.gameState) S.gameState.onFieldPlayers = selected;
    window.updateLineSelectionGrid?.();
    window.saveToStorage?.();

    // Build reasoning summary
    const posBreakdown = selected.reduce((acc, p) => {
        const pos = window.getPlayerPosition?.(p) || 'Unknown';
        acc[pos] = (acc[pos] || 0) + 1;
        return acc;
    }, {});
    const posStr = Object.entries(posBreakdown)
        .map(([k, v]) => `${v}${k[0]}`)
        .join(' ');
    const chemCount = selected.filter((p) => (playerReasons[p] || []).includes('chemistry')).length;
    const restCount = selected.filter((p) => (playerReasons[p] || []).includes('rested')).length;

    let reason = posStr;
    if (suggestSide) reason = (suggestSide === 'offense' ? 'O-line' : 'D-line') + ': ' + reason;
    if (chemCount > 0) reason += ` | ${chemCount} chem`;
    if (restCount > 0) reason += ` | ${restCount} rested`;
    showToast(`Suggested: ${reason}`, 'success');

    showSuggestionDetails(selected, playerReasons);
    vibrate(30);
}

function showSuggestionDetails(selected, reasons) {
    const strip = document.getElementById('chemistry-recommendations');
    if (!strip) return;

    strip.classList.remove('hidden');
    const pills = selected
        .map((p) => {
            const pos = window.getPlayerPosition?.(p);
            const posTag = pos ? `<span class="text-gray-500 text-[9px]">${pos.substring(0, 1)}</span> ` : '';
            const reasonTags = (reasons[p] || [])
                .slice(0, 2)
                .map((r) => {
                    const cls =
                        r === 'chemistry'
                            ? 'text-violet-400'
                            : r === 'rested'
                              ? 'text-cyan-400'
                              : r === '+/-'
                                ? 'text-emerald-400'
                                : 'text-amber-400';
                    return `<span class="${cls} text-[8px]">${r}</span>`;
                })
                .join(' ');
            return `<span class="chem-rec-chip chem-rec-selected">${posTag}<span class="text-white">${escapeHtml(p.split(' ')[0])}</span> ${reasonTags}</span>`;
        })
        .join('');

    strip.innerHTML = `<span class="text-violet-400 text-[10px] font-semibold mr-1.5">Suggested line:</span>${pills}`;
}

// ==================== DASHBOARD CHEMISTRY WIDGET ====================

function renderDashboardChemistry() {
    const container = document.getElementById('chemistry-content');
    if (!container) return;

    window.loadChemistryData?.();
    const cd = S.chemistryData || {};

    if ((cd.gamesAnalyzed || 0) === 0) {
        container.innerHTML = `<div class="text-center py-8">
            <div class="w-16 h-16 mx-auto bg-violet-500/10 rounded-2xl flex items-center justify-center mb-3">
                <i data-lucide="heart-handshake" class="w-8 h-8 text-violet-400"></i>
            </div>
            <p class="text-gray-400 text-sm">Play and complete games to build chemistry data</p>
            <p class="text-gray-500 text-xs mt-1">Player pairing analytics will appear here after your first game</p>
        </div>`;
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
    }

    const activeTab = document.querySelector('#chemistry-tabs .analysis-tab.active')?.dataset.tab || 'top-pairs';

    switch (activeTab) {
        case 'top-pairs':
            renderDashboardTopPairs(container);
            break;
        case 'best-lines':
            renderDashboardBestLines(container);
            break;
        case 'player-chem':
            renderDashboardPlayerChemistry(container);
            break;
        case 'recommended':
            renderDashboardRecommended(container);
            break;
    }
}

function switchChemistryTab(tab) {
    const tabs = document.querySelectorAll('#chemistry-tabs .analysis-tab');
    tabs.forEach((t) => t.classList.toggle('active', (t.dataset.tab || '') === tab));
    renderDashboardChemistry();
}

function renderDashboardTopPairs(container) {
    const cd = S.chemistryData || {};
    const pairs = computeCrossGamePairings(10);
    if (pairs.length === 0) {
        container.innerHTML = '<div class="text-gray-500 text-center py-4">No pairing data yet</div>';
        return;
    }
    const maxComp = pairs[0].completions || 1;
    container.innerHTML =
        `<div class="text-[10px] text-gray-500 mb-2 flex justify-between"><span>Across ${cd.gamesAnalyzed || 0} games</span><span>Thrower &rarr; Receiver</span></div>` +
        pairs
            .map((p) => {
                const pct = Math.round((p.completions / maxComp) * 100);
                const goalTag =
                    p.goals > 0 ? `<span class="text-emerald-400 font-semibold ml-1">${p.goals}G</span>` : '';
                const tvTag = p.avgThrowValue
                    ? `<span class="${p.avgThrowValue > 0 ? 'text-cyan-400' : 'text-red-400'} text-[10px] ml-1" title="Avg yards gained">${p.avgThrowValue > 0 ? '+' : ''}${p.avgThrowValue}y</span>`
                    : '';
                return `<div class="flex items-center gap-2 py-1.5 border-b border-white/5">
                <div class="flex-shrink-0 w-32 sm:w-44 truncate">
                    <span class="text-white font-medium">${escapeHtml(p.thrower.split(' ')[0])}</span>
                    <span class="text-gray-500 mx-0.5">&rarr;</span>
                    <span class="text-white font-medium">${escapeHtml(p.receiver.split(' ')[0])}</span>
                </div>
                <div class="flex-1 min-w-0">
                    <div class="stat-bar"><div class="stat-bar-fill" style="width:${pct}%"></div></div>
                </div>
                <div class="flex-shrink-0 text-gray-400 whitespace-nowrap text-xs">
                    ${p.completions}${goalTag}${tvTag}
                    <span class="text-gray-600 ml-1">${p.games}g</span>
                </div>
            </div>`;
            })
            .join('');
}

function renderDashboardBestLines(container) {
    const cd = S.chemistryData || {};
    const lines = computeCrossGameLines(8);
    if (lines.length === 0) {
        container.innerHTML = '<div class="text-gray-500 text-center py-4">No line data yet</div>';
        return;
    }
    container.innerHTML =
        `<div class="text-[10px] text-gray-500 mb-2">Best 7-player combinations across ${cd.gamesAnalyzed || 0} games</div>` +
        lines
            .map((l) => {
                const diff = l.plusMinus;
                const diffClass = diff > 0 ? 'plus-minus-pos' : diff < 0 ? 'plus-minus-neg' : 'plus-minus-zero';
                const diffStr = diff > 0 ? '+' + diff : '' + diff;
                const names = (l.players || []).map((n) => escapeHtml(n.split(' ')[0])).join(', ');
                return `<div class="py-2 border-b border-white/5">
                <div class="flex items-center justify-between mb-1">
                    <div class="flex items-center gap-2">
                        <span class="${diffClass} font-bold text-sm">${diffStr}</span>
                        <span class="text-gray-400 text-xs">${l.played} pts</span>
                    </div>
                    <div class="flex items-center gap-2 text-xs">
                        <span class="text-emerald-400">${l.scored} scored</span>
                        <span class="text-gray-600">/</span>
                        <span class="text-red-400">${l.scoredAgainst} allowed</span>
                    </div>
                </div>
                <div class="text-gray-500 text-[10px] truncate" title="${(l.players || []).map((n) => escapeHtml(n)).join(', ')}">${names}</div>
            </div>`;
            })
            .join('');
}

function renderDashboardPlayerChemistry(container) {
    const pairs = computePlayerChemistry(12);
    if (pairs.length === 0) {
        container.innerHTML = '<div class="text-gray-500 text-center py-4">No chemistry data yet</div>';
        return;
    }
    const maxScore = pairs[0].chemistryScore || 1;
    container.innerHTML =
        `<div class="text-[10px] text-gray-500 mb-2 flex justify-between"><span>Players who win together &middot; Break bonus 2&times;</span><span>Overall / O / D</span></div>` +
        pairs
            .map((p) => {
                const pct = Math.round((p.chemistryScore / maxScore) * 100);
                const pm = p.scoredTogether - p.allowedTogether;
                const pmClass = pm > 0 ? 'plus-minus-pos' : pm < 0 ? 'plus-minus-neg' : 'plus-minus-zero';
                const pmStr = pm > 0 ? '+' + pm : '' + pm;
                const wr = Math.round(p.winRate * 100);
                const offBadge =
                    p.offChemistry > 0 ? `<span class="text-amber-400 text-[9px]">O${p.offChemistry}</span>` : '';
                const defBadge =
                    p.defChemistry > 0 ? `<span class="text-red-400 text-[9px]">D${p.defChemistry}</span>` : '';
                return `<div class="flex items-center gap-2 py-1.5 border-b border-white/5">
                <div class="flex-shrink-0 w-32 sm:w-44 truncate">
                    <span class="text-white font-medium">${escapeHtml(p.player1.split(' ')[0])}</span>
                    <span class="text-violet-400 mx-0.5">&amp;</span>
                    <span class="text-white font-medium">${escapeHtml(p.player2.split(' ')[0])}</span>
                </div>
                <div class="flex-1 min-w-0">
                    <div class="stat-bar"><div class="stat-bar-fill chemistry-bar" style="width:${pct}%"></div></div>
                </div>
                <div class="flex-shrink-0 flex items-center gap-1.5 text-xs whitespace-nowrap">
                    <span class="${pmClass} font-semibold">${pmStr}</span>
                    <span class="text-cyan-400">${wr}%</span>
                    ${offBadge}${defBadge}
                    <span class="text-violet-400 font-bold">${p.chemistryScore}</span>
                </div>
            </div>`;
            })
            .join('');
}

function renderDashboardRecommended(container) {
    const roster = window.getCurrentRoster?.() || [];
    if (roster.length < 7) {
        container.innerHTML = '<div class="text-gray-500 text-center py-4">Need at least 7 players on roster</div>';
        return;
    }

    const cd = S.chemistryData || {};
    const hasChemData = Object.keys(cd.playerPairs || {}).length > 0;
    if (!hasChemData) {
        container.innerHTML =
            '<div class="text-gray-500 text-center py-4">Play more games to generate recommendations</div>';
        return;
    }

    const playerScores = {};
    const playerTags = {};
    roster.forEach((player) => {
        const career = S.careerStats?.players?.[player] || {};
        const gp = Math.max(1, career.gamesPlayed || 1);
        const offRate = ((career.goals || 0) + (career.assists || 0) + (career.hockeyAssists || 0)) / gp;
        const defRate = (career.blocks || 0) / gp;
        const turnRate = (career.turnovers || 0) / gp;
        const per = computePlayerPER(player);
        const perBonus = per > 0 ? Math.min(per / 20, 1) * 0.5 : 0;
        playerScores[player] = offRate * 2 + defRate * 1.5 - turnRate * 1 + perBonus;
        playerTags[player] = [];
        if (offRate > 0.5) playerTags[player].push('offense');
        if (defRate > 0.3) playerTags[player].push('defense');
        if (per > 5) playerTags[player].push('PER');
        if ((career.gamesPlayed || 0) >= 3) playerTags[player].push('veteran');
    });

    const sorted = [...roster].sort((a, b) => (playerScores[b] || 0) - (playerScores[a] || 0));
    const selected = [sorted[0]];

    while (selected.length < 7 && selected.length < roster.length) {
        let bestCandidate = null;
        let bestScore = -Infinity;

        for (const candidate of roster) {
            if (selected.includes(candidate)) continue;
            let score = playerScores[candidate] || 0;

            let chemSum = 0;
            for (const sel of selected) {
                chemSum += getChemistryScore(candidate, sel);
            }
            const chemBonus = (chemSum / selected.length) * 0.05;
            score += chemBonus;
            if (chemBonus > 0.3 && !playerTags[candidate].includes('chemistry')) {
                playerTags[candidate].push('chemistry');
            }

            const pos = window.getPlayerPosition?.(candidate);
            const selectedPositions = selected.map((p) => window.getPlayerPosition?.(p));
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

    const linePairs = [];
    for (let i = 0; i < selected.length; i++) {
        for (let j = i + 1; j < selected.length; j++) {
            const score = getChemistryScore(selected[i], selected[j]);
            if (score > 0) linePairs.push({ p1: selected[i], p2: selected[j], score: Math.round(score) });
        }
    }
    linePairs.sort((a, b) => b.score - a.score);
    const topPairs = linePairs.slice(0, 3);

    const posBreakdown = selected.reduce((acc, p) => {
        const pos = window.getPlayerPosition?.(p) || '?';
        acc[pos] = (acc[pos] || 0) + 1;
        return acc;
    }, {});
    const posStr = Object.entries(posBreakdown)
        .map(([k, v]) => `${v} ${k}${v > 1 ? 's' : ''}`)
        .join(', ');

    container.innerHTML = `
        <div class="mb-3">
            <div class="text-[10px] text-gray-500 mb-2">Recommended starting 7 based on career stats &amp; chemistry</div>
            <div class="text-[10px] text-gray-600 mb-3">${posStr}</div>
            <div class="grid grid-cols-1 gap-1.5">
                ${selected
                    .map((p, i) => {
                        const pos = window.getPlayerPosition?.(p);
                        const posTag = pos
                            ? `<span class="text-gray-500 text-[10px] w-6">${pos === 'Hybrid' ? 'HY' : pos.substring(0, 1)}</span>`
                            : '<span class="w-6"></span>';
                        const tags = (playerTags[p] || [])
                            .map((t) => {
                                const cls =
                                    t === 'chemistry'
                                        ? 'bg-violet-500/20 text-violet-400'
                                        : t === 'offense'
                                          ? 'bg-amber-500/20 text-amber-400'
                                          : t === 'defense'
                                            ? 'bg-purple-500/20 text-purple-400'
                                            : 'bg-cyan-500/20 text-cyan-400';
                                return `<span class="text-[9px] px-1.5 py-0.5 rounded-full ${cls}">${t}</span>`;
                            })
                            .join('');
                        return `<div class="flex items-center gap-2 py-1.5 px-2 rounded-lg ${i < 7 ? 'bg-white/5' : ''}">
                        <span class="text-gray-600 text-[10px] w-4">${i + 1}.</span>
                        ${posTag}
                        <span class="text-white font-medium text-xs flex-1">${escapeHtml(p)}</span>
                        <div class="flex gap-1">${tags}</div>
                    </div>`;
                    })
                    .join('')}
            </div>
        </div>
        ${
            topPairs.length > 0
                ? `
        <div class="mt-3 pt-3 border-t border-white/5">
            <div class="text-[10px] text-gray-500 mb-2">Top chemistry pairs in this line</div>
            ${topPairs
                .map((pair) => {
                    return `<div class="flex items-center gap-2 py-1 text-xs">
                    <span class="text-white">${escapeHtml(pair.p1.split(' ')[0])}</span>
                    <span class="text-violet-400">&amp;</span>
                    <span class="text-white">${escapeHtml(pair.p2.split(' ')[0])}</span>
                    <span class="text-violet-400 font-semibold ml-auto">${pair.score}</span>
                </div>`;
                })
                .join('')}
        </div>`
                : ''
        }`;
}

// ==================== EXPOSE ON WINDOW ====================

window.__analyticsRender = {
    // Compute (sync fallbacks)
    computePairingStats,
    computeLineStats,
    computePlayerImpact,
    computeChemScore,
    computeChemScoreForSide,
    computePlayerPER,
    computePageRank,
    computePlayerChemistry,
    computeCrossGamePairings,
    computeCrossGameLines,
    getChemistryScore,
    getRecencyWeight,
    countScoringConnections,
    // Aggregation
    aggregateChemistryData,
    // Render (game analysis tabs)
    renderPairingsTab,
    renderLinesTab,
    renderImpactTab,
    renderChemistryTab,
    // Panel controls
    toggleStatsAnalysis,
    switchAnalysisTab,
    refreshAnalysis,
    // Chemistry recommendations & suggest
    updateChemistryRecommendations,
    suggestLine,
    showSuggestionDetails,
    // Dashboard chemistry
    renderDashboardChemistry,
    switchChemistryTab,
    renderDashboardTopPairs,
    renderDashboardBestLines,
    renderDashboardPlayerChemistry,
    renderDashboardRecommended,
    // Helpers
    posAbbrev,
};

// Also expose functions directly on window for onclick="" handlers in HTML
window.toggleStatsAnalysis = toggleStatsAnalysis;
window.switchAnalysisTab = switchAnalysisTab;
window.switchChemistryTab = switchChemistryTab;
window.suggestLine = suggestLine;
window.renderDashboardChemistry = renderDashboardChemistry;
