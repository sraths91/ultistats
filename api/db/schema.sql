-- UltiStats Database Schema
-- SQLite Database

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    reset_token TEXT,
    reset_token_expires DATETIME
);

-- Teams table
CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Team members (many-to-many relationship)
CREATE TABLE IF NOT EXISTS team_members (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'coach',
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(team_id, user_id)
);

-- Team roster (players on a team)
CREATE TABLE IF NOT EXISTS roster (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    player_name TEXT NOT NULL,
    jersey_number INTEGER,
    position TEXT DEFAULT 'Hybrid',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    UNIQUE(team_id, player_name)
);

-- Invitations
CREATE TABLE IF NOT EXISTS invitations (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'coach',
    invited_by TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE CASCADE
);

-- Games
CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    opponent_name TEXT NOT NULL,
    game_date DATE NOT NULL,
    our_score INTEGER DEFAULT 0,
    opponent_score INTEGER DEFAULT 0,
    tournament_id TEXT,
    location TEXT,
    notes TEXT,
    is_complete INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE SET NULL
);

-- Player stats per game
CREATE TABLE IF NOT EXISTS player_game_stats (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    player_name TEXT NOT NULL,
    goals INTEGER DEFAULT 0,
    assists INTEGER DEFAULT 0,
    hockey_assists INTEGER DEFAULT 0,
    blocks INTEGER DEFAULT 0,
    turnovers INTEGER DEFAULT 0,
    yards_thrown INTEGER DEFAULT 0,
    yards_caught INTEGER DEFAULT 0,
    throws INTEGER DEFAULT 0,
    catches INTEGER DEFAULT 0,
    points_played INTEGER DEFAULT 0,
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

-- Game actions (detailed action log)
CREATE TABLE IF NOT EXISTS game_actions (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    player_name TEXT,
    target_player TEXT,
    position_x REAL,
    position_y REAL,
    distance INTEGER,
    point_number INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    metadata TEXT,
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

-- Tournaments
CREATE TABLE IF NOT EXISTS tournaments (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    name TEXT NOT NULL,
    start_date DATE,
    end_date DATE,
    location TEXT,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
);

-- Career stats (aggregated per team/player)
CREATE TABLE IF NOT EXISTS career_stats (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    player_name TEXT NOT NULL,
    total_games INTEGER DEFAULT 0,
    goals INTEGER DEFAULT 0,
    assists INTEGER DEFAULT 0,
    hockey_assists INTEGER DEFAULT 0,
    blocks INTEGER DEFAULT 0,
    turnovers INTEGER DEFAULT 0,
    yards_thrown INTEGER DEFAULT 0,
    yards_caught INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    UNIQUE(team_id, player_name)
);

-- Shared tournaments (USAU tournaments shared across coaches)
CREATE TABLE IF NOT EXISTS shared_tournaments (
    id TEXT PRIMARY KEY,
    usau_url TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    competition_level TEXT,
    gender_division TEXT,
    format TEXT DEFAULT 'pool-to-bracket',
    pools_json TEXT,            -- JSON: pool structure
    standings_json TEXT,        -- JSON: current standings
    matchups_json TEXT,         -- JSON: all matchups
    teams_json TEXT,            -- JSON: all teams in tournament
    imported_by TEXT,           -- User who first imported
    imported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_updated DATETIME,
    FOREIGN KEY (imported_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Links between user teams and shared tournaments
CREATE TABLE IF NOT EXISTS tournament_team_links (
    id TEXT PRIMARY KEY,
    tournament_id TEXT NOT NULL,
    team_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    team_name TEXT NOT NULL,    -- USAU team name (for matching)
    pool_name TEXT,
    linked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tournament_id) REFERENCES shared_tournaments(id) ON DELETE CASCADE,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(tournament_id, team_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_roster_team ON roster(team_id);
CREATE INDEX IF NOT EXISTS idx_games_team ON games(team_id);
CREATE INDEX IF NOT EXISTS idx_games_date ON games(game_date);
CREATE INDEX IF NOT EXISTS idx_player_stats_game ON player_game_stats(game_id);
CREATE INDEX IF NOT EXISTS idx_game_actions_game ON game_actions(game_id);
CREATE INDEX IF NOT EXISTS idx_tournaments_team ON tournaments(team_id);
CREATE INDEX IF NOT EXISTS idx_career_stats_team ON career_stats(team_id);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);
CREATE INDEX IF NOT EXISTS idx_invitations_team ON invitations(team_id);
CREATE INDEX IF NOT EXISTS idx_shared_tournaments_url ON shared_tournaments(usau_url);
CREATE INDEX IF NOT EXISTS idx_tournament_links_tournament ON tournament_team_links(tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_links_user ON tournament_team_links(user_id);
CREATE INDEX IF NOT EXISTS idx_tournament_links_team ON tournament_team_links(team_id);

-- ==================== USAU REGISTRY TABLES ====================

-- USAU Team Registry (synced from rankings)
CREATE TABLE IF NOT EXISTS usau_teams (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    division TEXT NOT NULL,
    region TEXT,
    conference TEXT,
    ranking INTEGER,
    rating REAL,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    usau_url TEXT,
    last_synced DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- USAU Tournament Registry (synced from event listings)
CREATE TABLE IF NOT EXISTS usau_tournaments (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    usau_url TEXT NOT NULL,
    start_date DATE,
    end_date DATE,
    location TEXT,
    competition_level TEXT,
    gender_division TEXT,
    schedule_url TEXT,
    team_count INTEGER DEFAULT 0,
    last_synced DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Teams in a tournament (junction table)
CREATE TABLE IF NOT EXISTS usau_tournament_teams (
    tournament_slug TEXT NOT NULL,
    team_slug TEXT,
    team_name TEXT NOT NULL,
    pool TEXT,
    seed INTEGER,
    usau_team_url TEXT,
    PRIMARY KEY (tournament_slug, team_name),
    FOREIGN KEY (tournament_slug) REFERENCES usau_tournaments(slug) ON DELETE CASCADE
);

-- Matchups from tournament games
CREATE TABLE IF NOT EXISTS usau_matchups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_slug TEXT NOT NULL,
    home_team TEXT NOT NULL,
    away_team TEXT NOT NULL,
    home_score INTEGER DEFAULT 0,
    away_score INTEGER DEFAULT 0,
    round TEXT,
    status TEXT DEFAULT 'scheduled',
    FOREIGN KEY (tournament_slug) REFERENCES usau_tournaments(slug) ON DELETE CASCADE
);

-- User team claims (connects app users to registry teams)
CREATE TABLE IF NOT EXISTS user_team_claims (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    team_slug TEXT NOT NULL,
    app_team_id TEXT,
    role TEXT DEFAULT 'coach',
    claimed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (team_slug) REFERENCES usau_teams(slug) ON DELETE CASCADE,
    UNIQUE(user_id, team_slug)
);

-- Sync log (tracks sync runs)
CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sync_type TEXT NOT NULL,
    division TEXT,
    status TEXT DEFAULT 'running',
    teams_synced INTEGER DEFAULT 0,
    tournaments_synced INTEGER DEFAULT 0,
    matchups_synced INTEGER DEFAULT 0,
    error_message TEXT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
);

-- Indexes for registry tables
CREATE INDEX IF NOT EXISTS idx_usau_teams_division ON usau_teams(division);
CREATE INDEX IF NOT EXISTS idx_usau_teams_name ON usau_teams(name);
CREATE INDEX IF NOT EXISTS idx_usau_tournaments_level ON usau_tournaments(competition_level);
CREATE INDEX IF NOT EXISTS idx_usau_tournament_teams_tournament ON usau_tournament_teams(tournament_slug);
CREATE INDEX IF NOT EXISTS idx_usau_matchups_tournament ON usau_matchups(tournament_slug);
CREATE INDEX IF NOT EXISTS idx_user_team_claims_user ON user_team_claims(user_id);
CREATE INDEX IF NOT EXISTS idx_user_team_claims_team ON user_team_claims(team_slug);
