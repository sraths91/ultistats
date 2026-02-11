# UltiStats Analytics Algorithms & Methodology

## Overview

UltiStats implements six analytics algorithms for real-time player chemistry analysis, line optimization, and performance evaluation during ultimate frisbee games. All computation runs client-side in vanilla JavaScript, designed for sub-50ms response times on mobile devices with datasets of 10-50 games per season.

---

## 1. Throw Value Scoring

**Problem:** Raw completion counts treat a 40-yard huck the same as a 2-yard dump. Coaches need to know which connections move the disc effectively, not just frequently.

**Algorithm:** Each throw records directional yardage (positive = toward opponent's endzone) computed from SVG field coordinates:

```
directionalYards = (startY - endY) × 1.2
```

The field is 120 yards mapped to 0-100% Y-axis, so multiplying by 1.2 converts percentage delta to real yards. Positive values indicate forward progress; negative values indicate resets or backward throws.

**Aggregation:** Per thrower→receiver pair, we store cumulative `throwValue` across games and compute:

```
avgThrowValue = totalThrowValue / completions
```

**Display:** Pairings tabs show `+Ny` (cyan, forward-moving) or `-Ny` (red, backward) next to each connection, letting coaches distinguish high-value deep connections from high-frequency reset pairs.

**References:**
- Field Value model concept from [Eberhard et al., MIT Sloan 2025](https://www.sloansportsconference.com/research-papers/a-machine-learning-approach-to-throw-value-estimation-in-professional-ultimate-frisbee): Completion Probability (CP) and Field Value (FV) models for expected throwing value
- [Colin Scott's xG model for ultimate](https://medium.com/@colinscott4/an-xg-model-for-ultimate-frisbee-c906ab64ea1d): Expected goals model adapted from soccer, with completion probability heatmaps

---

## 2. O/D Split Chemistry

**Problem:** A pair that dominates on O-line (holding serve) may struggle on D-line (earning breaks), and vice versa. A single chemistry score conflates these distinct roles.

**Algorithm:** Every point in `_pointHistory` records `startType: 'offense' | 'defense'`. When aggregating chemistry data at game end, each player pair accumulates separate counters:

```
offPointsTogether, offScored, offAllowed   (O-line points)
defPointsTogether, defScored, defAllowed   (D-line points)
```

Side-specific chemistry is computed as:

```
sideChemistry = winRate × 55 + pointDiffRate × 35 + connectionFreq × 10
```

where `winRate = scored / pointsTogether` and `pointDiffRate = (scored - allowed) / pointsTogether` for the given side.

**Break Rate Bonus:** D-line scores (breaks) are inherently harder and more impactful than O-line holds. The overall chemistry formula weights break performance at 2×:

```
overallChemistry = winRate × 40 + pointDiffRate × 25 + connectionFreq × 15 + breakBonus × 20
```

where `breakBonus = defWinRate × min(defPointsTogether, 10) / 10`.

**Context-Aware Suggestion:** `suggestLine()` detects whether the next point is likely offense or defense (based on the previous point's result) and uses side-specific chemistry scores when building the greedy selection.

**Display:** Chemistry tabs show `O##` (amber) and `D##` (red) badges per pair. Player Impact shows hold rate / break rate columns. Lines tab shows `% hold` and `% break` per 7-player combination.

**References:**
- [Player Chemistry: Striving for a Perfectly Balanced Soccer Team](https://arxiv.org/abs/2003.01712) (Bransen & Van Haaren, MIT Sloan): Introduced offensive and defensive chemistry metrics for player pairs using VAEP action valuation
- Ultimate-specific insight: break rate is 2-3× more impactful than hold rate, per analysis from [AUDL/UFA data science projects](https://someflow.substack.com/p/all-the-audlufa-data-science-projects)

---

## 3. Recency Weighting

**Problem:** A pair that played well 15 games ago may have since lost chemistry due to injury, role changes, or roster turnover. Recent performance should count more.

**Algorithm:** Exponential decay with configurable half-life:

```
weight(gameIndex) = e^(-λ × gamesAgo)
```

where `gamesAgo = totalGames - 1 - gameIndex` and `λ = 0.1`, giving a half-life of `ln(2) / 0.1 ≈ 7 games`.

| Games Ago | Weight |
|-----------|--------|
| 0 (most recent) | 1.00 |
| 3 | 0.74 |
| 7 | 0.50 |
| 14 | 0.25 |
| 23 | 0.10 |

**Implementation:** `chemistryData.gameTimestamps[]` records the timestamp of each analyzed game, enabling time-based weighting. The `getRecencyWeight()` function is available for weighted computations across all analytics modules.

**References:**
- Standard approach in RAPM implementations: [Regularized Adjusted Plus-Minus](https://www.nbastuffer.com/analytics101/regularized-adjusted-plus-minus-rapm/) uses weighted seasons with recent years counting more
- [L-RAPM (Jan 2026)](https://arxiv.org/abs/2601.15000): Uses informed priors that inherently decay older lineup observations

---

## 4. PageRank Hub Score

**Problem:** Some players are central to the team's offensive flow (hub playmakers), while others are peripheral. Traditional stats (goals, assists) don't capture structural importance in the passing network.

**Algorithm:** Power-iteration PageRank on a directed weighted graph where:
- **Nodes** = players
- **Edges** = throw connections (thrower → receiver)
- **Edge weights** = completion counts (current game + cross-game history)

The iterative formula (20 iterations, damping factor d = 0.85):

```
PR(i) = (1-d)/N + d × Σ[PR(j) × w(j→i) / Σw(j→*)]
```

For dangling nodes (players who received but never threw), rank is distributed equally across all nodes.

**Normalization:** Raw PageRank values are normalized to 0-100 scale relative to the highest-ranked player:

```
hubScore(player) = round(PR(player) / max(PR) × 100)
```

**Interpretation:**
- **Hub score 80-100:** Central playmaker, most throws flow through them
- **Hub score 40-79:** Important connector, regular part of the passing network
- **Hub score 1-39:** Peripheral player, fewer passing connections
- **Hub score 0:** No recorded throw connections

**Usage in line selection:** `suggestLine()` adds a hub bonus: `hubBonus = hubScore / 100 × 0.3`, favoring structurally important players.

**Display:** Player Impact tab shows a **HUB** column (pink, visible on wider screens).

**References:**
- [Measuring Line Chemistry in Hockey Using Google's PageRank Algorithm](https://www.linkedin.com/pulse/measuring-chemistry-hockey-using-googles-pagerank-algorithm-wilson): Ratio of player's PageRank with linemates vs overall PageRank approximates chemistry
- [A PageRank Model for Player Performance Assessment in Basketball, Soccer and Hockey](https://www.researchgate.net/publication/315766823_A_PageRank_Model_for_Player_Performance_Assessment_in_Basketball_Soccer_and_Hockey): PageRank applied across multiple sports for player ranking

---

## 5. Player Efficiency Rating (PER)

**Problem:** Coaches need a single number to compare overall player value across the roster, accounting for both offensive and defensive contributions.

**Algorithm:** Adapted from basketball PER for ultimate frisbee, using weighted career box score stats:

```
rawPER = goals × 3 + assists × 3 + hockeyAssists × 1.5 + blocks × 3 - turnovers × 2 + completionFactor
```

where `completionFactor = completionPct × gamesPlayed × 0.5` and `completionPct = catches / (catches + turnovers)`.

**Key design decision:** We use aggregate PER (total across career) rather than per-game PER. Research on AUDL data found aggregate uPER correlates 0.892 with plus-minus, significantly stronger than per-possession PER.

**Weights rationale:**
| Stat | Weight | Reasoning |
|------|--------|-----------|
| Goals | +3 | Direct scoring, highest offensive value |
| Assists | +3 | Equally valuable as the scoring throw |
| Hockey Assists | +1.5 | Facilitating the assist, indirect contribution |
| Blocks | +3 | Defensive equivalent of a goal (creates scoring opportunity) |
| Turnovers | -2 | Costly but less penalized than goals are rewarded (turnovers happen to active players) |
| Completion Factor | +0.5/game | Rewards consistent, reliable disc movement |

**Display:** Player Impact tab shows a **PER** column (orange, visible on wider screens). Dashboard Recommended 7 tab shows a "PER" tag on high-PER players.

**References:**
- [Player Efficiency Rating in the AUDL](https://www.bruinsportsanalytics.com/post/ultimate_per) (Bruin Sports Analytics): Adapted basketball PER to ultimate frisbee using 2019 AUDL data, finding aggregate uPER (not per-point) correlates best with team success
- [Dan Fiorino's UltiAnalytics Pull](https://github.com/dfiorino/ultianalyticspull): Open-source AUDL data pipeline comparing individual player efficiency against team averages

---

## 6. Greedy Line Selection with Chemistry

**Problem:** Choosing the optimal 7 players from a roster of 15-21 is a combinatorial optimization problem (C(21,7) = 116,280 combinations). Exhaustive search is too slow for real-time sideline use.

**Algorithm:** Greedy selection with multi-factor scoring:

### Phase 1: Individual Player Scoring

Each player gets a base score combining current-game performance, career stats, and fatigue:

```
score = plusMinus × 2 + offContrib × 1.5 + defContrib × 1 - turnPenalty × 1 + restFactor × 1.5 + perBonus + hubBonus + contextBonus
```

| Factor | Formula | Weight | Purpose |
|--------|---------|--------|---------|
| Plus/Minus | (pointsScored - pointsAgainst) / pointsPlayed | ×2 | Current game performance |
| Offensive Contribution | (goals + assists + hockeyAssists) / pointsPlayed | ×1.5 | Scoring involvement |
| Defensive Contribution | blocks / pointsPlayed | ×1 | Defensive impact |
| Turnover Penalty | turnovers / pointsPlayed | ×1 | Disc security |
| Rest Factor | max(0, 1 - pointsPlayed/avgPointsPerPlayer × 0.5) | ×1.5 | Fatigue management |
| PER Bonus | min(careerPER / 20, 1) × 0.5 | additive | Career performance |
| Hub Bonus | pageRankScore / 100 × 0.3 | additive | Network centrality |
| Context Bonus | offense/defense weighted stats | ×0.5 | O/D situation awareness |

### Phase 2: Greedy Selection with Chemistry

1. **Seed:** Pick the highest individually-scored player
2. **Iterate:** For each remaining slot (6 more), evaluate every candidate:
   ```
   candidateScore = individualScore + chemistryBonus + positionBonus
   ```
   where `chemistryBonus = (Σ chemistryScore(candidate, selected_i) / |selected|) × 0.05`
3. **Chemistry is O/D-aware:** If the next point is likely offense, use offensive chemistry; if defense, use defensive chemistry
4. **Position balance:** Bonus for handlers (up to 3), cutters (up to 4), and hybrids

### Phase 3: Reasoning Display

The algorithm tracks *why* each player was selected (rested, +/-, offense, defense, chemistry, PER, hub) and displays this in the recommendation strip and toast notification.

**Complexity:** O(n²) where n = roster size (typically 15-21). Each iteration scores ~14 candidates against ~6 selected players. Total: ~600 chemistry lookups per suggestion, completing in <5ms.

**References:**
- [Intelligent Team Formation and Player Selection](https://link.springer.com/article/10.1007/s10489-023-05150-x): Deep neural network approach for position-based team formation, formulated as maximum weighted bipartite matching solved with Hungarian algorithm
- Greedy approximation is standard for submodular optimization problems where the objective (team chemistry) exhibits diminishing returns — greedy achieves (1 - 1/e) ≈ 63% of optimal

---

## Data Flow Architecture

```
Game Actions (SVG taps)
    │
    ├─► recordThrow(thrower, receiver, distance, startPt, endPt)
    │       ├─► trackConnection(thrower, receiver, directionalYards)
    │       │       ├─► _throwConnections[thrower][receiver]++
    │       │       └─► _throwValues[thrower|receiver].totalYards += yards
    │       └─► playerStats[thrower].yardsThrown += distance
    │
    ├─► startPoint()
    │       └─► _pointHistory.push({ line, startType, result: null })
    │
    ├─► endPointAfterScore() / recordOpponentScore()
    │       ├─► _pointHistory[current].result = 'scored' | 'scored-against'
    │       └─► refreshAnalysis()
    │
    └─► endGame()
            └─► aggregateChemistryData()
                    ├─► chemistryData.pairings (throw value, goals, completions)
                    ├─► chemistryData.lineHistory (7-player combination outcomes)
                    ├─► chemistryData.playerPairs (O/D split, connection count)
                    ├─► chemistryData.gameTimestamps (recency tracking)
                    └─► localStorage.setItem('ultistats_chemistry', ...)
```

## Storage Schema

```javascript
chemistryData = {
    pairings: {
        'thrower|receiver': {
            completions: Number,  // Total throws completed
            goals: Number,        // Scoring connections
            games: Number,        // Games with this connection
            throwValue: Number    // Cumulative directional yardage
        }
    },
    lineHistory: {
        'sorted|player|names': {
            players: String[],    // 7 player names
            played: Number,       // Points played together
            scored: Number,       // Points scored
            scoredAgainst: Number,// Points allowed
            games: Number         // Unique games
        }
    },
    playerPairs: {
        'playerA|playerB': {
            pointsTogether: Number,     // Total points together
            scoredTogether: Number,     // Points scored together
            allowedTogether: Number,    // Points allowed together
            connectionCount: Number,    // Throw connections
            games: Number,
            offPointsTogether: Number,  // O-line points
            offScored: Number,          // O-line scores (holds)
            offAllowed: Number,         // O-line breaks allowed
            defPointsTogether: Number,  // D-line points
            defScored: Number,          // D-line scores (breaks)
            defAllowed: Number          // D-line holds allowed
        }
    },
    gamesAnalyzed: Number,
    gameTimestamps: Number[]  // Date.now() per game for recency
}
```

## Metric Definitions

| Metric | Formula | Range | Display |
|--------|---------|-------|---------|
| Chemistry Score | winRate×40 + diffRate×25 + connFreq×15 + breakBonus×20 | 0-100 | Violet number |
| O-Chemistry | winRate×55 + diffRate×35 + connFreq×10 (offense only) | 0-100 | Amber `O##` badge |
| D-Chemistry | winRate×55 + diffRate×35 + connFreq×10 (defense only) | 0-100 | Red `D##` badge |
| Hub Score | PageRank normalized to max | 0-100 | Pink number |
| PER | goals×3 + assists×3 + hockeyAssists×1.5 + blocks×3 - turnovers×2 + compFactor | unbounded | Orange number |
| Hold Rate | O-line points scored / O-line points played | 0-100% | Amber percentage |
| Break Rate | D-line points scored / D-line points played | 0-100% | Green (≥40%) or red (<40%) |
| Throw Value | Avg directional yards gained per completion | -120 to +120 | Cyan/red `±Ny` |

## Limitations & Future Work

1. **Sample size:** Chemistry scores are noisy with <5 shared points. Minimum threshold of 2 points is enforced.
2. **No opponent adjustment:** Current chemistry doesn't account for opponent strength. RAPM with ridge regression would isolate true player contribution but requires ~500+ point observations to converge.
3. **No spatial context:** Throw value uses linear yardage, not field position probability. A true Field Value model would assign nonlinear scoring probability to each position (endzone proximity is exponential, not linear).
4. **Wind/conditions:** Not tracked. The outdoor mode toggle could serve as a proxy for future condition-based adjustments.
5. **Predictive chemistry:** Currently only measures observed chemistry. Feature-based prediction (player position, physical attributes, throwing style) could estimate chemistry for untested pairings, following [Bransen & Van Haaren's predictive setting](https://arxiv.org/abs/2003.01712).
