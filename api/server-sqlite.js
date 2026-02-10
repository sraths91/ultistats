/**
 * @fileoverview Express API Server with SQLite Database
 * @description RESTful API for UltiStats application
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { body, param, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const cheerio = require('cheerio');
const db = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3001;

// Configuration
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

if (process.env.NODE_ENV !== 'test' && (!JWT_SECRET || JWT_SECRET.includes('change-this') || JWT_SECRET.includes('change-in-production'))) {
    console.error('FATAL: JWT_SECRET environment variable is not set or is using a default value.');
    console.error('Set a strong, unique JWT_SECRET in your .env file before starting the server.');
    process.exit(1);
}

// Middleware
app.use(compression());

const allowedOrigins = process.env.CLIENT_URL
    ? process.env.CLIENT_URL.split(',').map(s => s.trim())
    : ['http://localhost:3000', 'http://localhost:3001'];
app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (server-to-server, curl, mobile apps)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(new Error('Not allowed by CORS'));
    },
    credentials: true
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ limit: '2mb', extended: true }));

// Rate limiting for auth endpoints
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // 20 attempts per window
    message: { error: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false
});
if (process.env.NODE_ENV !== 'test') {
    app.use('/api/auth/', authLimiter);
}

// Validation error handler
function handleValidationErrors(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }
    next();
}

// ==================== AUTH MIDDLEWARE ====================

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
}

// Optional authentication - allows requests without token but attaches user if valid token provided
function optionalAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        req.user = null;
        return next();
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        req.user = err ? null : user;
        next();
    });
}

// Optional auth - adds user to request if token present
function optionalAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (token) {
        jwt.verify(token, JWT_SECRET, (err, user) => {
            if (!err) {
                req.user = user;
            }
        });
    }
    next();
}

// ==================== AUTH ROUTES ====================

app.post('/api/auth/register', [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('name').trim().isLength({ min: 1, max: 100 }).escape().withMessage('Name is required (max 100 characters)'),
    body('password').isLength({ min: 12 }).withMessage('Password must be at least 12 characters'),
    handleValidationErrors
], async (req, res) => {
    try {
        const { email, password, name } = req.body;
        
        // Validate password strength
        if (!password || password.length < 12) {
            return res.status(400).json({ error: 'Password must be at least 12 characters' });
        }
        if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
            return res.status(400).json({ error: 'Password must contain uppercase, lowercase, and a number' });
        }

        // Check if user exists
        const existingUser = await db.getUserByEmail(email);
        if (existingUser) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 10);
        
        // Create user
        const userId = uuidv4();
        const user = await db.createUser({
            id: userId,
            email,
            passwordHash,
            name
        });
        
        // Generate token
        const token = jwt.sign({ id: userId, email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
        
        res.status(201).json({
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name
            }
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

app.post('/api/auth/login', [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').notEmpty().withMessage('Password is required'),
    handleValidationErrors
], async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // Find user
        const user = await db.getUserByEmail(email);
        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        
        // Verify password
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        
        // Generate token
        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
        
        res.json({
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
    try {
        const user = await db.getUserById(req.user.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json({
            id: user.id,
            email: user.email,
            name: user.name
        });
    } catch (error) {
        console.error('Profile error:', error);
        res.status(500).json({ error: 'Failed to get profile' });
    }
});

app.post('/api/auth/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        
        // Always return success to prevent email enumeration
        res.json({ message: 'If an account exists, a reset email will be sent' });
        
        // In production, implement actual email sending
    } catch (error) {
        console.error('Password reset error:', error);
        res.status(500).json({ error: 'Failed to process request' });
    }
});

// ==================== TEAM ROUTES ====================

app.get('/api/teams', authenticateToken, async (req, res) => {
    try {
        const teams = await db.getTeamsForUser(req.user.id);
        res.json(teams);
    } catch (error) {
        console.error('Get teams error:', error);
        res.status(500).json({ error: 'Failed to get teams' });
    }
});

app.post('/api/teams', authenticateToken, [
    body('name').trim().isLength({ min: 1, max: 100 }).escape().withMessage('Team name is required (max 100 characters)'),
    handleValidationErrors
], async (req, res) => {
    try {
        const { name } = req.body;
        
        const team = await db.createTeam({
            id: uuidv4(),
            name,
            ownerId: req.user.id
        });
        
        res.status(201).json(team);
    } catch (error) {
        console.error('Create team error:', error);
        res.status(500).json({ error: 'Failed to create team' });
    }
});

app.get('/api/teams/:teamId', authenticateToken, async (req, res) => {
    try {
        const team = await db.getTeamById(req.params.teamId);
        
        if (!team) {
            return res.status(404).json({ error: 'Team not found' });
        }
        
        // Check if user is a member
        const isMember = team.members.some(m => m.user_id === req.user.id);
        if (!isMember) {
            return res.status(403).json({ error: 'Not a team member' });
        }
        
        res.json(team);
    } catch (error) {
        console.error('Get team error:', error);
        res.status(500).json({ error: 'Failed to get team' });
    }
});

app.put('/api/teams/:teamId', authenticateToken, async (req, res) => {
    try {
        const team = await db.getTeamById(req.params.teamId);
        
        if (!team) {
            return res.status(404).json({ error: 'Team not found' });
        }
        
        // Check if user is owner
        if (team.owner_id !== req.user.id) {
            return res.status(403).json({ error: 'Only team owner can update' });
        }
        
        const updatedTeam = await db.updateTeam(req.params.teamId, req.body);
        res.json(updatedTeam);
    } catch (error) {
        console.error('Update team error:', error);
        res.status(500).json({ error: 'Failed to update team' });
    }
});

app.delete('/api/teams/:teamId', authenticateToken, async (req, res) => {
    try {
        const team = await db.getTeamById(req.params.teamId);
        
        if (!team) {
            return res.status(404).json({ error: 'Team not found' });
        }
        
        if (team.owner_id !== req.user.id) {
            return res.status(403).json({ error: 'Only team owner can delete' });
        }
        
        await db.deleteTeam(req.params.teamId);
        res.json({ message: 'Team deleted' });
    } catch (error) {
        console.error('Delete team error:', error);
        res.status(500).json({ error: 'Failed to delete team' });
    }
});

// Team roster
app.put('/api/teams/:teamId/roster', authenticateToken, async (req, res) => {
    try {
        const { roster } = req.body;
        
        if (!Array.isArray(roster)) {
            return res.status(400).json({ error: 'Roster must be an array' });
        }
        
        await db.updateTeamRoster(req.params.teamId, roster);
        const team = await db.getTeamById(req.params.teamId);
        
        res.json(team);
    } catch (error) {
        console.error('Update roster error:', error);
        res.status(500).json({ error: 'Failed to update roster' });
    }
});

// Team invitations
app.post('/api/teams/:teamId/invite', authenticateToken, [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('role').optional().isIn(['owner', 'admin', 'coach']).withMessage('Role must be owner, admin, or coach'),
    handleValidationErrors
], async (req, res) => {
    try {
        const { email, role = 'coach' } = req.body;
        
        const team = await db.getTeamById(req.params.teamId);
        if (!team) {
            return res.status(404).json({ error: 'Team not found' });
        }
        
        const invitation = await db.createInvitation({
            id: uuidv4(),
            teamId: req.params.teamId,
            email,
            role,
            invitedBy: req.user.id
        });
        
        res.status(201).json(invitation);
    } catch (error) {
        console.error('Invite error:', error);
        res.status(500).json({ error: 'Failed to send invitation' });
    }
});

// ==================== INVITATION ROUTES ====================

app.get('/api/invitations/pending', authenticateToken, async (req, res) => {
    try {
        const user = await db.getUserById(req.user.id);
        const invitations = await db.getPendingInvitations(user.email);
        res.json(invitations);
    } catch (error) {
        console.error('Get invitations error:', error);
        res.status(500).json({ error: 'Failed to get invitations' });
    }
});

app.post('/api/invitations/:invitationId/accept', authenticateToken, async (req, res) => {
    try {
        const invitation = await db.getInvitationById(req.params.invitationId);
        
        if (!invitation) {
            return res.status(404).json({ error: 'Invitation not found' });
        }
        
        const user = await db.getUserById(req.user.id);
        if (invitation.email !== user.email) {
            return res.status(403).json({ error: 'Invitation is for a different email' });
        }
        
        // Add user to team
        await db.addTeamMember(invitation.team_id, req.user.id, invitation.role);
        await db.updateInvitationStatus(req.params.invitationId, 'accepted');
        
        const team = await db.getTeamById(invitation.team_id);
        res.json(team);
    } catch (error) {
        console.error('Accept invitation error:', error);
        res.status(500).json({ error: 'Failed to accept invitation' });
    }
});

app.post('/api/invitations/:invitationId/decline', authenticateToken, async (req, res) => {
    try {
        await db.updateInvitationStatus(req.params.invitationId, 'declined');
        res.json({ message: 'Invitation declined' });
    } catch (error) {
        console.error('Decline invitation error:', error);
        res.status(500).json({ error: 'Failed to decline invitation' });
    }
});

// ==================== GAME ROUTES ====================

app.get('/api/teams/:teamId/games', authenticateToken, async (req, res) => {
    try {
        const games = await db.getGamesForTeam(req.params.teamId);
        res.json(games);
    } catch (error) {
        console.error('Get games error:', error);
        res.status(500).json({ error: 'Failed to get games' });
    }
});

app.post('/api/teams/:teamId/games', authenticateToken, [
    body('opponentName').trim().isLength({ min: 1, max: 100 }).escape().withMessage('Opponent name is required (max 100 characters)'),
    body('gameDate').optional().isISO8601().withMessage('Invalid date format'),
    body('location').optional().trim().isLength({ max: 200 }).escape(),
    body('notes').optional().trim().isLength({ max: 1000 }).escape(),
    handleValidationErrors
], async (req, res) => {
    try {
        const { opponentName, gameDate, tournamentId, location, notes } = req.body;
        
        const game = await db.createGame({
            id: uuidv4(),
            teamId: req.params.teamId,
            opponentName,
            gameDate: gameDate || new Date().toISOString().split('T')[0],
            tournamentId,
            location,
            notes
        });
        
        res.status(201).json(game);
    } catch (error) {
        console.error('Create game error:', error);
        res.status(500).json({ error: 'Failed to create game' });
    }
});

app.put('/api/games/:gameId', authenticateToken, async (req, res) => {
    try {
        const game = await db.updateGame(req.params.gameId, req.body);
        res.json(game);
    } catch (error) {
        console.error('Update game error:', error);
        res.status(500).json({ error: 'Failed to update game' });
    }
});

app.post('/api/games/:gameId/end', authenticateToken, async (req, res) => {
    try {
        const { ourScore, opponentScore, playerStats } = req.body;
        
        // Update game with final score
        await db.updateGame(req.params.gameId, {
            ourScore,
            opponentScore,
            isComplete: 1
        });
        
        // Save player stats
        if (playerStats) {
            await db.saveGamePlayerStats(req.params.gameId, playerStats);
            
            // Update career stats
            const game = await db.getGameById(req.params.gameId);
            if (game) {
                for (const [playerName, stats] of Object.entries(playerStats)) {
                    await db.updateCareerStats(game.team_id, playerName, stats);
                }
            }
        }
        
        const updatedGame = await db.getGameById(req.params.gameId);
        res.json(updatedGame);
    } catch (error) {
        console.error('End game error:', error);
        res.status(500).json({ error: 'Failed to end game' });
    }
});

// ==================== STATS ROUTES ====================

app.get('/api/teams/:teamId/stats', authenticateToken, async (req, res) => {
    try {
        const careerStats = await db.getCareerStats(req.params.teamId);
        const games = await db.getGamesForTeam(req.params.teamId);
        
        // Calculate team totals
        let totalGames = games.length;
        let wins = 0, losses = 0;
        
        games.forEach(game => {
            if (game.is_complete) {
                if (game.our_score > game.opponent_score) wins++;
                else if (game.our_score < game.opponent_score) losses++;
            }
        });
        
        res.json({
            players: careerStats,
            team: {
                totalGames,
                wins,
                losses,
                winPercentage: totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0
            }
        });
    } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({ error: 'Failed to get stats' });
    }
});

app.post('/api/teams/:teamId/stats/sync', authenticateToken, async (req, res) => {
    try {
        const { gameId, playerStats } = req.body;
        
        if (gameId && playerStats) {
            await db.saveGamePlayerStats(gameId, playerStats);
        }
        
        res.json({ message: 'Stats synced' });
    } catch (error) {
        console.error('Sync stats error:', error);
        res.status(500).json({ error: 'Failed to sync stats' });
    }
});

// ==================== TOURNAMENT ROUTES ====================

app.get('/api/tournaments', optionalAuth, async (req, res) => {
    try {
        const tournaments = await db.getAllTournaments();
        res.json(tournaments);
    } catch (error) {
        console.error('Get tournaments error:', error);
        res.status(500).json({ error: 'Failed to get tournaments' });
    }
});

app.post('/api/tournaments', authenticateToken, async (req, res) => {
    try {
        const { teamId, name, startDate, endDate, location } = req.body;
        
        if (!teamId || !name) {
            return res.status(400).json({ error: 'Team ID and name are required' });
        }
        
        const tournament = await db.createTournament({
            id: uuidv4(),
            teamId,
            name,
            startDate,
            endDate,
            location
        });
        
        res.status(201).json(tournament);
    } catch (error) {
        console.error('Create tournament error:', error);
        res.status(500).json({ error: 'Failed to create tournament' });
    }
});

// ==================== HEALTH CHECK ====================

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ==================== USAU IMPORT ROUTES ====================

const scraper = require('./lib/usau-scraper');
const USAU_BASE_URL = scraper.USAU_BASE_URL;

// Rate limit for USAU scraping to be respectful
const usauLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 requests per minute
    message: { error: 'Too many USAU requests, please try again later' }
});
app.use('/api/usau/', usauLimiter);

// Delegate to shared scraper module
const fetchUSAUPage = scraper.fetchUSAUPage;

// Search for teams on USAU
app.post('/api/usau/search-teams', optionalAuth, [
    body('query').trim().isLength({ min: 2, max: 100 }).withMessage('Search query required (2-100 characters)'),
    body('competitionLevel').optional().isIn(['College', 'Club', 'High School', 'Youth']),
    body('genderDivision').optional().isIn(['Men', 'Women', 'Mixed']),
    handleValidationErrors
], async (req, res) => {
    try {
        const { query, competitionLevel, genderDivision } = req.body;

        // Build search URL - USAU uses a search page
        const searchUrl = `${USAU_BASE_URL}/teams/events/rankings/`;

        // For now, we'll search the team finder page
        const html = await fetchUSAUPage(searchUrl);
        const $ = cheerio.load(html);

        // Parse team listings - this will need adjustment based on actual USAU HTML
        const teams = [];

        // USAU uses a form-based search, so we'll provide a simplified response
        // with instructions on how the user can search manually
        res.json({
            message: 'USAU team search requires form submission. Use the tournament search to find teams.',
            searchUrl: searchUrl,
            suggestion: 'Try searching for a tournament instead, which will list all participating teams.',
            teams: []
        });
    } catch (error) {
        console.error('USAU team search error:', error);
        res.status(500).json({ error: 'Failed to search USAU teams' });
    }
});

// Search for tournaments on USAU
app.post('/api/usau/search-tournaments', optionalAuth, [
    body('query').trim().isLength({ min: 2, max: 100 }).withMessage('Search query required (2-100 characters)'),
    body('competitionLevel').optional().isIn(['College', 'Club', 'High School', 'Youth']),
    body('genderDivision').optional().isIn(['Men', 'Women', 'Mixed']),
    body('season').optional().isInt({ min: 2010, max: 2030 }),
    handleValidationErrors
], async (req, res) => {
    try {
        const { query, competitionLevel = 'College', genderDivision = 'Men', season } = req.body;

        // Build the events search URL
        const currentYear = season || new Date().getFullYear();
        const eventsUrl = `${USAU_BASE_URL}/events/`;

        const html = await fetchUSAUPage(eventsUrl);
        const $ = cheerio.load(html);

        const tournaments = [];

        // Parse event listings from the events page
        $('a[href*="/events/"]').each((i, el) => {
            const link = $(el).attr('href');
            const name = $(el).text().trim();

            // Filter by search query (case-insensitive)
            if (name && link && name.toLowerCase().includes(query.toLowerCase())) {
                // Avoid duplicates and navigation links
                if (!tournaments.find(t => t.link === link) && name.length > 3) {
                    tournaments.push({
                        name: name,
                        link: link.startsWith('http') ? link : USAU_BASE_URL + link,
                        season: currentYear
                    });
                }
            }
        });

        res.json({
            tournaments: tournaments.slice(0, 20), // Limit results
            searchUrl: eventsUrl,
            query: query
        });
    } catch (error) {
        console.error('USAU tournament search error:', error);
        res.status(500).json({ error: 'Failed to search USAU tournaments' });
    }
});

// Get team roster from USAU team page
app.get('/api/usau/team', optionalAuth, async (req, res) => {
    try {
        const { url } = req.query;

        if (!url) {
            return res.status(400).json({ error: 'Team URL is required' });
        }

        const html = await fetchUSAUPage(url);
        const $ = cheerio.load(html);

        // Extract team name - look for specific USAU patterns
        let teamName = '';

        // Try the most specific selector first for USAU Event Team pages
        const profileH4 = $('.profile_info h4').first().text().trim();

        if (profileH4 && profileH4.length > 2) {
            teamName = profileH4;
        }

        // Try other selectors if not found
        if (!teamName) {
            const teamNameSelectors = [
                '.team-header h1',
                '.team-name',
                'h1.team-name',
                '.event-team-name',
                '#ContentPlaceHolder1_lblTeamName',
                '.profile_info strong'
            ];

            for (const selector of teamNameSelectors) {
                const text = $(selector).first().text().trim();
                if (text && text.length > 2 && text.length < 100 &&
                    !text.toLowerCase().includes('usa ultimate')) {
                    teamName = text;
                    break;
                }
            }
        }

        // Fallback to title only if still not found
        if (!teamName) {
            const titleText = $('title').text();
            const parts = titleText.split(/[|\-–]/);
            if (parts.length > 0 && !parts[0].toLowerCase().includes('usa ultimate')) {
                teamName = parts[0].trim();
            }
        }

        // Clean up team name
        teamName = teamName.replace(/roster/i, '').replace(/\s+/g, ' ').trim() || 'Unknown Team';

        // Extract roster from the page
        const roster = [];
        const playerSet = new Set();

        // Words that indicate non-player entries
        const excludeWords = [
            'name', 'player', 'roster', 'jersey', 'number', '#',
            'open', 'women', 'mixed', 'men', 'division',
            'january', 'february', 'march', 'april', 'may', 'june',
            'july', 'august', 'september', 'october', 'november', 'december',
            'schedule', 'results', 'standings', 'stats', 'view', 'more',
            'tournament', 'event', '2024', '2025', '2026'
        ];

        function isValidPlayerName(name) {
            if (!name || name.length < 3 || name.length > 50) return false;
            const lowerName = name.toLowerCase();

            // Must contain at least one letter
            if (!/[a-zA-Z]/.test(name)) return false;

            // Check for exclude words
            for (const word of excludeWords) {
                if (lowerName.includes(word)) return false;
            }

            // Should look like a name (contains space between words, or is single name)
            // Filter out things that look like dates or events
            if (/^\d/.test(name) && !/^\d+\s+[a-zA-Z]/.test(name)) return false;

            return true;
        }

        // Try multiple table selectors - USAU has different page structures
        const tableSelectors = [
            '.global_table tr',
            '#CT_Main_0_ucTeamDetails_gvList tr',
            '#ctl00_ContentPlaceHolder1_gvRoster tr',
            '[id*="gvList"] tr',
            '[id*="Roster"] tr',
            '[id*="roster"] tr',
            '.roster-table tr',
            'table.data tr',
            'table tr'
        ];

        let foundTableSelector = null;
        for (const selector of tableSelectors) {
            const count = $(selector).length;
            if (count > 1) {
                foundTableSelector = selector;
                break;
            }
        }

        // Look for USAU roster format - try the found selector or all table rows
        // USAU table columns: No. | Player | Pronouns | Position | Year | Height | Points | Assists | Ds | Turns
        const rowSelector = foundTableSelector || 'table tr';
        $(rowSelector).each((idx, el) => {
            const $row = $(el);
            const cells = $row.find('td');

            if (cells.length >= 2) {
                const firstCell = $(cells[0]).text().trim();
                const secondCell = $(cells[1]).text().trim();

                // First cell is jersey number, second is player name
                let number = null;
                let name = '';

                if (/^\d+$/.test(firstCell)) {
                    number = parseInt(firstCell);
                    name = secondCell;
                }

                if (isValidPlayerName(name) && !playerSet.has(name.toLowerCase())) {
                    playerSet.add(name.toLowerCase());

                    // Extract additional fields if available
                    const player = { name, number };

                    // Pronouns (column 2)
                    if (cells.length > 2) {
                        const pronouns = $(cells[2]).text().trim();
                        if (pronouns && pronouns.length > 0 && pronouns.length < 20) {
                            player.pronouns = pronouns;
                        }
                    }

                    // Position (column 3)
                    if (cells.length > 3) {
                        const position = $(cells[3]).text().trim();
                        if (position && position.length > 0 && position.length < 30) {
                            player.position = position;
                        }
                    }

                    // Year (column 4)
                    if (cells.length > 4) {
                        const year = $(cells[4]).text().trim();
                        if (year && year.length > 0 && year.length < 20) {
                            player.year = year;
                        }
                    }

                    // Height (column 5)
                    if (cells.length > 5) {
                        const height = $(cells[5]).text().trim();
                        if (height && height.length > 0 && height.length < 15) {
                            player.height = height;
                        }
                    }

                    // Stats columns (6-9): Points, Assists, Ds, Turns
                    if (cells.length > 6) {
                        const points = parseInt($(cells[6]).text().trim());
                        if (!isNaN(points)) player.points = points;
                    }
                    if (cells.length > 7) {
                        const assists = parseInt($(cells[7]).text().trim());
                        if (!isNaN(assists)) player.assists = assists;
                    }
                    if (cells.length > 8) {
                        const ds = parseInt($(cells[8]).text().trim());
                        if (!isNaN(ds)) player.ds = ds;
                    }
                    if (cells.length > 9) {
                        const turns = parseInt($(cells[9]).text().trim());
                        if (!isNaN(turns)) player.turns = turns;
                    }

                    roster.push(player);
                }
            }
        });

        // Also look for other roster table formats
        $('table tr, .roster-row, .player-row, [class*="roster"] tr').each((_, el) => {
            const $row = $(el);
            const cells = $row.find('td, .player-name, .name');

            if (cells.length > 0) {
                const firstCell = $(cells[0]).text().trim();
                const secondCell = cells.length > 1 ? $(cells[1]).text().trim() : '';

                let name = '';
                let number = null;

                // Check if first cell is a jersey number
                if (/^\d{1,2}$/.test(firstCell) && secondCell) {
                    number = parseInt(firstCell);
                    name = secondCell;
                } else if (firstCell && !/^\d+$/.test(firstCell)) {
                    name = firstCell;
                    if (/^\d{1,2}$/.test(secondCell)) {
                        number = parseInt(secondCell);
                    }
                }

                if (isValidPlayerName(name) && !playerSet.has(name.toLowerCase())) {
                    playerSet.add(name.toLowerCase());
                    roster.push({ name, number });
                }
            }
        });

        // Also look for player links
        $('a[href*="/players/"], .player a, .roster a').each((_, el) => {
            const name = $(el).text().trim();
            if (isValidPlayerName(name) && !playerSet.has(name.toLowerCase())) {
                playerSet.add(name.toLowerCase());
                roster.push({ name, number: null });
            }
        });

        console.log(`Found team "${teamName}" with ${roster.length} players`);

        res.json({
            name: teamName,
            link: url,
            roster: roster.slice(0, 50) // Limit to 50 players
        });
    } catch (error) {
        console.error('USAU team fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch USAU team' });
    }
});

// Get tournament details (pools and teams)
app.get('/api/usau/tournament', optionalAuth, async (req, res) => {
    try {
        const { url, competitionLevel = 'College', genderDivision = 'Men' } = req.query;

        if (!url) {
            return res.status(400).json({ error: 'Tournament URL is required' });
        }

        const html = await fetchUSAUPage(url);
        const result = scraper.parseTournamentPage(html, url);

        res.json({
            name: result.name,
            url: url,
            teams: result.teams,
            scheduleLinks: result.scheduleLinks,
            competitionLevel,
            genderDivision
        });
    } catch (error) {
        console.error('USAU tournament fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch tournament details' });
    }
});

// Get pool play results from a tournament
app.get('/api/usau/tournament/pools', optionalAuth, async (req, res) => {
    try {
        const { url } = req.query;

        if (!url) {
            return res.status(400).json({ error: 'Schedule URL is required' });
        }

        const html = await fetchUSAUPage(url);
        const result = scraper.parsePoolsAndMatchups(html);

        res.json({
            pools: result.pools,
            matchups: result.matchups,
            teams: result.teams,
            poolCount: Object.keys(result.pools).length,
            teamCount: result.teams.length,
            brackets: result.brackets,
            tabs: result.tabs,
            url: url
        });
    } catch (error) {
        console.error('USAU pools fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch pool results' });
    }
});

// Get USAU rankings for a division
app.get('/api/usau/rankings', optionalAuth, async (req, res) => {
    try {
        const { rankSet } = req.query;
        const allowedRankSets = [
            'College-Men', 'College-Women',
            'Club-Men', 'Club-Women', 'Club-Mixed'
        ];
        if (!rankSet || !allowedRankSets.includes(rankSet)) {
            return res.status(400).json({
                error: 'Valid rankSet required. Options: ' + allowedRankSets.join(', ')
            });
        }

        const { rankings, totalCount } = await scraper.fetchAllRankings(rankSet);

        res.json({
            rankings,
            rankSet,
            totalCount,
            fetchedCount: rankings.length,
            fetchedAt: new Date().toISOString()
        });
    } catch (error) {
        console.error('USAU rankings fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch USAU rankings' });
    }
});

// Get bracket results from a tournament
app.get('/api/usau/tournament/bracket', optionalAuth, async (req, res) => {
    try {
        const { url } = req.query;

        if (!url) {
            return res.status(400).json({ error: 'Bracket URL is required' });
        }

        const html = await fetchUSAUPage(url);
        const $ = cheerio.load(html);
        const brackets = scraper.parseBracketSections($, scraper.cleanTeamName);

        const championBracket = brackets.find(b =>
            b.name.toLowerCase().includes('1st') ||
            b.name.toLowerCase().includes('championship') ||
            b.name.toLowerCase().includes('final')
        );

        res.json({
            brackets: brackets,
            champion: championBracket ? championBracket.champion : null,
            bracketCount: brackets.length,
            totalGames: brackets.reduce((sum, b) => sum + b.games.length, 0),
            url: url
        });
    } catch (error) {
        console.error('USAU bracket fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch bracket results' });
    }
});

// ==================== USAU REGISTRY ====================

// Get registered teams by division
app.get('/api/registry/teams', optionalAuth, async (req, res) => {
    try {
        const { division, search, limit = '50', offset = '0' } = req.query;
        if (!division) {
            return res.status(400).json({ error: 'division query parameter is required (e.g. College-Men)' });
        }

        const lim = Math.min(parseInt(limit) || 50, 200);
        const off = parseInt(offset) || 0;

        const [teams, total] = await Promise.all([
            db.getUsauTeams(division, { search, limit: lim, offset: off }),
            db.countUsauTeams(division, { search })
        ]);

        res.json({ teams, total, division, limit: lim, offset: off });
    } catch (error) {
        console.error('Registry teams error:', error);
        res.status(500).json({ error: 'Failed to fetch registry teams' });
    }
});

// Get single team by slug with tournament history
app.get('/api/registry/teams/:slug', optionalAuth, async (req, res) => {
    try {
        const team = await db.getUsauTeamBySlug(req.params.slug);
        if (!team) {
            return res.status(404).json({ error: 'Team not found' });
        }

        const tournaments = await db.getTeamTournamentHistory(req.params.slug);
        res.json({ team, tournaments });
    } catch (error) {
        console.error('Registry team detail error:', error);
        res.status(500).json({ error: 'Failed to fetch team details' });
    }
});

// Get registered tournaments
app.get('/api/registry/tournaments', optionalAuth, async (req, res) => {
    try {
        const { competitionLevel, genderDivision, search, limit = '50', offset = '0' } = req.query;

        const lim = Math.min(parseInt(limit) || 50, 200);
        const off = parseInt(offset) || 0;

        const [tournaments, total] = await Promise.all([
            db.getUsauTournaments({ competitionLevel, genderDivision, search, limit: lim, offset: off }),
            db.countUsauTournaments({ competitionLevel, genderDivision, search })
        ]);

        res.json({ tournaments, total, limit: lim, offset: off });
    } catch (error) {
        console.error('Registry tournaments error:', error);
        res.status(500).json({ error: 'Failed to fetch registry tournaments' });
    }
});

// Get single tournament by slug with teams and matchups
app.get('/api/registry/tournaments/:slug', optionalAuth, async (req, res) => {
    try {
        const tournament = await db.getUsauTournamentBySlug(req.params.slug);
        if (!tournament) {
            return res.status(404).json({ error: 'Tournament not found' });
        }

        const [teams, matchups] = await Promise.all([
            db.getUsauTournamentTeams(req.params.slug),
            db.getUsauMatchups(req.params.slug)
        ]);

        res.json({ tournament, teams, matchups });
    } catch (error) {
        console.error('Registry tournament detail error:', error);
        res.status(500).json({ error: 'Failed to fetch tournament details' });
    }
});

// Claim a team (link user to a registry team)
app.post('/api/registry/claim-team', authenticateToken, [
    body('teamSlug').trim().notEmpty().withMessage('teamSlug is required'),
    body('appTeamId').optional().trim(),
    body('role').optional().isIn(['coach', 'captain', 'player']),
    handleValidationErrors
], async (req, res) => {
    try {
        const { teamSlug, appTeamId, role = 'coach' } = req.body;

        // Verify team exists
        const team = await db.getUsauTeamBySlug(teamSlug);
        if (!team) {
            return res.status(404).json({ error: 'Team not found in registry' });
        }

        await db.claimTeam({
            id: uuidv4(),
            userId: req.user.id,
            teamSlug,
            appTeamId: appTeamId || null,
            role
        });

        res.json({ message: 'Team claimed successfully', team });
    } catch (error) {
        console.error('Claim team error:', error);
        res.status(500).json({ error: 'Failed to claim team' });
    }
});

// Get claimed teams for current user
app.get('/api/registry/my-teams', authenticateToken, async (req, res) => {
    try {
        const claims = await db.getUserClaims(req.user.id);
        res.json({ claims });
    } catch (error) {
        console.error('My teams error:', error);
        res.status(500).json({ error: 'Failed to fetch claimed teams' });
    }
});

// Get latest sync status
app.get('/api/registry/sync/status', optionalAuth, async (req, res) => {
    try {
        const log = await db.getLatestSyncLog();
        res.json({ sync: log || null });
    } catch (error) {
        console.error('Sync status error:', error);
        res.status(500).json({ error: 'Failed to fetch sync status' });
    }
});

// ==================== SEASON BROWSING ====================

// Get available seasons
app.get('/api/registry/seasons', optionalAuth, async (req, res) => {
    try {
        const seasons = await db.getAvailableSeasons();
        res.json({ seasons });
    } catch (error) {
        console.error('Seasons list error:', error);
        res.status(500).json({ error: 'Failed to fetch seasons' });
    }
});

// Get season summary (team counts by division, tournament count)
app.get('/api/registry/seasons/:season', optionalAuth, async (req, res) => {
    try {
        const season = parseInt(req.params.season);
        if (isNaN(season)) return res.status(400).json({ error: 'Invalid season year' });
        const summary = await db.getSeasonSummary(season);
        res.json(summary);
    } catch (error) {
        console.error('Season summary error:', error);
        res.status(500).json({ error: 'Failed to fetch season summary' });
    }
});

// Get ranked teams for a season + division
app.get('/api/registry/seasons/:season/teams', optionalAuth, async (req, res) => {
    try {
        const season = parseInt(req.params.season);
        if (isNaN(season)) return res.status(400).json({ error: 'Invalid season year' });
        const { division, search, limit = '50', offset = '0' } = req.query;
        if (!division) return res.status(400).json({ error: 'Division parameter required' });

        const [teams, total] = await Promise.all([
            db.getUsauTeamsBySeason(season, division, { search, limit: parseInt(limit), offset: parseInt(offset) }),
            db.countUsauTeamsBySeason(season, division, { search })
        ]);
        res.json({ teams, total, season, division });
    } catch (error) {
        console.error('Season teams error:', error);
        res.status(500).json({ error: 'Failed to fetch season teams' });
    }
});

// Get tournaments for a season
app.get('/api/registry/seasons/:season/tournaments', optionalAuth, async (req, res) => {
    try {
        const season = parseInt(req.params.season);
        if (isNaN(season)) return res.status(400).json({ error: 'Invalid season year' });
        const { search, limit = '50', offset = '0' } = req.query;

        const [tournaments, total] = await Promise.all([
            db.getUsauTournamentsBySeason(season, { search, limit: parseInt(limit), offset: parseInt(offset) }),
            db.countUsauTournamentsBySeason(season, { search })
        ]);
        res.json({ tournaments, total, season });
    } catch (error) {
        console.error('Season tournaments error:', error);
        res.status(500).json({ error: 'Failed to fetch season tournaments' });
    }
});

// ==================== SHARED TOURNAMENTS ====================

// Share/get a tournament (creates if not exists, returns existing if it does)
app.post('/api/shared-tournaments', authenticateToken, [
    body('usauUrl').isURL().withMessage('Valid USAU URL required'),
    body('name').trim().notEmpty().withMessage('Tournament name required'),
    body('teamId').optional().trim(),
    body('teamName').optional().trim(),
    handleValidationErrors
], async (req, res) => {
    try {
        const { usauUrl, name, competitionLevel, genderDivision, format, pools, standings, matchups, teams, teamId, teamName, poolName } = req.body;

        // Normalize URL (remove trailing slashes, etc.)
        const normalizedUrl = usauUrl.replace(/\/+$/, '');

        // Create or get existing tournament
        const tournament = await db.createOrGetSharedTournament({
            id: uuidv4(),
            usauUrl: normalizedUrl,
            name,
            competitionLevel,
            genderDivision,
            format: format || 'pool-to-bracket',
            pools,
            standings,
            matchups,
            teams,
            importedBy: req.user.id
        });

        // If team info provided, link it
        if (teamId && teamName) {
            await db.linkTeamToTournament({
                id: `${tournament.id}-${teamId}`,
                tournamentId: tournament.id,
                teamId,
                userId: req.user.id,
                teamName,
                poolName
            });
        }

        // Get linked teams count
        const linkedTeams = await db.getLinkedTeamsForTournament(tournament.id);

        res.json({
            ...tournament,
            linkedTeamsCount: linkedTeams.length,
            linkedTeams: linkedTeams
        });
    } catch (error) {
        console.error('Share tournament error:', error);
        res.status(500).json({ error: 'Failed to share tournament' });
    }
});

// Get tournaments linked to user's teams
app.get('/api/shared-tournaments', authenticateToken, async (req, res) => {
    try {
        const tournaments = await db.getLinkedTournamentsForUser(req.user.id);
        res.json({ tournaments });
    } catch (error) {
        console.error('Get shared tournaments error:', error);
        res.status(500).json({ error: 'Failed to get shared tournaments' });
    }
});

// Get a specific shared tournament
app.get('/api/shared-tournaments/:id', optionalAuth, async (req, res) => {
    try {
        const tournament = await db.getSharedTournamentById(req.params.id);

        if (!tournament) {
            return res.status(404).json({ error: 'Tournament not found' });
        }

        // Get linked teams
        const linkedTeams = await db.getLinkedTeamsForTournament(tournament.id);

        res.json({
            ...tournament,
            linkedTeams: linkedTeams
        });
    } catch (error) {
        console.error('Get tournament error:', error);
        res.status(500).json({ error: 'Failed to get tournament' });
    }
});

// Update shared tournament (fetch fresh results from USAU)
app.post('/api/shared-tournaments/:id/update', authenticateToken, async (req, res) => {
    try {
        const tournament = await db.getSharedTournamentById(req.params.id);

        if (!tournament) {
            return res.status(404).json({ error: 'Tournament not found' });
        }

        // Fetch fresh data from USAU
        const scheduleUrl = tournament.usau_url;

        // Construct schedule URL if needed
        let poolsUrl = scheduleUrl;
        if (!poolsUrl.includes('/schedule/')) {
            const urlLower = poolsUrl.toLowerCase();
            let gender = 'Men';
            let level = 'College';

            if (urlLower.includes('women') || urlLower.includes('-w-')) gender = 'Women';
            if (urlLower.includes('mixed')) gender = 'Mixed';
            if (urlLower.includes('club')) level = 'Club';

            poolsUrl = poolsUrl.replace(/\/?$/, '') + `/schedule/${gender}/${level}${gender}/`;
        }

        // Fetch pool data
        const html = await fetchUSAUPage(poolsUrl);
        const $ = cheerio.load(html);

        // Parse pools (reuse existing parsing logic)
        const pools = {};
        const allTeams = [];
        const teamSet = new Set();

        function cleanTeamName(name) {
            return name.replace(/\s*[\(\[\{]\d+[\)\]\}]\s*$/, '').trim();
        }

        function extractSeed(name) {
            const match = name.match(/[\(\[\{](\d+)[\)\]\}]\s*$/);
            return match ? parseInt(match[1]) : null;
        }

        // Parse pool headers
        const poolHeaders = [];
        $('h2, h3, h4, h5, .pool-header, [class*="poolSlide"]').each((i, el) => {
            const text = $(el).text().trim();
            const poolMatch = text.match(/Pool\s*([A-Z])/i);
            if (poolMatch) {
                poolHeaders.push({
                    element: el,
                    name: `Pool ${poolMatch[1].toUpperCase()}`
                });
            }
        });

        if (poolHeaders.length > 0) {
            poolHeaders.forEach(poolHeader => {
                const poolName = poolHeader.name;
                const poolTeams = [];
                let $current = $(poolHeader.element);
                const $parent = $current.parent();

                $parent.find('table').each((ti, table) => {
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
                                cleanName.toLowerCase() !== 'w-l') {
                                poolTeams.push({ name: cleanName, seed, wins, losses, pointDiff: 0 });

                                if (!teamSet.has(cleanName.toLowerCase())) {
                                    teamSet.add(cleanName.toLowerCase());
                                    allTeams.push({ name: cleanName, pool: poolName, seed });
                                }
                            }
                        }
                    });
                });

                if (poolTeams.length > 0) {
                    pools[poolName] = poolTeams;
                }
            });
        }

        // Update tournament with fresh data
        const updated = await db.updateSharedTournament(tournament.id, {
            pools,
            standings: pools, // Use pools as standings since they contain W-L
            teams: allTeams
        });

        res.json({
            success: true,
            tournament: updated,
            poolCount: Object.keys(pools).length,
            teamCount: allTeams.length
        });
    } catch (error) {
        console.error('Update tournament error:', error);
        res.status(500).json({ error: 'Failed to update tournament' });
    }
});

// Link a team to a tournament
app.post('/api/shared-tournaments/:id/link', authenticateToken, [
    body('teamId').trim().notEmpty().withMessage('Team ID required'),
    body('teamName').trim().notEmpty().withMessage('Team name required'),
    handleValidationErrors
], async (req, res) => {
    try {
        const { teamId, teamName, poolName } = req.body;

        const tournament = await db.getSharedTournamentById(req.params.id);
        if (!tournament) {
            return res.status(404).json({ error: 'Tournament not found' });
        }

        // Verify user owns/has access to the team
        const team = await db.getTeamById(teamId);
        if (!team) {
            return res.status(404).json({ error: 'Team not found' });
        }

        const members = await db.getTeamMembers(teamId);
        const isMember = members.some(m => m.user_id === req.user.id);
        if (!isMember) {
            return res.status(403).json({ error: 'Not authorized to link this team' });
        }

        // Create link
        const link = await db.linkTeamToTournament({
            id: `${tournament.id}-${teamId}`,
            tournamentId: tournament.id,
            teamId,
            userId: req.user.id,
            teamName,
            poolName
        });

        res.json({ success: true, link });
    } catch (error) {
        console.error('Link team error:', error);
        res.status(500).json({ error: 'Failed to link team' });
    }
});

// Find tournaments containing a team
app.get('/api/shared-tournaments/find-by-team', authenticateToken, async (req, res) => {
    try {
        const { teamName } = req.query;

        if (!teamName || teamName.length < 2) {
            return res.status(400).json({ error: 'Team name required (min 2 chars)' });
        }

        const matches = await db.findTournamentsWithTeam(teamName);
        res.json({ matches });
    } catch (error) {
        console.error('Find tournaments error:', error);
        res.status(500).json({ error: 'Failed to find tournaments' });
    }
});

// ==================== STATIC FILE SERVING ====================
// Serve frontend files from the project root (parent directory of /api)
const path = require('path');
const frontendDir = path.join(__dirname, '..');
app.use(express.static(frontendDir));

// Fallback: serve index.html for any non-API route that doesn't match a static file
// This supports client-side routing
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    const filePath = path.join(frontendDir, req.path);
    res.sendFile(filePath, (err) => {
        if (err) {
            res.sendFile(path.join(frontendDir, 'index.html'));
        }
    });
});

// ==================== ERROR HANDLER ====================

app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// ==================== START SERVER ====================

async function startServer() {
    try {
        // Initialize database
        await db.initDatabase();
        
        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
            console.log(`API available at http://localhost:${PORT}/api`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await db.closeDatabase();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\nShutting down...');
    await db.closeDatabase();
    process.exit(0);
});

module.exports = { app, startServer };

if (require.main === module) {
    startServer();
}
