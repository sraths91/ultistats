const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3001;

// JWT Secret - required, no fallback
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = '7d';

if (!JWT_SECRET || JWT_SECRET.includes('change-this') || JWT_SECRET.includes('change-in-production')) {
    console.error('FATAL: JWT_SECRET environment variable is not set or is using a default value.');
    console.error('Set a strong, unique JWT_SECRET in your .env file before starting the server.');
    process.exit(1);
}

// Email configuration - Configure with your SMTP settings
const emailTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT || 587,
    secure: false,
    auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || ''
    }
});

// Middleware
const allowedOrigins = process.env.CLIENT_URL
    ? process.env.CLIENT_URL.split(',').map(s => s.trim())
    : ['http://localhost:3000'];
app.use(cors({
    origin: function (origin, callback) {
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
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false
});
app.use('/api/auth/', authLimiter);

// Data file paths
const DATA_DIR = path.join(__dirname, 'data');
const PLAYERS_FILE = path.join(DATA_DIR, 'players.json');
const GAMES_FILE = path.join(DATA_DIR, 'games.json');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');
const TURNOVERS_FILE = path.join(DATA_DIR, 'turnovers.json');
const ACTIONS_FILE = path.join(DATA_DIR, 'actions.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const TEAMS_FILE = path.join(DATA_DIR, 'teams.json');
const INVITATIONS_FILE = path.join(DATA_DIR, 'invitations.json');
const TOURNAMENTS_FILE = path.join(DATA_DIR, 'tournaments.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Helper functions for data persistence
function readData(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (error) {
        console.error(`Error reading ${filePath}:`, error);
    }
    return [];
}

function writeData(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error(`Error writing ${filePath}:`, error);
        return false;
    }
}

// Initialize data files if they don't exist
function initializeDataFiles() {
    const files = [
        { path: PLAYERS_FILE, default: [] },
        { path: GAMES_FILE, default: [] },
        { path: STATS_FILE, default: [] },
        { path: TURNOVERS_FILE, default: [] },
        { path: ACTIONS_FILE, default: [] },
        { path: USERS_FILE, default: [] },
        { path: TEAMS_FILE, default: [] },
        { path: INVITATIONS_FILE, default: [] },
        { path: TOURNAMENTS_FILE, default: [] }
    ];

    files.forEach(file => {
        if (!fs.existsSync(file.path)) {
            writeData(file.path, file.default);
        }
    });
}

initializeDataFiles();

// ==================== AUTH MIDDLEWARE ====================

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
}

// ==================== AUTH API ====================

// Register new user
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, name } = req.body;
        
        if (!email || !password || !name) {
            return res.status(400).json({ error: 'Email, password, and name are required' });
        }
        
        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }
        
        // Check password strength
        if (password.length < 12) {
            return res.status(400).json({ error: 'Password must be at least 12 characters' });
        }
        if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
            return res.status(400).json({ error: 'Password must contain uppercase, lowercase, and a number' });
        }
        
        const users = readData(USERS_FILE);
        
        // Check if email already exists
        if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
            return res.status(400).json({ error: 'Email already registered' });
        }
        
        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        
        // Create user
        const newUser = {
            id: uuidv4(),
            email: email.toLowerCase(),
            password: hashedPassword,
            name,
            createdAt: new Date().toISOString(),
            teams: [] // Array of team IDs the user has access to
        };
        
        users.push(newUser);
        
        // Auto-accept any pending invitations for this email
        const invitations = readData(INVITATIONS_FILE);
        const teams = readData(TEAMS_FILE);
        const acceptedTeams = [];
        
        invitations.forEach((invitation, index) => {
            if (invitation.email.toLowerCase() === email.toLowerCase() && 
                invitation.status === 'pending' &&
                new Date(invitation.expiresAt) > new Date()) {
                
                // Find the team
                const teamIndex = teams.findIndex(t => t.id === invitation.teamId);
                if (teamIndex !== -1) {
                    // Add user to team
                    teams[teamIndex].members.push({
                        userId: newUser.id,
                        email: newUser.email,
                        name: newUser.name,
                        role: invitation.role,
                        joinedAt: new Date().toISOString()
                    });
                    
                    // Add team to user's teams
                    newUser.teams.push(invitation.teamId);
                    acceptedTeams.push(teams[teamIndex].name);
                    
                    // Update invitation status
                    invitations[index].status = 'accepted';
                    invitations[index].acceptedAt = new Date().toISOString();
                    invitations[index].autoAccepted = true;
                }
            }
        });
        
        // Save all changes
        writeData(USERS_FILE, users);
        if (acceptedTeams.length > 0) {
            writeData(TEAMS_FILE, teams);
            writeData(INVITATIONS_FILE, invitations);
        }
        
        // Generate token
        const token = jwt.sign(
            { id: newUser.id, email: newUser.email, name: newUser.name },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );
        
        // Return user without password
        const { password: _, ...userWithoutPassword } = newUser;
        
        // Include info about auto-accepted teams
        const message = acceptedTeams.length > 0 
            ? `Account created! You've been automatically added to: ${acceptedTeams.join(', ')}`
            : 'Account created successfully';
        
        res.status(201).json({ 
            message,
            user: userWithoutPassword, 
            token,
            autoJoinedTeams: acceptedTeams
        });
        
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Server error during registration' });
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }
        
        const users = readData(USERS_FILE);
        const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
        
        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        
        // Compare password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        
        // Generate token
        const token = jwt.sign(
            { id: user.id, email: user.email, name: user.name },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );
        
        // Return user without password
        const { password: _, ...userWithoutPassword } = user;
        res.json({ 
            message: 'Login successful',
            user: userWithoutPassword, 
            token 
        });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error during login' });
    }
});

// Get current user
app.get('/api/auth/me', authenticateToken, (req, res) => {
    const users = readData(USERS_FILE);
    const user = users.find(u => u.id === req.user.id);
    
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    const { password: _, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
});

// ==================== TEAMS API ====================

// Create a new team
app.post('/api/teams', authenticateToken, (req, res) => {
    try {
        const { name, sport = 'Ultimate Frisbee' } = req.body;
        
        if (!name) {
            return res.status(400).json({ error: 'Team name is required' });
        }
        
        const teams = readData(TEAMS_FILE);
        const users = readData(USERS_FILE);
        
        const newTeam = {
            id: uuidv4(),
            name,
            sport,
            ownerId: req.user.id,
            members: [{
                userId: req.user.id,
                email: req.user.email,
                name: req.user.name,
                role: 'owner',
                joinedAt: new Date().toISOString()
            }],
            createdAt: new Date().toISOString(),
            roster: [],
            games: [],
            stats: {}
        };
        
        teams.push(newTeam);
        writeData(TEAMS_FILE, teams);
        
        // Add team to user's teams array
        const userIndex = users.findIndex(u => u.id === req.user.id);
        if (userIndex !== -1) {
            users[userIndex].teams = users[userIndex].teams || [];
            users[userIndex].teams.push(newTeam.id);
            writeData(USERS_FILE, users);
        }
        
        res.status(201).json(newTeam);
        
    } catch (error) {
        console.error('Create team error:', error);
        res.status(500).json({ error: 'Server error creating team' });
    }
});

// Get user's teams
app.get('/api/teams', authenticateToken, (req, res) => {
    const teams = readData(TEAMS_FILE);
    const userTeams = teams.filter(t => 
        t.members.some(m => m.userId === req.user.id)
    );
    res.json(userTeams);
});

// Get single team
app.get('/api/teams/:id', authenticateToken, (req, res) => {
    const teams = readData(TEAMS_FILE);
    const team = teams.find(t => t.id === req.params.id);
    
    if (!team) {
        return res.status(404).json({ error: 'Team not found' });
    }
    
    // Check if user has access
    if (!team.members.some(m => m.userId === req.user.id)) {
        return res.status(403).json({ error: 'Access denied to this team' });
    }
    
    res.json(team);
});

// Update team
app.put('/api/teams/:id', authenticateToken, (req, res) => {
    const teams = readData(TEAMS_FILE);
    const teamIndex = teams.findIndex(t => t.id === req.params.id);
    
    if (teamIndex === -1) {
        return res.status(404).json({ error: 'Team not found' });
    }
    
    // Check if user is owner or admin
    const member = teams[teamIndex].members.find(m => m.userId === req.user.id);
    if (!member || !['owner', 'admin'].includes(member.role)) {
        return res.status(403).json({ error: 'Only team owner or admin can update team' });
    }
    
    const { name, roster, stats, games } = req.body;
    
    if (name) teams[teamIndex].name = name;
    if (roster) teams[teamIndex].roster = roster;
    if (stats) teams[teamIndex].stats = stats;
    if (games) teams[teamIndex].games = games;
    
    teams[teamIndex].updatedAt = new Date().toISOString();
    writeData(TEAMS_FILE, teams);
    
    res.json(teams[teamIndex]);
});

// ==================== INVITATIONS API ====================

// Invite user to team
app.post('/api/teams/:id/invite', authenticateToken, async (req, res) => {
    try {
        const { email, role = 'coach' } = req.body;
        
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }
        
        const teams = readData(TEAMS_FILE);
        const users = readData(USERS_FILE);
        const invitations = readData(INVITATIONS_FILE);
        
        const team = teams.find(t => t.id === req.params.id);
        
        if (!team) {
            return res.status(404).json({ error: 'Team not found' });
        }
        
        // Check if inviter has permission
        const inviterMember = team.members.find(m => m.userId === req.user.id);
        if (!inviterMember || !['owner', 'admin'].includes(inviterMember.role)) {
            return res.status(403).json({ error: 'Only team owner or admin can invite members' });
        }
        
        // Check if already a member
        if (team.members.some(m => m.email.toLowerCase() === email.toLowerCase())) {
            return res.status(400).json({ error: 'User is already a team member' });
        }
        
        // Check if invitation already pending
        const existingInvite = invitations.find(i => 
            i.teamId === team.id && 
            i.email.toLowerCase() === email.toLowerCase() && 
            i.status === 'pending'
        );
        
        if (existingInvite) {
            return res.status(400).json({ error: 'Invitation already pending for this email' });
        }
        
        // Check if user exists
        const existingUser = users.find(u => u.email.toLowerCase() === email.toLowerCase());
        
        // Create invitation
        const invitation = {
            id: uuidv4(),
            teamId: team.id,
            teamName: team.name,
            email: email.toLowerCase(),
            role,
            invitedBy: req.user.id,
            inviterName: req.user.name,
            status: 'pending',
            existingUser: !!existingUser,
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days
        };
        
        invitations.push(invitation);
        writeData(INVITATIONS_FILE, invitations);
        
        // Send invitation email (if SMTP configured)
        if (process.env.SMTP_USER) {
            const appUrl = process.env.APP_URL || 'http://localhost:3000';
            const inviteUrl = existingUser 
                ? `${appUrl}?invite=${invitation.id}` 
                : `${appUrl}?invite=${invitation.id}&register=true`;
            
            try {
                await emailTransporter.sendMail({
                    from: process.env.SMTP_FROM || 'noreply@ultistats.app',
                    to: email,
                    subject: `You've been invited to join ${team.name} on UltiStats`,
                    html: `
                        <h2>Team Invitation</h2>
                        <p>${req.user.name} has invited you to join <strong>${team.name}</strong> as a ${role}.</p>
                        <p><a href="${inviteUrl}" style="display: inline-block; padding: 12px 24px; background: #8B5CF6; color: white; text-decoration: none; border-radius: 8px;">
                            ${existingUser ? 'Accept Invitation' : 'Create Account & Join'}
                        </a></p>
                        <p>This invitation expires in 7 days.</p>
                    `
                });
                invitation.emailSent = true;
            } catch (emailError) {
                console.error('Failed to send invitation email:', emailError);
                invitation.emailSent = false;
            }
        }
        
        res.status(201).json({
            message: existingUser 
                ? 'Invitation sent! User has an existing account.' 
                : 'Invitation sent! User will need to create an account.',
            invitation,
            existingUser: !!existingUser
        });
        
    } catch (error) {
        console.error('Invite error:', error);
        res.status(500).json({ error: 'Server error sending invitation' });
    }
});

// Get pending invitations for current user
app.get('/api/invitations', authenticateToken, (req, res) => {
    const invitations = readData(INVITATIONS_FILE);
    const userInvitations = invitations.filter(i => 
        i.email.toLowerCase() === req.user.email.toLowerCase() && 
        i.status === 'pending'
    );
    res.json(userInvitations);
});

// Accept invitation
app.post('/api/invitations/:id/accept', authenticateToken, (req, res) => {
    const invitations = readData(INVITATIONS_FILE);
    const teams = readData(TEAMS_FILE);
    const users = readData(USERS_FILE);
    
    const inviteIndex = invitations.findIndex(i => i.id === req.params.id);
    
    if (inviteIndex === -1) {
        return res.status(404).json({ error: 'Invitation not found' });
    }
    
    const invitation = invitations[inviteIndex];
    
    // Verify email matches
    if (invitation.email.toLowerCase() !== req.user.email.toLowerCase()) {
        return res.status(403).json({ error: 'This invitation is for a different email' });
    }
    
    if (invitation.status !== 'pending') {
        return res.status(400).json({ error: 'Invitation already processed' });
    }
    
    // Check if expired
    if (new Date(invitation.expiresAt) < new Date()) {
        invitation.status = 'expired';
        writeData(INVITATIONS_FILE, invitations);
        return res.status(400).json({ error: 'Invitation has expired' });
    }
    
    // Add user to team
    const teamIndex = teams.findIndex(t => t.id === invitation.teamId);
    if (teamIndex === -1) {
        return res.status(404).json({ error: 'Team no longer exists' });
    }
    
    teams[teamIndex].members.push({
        userId: req.user.id,
        email: req.user.email,
        name: req.user.name,
        role: invitation.role,
        joinedAt: new Date().toISOString()
    });
    
    // Add team to user's teams
    const userIndex = users.findIndex(u => u.id === req.user.id);
    if (userIndex !== -1) {
        users[userIndex].teams = users[userIndex].teams || [];
        if (!users[userIndex].teams.includes(invitation.teamId)) {
            users[userIndex].teams.push(invitation.teamId);
        }
        writeData(USERS_FILE, users);
    }
    
    // Update invitation status
    invitations[inviteIndex].status = 'accepted';
    invitations[inviteIndex].acceptedAt = new Date().toISOString();
    
    writeData(TEAMS_FILE, teams);
    writeData(INVITATIONS_FILE, invitations);
    
    res.json({ 
        message: 'Successfully joined team',
        team: teams[teamIndex]
    });
});

// Decline invitation
app.post('/api/invitations/:id/decline', authenticateToken, (req, res) => {
    const invitations = readData(INVITATIONS_FILE);
    const inviteIndex = invitations.findIndex(i => i.id === req.params.id);
    
    if (inviteIndex === -1) {
        return res.status(404).json({ error: 'Invitation not found' });
    }
    
    if (invitations[inviteIndex].email.toLowerCase() !== req.user.email.toLowerCase()) {
        return res.status(403).json({ error: 'This invitation is for a different email' });
    }
    
    invitations[inviteIndex].status = 'declined';
    invitations[inviteIndex].declinedAt = new Date().toISOString();
    writeData(INVITATIONS_FILE, invitations);
    
    res.json({ message: 'Invitation declined' });
});

// Removed: /api/auth/check-email endpoint was an email enumeration vector.
// The invitation flow should work without confirming whether an email is registered.

// ==================== PLAYERS API ====================

// GET all players (AppSheet compatible format)
app.get('/api/players', (req, res) => {
    const players = readData(PLAYERS_FILE);
    res.json(players);
});

// GET single player by ID
app.get('/api/players/:id', (req, res) => {
    const players = readData(PLAYERS_FILE);
    const player = players.find(p => p.id === req.params.id);
    if (player) {
        res.json(player);
    } else {
        res.status(404).json({ error: 'Player not found' });
    }
});

// POST create new player
app.post('/api/players', (req, res) => {
    const players = readData(PLAYERS_FILE);
    const newPlayer = {
        id: uuidv4(),
        name: req.body.name,
        number: req.body.number || '',
        position: req.body.position || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    players.push(newPlayer);
    writeData(PLAYERS_FILE, players);
    res.status(201).json(newPlayer);
});

// PUT update player
app.put('/api/players/:id', (req, res) => {
    const players = readData(PLAYERS_FILE);
    const index = players.findIndex(p => p.id === req.params.id);
    if (index !== -1) {
        players[index] = {
            ...players[index],
            ...req.body,
            updatedAt: new Date().toISOString()
        };
        writeData(PLAYERS_FILE, players);
        res.json(players[index]);
    } else {
        res.status(404).json({ error: 'Player not found' });
    }
});

// DELETE player
app.delete('/api/players/:id', (req, res) => {
    const players = readData(PLAYERS_FILE);
    const filtered = players.filter(p => p.id !== req.params.id);
    if (filtered.length < players.length) {
        writeData(PLAYERS_FILE, filtered);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Player not found' });
    }
});

// ==================== TOURNAMENTS API ====================

// GET all tournaments (past tournaments)
app.get('/api/tournaments', (req, res) => {
    const tournaments = readData(TOURNAMENTS_FILE);
    res.json(tournaments);
});

// GET single tournament by ID
app.get('/api/tournaments/:id', (req, res) => {
    const tournaments = readData(TOURNAMENTS_FILE);
    const tournament = tournaments.find(t => t.id === req.params.id);
    if (tournament) {
        res.json(tournament);
    } else {
        res.status(404).json({ error: 'Tournament not found' });
    }
});

// ==================== GAMES API ====================

// GET all games
app.get('/api/games', (req, res) => {
    const games = readData(GAMES_FILE);
    res.json(games);
});

// GET single game by ID
app.get('/api/games/:id', (req, res) => {
    const games = readData(GAMES_FILE);
    const game = games.find(g => g.id === req.params.id);
    if (game) {
        res.json(game);
    } else {
        res.status(404).json({ error: 'Game not found' });
    }
});

// POST create new game
app.post('/api/games', (req, res) => {
    const games = readData(GAMES_FILE);
    const newGame = {
        id: uuidv4(),
        ourTeam: req.body.ourTeam,
        opponentTeam: req.body.opponentTeam,
        date: req.body.date,
        ourScore: req.body.ourScore || 0,
        opponentScore: req.body.opponentScore || 0,
        status: req.body.status || 'in_progress',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    games.push(newGame);
    writeData(GAMES_FILE, games);
    res.status(201).json(newGame);
});

// PUT update game
app.put('/api/games/:id', (req, res) => {
    const games = readData(GAMES_FILE);
    const index = games.findIndex(g => g.id === req.params.id);
    if (index !== -1) {
        games[index] = {
            ...games[index],
            ...req.body,
            updatedAt: new Date().toISOString()
        };
        writeData(GAMES_FILE, games);
        res.json(games[index]);
    } else {
        res.status(404).json({ error: 'Game not found' });
    }
});

// ==================== PLAYER STATS API ====================

// GET all stats (with optional filters)
app.get('/api/stats', (req, res) => {
    let stats = readData(STATS_FILE);
    
    // Filter by gameId if provided
    if (req.query.gameId) {
        stats = stats.filter(s => s.gameId === req.query.gameId);
    }
    
    // Filter by playerId if provided
    if (req.query.playerId) {
        stats = stats.filter(s => s.playerId === req.query.playerId);
    }
    
    res.json(stats);
});

// GET aggregated stats for a player across all games
app.get('/api/stats/player/:playerId/aggregate', (req, res) => {
    const stats = readData(STATS_FILE);
    const playerStats = stats.filter(s => s.playerId === req.params.playerId);
    
    const aggregate = {
        playerId: req.params.playerId,
        totalGames: new Set(playerStats.map(s => s.gameId)).size,
        totalGoals: playerStats.reduce((sum, s) => sum + (s.goals || 0), 0),
        totalAssists: playerStats.reduce((sum, s) => sum + (s.assists || 0), 0),
        totalBlocks: playerStats.reduce((sum, s) => sum + (s.blocks || 0), 0),
        totalTurnovers: playerStats.reduce((sum, s) => sum + (s.turnovers || 0), 0),
        totalYardsThrown: playerStats.reduce((sum, s) => sum + (s.yardsThrown || 0), 0),
        totalYardsCaught: playerStats.reduce((sum, s) => sum + (s.yardsCaught || 0), 0)
    };
    
    res.json(aggregate);
});

// GET single stat entry
app.get('/api/stats/:id', (req, res) => {
    const stats = readData(STATS_FILE);
    const stat = stats.find(s => s.id === req.params.id);
    if (stat) {
        res.json(stat);
    } else {
        res.status(404).json({ error: 'Stat not found' });
    }
});

// POST create new stat entry
app.post('/api/stats', (req, res) => {
    const stats = readData(STATS_FILE);
    const newStat = {
        id: uuidv4(),
        gameId: req.body.gameId,
        playerId: req.body.playerId,
        playerName: req.body.playerName,
        goals: req.body.goals || 0,
        assists: req.body.assists || 0,
        blocks: req.body.blocks || 0,
        turnovers: req.body.turnovers || 0,
        yardsThrown: req.body.yardsThrown || 0,
        yardsCaught: req.body.yardsCaught || 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    stats.push(newStat);
    writeData(STATS_FILE, stats);
    res.status(201).json(newStat);
});

// PUT update stat entry
app.put('/api/stats/:id', (req, res) => {
    const stats = readData(STATS_FILE);
    const index = stats.findIndex(s => s.id === req.params.id);
    if (index !== -1) {
        stats[index] = {
            ...stats[index],
            ...req.body,
            updatedAt: new Date().toISOString()
        };
        writeData(STATS_FILE, stats);
        res.json(stats[index]);
    } else {
        res.status(404).json({ error: 'Stat not found' });
    }
});

// POST bulk update/create stats (useful for syncing from frontend)
app.post('/api/stats/bulk', (req, res) => {
    const stats = readData(STATS_FILE);
    const { gameId, playerStats } = req.body;
    
    if (!gameId || !playerStats) {
        return res.status(400).json({ error: 'gameId and playerStats required' });
    }
    
    const results = [];
    
    playerStats.forEach(ps => {
        const existingIndex = stats.findIndex(
            s => s.gameId === gameId && s.playerName === ps.playerName
        );
        
        if (existingIndex !== -1) {
            // Update existing
            stats[existingIndex] = {
                ...stats[existingIndex],
                ...ps,
                updatedAt: new Date().toISOString()
            };
            results.push(stats[existingIndex]);
        } else {
            // Create new
            const newStat = {
                id: uuidv4(),
                gameId,
                playerName: ps.playerName,
                goals: ps.goals || 0,
                assists: ps.assists || 0,
                blocks: ps.blocks || 0,
                turnovers: ps.turnovers || 0,
                yardsThrown: ps.yardsThrown || 0,
                yardsCaught: ps.yardsCaught || 0,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            stats.push(newStat);
            results.push(newStat);
        }
    });
    
    writeData(STATS_FILE, stats);
    res.json(results);
});

// ==================== TURNOVERS API ====================

// GET all turnovers
app.get('/api/turnovers', (req, res) => {
    let turnovers = readData(TURNOVERS_FILE);
    
    if (req.query.gameId) {
        turnovers = turnovers.filter(t => t.gameId === req.query.gameId);
    }
    
    if (req.query.type) {
        turnovers = turnovers.filter(t => t.type === req.query.type);
    }
    
    res.json(turnovers);
});

// POST create turnover
app.post('/api/turnovers', (req, res) => {
    const turnovers = readData(TURNOVERS_FILE);
    const newTurnover = {
        id: uuidv4(),
        gameId: req.body.gameId,
        type: req.body.type, // 'our' or 'their'
        fieldX: req.body.fieldX,
        fieldY: req.body.fieldY,
        playerName: req.body.playerName || null,
        description: req.body.description || '',
        createdAt: new Date().toISOString()
    };
    turnovers.push(newTurnover);
    writeData(TURNOVERS_FILE, turnovers);
    res.status(201).json(newTurnover);
});

// ==================== ACTIONS API ====================

// GET all actions (game log)
app.get('/api/actions', (req, res) => {
    let actions = readData(ACTIONS_FILE);
    
    if (req.query.gameId) {
        actions = actions.filter(a => a.gameId === req.query.gameId);
    }
    
    // Sort by timestamp descending
    actions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    // Limit results if specified
    if (req.query.limit) {
        actions = actions.slice(0, parseInt(req.query.limit));
    }
    
    res.json(actions);
});

// POST create action
app.post('/api/actions', (req, res) => {
    const actions = readData(ACTIONS_FILE);
    const newAction = {
        id: uuidv4(),
        gameId: req.body.gameId,
        type: req.body.type, // 'throw', 'score', 'turnover', 'block', etc.
        description: req.body.description,
        thrower: req.body.thrower || null,
        receiver: req.body.receiver || null,
        yards: req.body.yards || 0,
        fieldStartX: req.body.fieldStartX || null,
        fieldStartY: req.body.fieldStartY || null,
        fieldEndX: req.body.fieldEndX || null,
        fieldEndY: req.body.fieldEndY || null,
        timestamp: new Date().toISOString()
    };
    actions.push(newAction);
    writeData(ACTIONS_FILE, actions);
    res.status(201).json(newAction);
});

// ==================== SEASON STATS API (for AppSheet) ====================

// GET season summary for all players
app.get('/api/season/summary', (req, res) => {
    const stats = readData(STATS_FILE);
    const players = readData(PLAYERS_FILE);
    const games = readData(GAMES_FILE);
    
    // Aggregate stats by player
    const playerSummaries = {};
    
    stats.forEach(stat => {
        const playerKey = stat.playerName || stat.playerId;
        if (!playerSummaries[playerKey]) {
            playerSummaries[playerKey] = {
                id: uuidv4(),
                playerName: stat.playerName,
                gamesPlayed: new Set(),
                totalGoals: 0,
                totalAssists: 0,
                totalBlocks: 0,
                totalTurnovers: 0,
                totalYardsThrown: 0,
                totalYardsCaught: 0
            };
        }
        
        playerSummaries[playerKey].gamesPlayed.add(stat.gameId);
        playerSummaries[playerKey].totalGoals += stat.goals || 0;
        playerSummaries[playerKey].totalAssists += stat.assists || 0;
        playerSummaries[playerKey].totalBlocks += stat.blocks || 0;
        playerSummaries[playerKey].totalTurnovers += stat.turnovers || 0;
        playerSummaries[playerKey].totalYardsThrown += stat.yardsThrown || 0;
        playerSummaries[playerKey].totalYardsCaught += stat.yardsCaught || 0;
    });
    
    // Convert to array and calculate derived stats
    const summary = Object.values(playerSummaries).map(p => ({
        id: p.id,
        playerName: p.playerName,
        gamesPlayed: p.gamesPlayed.size,
        totalGoals: p.totalGoals,
        totalAssists: p.totalAssists,
        totalBlocks: p.totalBlocks,
        totalTurnovers: p.totalTurnovers,
        totalYardsThrown: p.totalYardsThrown,
        totalYardsCaught: p.totalYardsCaught,
        totalPoints: p.totalGoals + p.totalAssists,
        avgGoalsPerGame: p.gamesPlayed.size > 0 ? (p.totalGoals / p.gamesPlayed.size).toFixed(2) : 0,
        avgAssistsPerGame: p.gamesPlayed.size > 0 ? (p.totalAssists / p.gamesPlayed.size).toFixed(2) : 0
    }));
    
    res.json(summary);
});

// GET team totals for the season
app.get('/api/season/team', (req, res) => {
    const games = readData(GAMES_FILE);
    const stats = readData(STATS_FILE);
    const turnovers = readData(TURNOVERS_FILE);
    
    const teamStats = {
        id: 'team-season-stats',
        totalGames: games.length,
        totalWins: games.filter(g => g.ourScore > g.opponentScore).length,
        totalLosses: games.filter(g => g.ourScore < g.opponentScore).length,
        totalTies: games.filter(g => g.ourScore === g.opponentScore && g.status === 'completed').length,
        totalPointsScored: games.reduce((sum, g) => sum + (g.ourScore || 0), 0),
        totalPointsAllowed: games.reduce((sum, g) => sum + (g.opponentScore || 0), 0),
        totalTeamGoals: stats.reduce((sum, s) => sum + (s.goals || 0), 0),
        totalTeamAssists: stats.reduce((sum, s) => sum + (s.assists || 0), 0),
        totalTeamBlocks: stats.reduce((sum, s) => sum + (s.blocks || 0), 0),
        totalTeamTurnovers: turnovers.filter(t => t.type === 'our').length,
        totalTurnoversGained: turnovers.filter(t => t.type === 'their').length,
        totalYardsThrown: stats.reduce((sum, s) => sum + (s.yardsThrown || 0), 0),
        totalYardsCaught: stats.reduce((sum, s) => sum + (s.yardsCaught || 0), 0),
        updatedAt: new Date().toISOString()
    };
    
    res.json([teamStats]); // Return as array for AppSheet compatibility
});

// ==================== SYNC ENDPOINT (from frontend) ====================

// POST sync all game data from frontend
app.post('/api/sync', (req, res) => {
    const { game, players, playerStats, teamStats, actions: gameActions, turnovers: gameTurnovers } = req.body;
    
    try {
        // Save/update game
        const games = readData(GAMES_FILE);
        const gameIndex = games.findIndex(g => g.id === game.id);
        if (gameIndex !== -1) {
            games[gameIndex] = { ...games[gameIndex], ...game, updatedAt: new Date().toISOString() };
        } else {
            games.push({ ...game, id: game.id || uuidv4(), createdAt: new Date().toISOString() });
        }
        writeData(GAMES_FILE, games);
        
        // Save/update players
        const existingPlayers = readData(PLAYERS_FILE);
        players.forEach(playerName => {
            if (!existingPlayers.find(p => p.name === playerName)) {
                existingPlayers.push({
                    id: uuidv4(),
                    name: playerName,
                    createdAt: new Date().toISOString()
                });
            }
        });
        writeData(PLAYERS_FILE, existingPlayers);
        
        // Save stats
        const stats = readData(STATS_FILE);
        Object.entries(playerStats).forEach(([playerName, pStats]) => {
            const existingStatIndex = stats.findIndex(
                s => s.gameId === game.id && s.playerName === playerName
            );
            
            const statEntry = {
                gameId: game.id,
                playerName,
                ...pStats,
                updatedAt: new Date().toISOString()
            };
            
            if (existingStatIndex !== -1) {
                stats[existingStatIndex] = { ...stats[existingStatIndex], ...statEntry };
            } else {
                stats.push({ id: uuidv4(), ...statEntry, createdAt: new Date().toISOString() });
            }
        });
        writeData(STATS_FILE, stats);
        
        // Save turnovers
        if (gameTurnovers && gameTurnovers.length > 0) {
            const turnovers = readData(TURNOVERS_FILE);
            gameTurnovers.forEach(t => {
                if (!turnovers.find(existing => existing.id === t.id)) {
                    turnovers.push({ ...t, id: t.id || uuidv4(), gameId: game.id });
                }
            });
            writeData(TURNOVERS_FILE, turnovers);
        }
        
        // Save actions
        if (gameActions && gameActions.length > 0) {
            const actions = readData(ACTIONS_FILE);
            gameActions.forEach(a => {
                if (!actions.find(existing => existing.id === a.id)) {
                    actions.push({ ...a, id: a.id || uuidv4(), gameId: game.id });
                }
            });
            writeData(ACTIONS_FILE, actions);
        }
        
        res.json({ success: true, message: 'Data synced successfully' });
    } catch (error) {
        console.error('Sync error:', error);
        res.status(500).json({ error: 'Sync failed', details: error.message });
    }
});

// ==================== HEALTH CHECK ====================

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        name: 'Ultimate Frisbee Stats API',
        version: '1.0.0',
        endpoints: {
            players: '/api/players',
            games: '/api/games',
            stats: '/api/stats',
            turnovers: '/api/turnovers',
            actions: '/api/actions',
            seasonSummary: '/api/season/summary',
            teamStats: '/api/season/team',
            sync: '/api/sync',
            health: '/api/health'
        },
        appsheetEndpoints: {
            description: 'Use these endpoints in AppSheet as REST data sources',
            players: 'GET /api/players',
            seasonStats: 'GET /api/season/summary',
            teamStats: 'GET /api/season/team',
            games: 'GET /api/games'
        }
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Ultimate Frisbee Stats API running on http://localhost:${PORT}`);
    console.log(`📊 AppSheet-compatible endpoints ready`);
    console.log(`\nAvailable endpoints:`);
    console.log(`  GET  /api/players          - All players`);
    console.log(`  GET  /api/games            - All games`);
    console.log(`  GET  /api/stats            - All stats`);
    console.log(`  GET  /api/season/summary   - Season summary per player`);
    console.log(`  GET  /api/season/team      - Team season totals`);
    console.log(`  POST /api/sync             - Sync from frontend`);
});
