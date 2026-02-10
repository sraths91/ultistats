/**
 * Seed script to create a demo team with 21 players for demo@demo.com
 * Run with: node seed-demo-team.js
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DATABASE_URL || path.join(__dirname, 'db/ultistats.db');

// 21 demo players with positions and jersey numbers
const demoPlayers = [
    { name: 'Alex Thompson', position: 'Handler', number: 1 },
    { name: 'Jordan Rivera', position: 'Handler', number: 2 },
    { name: 'Casey Morgan', position: 'Handler', number: 3 },
    { name: 'Taylor Chen', position: 'Handler', number: 4 },
    { name: 'Riley Johnson', position: 'Hybrid', number: 5 },
    { name: 'Morgan Smith', position: 'Hybrid', number: 6 },
    { name: 'Jamie Williams', position: 'Hybrid', number: 7 },
    { name: 'Drew Anderson', position: 'Hybrid', number: 8 },
    { name: 'Avery Martinez', position: 'Cutter', number: 9 },
    { name: 'Quinn Davis', position: 'Cutter', number: 10 },
    { name: 'Skyler Brown', position: 'Cutter', number: 11 },
    { name: 'Parker Wilson', position: 'Cutter', number: 12 },
    { name: 'Reese Garcia', position: 'Cutter', number: 13 },
    { name: 'Cameron Lee', position: 'Cutter', number: 14 },
    { name: 'Blake Miller', position: 'Cutter', number: 15 },
    { name: 'Hayden Taylor', position: 'Hybrid', number: 17 },
    { name: 'Kendall White', position: 'Handler', number: 21 },
    { name: 'Peyton Harris', position: 'Cutter', number: 22 },
    { name: 'Logan Clark', position: 'Hybrid', number: 23 },
    { name: 'Charlie Lewis', position: 'Handler', number: 24 },
    { name: 'Dakota Robinson', position: 'Cutter', number: 25 }
];

const DEMO_EMAIL = 'demo@demo.com';
const TEAM_NAME = 'Demo Squad';

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

function get(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function all(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

async function seedDemoTeam() {
    console.log('Opening database:', DB_PATH);

    const db = new sqlite3.Database(DB_PATH, async (err) => {
        if (err) {
            console.error('Error opening database:', err);
            process.exit(1);
        }
    });

    try {
        // Enable foreign keys
        await run(db, 'PRAGMA foreign_keys = ON');

        // Find the demo user
        const user = await get(db, 'SELECT * FROM users WHERE email = ?', [DEMO_EMAIL]);

        if (!user) {
            console.error(`User ${DEMO_EMAIL} not found. Please create the account first.`);
            process.exit(1);
        }

        console.log(`Found user: ${user.name} (${user.email}), ID: ${user.id}`);

        // Check if team already exists
        const existingTeam = await get(db,
            'SELECT t.* FROM teams t WHERE t.owner_id = ? AND t.name = ?',
            [user.id, TEAM_NAME]
        );

        let teamId;

        if (existingTeam) {
            console.log(`Team "${TEAM_NAME}" already exists, updating roster...`);
            teamId = existingTeam.id;

            // Delete existing roster
            await run(db, 'DELETE FROM roster WHERE team_id = ?', [teamId]);
        } else {
            // Create new team
            teamId = uuidv4();
            console.log(`Creating team "${TEAM_NAME}" with ID: ${teamId}`);

            await run(db,
                'INSERT INTO teams (id, name, owner_id) VALUES (?, ?, ?)',
                [teamId, TEAM_NAME, user.id]
            );

            // Add owner as team member
            await run(db,
                'INSERT INTO team_members (id, team_id, user_id, role) VALUES (?, ?, ?, ?)',
                [`${teamId}-${user.id}`, teamId, user.id, 'owner']
            );
        }

        // Insert players into roster
        console.log(`Adding ${demoPlayers.length} players to roster...`);

        for (const player of demoPlayers) {
            const rosterId = `${teamId}-${player.name.replace(/\s+/g, '-').toLowerCase()}`;
            await run(db,
                'INSERT INTO roster (id, team_id, player_name, jersey_number, position) VALUES (?, ?, ?, ?, ?)',
                [rosterId, teamId, player.name, player.number, player.position]
            );
            console.log(`  Added: #${player.number} ${player.name} (${player.position})`);
        }

        // Initialize career stats for each player
        console.log('Initializing career stats...');
        for (const player of demoPlayers) {
            const statsId = `${teamId}-${player.name.replace(/\s+/g, '-').toLowerCase()}-career`;

            // Check if stats exist
            const existingStats = await get(db,
                'SELECT * FROM career_stats WHERE team_id = ? AND player_name = ?',
                [teamId, player.name]
            );

            if (!existingStats) {
                await run(db,
                    `INSERT INTO career_stats (id, team_id, player_name, total_games, goals, assists, hockey_assists, blocks, turnovers, yards_thrown, yards_caught)
                     VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0)`,
                    [statsId, teamId, player.name]
                );
            }
        }

        // Verify
        const roster = await all(db,
            'SELECT player_name, jersey_number, position FROM roster WHERE team_id = ? ORDER BY jersey_number',
            [teamId]
        );

        console.log('\n=== Demo Team Created Successfully ===');
        console.log(`Team: ${TEAM_NAME}`);
        console.log(`Owner: ${user.name} (${user.email})`);
        console.log(`Players: ${roster.length}`);
        console.log('\nRoster:');
        console.table(roster.map(p => ({
            '#': p.jersey_number,
            'Name': p.player_name,
            'Position': p.position
        })));

        db.close();
        console.log('\nDone! Login as demo@demo.com to see your team.');

    } catch (error) {
        console.error('Error:', error);
        db.close();
        process.exit(1);
    }
}

seedDemoTeam();
