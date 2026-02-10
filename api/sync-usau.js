#!/usr/bin/env node
/**
 * @fileoverview USAU Registry Sync Script
 * Populates usau_teams and usau_tournaments tables by scraping play.usaultimate.org
 *
 * Usage:
 *   node sync-usau.js                          # Full sync (rankings + tournaments)
 *   node sync-usau.js --rankings-only          # Only sync rankings
 *   node sync-usau.js --tournaments-only       # Only sync tournaments
 *   node sync-usau.js --division College-Men   # Only sync one division
 */

require('dotenv').config();

const db = require('./db/database');
const scraper = require('./lib/usau-scraper');

const ALL_DIVISIONS = ['College-Men', 'College-Women', 'Club-Men', 'Club-Women', 'Club-Mixed'];

function slugify(text) {
    return text.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {
        rankingsOnly: false,
        tournamentsOnly: false,
        backfillSeasons: false,
        division: null
    };

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--rankings-only') opts.rankingsOnly = true;
        if (args[i] === '--tournaments-only') opts.tournamentsOnly = true;
        if (args[i] === '--backfill-seasons') opts.backfillSeasons = true;
        if (args[i] === '--division' && args[i + 1]) {
            opts.division = args[i + 1];
            i++;
        }
    }

    return opts;
}

async function syncRankings(divisions) {
    let totalTeams = 0;
    const currentSeason = scraper.deriveSeason(null, null);

    for (const division of divisions) {
        console.log(`\n--- Syncing rankings: ${division} (season ${currentSeason}) ---`);

        try {
            const { rankings, totalCount } = await scraper.fetchAllRankings(division);
            console.log(`  Fetched ${rankings.length} of ${totalCount} teams`);

            for (const team of rankings) {
                const slug = slugify(`${division}--${team.teamName}`);
                await db.upsertUsauTeam({
                    slug,
                    name: team.teamName,
                    division,
                    region: team.region || null,
                    conference: team.conference || null,
                    ranking: team.rank,
                    rating: team.rating,
                    wins: team.wins,
                    losses: team.losses,
                    usauUrl: null,
                    season: currentSeason
                });
            }

            totalTeams += rankings.length;
            console.log(`  Upserted ${rankings.length} teams for ${division}`);
        } catch (err) {
            console.error(`  ERROR syncing ${division}:`, err.message);
        }

        // Rate limit between divisions
        await sleep(2000);
    }

    return totalTeams;
}

async function syncTournaments() {
    let totalTournaments = 0;
    let totalMatchups = 0;

    console.log('\n--- Fetching USAU events listing ---');

    try {
        // Fetch the main events page with ViewAll=true for the full listing
        const eventsUrl = `${scraper.USAU_BASE_URL}/events/tournament/?ViewAll=true`;
        const eventsHtml = await scraper.fetchUSAUPage(eventsUrl);

        // Parse all tournament links from the page
        const tournaments = scraper.parseEventsList(eventsHtml, '');

        // Filter to only tournament-like links (not navigation)
        const validTournaments = tournaments.filter(t => {
            const name = t.name.toLowerCase();
            return t.link.includes('/events/') &&
                !t.link.endsWith('/events/') &&
                !t.link.includes('ViewAll') &&
                !name.includes('unaffiliated') &&
                !name.includes('rankings') &&
                name.length > 5;
        });

        console.log(`  Found ${validTournaments.length} tournaments`);

        for (const tournament of validTournaments) {
            try {
                console.log(`  Processing: ${tournament.name.substring(0, 60)}`);

                const slug = slugify(tournament.name);

                // Fetch tournament detail page
                const tournamentHtml = await scraper.fetchUSAUPage(tournament.link);
                const detail = scraper.parseTournamentPage(tournamentHtml, tournament.link);

                const tournamentSeason = scraper.deriveSeason(tournament.name, null);
                await db.upsertUsauTournament({
                    slug,
                    name: detail.name || tournament.name,
                    usauUrl: tournament.link,
                    startDate: null,
                    location: null,
                    competitionLevel: null,
                    genderDivision: null,
                    scheduleUrl: detail.scheduleLinks.length > 0 ? detail.scheduleLinks[0].href : null,
                    teamCount: detail.teams.length,
                    season: tournamentSeason
                });

                // Upsert teams for this tournament
                for (const team of detail.teams) {
                    const teamSlug = findTeamSlug(team.name);
                    await db.upsertUsauTournamentTeam({
                        tournamentSlug: slug,
                        teamSlug,
                        teamName: team.name,
                        pool: null,
                        seed: null,
                        usauTeamUrl: team.link
                    });
                }

                // If there's a schedule link, fetch pools and matchups
                if (detail.scheduleLinks.length > 0) {
                    try {
                        await sleep(1500);
                        const scheduleHtml = await scraper.fetchUSAUPage(detail.scheduleLinks[0].href);
                        const poolData = scraper.parsePoolsAndMatchups(scheduleHtml);

                        // Update teams with pool assignments
                        for (const team of poolData.teams) {
                            const teamSlug = findTeamSlug(team.name);
                            await db.upsertUsauTournamentTeam({
                                tournamentSlug: slug,
                                teamSlug,
                                teamName: team.name,
                                pool: team.pool || null,
                                seed: team.seed || null,
                                usauTeamUrl: null
                            });
                        }

                        // Insert matchups
                        if (poolData.matchups.length > 0) {
                            await db.insertUsauMatchups(slug, poolData.matchups);
                            totalMatchups += poolData.matchups.length;
                            console.log(`    ${poolData.matchups.length} matchups, ${poolData.teams.length} teams`);
                        }
                    } catch (schedErr) {
                        console.error(`    Schedule fetch error: ${schedErr.message}`);
                    }
                }

                totalTournaments++;
                await sleep(2000); // Rate limit between tournaments
            } catch (tErr) {
                console.error(`    ERROR processing tournament: ${tErr.message}`);
            }
        }
    } catch (err) {
        console.error('  ERROR fetching events:', err.message);
    }

    return { totalTournaments, totalMatchups };
}

// In-memory cache of team slugs for matching tournament teams to ranked teams
let _teamSlugCache = null;

async function loadTeamSlugCache() {
    if (_teamSlugCache) return;
    _teamSlugCache = {};
    for (const division of ALL_DIVISIONS) {
        const teams = await db.getUsauTeams(division, { limit: 500 });
        for (const team of teams) {
            _teamSlugCache[team.name.toLowerCase()] = team.slug;
        }
    }
}

function findTeamSlug(teamName) {
    if (!_teamSlugCache || !teamName) return null;
    return _teamSlugCache[teamName.toLowerCase()] || null;
}

async function backfillSeasons() {
    console.log('\n--- Backfilling season values ---');
    const currentSeason = scraper.deriveSeason(null, null);

    // Backfill teams without season
    const teamResult = await db.run(
        'UPDATE usau_teams SET season = ? WHERE season IS NULL',
        [currentSeason]
    );
    console.log(`  Teams updated: ${teamResult.changes}`);

    // Backfill tournaments - try to derive from name first, fallback to current season
    const tournaments = await db.all('SELECT slug, name, start_date FROM usau_tournaments WHERE season IS NULL');
    let updated = 0;
    for (const t of tournaments) {
        const season = scraper.deriveSeason(t.name, t.start_date);
        await db.run('UPDATE usau_tournaments SET season = ? WHERE slug = ?', [season, t.slug]);
        updated++;
    }
    console.log(`  Tournaments updated: ${updated}`);
    return { teams: teamResult.changes, tournaments: updated };
}

async function main() {
    const opts = parseArgs();

    console.log('=== USAU Registry Sync ===');
    const mode = opts.backfillSeasons ? 'backfill-seasons' :
        opts.rankingsOnly ? 'rankings-only' : opts.tournamentsOnly ? 'tournaments-only' : 'full';
    console.log(`Mode: ${mode}`);
    if (opts.division) console.log(`Division: ${opts.division}`);
    console.log('');

    try {
        await db.initDatabase();
        console.log('Database connected');

        // Handle backfill-only mode
        if (opts.backfillSeasons) {
            const result = await backfillSeasons();
            console.log(`\n=== Backfill Complete === Teams: ${result.teams}, Tournaments: ${result.tournaments}`);
            return;
        }

        const syncType = opts.rankingsOnly ? 'rankings' : opts.tournamentsOnly ? 'tournaments' : 'full';
        const logResult = await db.createSyncLog({ syncType, division: opts.division || null });
        const syncLogId = logResult.lastID;

        let teamsSynced = 0;
        let tournamentsSynced = 0;
        let matchupsSynced = 0;

        // Rankings sync
        if (!opts.tournamentsOnly) {
            const divisions = opts.division ? [opts.division] : ALL_DIVISIONS;
            const invalidDivisions = divisions.filter(d => !ALL_DIVISIONS.includes(d));
            if (invalidDivisions.length > 0) {
                console.error(`Invalid division(s): ${invalidDivisions.join(', ')}`);
                console.error(`Valid options: ${ALL_DIVISIONS.join(', ')}`);
                process.exit(1);
            }
            teamsSynced = await syncRankings(divisions);
        }

        // Load team slug cache before tournament sync (for matching)
        await loadTeamSlugCache();

        // Tournament sync
        if (!opts.rankingsOnly) {
            const result = await syncTournaments();
            tournamentsSynced = result.totalTournaments;
            matchupsSynced = result.totalMatchups;
        }

        // Update sync log
        await db.updateSyncLog(syncLogId, {
            status: 'completed',
            teamsSynced,
            tournamentsSynced,
            matchupsSynced,
            errorMessage: null
        });

        console.log('\n=== Sync Complete ===');
        console.log(`Teams synced: ${teamsSynced}`);
        console.log(`Tournaments synced: ${tournamentsSynced}`);
        console.log(`Matchups synced: ${matchupsSynced}`);

    } catch (err) {
        console.error('\nFATAL ERROR:', err);
        try {
            const log = await db.getLatestSyncLog();
            if (log && log.status === 'running') {
                await db.updateSyncLog(log.id, {
                    status: 'failed',
                    teamsSynced: 0,
                    tournamentsSynced: 0,
                    matchupsSynced: 0,
                    errorMessage: err.message
                });
            }
        } catch (_) {}
        process.exit(1);
    } finally {
        await db.closeDatabase();
    }
}

main();
