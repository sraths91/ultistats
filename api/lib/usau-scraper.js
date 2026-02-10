/**
 * @fileoverview USAU Web Scraping Module
 * Shared scraping functions for fetching and parsing data from play.usaultimate.org
 * Used by both the API server (server-sqlite.js) and the sync script (sync-usau.js)
 */

const cheerio = require('cheerio');
const { execSync } = require('child_process');

const USAU_BASE_URL = 'https://play.usaultimate.org';

/**
 * Fetch a USAU page using curl (handles ASP.NET sessions properly)
 * Falls back to node fetch if curl fails
 * @param {string} url - Full URL to fetch
 * @returns {Promise<string>} HTML content
 */
async function fetchUSAUPage(url) {
    try {
        const urlObj = new URL(url);
        const query = urlObj.search.slice(1);

        const reEncodedQuery = query.split('&').map(param => {
            const eqIdx = param.indexOf('=');
            if (eqIdx === -1) return param;
            const key = param.slice(0, eqIdx);
            const value = param.slice(eqIdx + 1);
            const encodedValue = value.replace(/\+/g, '%2B').replace(/=/g, '%3D');
            return `${key}=${encodedValue}`;
        }).join('&');

        const encodedUrl = reEncodedQuery
            ? `${urlObj.origin}${urlObj.pathname}?${reEncodedQuery}`
            : `${urlObj.origin}${urlObj.pathname}`;

        const escapedUrl = encodedUrl.replace(/'/g, "'\\''");

        const result = execSync(
            `curl -sL -A 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' '${escapedUrl}'`,
            { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 30000 }
        );
        return result;
    } catch (error) {
        console.error('Curl fetch failed:', error.message);
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            }
        });
        if (!response.ok) {
            throw new Error(`USAU fetch failed: ${response.status}`);
        }
        return response.text();
    }
}

/**
 * Remove seed numbers from team name (e.g. "(1)" or "[1]")
 * @param {string} name - Raw team name
 * @returns {string} Cleaned team name
 */
function cleanTeamName(name) {
    return name.replace(/\s*[\(\[\{]\d+[\)\]\}]\s*$/, '').trim();
}

/**
 * Extract seed number from team name
 * @param {string} name - Raw team name with possible seed
 * @returns {number|null} Seed number or null
 */
function extractSeed(name) {
    const match = name.match(/[\(\[\{](\d+)[\)\]\}]\s*$/);
    return match ? parseInt(match[1]) : null;
}

/**
 * Parse a single rankings table page
 * @param {CheerioAPI} $ - Cheerio instance
 * @returns {Array} Array of ranking objects
 */
function parseRankingsPage($) {
    const pageRankings = [];
    $('table tr').each((i, row) => {
        const cells = $(row).find('td');
        if (cells.length < 8) return;

        const rank = parseInt($(cells[0]).text().trim());
        if (isNaN(rank)) return;

        const $teamCell = $(cells[1]);
        const teamName = $teamCell.find('a').text().trim() || $teamCell.text().trim();
        const rating = parseFloat($(cells[2]).text().trim());

        if (!teamName || isNaN(rating)) return;

        const wins = parseInt($(cells[cells.length - 2]).text().trim()) || 0;
        const losses = parseInt($(cells[cells.length - 1]).text().trim()) || 0;
        const region = $(cells[6]).text().trim();
        const conference = $(cells[7]).text().trim();

        pageRankings.push({ rank, teamName, rating, wins, losses, region, conference });
    });
    return pageRankings;
}

/**
 * Fetch all rankings pages for a division (handles ASP.NET postback pagination)
 * @param {string} rankSet - Division key (e.g. "College-Men")
 * @returns {Promise<{rankings: Array, totalCount: number}>}
 */
async function fetchAllRankings(rankSet) {
    const rankings = [];
    let totalCount = 0;
    const maxPages = 12;

    const firstUrl = `${USAU_BASE_URL}/teams/events/team_rankings/?RankSet=${rankSet}`;
    let html = await fetchUSAUPage(firstUrl);
    let $ = cheerio.load(html);

    const firstPageResults = parseRankingsPage($);
    rankings.push(...firstPageResults);

    const bodyText = $('body').text();
    const paginationMatch = bodyText.match(/Rows:\s*\d+\s*-\s*\d+\s*of\s*(\d+)/);
    totalCount = paginationMatch ? parseInt(paginationMatch[1]) : firstPageResults.length;

    if (firstPageResults.length > 0 && firstPageResults.length < totalCount) {
        const pageLinks = [];
        $('a[href*="__doPostBack"]').each((i, el) => {
            const href = $(el).attr('href') || '';
            const text = $(el).text().trim();
            if (/^\d+$/.test(text) && parseInt(text) > 1) {
                const match = href.match(/__doPostBack\('([^']+)'/);
                if (match) {
                    pageLinks.push({ page: parseInt(text), target: match[1] });
                }
            }
        });

        $('a[href*="__doPostBack"]').each((i, el) => {
            const text = $(el).text().trim();
            if (text === '...') {
                const href = $(el).attr('href') || '';
                const match = href.match(/__doPostBack\('([^']+)'/);
                if (match) {
                    pageLinks.push({ page: pageLinks.length + 2, target: match[1], isExpander: true });
                }
            }
        });

        for (const pageLink of pageLinks.slice(0, maxPages - 1)) {
            try {
                const viewState = $('input[name="__VIEWSTATE"]').val() || '';
                const viewStateGen = $('input[name="__VIEWSTATEGENERATOR"]').val() || '';
                const eventValidation = $('input[name="__EVENTVALIDATION"]').val() || '';

                if (!viewState) break;

                const postData = `__EVENTTARGET=${encodeURIComponent(pageLink.target)}&__EVENTARGUMENT=&__VIEWSTATE=${encodeURIComponent(viewState)}&__VIEWSTATEGENERATOR=${encodeURIComponent(viewStateGen)}&__EVENTVALIDATION=${encodeURIComponent(eventValidation)}`;

                const postUrl = `${USAU_BASE_URL}/teams/events/team_rankings/?RankSet=${rankSet}`;
                const escapedUrl = postUrl.replace(/'/g, "'\\''");

                const result = execSync(
                    `curl -sL -X POST -A 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' -d '${postData.replace(/'/g, "'\\''")}' '${escapedUrl}'`,
                    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 30000 }
                );

                $ = cheerio.load(result);
                const pageResults = parseRankingsPage($);
                if (pageResults.length === 0) break;
                rankings.push(...pageResults);
            } catch (pageErr) {
                console.error(`Failed to fetch rankings page ${pageLink.page}:`, pageErr.message);
                break;
            }
        }
    }

    return { rankings, totalCount };
}

/**
 * Parse tournament page to extract name, teams, and schedule links
 * @param {string} html - HTML content
 * @param {string} url - Tournament URL (for resolving relative links)
 * @returns {{name: string, teams: Array, scheduleLinks: Array}}
 */
function parseTournamentPage(html, url) {
    const $ = cheerio.load(html);

    const tournamentName = $('h1').first().text().trim() ||
                           $('title').text().split('|')[0].trim() ||
                           'Unknown Tournament';

    const scheduleLinks = [];
    const seenHrefs = new Set();

    $('a').each((i, el) => {
        const href = $(el).attr('href') || '';
        const text = $(el).text().trim();
        const textLower = text.toLowerCase();

        if (!href || seenHrefs.has(href)) return;

        const isScheduleLink =
            href.includes('/schedule/') ||
            href.includes('schedule') ||
            textLower.includes('schedule') ||
            textLower.includes('pool play') ||
            textLower.includes('bracket');

        const isDivisionLink =
            (textLower === 'men' || textLower === "men's" ||
             textLower === 'women' || textLower === "women's" ||
             textLower === 'mixed' ||
             textLower.includes('college men') || textLower.includes('college women') ||
             textLower.includes('club men') || textLower.includes('club women')) &&
            (href.includes('/schedule/') || href.includes('/Men/') || href.includes('/Women/') || href.includes('/Mixed/'));

        if (isScheduleLink || isDivisionLink) {
            seenHrefs.add(href);
            const fullHref = href.startsWith('http') ? href :
                            href.startsWith('/') ? USAU_BASE_URL + href :
                            url.replace(/\/?$/, '/') + href;
            scheduleLinks.push({
                text: text || 'Schedule',
                href: fullHref,
                type: isDivisionLink ? 'division' : 'schedule'
            });
        }
    });

    const teams = [];
    const teamSet = new Set();

    $('a[href*="/teams/"], .team-name, .team, td a').each((i, el) => {
        const name = $(el).text().trim();
        const href = $(el).attr('href') || '';

        if (name && name.length > 2 && name.length < 100 && !teamSet.has(name.toLowerCase())) {
            const nameLower = name.toLowerCase();
            const skipWords = ['schedule', 'pool', 'bracket', 'results', 'standings',
                'home', 'about', 'rankings', 'login', 'register', 'sign up', 'sign in',
                'contact', 'search', 'events', 'membership', 'donate',
                'match report', 'consolation', 'winner of', 'loser of', 'w of ', 'l of '];
            const skipExact = ['men', "men's", 'women', "women's", 'mixed', 'boys', 'girls',
                "college men's", "college women's", "college mixed",
                "club men's", "club women's", "club mixed",
                "tct men's", "tct women's", "tct mixed",
                'college men', 'college women', 'college mixed',
                'club men', 'club women', 'club mixed',
                'tct men', 'tct women', 'tct mixed',
                'masters', 'grandmasters', 'great grandmasters'];
            const isBracketPlaceholder = /^[WL]\s+of\s+/i.test(name);
            if (!skipWords.some(w => nameLower.includes(w)) && !skipExact.includes(nameLower) && !isBracketPlaceholder) {
                teamSet.add(nameLower);
                teams.push({
                    name: name,
                    link: href.startsWith('http') ? href : (href ? USAU_BASE_URL + href : null)
                });
            }
        }
    });

    return {
        name: tournamentName,
        teams: teams.slice(0, 50),
        scheduleLinks: scheduleLinks.slice(0, 5)
    };
}

/**
 * Parse pool standings, matchups, and brackets from a schedule page
 * @param {string} html - HTML content
 * @returns {{pools: Object, matchups: Array, teams: Array, brackets: Array, tabs: Array}}
 */
function parsePoolsAndMatchups(html) {
    const $ = cheerio.load(html);

    const pools = {};
    const matchups = [];
    const allTeams = [];
    const teamSet = new Set();

    // Look for pool headers
    const poolHeaders = [];
    $('h2, h3, h4, h5, .pool-header, [class*="poolSlide"]').each((i, el) => {
        const text = $(el).text().trim();
        const poolMatch = text.match(/Pool\s*([A-Z])/i);
        if (poolMatch) {
            poolHeaders.push({
                element: el,
                name: `Pool ${poolMatch[1].toUpperCase()}`,
                letter: poolMatch[1].toUpperCase()
            });
        }
    });

    if (poolHeaders.length > 0) {
        poolHeaders.forEach((poolHeader) => {
            const poolName = poolHeader.name;
            const poolTeams = [];

            let $current = $(poolHeader.element);
            let foundTable = false;

            const $parent = $current.parent();
            $parent.find('table').each((ti, table) => {
                if (foundTable) return;

                const $table = $(table);
                $table.find('tr').each((ri, row) => {
                    const $row = $(row);
                    const cells = $row.find('td');

                    if (cells.length >= 1) {
                        const $firstCell = $(cells[0]);
                        let teamName = $firstCell.find('a').first().text().trim() || $firstCell.text().trim();

                        const cleanName = cleanTeamName(teamName);
                        const seed = extractSeed(teamName);

                        let wins = 0, losses = 0;
                        if (cells.length >= 2) {
                            const recordText = $(cells[1]).text().trim();
                            const recordMatch = recordText.match(/(\d+)\s*-\s*(\d+)/);
                            if (recordMatch) {
                                wins = parseInt(recordMatch[1]);
                                losses = parseInt(recordMatch[2]);
                            }
                        }

                        if (cleanName && cleanName.length > 2 &&
                            !cleanName.toLowerCase().includes('team') &&
                            cleanName.toLowerCase() !== 'w-l' &&
                            cleanName.toLowerCase() !== 'record') {
                            poolTeams.push({
                                name: cleanName,
                                seed: seed,
                                wins: wins,
                                losses: losses,
                                pointDiff: 0
                            });

                            if (!teamSet.has(cleanName.toLowerCase())) {
                                teamSet.add(cleanName.toLowerCase());
                                allTeams.push({ name: cleanName, pool: poolName, seed: seed });
                            }
                        }
                    }
                });

                if (poolTeams.length > 0) {
                    foundTable = true;
                }
            });

            if (poolTeams.length > 0) {
                pools[poolName] = poolTeams;
            }
        });
    }

    // Fallback: Parse any tables that look like pool standings
    if (Object.keys(pools).length === 0) {
        $('table').each((i, table) => {
            const $table = $(table);
            const poolTeams = [];

            let poolName = $table.find('caption').text().trim() ||
                          $table.prev('h2, h3, h4, h5').text().trim() ||
                          `Pool ${String.fromCharCode(65 + i)}`;

            const poolMatch = poolName.match(/Pool\s*([A-Z])/i);
            if (poolMatch) {
                poolName = `Pool ${poolMatch[1].toUpperCase()}`;
            }

            $table.find('tr').each((j, row) => {
                const $row = $(row);
                const cells = $row.find('td');

                if (cells.length >= 1) {
                    const $firstCell = $(cells[0]);
                    let teamName = $firstCell.find('a').first().text().trim() || $firstCell.text().trim();
                    const cleanName = cleanTeamName(teamName);
                    const seed = extractSeed(teamName);

                    let wins = 0, losses = 0;
                    if (cells.length >= 2) {
                        const recordText = $(cells[1]).text().trim();
                        const recordMatch = recordText.match(/(\d+)\s*-\s*(\d+)/);
                        if (recordMatch) {
                            wins = parseInt(recordMatch[1]);
                            losses = parseInt(recordMatch[2]);
                        }
                    }

                    if (cleanName && cleanName.length > 2 &&
                        !cleanName.toLowerCase().includes('team') &&
                        cleanName.toLowerCase() !== 'w-l') {
                        poolTeams.push({
                            name: cleanName,
                            seed: seed,
                            wins: wins,
                            losses: losses,
                            pointDiff: 0
                        });

                        if (!teamSet.has(cleanName.toLowerCase())) {
                            teamSet.add(cleanName.toLowerCase());
                            allTeams.push({ name: cleanName, pool: poolName, seed: seed });
                        }
                    }
                }
            });

            if (poolTeams.length >= 2) {
                pools[poolName] = poolTeams;
            }
        });
    }

    // Parse individual pool play games from schedule sections (type 1 and type 2)
    $('[id^="section_"]').each((si, sectionEl) => {
        const sectionId = $(sectionEl).attr('id') || '';
        const typeMatch = sectionId.match(/section_\d+_(\d+)_/);
        if (!typeMatch || typeMatch[1] === '3') return;

        $(sectionEl).find('[data-type="game-team-home"]').each((gi, gameEl) => {
            const $row = $(gameEl).closest('tr');
            if (!$row.length) return;

            const homeTeamRaw = $row.find('[data-type="game-team-home"]').text().trim();
            const awayTeamRaw = $row.find('[data-type="game-team-away"]').text().trim();
            const homeScoreText = $row.find('[data-type="game-score-home"]').text().trim();
            const awayScoreText = $row.find('[data-type="game-score-away"]').text().trim();
            const statusText = $row.find('.game-status, [data-type="game-status"]').text().trim();

            if (!homeTeamRaw || !awayTeamRaw) return;

            const homeScore = parseInt(homeScoreText) || 0;
            const awayScore = parseInt(awayScoreText) || 0;
            const isCompleted = statusText === 'Final' || (homeScore > 0 || awayScore > 0);

            matchups.push({
                homeTeam: cleanTeamName(homeTeamRaw),
                homeScore: homeScore,
                awayScore: awayScore,
                awayTeam: cleanTeamName(awayTeamRaw),
                status: isCompleted ? 'completed' : 'scheduled'
            });
        });
    });

    const brackets = parseBracketSections($, cleanTeamName);

    const tabs = [];
    $('[id*="rptTabs"] a').each((i, el) => {
        const text = $(el).text().trim();
        const rel = $(el).attr('rel') || '';
        if (text) tabs.push({ name: text, sectionId: rel });
    });

    return {
        pools,
        matchups: matchups.slice(0, 500),
        teams: allTeams,
        brackets,
        tabs
    };
}

/**
 * Parse bracket sections from a USAU schedule page
 * @param {CheerioAPI} $ - Cheerio instance loaded with the page HTML
 * @param {Function} cleanFn - Function to clean team names
 * @returns {Array} Array of bracket objects with games organized by round
 */
function parseBracketSections($, cleanFn) {
    const brackets = [];

    $('div.mod_slide.alt_slide').each((i, slideEl) => {
        const $slide = $(slideEl);
        const bracketName = $slide.find('h3.slide_trigger a').first().text().trim();
        if (!bracketName) return;

        const bracketData = {
            name: bracketName,
            rounds: [],
            games: [],
            champion: null
        };

        $slide.find('.bracket_col').each((ci, colEl) => {
            const $col = $(colEl);
            const roundName = $col.find('h4.col_title').text().trim();

            $col.find('.bracket_game').each((gi, gameEl) => {
                const $game = $(gameEl);
                const gameId = $game.attr('id') || '';
                const nextGameId = $game.attr('data-relation') || '';

                const $home = $game.find('.top_area');
                const homeTeamRaw = $home.find('[data-type="game-team-home"]').text().trim();
                const homeScoreText = $home.find('[data-type="game-score-home"]').text().trim();
                const homeScore = /^\d+$/.test(homeScoreText) ? parseInt(homeScoreText) : homeScoreText || null;
                const homeWon = $home.hasClass('winner');

                const $away = $game.find('.btm_area');
                const awayTeamRaw = $away.find('[data-type="game-team-away"]').text().trim();
                const awayScoreText = $away.find('[data-type="game-score-away"]').text().trim();
                const awayScore = /^\d+$/.test(awayScoreText) ? parseInt(awayScoreText) : awayScoreText || null;
                const awayWon = $away.hasClass('winner');

                const status = $game.find('.game-status').text().trim() || 'Pending';
                const date = $game.find('.date').text().trim() || null;
                const location = $game.find('.location').text().trim() || null;

                const homeSeedMatch = homeTeamRaw.match(/\((\d+)\)\s*$/);
                const awaySeedMatch = awayTeamRaw.match(/\((\d+)\)\s*$/);

                const game = {
                    gameId,
                    nextGameId,
                    round: roundName,
                    bracketName,
                    homeTeam: cleanFn(homeTeamRaw),
                    homeTeamRaw,
                    homeSeed: homeSeedMatch ? parseInt(homeSeedMatch[1]) : null,
                    homeScore,
                    homeWon,
                    awayTeam: cleanFn(awayTeamRaw),
                    awayTeamRaw,
                    awaySeed: awaySeedMatch ? parseInt(awaySeedMatch[1]) : null,
                    awayScore,
                    awayWon,
                    status,
                    date,
                    location
                };

                bracketData.games.push(game);

                if (roundName && !bracketData.rounds.includes(roundName)) {
                    bracketData.rounds.push(roundName);
                }

                if (!nextGameId && (homeWon || awayWon)) {
                    bracketData.champion = homeWon ? cleanFn(homeTeamRaw) : cleanFn(awayTeamRaw);
                }
            });
        });

        if (bracketData.games.length > 0) {
            brackets.push(bracketData);
        }
    });

    return brackets;
}

/**
 * Parse tournament events listing from the USAU events page
 * @param {string} html - HTML content of the events page
 * @param {string} query - Search query to filter results
 * @returns {Array} Array of tournament objects with name and link
 */
function parseEventsList(html, query) {
    const $ = cheerio.load(html);
    const tournaments = [];

    $('a[href*="/events/"]').each((i, el) => {
        const link = $(el).attr('href');
        const name = $(el).text().trim();

        if (name && link && name.toLowerCase().includes(query.toLowerCase())) {
            if (!tournaments.find(t => t.link === link) && name.length > 3) {
                tournaments.push({
                    name: name,
                    link: link.startsWith('http') ? link : USAU_BASE_URL + link
                });
            }
        }
    });

    return tournaments.slice(0, 50);
}

/**
 * Derive the USAU season year from a tournament name or date.
 * USAU college season spans fall→spring, so fall events (Aug-Dec) belong to next year's season.
 * E.g. a tournament in Oct 2025 is part of the 2026 season.
 * @param {string} name - Tournament or event name (may contain a year like "2025")
 * @param {string|null} startDate - ISO date string (optional)
 * @returns {number} Season year
 */
function deriveSeason(name, startDate) {
    // 1. Try to extract year from the name (e.g. "Stanford Invite 2025")
    const yearMatch = name && name.match(/\b(20\d{2})\b/);
    if (yearMatch) return parseInt(yearMatch[1]);

    // 2. Use startDate if available
    if (startDate) {
        const d = new Date(startDate);
        if (!isNaN(d.getTime())) {
            const month = d.getMonth(); // 0-indexed
            return month >= 7 ? d.getFullYear() + 1 : d.getFullYear(); // Aug(7)-Dec → next year
        }
    }

    // 3. Fallback: current date logic
    const now = new Date();
    return now.getMonth() >= 7 ? now.getFullYear() + 1 : now.getFullYear();
}

module.exports = {
    USAU_BASE_URL,
    fetchUSAUPage,
    cleanTeamName,
    extractSeed,
    parseRankingsPage,
    fetchAllRankings,
    parseTournamentPage,
    parsePoolsAndMatchups,
    parseBracketSections,
    parseEventsList,
    deriveSeason
};
