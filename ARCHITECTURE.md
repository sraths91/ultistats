# UltiStats Architecture

## Overview

UltiStats has two JavaScript layers: a monolithic `script.js` game engine loaded by `game.html` and `testgame.html`, and an ES module layer under `src/js/` used by other pages (dashboard, login, tournament, etc.). Both layers share the same Express API server backed by SQLite.

## Project Structure

```
ultistats/
├── index.html                  # Login / registration page
├── dashboard.html              # Team dashboard
├── game.html                   # Game tracking (loads script.js)
├── testgame.html               # Demo game with pre-loaded roster
├── tournament.html             # USAU tournament view
├── league.html                 # League standings
├── season.html                 # Season stats
├── player-profile.html         # Individual player profile
├── game-test.html              # Game testing page
├── script.js                   # Game engine (~10,900 lines)
├── styles.css                  # Custom CSS + outdoor mode + analysis panel
├── config.js                   # Client-side config loader (fetches /config.json)
├── sw.js                       # Service worker (network-first + stale-while-revalidate)
├── manifest.json               # PWA manifest
├── vite.config.js              # Build config (5 HTML entry points + static file copy)
├── icons/
│   └── icon-192.svg            # PWA icon
├── src/
│   ├── js/
│   │   ├── index.js            # Re-exports all modules
│   │   ├── constants.js        # GAME_CONSTANTS, STORAGE_KEYS, API_CONFIG, ROUTES, etc.
│   │   ├── api.js              # apiRequest() with CSRF + HttpOnly cookie credentials
│   │   ├── storage.js          # LocalStorage wrapper with typed getters/setters
│   │   ├── auth.js             # Login/register/logout flows
│   │   ├── game.js             # Game state helpers
│   │   ├── stats.js            # Stat calculations (distance, endzone, leaderboards)
│   │   ├── ui.js               # Toast, modals, haptics, loading states
│   │   ├── utils.js            # UUID, debounce, deepClone, date formatting
│   │   └── pages/
│   │       ├── dashboard.js    # Dashboard page logic
│   │       ├── game.js         # Game page module bridge
│   │       └── login.js        # Login page logic
│   └── tests/
│       ├── stats.test.cjs      # Stats module unit tests
│       └── utils.test.cjs      # Utils module unit tests
├── api/
│   ├── server-sqlite.js        # Express API server (SQLite backend)
│   ├── server-legacy.js        # Legacy JSON file server (deprecated)
│   ├── db/
│   │   ├── database.js         # SQLite ORM (getTeamById, createGame, etc.)
│   │   └── schema.sql          # 17 tables + indexes
│   ├── lib/
│   │   └── usau-scraper.js     # Cheerio-based USAU page parser
│   ├── data/                   # Sample/seed data (JSON files)
│   │   ├── actions/            # Per-game action logs (19 games)
│   │   └── *.json              # games, players, teams, etc.
│   ├── seed-demo-team.js       # Demo team seeder
│   ├── sync-usau.js            # USAU registry sync script
│   ├── tests/
│   │   ├── helpers.cjs         # Test utilities (createTestApp, etc.)
│   │   ├── auth.test.cjs       # Auth endpoint tests
│   │   ├── teams.test.cjs      # Teams endpoint tests
│   │   ├── games.test.cjs      # Games endpoint tests
│   │   └── health.test.cjs     # Health check test
│   └── package.json
├── .env.example                # Environment variable template
├── .github/workflows/ci.yml   # CI: test + build on Node 20/22
└── package.json                # Root: vite dev/build + test scripts
```

## Frontend Architecture

### script.js (Game Engine)

The main game tracking logic lives in a single `script.js` file. Key subsystems:

| Section | Responsibility |
|---------|---------------|
| Game state (`gameState`) | Score, point number, on-field players, player stats, actions log |
| Field interaction | SVG tap handling, disc marker, throw lines, yardage calculation |
| Progressive stat entry | `_throwConnections` (thrower→receiver frequency), `_recentFieldPlayers` (MRU ordering) |
| Point tracking | `_pointHistory[]` — line composition and outcome per point |
| Line selection | Sort modes (alphabetical, position, playing-time, +/-, predictive) |
| Live analysis | `computePairingStats()`, `computeLineStats()`, `computePlayerImpact()` with tabbed UI |
| Undo system | Action state stack with full rollback |
| Outdoor mode | Toggles `body.outdoor-mode` class for high-contrast CSS |
| Storage | LocalStorage persistence for game state, roster, stats, settings |

### ES Module Layer (src/js/)

Used by non-game pages. Each module is independently importable:

- **api.js** — `apiRequest()` wraps `fetch()` with `credentials: 'include'`, automatic CSRF token header for non-GET methods, and standardized `{ ok, data, error }` response format.
- **storage.js** — JSON-safe `getItem()`/`setItem()` with typed functions for each data domain (auth, game, roster, stats, teams, settings).
- **constants.js** — All magic values in one place. `API_CONFIG` reads from `window.ULTISTATS_CONFIG` (set by `config.js`).

### Authentication Flow

1. User registers or logs in via `/api/auth/register` or `/api/auth/login`
2. Server sets `ultistats_token` HttpOnly cookie + `ultistats_csrf` readable cookie
3. All subsequent requests include cookies automatically (`credentials: 'include'`)
4. State-changing requests (POST/PUT/DELETE) read the CSRF cookie and send it as `X-CSRF-Token` header
5. Server validates CSRF cookie matches header (double-submit pattern)
6. Logout clears the cookie via `/api/auth/logout`

Client-side auth state stores only the user object in LocalStorage (no token).

## API Architecture

### Middleware Stack (in order)

1. `compression()` — gzip responses
2. Security headers — CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy
3. `cors()` — origin allowlist from `CLIENT_URL` env var
4. `cookieParser()` — parse cookies for JWT extraction
5. `express.json()` / `express.urlencoded()` — body parsing (2MB limit)
6. Rate limiters — auth (20/15min), general API (100/min), USAU (10/min)
7. CSRF protection — double-submit cookie validation (exempts login/register/forgot-password/logout)
8. `authenticateToken` / `optionalAuth` — JWT verification per-route

### Authorization Helpers

Three reusable functions enforce access control:
- `requireTeamMember(req, res, teamId)` — returns team or sends 403
- `requireTeamOwner(req, res, teamId)` — returns team or sends 403
- `requireGameAccess(req, res, gameId)` — looks up game → team → membership

### Database

SQLite with 17 tables organized into:
- **Core**: users, teams, team_members, roster, invitations
- **Games**: games, player_game_stats, game_actions, career_stats
- **Tournaments**: tournaments, shared_tournaments, tournament_team_links
- **USAU Registry**: usau_teams, usau_tournaments, usau_tournament_teams, usau_matchups, user_team_claims, sync_log

The `database.js` module provides a promise-based API over `sqlite3`, auto-initializes schema on first run, and runs migrations for new columns.

## Testing

- **Frontend**: `src/tests/*.test.cjs` — pure unit tests for stats calculations and utility functions
- **API**: `api/tests/*.test.cjs` — integration tests using `supertest` against in-memory SQLite; each test file gets a fresh database

All tests use Node.js built-in `node --test` runner. CI runs on Node 20 and 22 via GitHub Actions.

## Build

Vite handles the build:
- Entry points: index.html, dashboard.html, game.html, league.html, tournament.html
- A custom plugin copies `script.js`, `sw.js`, `manifest.json`, `config.js` to `dist/`
- Dev server on port 3000 proxies `/api` to `localhost:3001`
