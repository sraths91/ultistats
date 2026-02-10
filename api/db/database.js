/**
 * @fileoverview SQLite Database Module
 * @module database
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DATABASE_URL || path.join(__dirname, 'ultistats.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let db = null;

/**
 * Initialize the database connection
 * @returns {Promise<sqlite3.Database>}
 */
function initDatabase() {
    return new Promise((resolve, reject) => {
        db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                console.error('Error opening database:', err);
                reject(err);
                return;
            }
            
            console.log(`Connected to SQLite database at ${DB_PATH}`);
            
            // Enable foreign keys
            db.run('PRAGMA foreign_keys = ON', (err) => {
                if (err) {
                    console.error('Error enabling foreign keys:', err);
                }
            });
            
            // Run schema
            const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
            db.exec(schema, async (err) => {
                if (err) {
                    console.error('Error running schema:', err);
                    reject(err);
                    return;
                }
                console.log('Database schema initialized');

                // Migrate: add season column to usau_teams and usau_tournaments
                try {
                    const addColumnIfMissing = (table, column, type) => {
                        return new Promise((res, rej) => {
                            db.all(`PRAGMA table_info(${table})`, (err, cols) => {
                                if (err) return res(); // table may not exist yet
                                const hasCol = cols && cols.some(c => c.name === column);
                                if (hasCol) return res();
                                db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`, (err2) => {
                                    if (err2) console.error(`Migration: failed to add ${table}.${column}:`, err2.message);
                                    else console.log(`Migration: added ${table}.${column}`);
                                    res();
                                });
                            });
                        });
                    };
                    await addColumnIfMissing('usau_teams', 'season', 'INTEGER');
                    await addColumnIfMissing('usau_tournaments', 'season', 'INTEGER');

                    // Create season indexes (safe to run multiple times)
                    const createIdx = (sql) => new Promise(r => db.run(sql, () => r()));
                    await createIdx('CREATE INDEX IF NOT EXISTS idx_usau_teams_season ON usau_teams(season)');
                    await createIdx('CREATE INDEX IF NOT EXISTS idx_usau_teams_season_division ON usau_teams(season, division)');
                    await createIdx('CREATE INDEX IF NOT EXISTS idx_usau_tournaments_season ON usau_tournaments(season)');
                } catch (migErr) {
                    console.error('Season migration warning:', migErr.message);
                }

                resolve(db);
            });
        });
    });
}

/**
 * Get the database connection
 * @returns {sqlite3.Database}
 */
function getDb() {
    if (!db) {
        throw new Error('Database not initialized. Call initDatabase() first.');
    }
    return db;
}

/**
 * Close the database connection
 * @returns {Promise<void>}
 */
function closeDatabase() {
    return new Promise((resolve, reject) => {
        if (!db) {
            resolve();
            return;
        }
        
        db.close((err) => {
            if (err) {
                reject(err);
                return;
            }
            db = null;
            console.log('Database connection closed');
            resolve();
        });
    });
}

// ==================== QUERY HELPERS ====================

/**
 * Run a query that modifies data
 * @param {string} sql - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<{lastID: number, changes: number}>}
 */
function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        getDb().run(sql, params, function(err) {
            if (err) {
                reject(err);
                return;
            }
            resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

/**
 * Get a single row
 * @param {string} sql - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Object|undefined>}
 */
function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        getDb().get(sql, params, (err, row) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(row);
        });
    });
}

/**
 * Get all rows
 * @param {string} sql - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Array>}
 */
function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        getDb().all(sql, params, (err, rows) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(rows || []);
        });
    });
}

// ==================== USER OPERATIONS ====================

/**
 * Create a new user
 * @param {Object} user - User data
 * @returns {Promise<Object>}
 */
async function createUser({ id, email, passwordHash, name }) {
    await run(
        'INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)',
        [id, email, passwordHash, name]
    );
    return getUserById(id);
}

/**
 * Get user by ID
 * @param {string} id - User ID
 * @returns {Promise<Object|undefined>}
 */
async function getUserById(id) {
    return get('SELECT id, email, name, created_at FROM users WHERE id = ?', [id]);
}

/**
 * Get user by email
 * @param {string} email - User email
 * @returns {Promise<Object|undefined>}
 */
async function getUserByEmail(email) {
    return get('SELECT * FROM users WHERE email = ?', [email]);
}

/**
 * Update user
 * @param {string} id - User ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>}
 */
async function updateUser(id, updates) {
    const allowedFields = ['name', 'email', 'password'];
    const fields = [];
    const values = [];

    Object.entries(updates).forEach(([key, value]) => {
        if (!allowedFields.includes(key)) return;
        fields.push(`${key} = ?`);
        values.push(value);
    });

    if (fields.length === 0) return getUserById(id);
    
    values.push(id);
    
    await run(
        `UPDATE users SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        values
    );
    
    return getUserById(id);
}

// ==================== TEAM OPERATIONS ====================

/**
 * Create a new team
 * @param {Object} team - Team data
 * @returns {Promise<Object>}
 */
async function createTeam({ id, name, ownerId }) {
    await run(
        'INSERT INTO teams (id, name, owner_id) VALUES (?, ?, ?)',
        [id, name, ownerId]
    );
    
    // Add owner as team member
    await run(
        'INSERT INTO team_members (id, team_id, user_id, role) VALUES (?, ?, ?, ?)',
        [`${id}-${ownerId}`, id, ownerId, 'owner']
    );
    
    return getTeamById(id);
}

/**
 * Get team by ID
 * @param {string} id - Team ID
 * @returns {Promise<Object|undefined>}
 */
async function getTeamById(id) {
    const team = await get('SELECT * FROM teams WHERE id = ?', [id]);
    if (team) {
        team.roster = await getTeamRoster(id);
        team.members = await getTeamMembers(id);
    }
    return team;
}

/**
 * Get teams for a user
 * @param {string} userId - User ID
 * @returns {Promise<Array>}
 */
async function getTeamsForUser(userId) {
    const teams = await all(`
        SELECT t.* FROM teams t
        JOIN team_members tm ON t.id = tm.team_id
        WHERE tm.user_id = ?
        ORDER BY t.created_at DESC
    `, [userId]);

    if (teams.length === 0) return teams;

    // Batch load rosters for all teams in a single query (avoids N+1)
    const teamIds = teams.map(t => t.id);
    const placeholders = teamIds.map(() => '?').join(',');
    const rosterRows = await all(
        `SELECT team_id, player_name FROM roster WHERE team_id IN (${placeholders}) ORDER BY player_name`,
        teamIds
    );

    // Group rosters by team ID
    const rostersByTeam = {};
    for (const row of rosterRows) {
        if (!rostersByTeam[row.team_id]) rostersByTeam[row.team_id] = [];
        rostersByTeam[row.team_id].push(row.player_name);
    }

    for (const team of teams) {
        team.roster = rostersByTeam[team.id] || [];
    }

    return teams;
}

/**
 * Update team
 * @param {string} id - Team ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>}
 */
async function updateTeam(id, updates) {
    const fields = [];
    const values = [];
    
    Object.entries(updates).forEach(([key, value]) => {
        if (key !== 'roster') {
            fields.push(`${key} = ?`);
            values.push(value);
        }
    });
    
    if (fields.length > 0) {
        values.push(id);
        await run(
            `UPDATE teams SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            values
        );
    }
    
    return getTeamById(id);
}

/**
 * Delete team
 * @param {string} id - Team ID
 * @returns {Promise<void>}
 */
async function deleteTeam(id) {
    await run('DELETE FROM teams WHERE id = ?', [id]);
}

/**
 * Get team members
 * @param {string} teamId - Team ID
 * @returns {Promise<Array>}
 */
async function getTeamMembers(teamId) {
    return all(`
        SELECT tm.*, u.email, u.name 
        FROM team_members tm
        JOIN users u ON tm.user_id = u.id
        WHERE tm.team_id = ?
    `, [teamId]);
}

/**
 * Add team member
 * @param {string} teamId - Team ID
 * @param {string} userId - User ID
 * @param {string} role - Role
 * @returns {Promise<void>}
 */
async function addTeamMember(teamId, userId, role = 'coach') {
    await run(
        'INSERT OR REPLACE INTO team_members (id, team_id, user_id, role) VALUES (?, ?, ?, ?)',
        [`${teamId}-${userId}`, teamId, userId, role]
    );
}

// ==================== ROSTER OPERATIONS ====================

/**
 * Get team roster
 * @param {string} teamId - Team ID
 * @returns {Promise<Array>}
 */
async function getTeamRoster(teamId) {
    const rows = await all(
        'SELECT player_name FROM roster WHERE team_id = ? ORDER BY player_name',
        [teamId]
    );
    return rows.map(r => r.player_name);
}

/**
 * Update team roster
 * @param {string} teamId - Team ID
 * @param {string[]} roster - Player names
 * @returns {Promise<void>}
 */
async function updateTeamRoster(teamId, roster) {
    // Delete existing roster
    await run('DELETE FROM roster WHERE team_id = ?', [teamId]);
    
    // Insert new roster
    for (const playerName of roster) {
        const id = `${teamId}-${playerName.replace(/\s+/g, '-').toLowerCase()}`;
        await run(
            'INSERT INTO roster (id, team_id, player_name) VALUES (?, ?, ?)',
            [id, teamId, playerName]
        );
    }
}

// ==================== INVITATION OPERATIONS ====================

/**
 * Create invitation
 * @param {Object} invitation - Invitation data
 * @returns {Promise<Object>}
 */
async function createInvitation({ id, teamId, email, role, invitedBy }) {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    
    await run(
        'INSERT INTO invitations (id, team_id, email, role, invited_by, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
        [id, teamId, email, role, invitedBy, expiresAt]
    );
    
    return get('SELECT * FROM invitations WHERE id = ?', [id]);
}

/**
 * Get pending invitations for email
 * @param {string} email - Email address
 * @returns {Promise<Array>}
 */
async function getPendingInvitations(email) {
    return all(`
        SELECT i.*, t.name as team_name
        FROM invitations i
        JOIN teams t ON i.team_id = t.id
        WHERE i.email = ? AND i.status = 'pending' AND i.expires_at > datetime('now')
    `, [email]);
}

/**
 * Update invitation status
 * @param {string} id - Invitation ID
 * @param {string} status - New status
 * @returns {Promise<void>}
 */
async function updateInvitationStatus(id, status) {
    await run('UPDATE invitations SET status = ? WHERE id = ?', [status, id]);
}

/**
 * Get invitation by ID
 * @param {string} id - Invitation ID
 * @returns {Promise<Object|undefined>}
 */
async function getInvitationById(id) {
    return get('SELECT * FROM invitations WHERE id = ?', [id]);
}

// ==================== GAME OPERATIONS ====================

/**
 * Create a new game
 * @param {Object} game - Game data
 * @returns {Promise<Object>}
 */
async function createGame({ id, teamId, opponentName, gameDate, tournamentId, location, notes }) {
    await run(
        `INSERT INTO games (id, team_id, opponent_name, game_date, tournament_id, location, notes) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, teamId, opponentName, gameDate, tournamentId, location, notes]
    );
    
    return getGameById(id);
}

/**
 * Get game by ID
 * @param {string} id - Game ID
 * @returns {Promise<Object|undefined>}
 */
async function getGameById(id) {
    const game = await get('SELECT * FROM games WHERE id = ?', [id]);
    if (game) {
        game.playerStats = await getGamePlayerStats(id);
    }
    return game;
}

/**
 * Get games for a team
 * @param {string} teamId - Team ID
 * @returns {Promise<Array>}
 */
async function getGamesForTeam(teamId) {
    return all(
        'SELECT * FROM games WHERE team_id = ? ORDER BY game_date DESC',
        [teamId]
    );
}

/**
 * Update game
 * @param {string} id - Game ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>}
 */
async function updateGame(id, updates) {
    const fields = [];
    const values = [];
    
    const allowedFields = ['opponent_name', 'game_date', 'our_score', 'opponent_score', 
                           'tournament_id', 'location', 'notes', 'is_complete'];
    
    Object.entries(updates).forEach(([key, value]) => {
        const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
        if (allowedFields.includes(snakeKey)) {
            fields.push(`${snakeKey} = ?`);
            values.push(value);
        }
    });
    
    if (fields.length > 0) {
        values.push(id);
        await run(
            `UPDATE games SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            values
        );
    }
    
    return getGameById(id);
}

// ==================== PLAYER STATS OPERATIONS ====================

/**
 * Get player stats for a game
 * @param {string} gameId - Game ID
 * @returns {Promise<Object>}
 */
async function getGamePlayerStats(gameId) {
    const rows = await all('SELECT * FROM player_game_stats WHERE game_id = ?', [gameId]);
    const stats = {};
    rows.forEach(row => {
        stats[row.player_name] = {
            goals: row.goals,
            assists: row.assists,
            hockeyAssists: row.hockey_assists,
            blocks: row.blocks,
            turnovers: row.turnovers,
            yardsThrown: row.yards_thrown,
            yardsCaught: row.yards_caught,
            throws: row.throws,
            catches: row.catches,
            pointsPlayed: row.points_played
        };
    });
    return stats;
}

/**
 * Save player stats for a game
 * @param {string} gameId - Game ID
 * @param {Object} playerStats - Player stats object
 * @returns {Promise<void>}
 */
async function saveGamePlayerStats(gameId, playerStats) {
    // Delete existing stats
    await run('DELETE FROM player_game_stats WHERE game_id = ?', [gameId]);
    
    // Insert new stats
    for (const [playerName, stats] of Object.entries(playerStats)) {
        const id = `${gameId}-${playerName.replace(/\s+/g, '-').toLowerCase()}`;
        await run(
            `INSERT INTO player_game_stats 
             (id, game_id, player_name, goals, assists, hockey_assists, blocks, turnovers, 
              yards_thrown, yards_caught, throws, catches, points_played) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, gameId, playerName, stats.goals || 0, stats.assists || 0, stats.hockeyAssists || 0,
             stats.blocks || 0, stats.turnovers || 0, stats.yardsThrown || 0, stats.yardsCaught || 0,
             stats.throws || 0, stats.catches || 0, stats.pointsPlayed || 0]
        );
    }
}

// ==================== TOURNAMENT OPERATIONS ====================

/**
 * Create tournament
 * @param {Object} tournament - Tournament data
 * @returns {Promise<Object>}
 */
async function createTournament({ id, teamId, name, startDate, endDate, location }) {
    await run(
        'INSERT INTO tournaments (id, team_id, name, start_date, end_date, location) VALUES (?, ?, ?, ?, ?, ?)',
        [id, teamId, name, startDate, endDate, location]
    );
    
    return get('SELECT * FROM tournaments WHERE id = ?', [id]);
}

/**
 * Get tournaments for a team
 * @param {string} teamId - Team ID
 * @returns {Promise<Array>}
 */
async function getTournamentsForTeam(teamId) {
    return all(
        'SELECT * FROM tournaments WHERE team_id = ? ORDER BY start_date DESC',
        [teamId]
    );
}

/**
 * Get all tournaments
 * @returns {Promise<Array>}
 */
async function getAllTournaments() {
    return all('SELECT * FROM tournaments ORDER BY start_date DESC');
}

// ==================== CAREER STATS OPERATIONS ====================

/**
 * Update career stats for a player
 * @param {string} teamId - Team ID
 * @param {string} playerName - Player name
 * @param {Object} gameStats - Stats from a game to add
 * @returns {Promise<void>}
 */
async function updateCareerStats(teamId, playerName, gameStats) {
    const existing = await get(
        'SELECT * FROM career_stats WHERE team_id = ? AND player_name = ?',
        [teamId, playerName]
    );
    
    if (existing) {
        await run(`
            UPDATE career_stats SET 
                total_games = total_games + 1,
                goals = goals + ?,
                assists = assists + ?,
                hockey_assists = hockey_assists + ?,
                blocks = blocks + ?,
                turnovers = turnovers + ?,
                yards_thrown = yards_thrown + ?,
                yards_caught = yards_caught + ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE team_id = ? AND player_name = ?
        `, [
            gameStats.goals || 0, gameStats.assists || 0, gameStats.hockeyAssists || 0,
            gameStats.blocks || 0, gameStats.turnovers || 0, gameStats.yardsThrown || 0,
            gameStats.yardsCaught || 0, teamId, playerName
        ]);
    } else {
        const id = `${teamId}-${playerName.replace(/\s+/g, '-').toLowerCase()}`;
        await run(`
            INSERT INTO career_stats 
            (id, team_id, player_name, total_games, goals, assists, hockey_assists, blocks, turnovers, yards_thrown, yards_caught)
            VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
        `, [
            id, teamId, playerName, gameStats.goals || 0, gameStats.assists || 0, 
            gameStats.hockeyAssists || 0, gameStats.blocks || 0, gameStats.turnovers || 0,
            gameStats.yardsThrown || 0, gameStats.yardsCaught || 0
        ]);
    }
}

/**
 * Get career stats for a team
 * @param {string} teamId - Team ID
 * @returns {Promise<Object>}
 */
async function getCareerStats(teamId) {
    const rows = await all('SELECT * FROM career_stats WHERE team_id = ?', [teamId]);
    const stats = {};
    rows.forEach(row => {
        stats[row.player_name] = {
            totalGames: row.total_games,
            goals: row.goals,
            assists: row.assists,
            hockeyAssists: row.hockey_assists,
            blocks: row.blocks,
            turnovers: row.turnovers,
            yardsThrown: row.yards_thrown,
            yardsCaught: row.yards_caught
        };
    });
    return stats;
}

// ==================== SHARED TOURNAMENT OPERATIONS ====================

/**
 * Create or get existing shared tournament by USAU URL
 * @param {Object} tournament - Tournament data
 * @returns {Promise<Object>}
 */
async function createOrGetSharedTournament({ id, usauUrl, name, competitionLevel, genderDivision, format, pools, standings, matchups, teams, importedBy }) {
    // Check if tournament already exists
    const existing = await get('SELECT * FROM shared_tournaments WHERE usau_url = ?', [usauUrl]);

    if (existing) {
        return {
            ...existing,
            pools: existing.pools_json ? JSON.parse(existing.pools_json) : null,
            standings: existing.standings_json ? JSON.parse(existing.standings_json) : null,
            matchups: existing.matchups_json ? JSON.parse(existing.matchups_json) : null,
            teams: existing.teams_json ? JSON.parse(existing.teams_json) : null,
            isNew: false
        };
    }

    // Create new tournament
    await run(
        `INSERT INTO shared_tournaments
         (id, usau_url, name, competition_level, gender_division, format, pools_json, standings_json, matchups_json, teams_json, imported_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            id, usauUrl, name, competitionLevel, genderDivision, format,
            pools ? JSON.stringify(pools) : null,
            standings ? JSON.stringify(standings) : null,
            matchups ? JSON.stringify(matchups) : null,
            teams ? JSON.stringify(teams) : null,
            importedBy
        ]
    );

    const created = await get('SELECT * FROM shared_tournaments WHERE id = ?', [id]);
    return {
        ...created,
        pools: pools,
        standings: standings,
        matchups: matchups,
        teams: teams,
        isNew: true
    };
}

/**
 * Get shared tournament by ID
 * @param {string} id - Tournament ID
 * @returns {Promise<Object|undefined>}
 */
async function getSharedTournamentById(id) {
    const tournament = await get('SELECT * FROM shared_tournaments WHERE id = ?', [id]);
    if (tournament) {
        tournament.pools = tournament.pools_json ? JSON.parse(tournament.pools_json) : null;
        tournament.standings = tournament.standings_json ? JSON.parse(tournament.standings_json) : null;
        tournament.matchups = tournament.matchups_json ? JSON.parse(tournament.matchups_json) : null;
        tournament.teams = tournament.teams_json ? JSON.parse(tournament.teams_json) : null;

        // Get linked teams count
        const links = await all('SELECT COUNT(*) as count FROM tournament_team_links WHERE tournament_id = ?', [id]);
        tournament.linkedTeamsCount = links[0]?.count || 0;
    }
    return tournament;
}

/**
 * Get shared tournament by USAU URL
 * @param {string} usauUrl - USAU URL
 * @returns {Promise<Object|undefined>}
 */
async function getSharedTournamentByUrl(usauUrl) {
    const tournament = await get('SELECT * FROM shared_tournaments WHERE usau_url = ?', [usauUrl]);
    if (tournament) {
        tournament.pools = tournament.pools_json ? JSON.parse(tournament.pools_json) : null;
        tournament.standings = tournament.standings_json ? JSON.parse(tournament.standings_json) : null;
        tournament.matchups = tournament.matchups_json ? JSON.parse(tournament.matchups_json) : null;
        tournament.teams = tournament.teams_json ? JSON.parse(tournament.teams_json) : null;
    }
    return tournament;
}

/**
 * Update shared tournament data
 * @param {string} id - Tournament ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>}
 */
async function updateSharedTournament(id, { pools, standings, matchups, teams }) {
    const fields = [];
    const values = [];

    if (pools !== undefined) {
        fields.push('pools_json = ?');
        values.push(JSON.stringify(pools));
    }
    if (standings !== undefined) {
        fields.push('standings_json = ?');
        values.push(JSON.stringify(standings));
    }
    if (matchups !== undefined) {
        fields.push('matchups_json = ?');
        values.push(JSON.stringify(matchups));
    }
    if (teams !== undefined) {
        fields.push('teams_json = ?');
        values.push(JSON.stringify(teams));
    }

    if (fields.length > 0) {
        fields.push('last_updated = CURRENT_TIMESTAMP');
        values.push(id);
        await run(
            `UPDATE shared_tournaments SET ${fields.join(', ')} WHERE id = ?`,
            values
        );
    }

    return getSharedTournamentById(id);
}

/**
 * Link a team to a shared tournament
 * @param {Object} link - Link data
 * @returns {Promise<Object>}
 */
async function linkTeamToTournament({ id, tournamentId, teamId, userId, teamName, poolName }) {
    await run(
        `INSERT OR REPLACE INTO tournament_team_links
         (id, tournament_id, team_id, user_id, team_name, pool_name)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, tournamentId, teamId, userId, teamName, poolName]
    );

    return get('SELECT * FROM tournament_team_links WHERE id = ?', [id]);
}

/**
 * Get tournaments linked to a user's teams
 * Shows tournaments linked to ANY team the user is a member of (not just links they created)
 * @param {string} userId - User ID
 * @returns {Promise<Array>}
 */
async function getLinkedTournamentsForUser(userId) {
    // Get tournaments linked to any team the user is a member of
    // This allows multiple coaches on the same team to see shared tournaments
    const tournaments = await all(`
        SELECT DISTINCT st.*, ttl.team_id as linked_team_id, ttl.team_name as linked_team_name, ttl.pool_name,
               t.name as local_team_name
        FROM shared_tournaments st
        JOIN tournament_team_links ttl ON st.id = ttl.tournament_id
        JOIN team_members tm ON ttl.team_id = tm.team_id
        JOIN teams t ON ttl.team_id = t.id
        WHERE tm.user_id = ?
        ORDER BY st.imported_at DESC
    `, [userId]);

    // Parse JSON fields
    for (const tournament of tournaments) {
        tournament.pools = tournament.pools_json ? JSON.parse(tournament.pools_json) : null;
        tournament.standings = tournament.standings_json ? JSON.parse(tournament.standings_json) : null;
        tournament.matchups = tournament.matchups_json ? JSON.parse(tournament.matchups_json) : null;
        tournament.teams = tournament.teams_json ? JSON.parse(tournament.teams_json) : null;
    }

    return tournaments;
}

/**
 * Get all teams linked to a tournament with all their coaches
 * @param {string} tournamentId - Tournament ID
 * @returns {Promise<Array>}
 */
async function getLinkedTeamsForTournament(tournamentId) {
    // Get linked teams with all their coaches (team members)
    const linkedTeams = await all(`
        SELECT ttl.*, t.name as local_team_name
        FROM tournament_team_links ttl
        JOIN teams t ON ttl.team_id = t.id
        WHERE ttl.tournament_id = ?
        ORDER BY ttl.linked_at
    `, [tournamentId]);

    // For each linked team, get all coaches (team members)
    for (const link of linkedTeams) {
        const coaches = await all(`
            SELECT tm.role, u.id as user_id, u.email as user_email, u.name as user_name
            FROM team_members tm
            JOIN users u ON tm.user_id = u.id
            WHERE tm.team_id = ?
            ORDER BY
                CASE tm.role
                    WHEN 'owner' THEN 1
                    WHEN 'admin' THEN 2
                    ELSE 3
                END
        `, [link.team_id]);
        link.coaches = coaches;
        // For backward compatibility, set user_name to first coach
        if (coaches.length > 0) {
            link.user_name = coaches[0].user_name;
            link.user_email = coaches[0].user_email;
        }
    }

    return linkedTeams;
}

/**
 * Check if a team URL matches any tournament
 * @param {string} teamName - Team name from USAU
 * @returns {Promise<Array>} Tournaments containing this team
 */
async function findTournamentsWithTeam(teamName) {
    // Search through tournament teams JSON for matching team
    const tournaments = await all('SELECT * FROM shared_tournaments WHERE teams_json LIKE ?', [`%${teamName}%`]);

    const matches = [];
    for (const tournament of tournaments) {
        const teams = tournament.teams_json ? JSON.parse(tournament.teams_json) : [];
        const matchingTeam = teams.find(t =>
            t.name.toLowerCase() === teamName.toLowerCase() ||
            t.name.toLowerCase().includes(teamName.toLowerCase()) ||
            teamName.toLowerCase().includes(t.name.toLowerCase())
        );

        if (matchingTeam) {
            matches.push({
                tournament: {
                    id: tournament.id,
                    name: tournament.name,
                    usauUrl: tournament.usau_url,
                    competitionLevel: tournament.competition_level,
                    genderDivision: tournament.gender_division
                },
                matchingTeam: matchingTeam
            });
        }
    }

    return matches;
}

// ==================== USAU REGISTRY OPERATIONS ====================

async function upsertUsauTeam({ slug, name, division, region, conference, ranking, rating, wins, losses, usauUrl, season }) {
    return run(`INSERT INTO usau_teams (slug, name, division, region, conference, ranking, rating, wins, losses, usau_url, season, last_synced)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(slug) DO UPDATE SET
            name=excluded.name, ranking=excluded.ranking, rating=excluded.rating,
            wins=excluded.wins, losses=excluded.losses, region=excluded.region,
            conference=excluded.conference, usau_url=excluded.usau_url,
            season=COALESCE(excluded.season, season),
            last_synced=CURRENT_TIMESTAMP`,
        [slug, name, division, region, conference, ranking, rating, wins, losses, usauUrl, season || null]);
}

async function getUsauTeams(division, { search, limit = 50, offset = 0 } = {}) {
    let sql = 'SELECT * FROM usau_teams WHERE division = ?';
    const params = [division];
    if (search) { sql += ' AND name LIKE ?'; params.push(`%${search}%`); }
    sql += ' ORDER BY ranking ASC NULLS LAST LIMIT ? OFFSET ?';
    params.push(limit, offset);
    return all(sql, params);
}

async function getUsauTeamBySlug(slug) {
    return get('SELECT * FROM usau_teams WHERE slug = ?', [slug]);
}

async function countUsauTeams(division, { search } = {}) {
    let sql = 'SELECT COUNT(*) as total FROM usau_teams WHERE division = ?';
    const params = [division];
    if (search) { sql += ' AND name LIKE ?'; params.push(`%${search}%`); }
    const row = await get(sql, params);
    return row ? row.total : 0;
}

async function upsertUsauTournament({ slug, name, usauUrl, startDate, location, competitionLevel, genderDivision, scheduleUrl, teamCount, season }) {
    return run(`INSERT INTO usau_tournaments (slug, name, usau_url, start_date, location, competition_level, gender_division, schedule_url, team_count, season, last_synced)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(slug) DO UPDATE SET
            name=excluded.name, usau_url=excluded.usau_url, start_date=excluded.start_date,
            location=excluded.location, schedule_url=excluded.schedule_url,
            team_count=excluded.team_count, season=COALESCE(excluded.season, season),
            last_synced=CURRENT_TIMESTAMP`,
        [slug, name, usauUrl, startDate, location, competitionLevel, genderDivision, scheduleUrl, teamCount, season || null]);
}

async function getUsauTournaments({ competitionLevel, genderDivision, search, limit = 50, offset = 0 } = {}) {
    let sql = 'SELECT * FROM usau_tournaments WHERE 1=1';
    const params = [];
    if (competitionLevel) { sql += ' AND competition_level = ?'; params.push(competitionLevel); }
    if (genderDivision) { sql += ' AND gender_division = ?'; params.push(genderDivision); }
    if (search) { sql += ' AND name LIKE ?'; params.push(`%${search}%`); }
    sql += ' ORDER BY start_date DESC NULLS LAST LIMIT ? OFFSET ?';
    params.push(limit, offset);
    return all(sql, params);
}

async function countUsauTournaments({ competitionLevel, genderDivision, search } = {}) {
    let sql = 'SELECT COUNT(*) as total FROM usau_tournaments WHERE 1=1';
    const params = [];
    if (competitionLevel) { sql += ' AND competition_level = ?'; params.push(competitionLevel); }
    if (genderDivision) { sql += ' AND gender_division = ?'; params.push(genderDivision); }
    if (search) { sql += ' AND name LIKE ?'; params.push(`%${search}%`); }
    const row = await get(sql, params);
    return row ? row.total : 0;
}

async function getUsauTournamentBySlug(slug) {
    return get('SELECT * FROM usau_tournaments WHERE slug = ?', [slug]);
}

async function upsertUsauTournamentTeam({ tournamentSlug, teamSlug, teamName, pool, seed, usauTeamUrl }) {
    return run(`INSERT INTO usau_tournament_teams (tournament_slug, team_slug, team_name, pool, seed, usau_team_url)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(tournament_slug, team_name) DO UPDATE SET
            team_slug=excluded.team_slug, pool=excluded.pool, seed=excluded.seed, usau_team_url=excluded.usau_team_url`,
        [tournamentSlug, teamSlug, teamName, pool, seed, usauTeamUrl]);
}

async function getUsauTournamentTeams(tournamentSlug) {
    return all(`SELECT tt.*, t.ranking, t.rating, t.region
        FROM usau_tournament_teams tt
        LEFT JOIN usau_teams t ON tt.team_slug = t.slug
        WHERE tt.tournament_slug = ?
        ORDER BY tt.seed ASC NULLS LAST`, [tournamentSlug]);
}

async function insertUsauMatchups(tournamentSlug, matchups) {
    await run('DELETE FROM usau_matchups WHERE tournament_slug = ?', [tournamentSlug]);
    for (const m of matchups) {
        await run(`INSERT INTO usau_matchups (tournament_slug, home_team, away_team, home_score, away_score, round, status)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [tournamentSlug, m.homeTeam, m.awayTeam, m.homeScore, m.awayScore, m.round || 'Pool Play', m.status]);
    }
}

async function getUsauMatchups(tournamentSlug) {
    return all('SELECT * FROM usau_matchups WHERE tournament_slug = ? ORDER BY id', [tournamentSlug]);
}

async function claimTeam({ id, userId, teamSlug, appTeamId, role }) {
    return run(`INSERT INTO user_team_claims (id, user_id, team_slug, app_team_id, role)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, team_slug) DO UPDATE SET app_team_id=excluded.app_team_id, role=excluded.role`,
        [id, userId, teamSlug, appTeamId, role]);
}

async function getUserClaims(userId) {
    return all(`SELECT c.*, t.name, t.division, t.ranking, t.rating, t.region, t.conference
        FROM user_team_claims c
        JOIN usau_teams t ON c.team_slug = t.slug
        WHERE c.user_id = ?
        ORDER BY t.division, t.ranking`, [userId]);
}

async function createSyncLog({ syncType, division }) {
    return run('INSERT INTO sync_log (sync_type, division) VALUES (?, ?)', [syncType, division]);
}

async function updateSyncLog(id, { status, teamsSynced, tournamentsSynced, matchupsSynced, errorMessage }) {
    return run(`UPDATE sync_log SET status=?, teams_synced=?, tournaments_synced=?, matchups_synced=?, error_message=?, completed_at=CURRENT_TIMESTAMP WHERE id=?`,
        [status, teamsSynced || 0, tournamentsSynced || 0, matchupsSynced || 0, errorMessage, id]);
}

async function getLatestSyncLog() {
    return get('SELECT * FROM sync_log ORDER BY started_at DESC LIMIT 1');
}

async function getTeamTournamentHistory(teamSlug) {
    return all(`SELECT tt.*, t.name as tournament_name, t.usau_url, t.start_date, t.competition_level, t.gender_division
        FROM usau_tournament_teams tt
        JOIN usau_tournaments t ON tt.tournament_slug = t.slug
        WHERE tt.team_slug = ?
        ORDER BY t.start_date DESC`, [teamSlug]);
}

// ==================== SEASON QUERY HELPERS ====================

async function getAvailableSeasons() {
    const rows = await all(`
        SELECT DISTINCT season FROM (
            SELECT season FROM usau_teams WHERE season IS NOT NULL
            UNION
            SELECT season FROM usau_tournaments WHERE season IS NOT NULL
        ) ORDER BY season DESC`);
    return rows.map(r => r.season);
}

async function getSeasonSummary(season) {
    const teamCounts = await all(
        'SELECT division, COUNT(*) as count FROM usau_teams WHERE season = ? GROUP BY division ORDER BY division',
        [season]
    );
    const tournamentCount = await get(
        'SELECT COUNT(*) as count FROM usau_tournaments WHERE season = ?',
        [season]
    );
    return {
        season,
        divisions: teamCounts,
        totalTeams: teamCounts.reduce((sum, d) => sum + d.count, 0),
        totalTournaments: tournamentCount ? tournamentCount.count : 0
    };
}

async function getUsauTeamsBySeason(season, division, { search, limit = 50, offset = 0 } = {}) {
    let sql = 'SELECT * FROM usau_teams WHERE season = ? AND division = ?';
    const params = [season, division];
    if (search) { sql += ' AND name LIKE ?'; params.push(`%${search}%`); }
    sql += ' ORDER BY ranking ASC NULLS LAST LIMIT ? OFFSET ?';
    params.push(limit, offset);
    return all(sql, params);
}

async function countUsauTeamsBySeason(season, division, { search } = {}) {
    let sql = 'SELECT COUNT(*) as total FROM usau_teams WHERE season = ? AND division = ?';
    const params = [season, division];
    if (search) { sql += ' AND name LIKE ?'; params.push(`%${search}%`); }
    const row = await get(sql, params);
    return row ? row.total : 0;
}

async function getUsauTournamentsBySeason(season, { competitionLevel, genderDivision, search, limit = 50, offset = 0 } = {}) {
    let sql = 'SELECT * FROM usau_tournaments WHERE season = ?';
    const params = [season];
    if (competitionLevel) { sql += ' AND competition_level = ?'; params.push(competitionLevel); }
    if (genderDivision) { sql += ' AND gender_division = ?'; params.push(genderDivision); }
    if (search) { sql += ' AND name LIKE ?'; params.push(`%${search}%`); }
    sql += ' ORDER BY start_date DESC NULLS LAST LIMIT ? OFFSET ?';
    params.push(limit, offset);
    return all(sql, params);
}

async function countUsauTournamentsBySeason(season, { competitionLevel, genderDivision, search } = {}) {
    let sql = 'SELECT COUNT(*) as total FROM usau_tournaments WHERE season = ?';
    const params = [season];
    if (competitionLevel) { sql += ' AND competition_level = ?'; params.push(competitionLevel); }
    if (genderDivision) { sql += ' AND gender_division = ?'; params.push(genderDivision); }
    if (search) { sql += ' AND name LIKE ?'; params.push(`%${search}%`); }
    const row = await get(sql, params);
    return row ? row.total : 0;
}

module.exports = {
    initDatabase,
    getDb,
    closeDatabase,
    run,
    get,
    all,
    // User operations
    createUser,
    getUserById,
    getUserByEmail,
    updateUser,
    // Team operations
    createTeam,
    getTeamById,
    getTeamsForUser,
    updateTeam,
    deleteTeam,
    getTeamMembers,
    addTeamMember,
    // Roster operations
    getTeamRoster,
    updateTeamRoster,
    // Invitation operations
    createInvitation,
    getPendingInvitations,
    updateInvitationStatus,
    getInvitationById,
    // Game operations
    createGame,
    getGameById,
    getGamesForTeam,
    updateGame,
    // Player stats operations
    getGamePlayerStats,
    saveGamePlayerStats,
    // Tournament operations
    createTournament,
    getTournamentsForTeam,
    getAllTournaments,
    // Career stats operations
    updateCareerStats,
    getCareerStats,
    // Shared tournament operations
    createOrGetSharedTournament,
    getSharedTournamentById,
    getSharedTournamentByUrl,
    updateSharedTournament,
    linkTeamToTournament,
    getLinkedTournamentsForUser,
    getLinkedTeamsForTournament,
    findTournamentsWithTeam,
    // USAU Registry operations
    upsertUsauTeam,
    getUsauTeams,
    getUsauTeamBySlug,
    countUsauTeams,
    upsertUsauTournament,
    getUsauTournaments,
    countUsauTournaments,
    getUsauTournamentBySlug,
    upsertUsauTournamentTeam,
    getUsauTournamentTeams,
    insertUsauMatchups,
    getUsauMatchups,
    claimTeam,
    getUserClaims,
    createSyncLog,
    updateSyncLog,
    getLatestSyncLog,
    getTeamTournamentHistory,
    // Season query helpers
    getAvailableSeasons,
    getSeasonSummary,
    getUsauTeamsBySeason,
    countUsauTeamsBySeason,
    getUsauTournamentsBySeason,
    countUsauTournamentsBySeason
};
