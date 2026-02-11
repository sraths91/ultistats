# UltiStats API

Express.js REST API with SQLite database, JWT authentication, and USAU tournament scraping.

## Quick Start

```bash
cd api
npm install
cp ../.env.example ../.env   # Set JWT_SECRET at minimum
npm run dev                  # Starts with --watch on :3001
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Production server |
| `npm run dev` | Dev server with auto-reload |
| `npm test` | Run integration tests |
| `node seed-demo-team.js` | Seed a demo team with players |
| `node sync-usau.js` | Sync USAU team/tournament registry |

## Dependencies

| Package | Purpose |
|---------|---------|
| express | HTTP framework |
| sqlite3 | SQLite database driver |
| jsonwebtoken | JWT token generation and verification |
| bcryptjs | Password hashing |
| cookie-parser | Parse HttpOnly auth cookies |
| cors | Cross-origin request handling |
| compression | Gzip response compression |
| express-rate-limit | Rate limiting (auth, API, USAU) |
| express-validator | Input validation and sanitization |
| cheerio | HTML parsing for USAU scraping |
| dotenv | Environment variable loading |
| uuid | UUID generation |
| nodemailer | Email sending (invitations, password reset) |

## Architecture

### Middleware Stack

Request processing order:
1. Compression
2. Security headers (CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy)
3. CORS (origin allowlist from `CLIENT_URL`)
4. Cookie parser
5. Body parser (JSON + URL-encoded, 2MB limit)
6. Rate limiters (auth: 20/15min, general: 100/min, USAU: 10/min)
7. CSRF validation (double-submit cookie, exempts auth endpoints)

### Authentication

- JWT stored in HttpOnly cookie (`ultistats_token`)
- `extractToken(req)` checks cookie first, falls back to Authorization header
- `authenticateToken` middleware — required auth, returns 401/403
- `optionalAuth` middleware — attaches user if token present, continues if not

### Authorization

Three helper functions for route-level access control:
- `requireTeamMember(req, res, teamId)` — verifies user is a team member
- `requireTeamOwner(req, res, teamId)` — verifies user owns the team
- `requireGameAccess(req, res, gameId)` — verifies user is a member of the game's team

Each returns the resource on success or sends an error response and returns `null`.

### CSRF Protection

Double-submit cookie pattern:
- Server sets `ultistats_csrf` cookie (readable by JS) on login/register and GET requests
- Client reads cookie and sends value as `X-CSRF-Token` header on POST/PUT/DELETE
- Server compares cookie value against header value
- Exempted: `/auth/login`, `/auth/register`, `/auth/forgot-password`, `/auth/logout`

### Database

SQLite via `database.js` ORM layer. Schema auto-initializes on first start from `db/schema.sql` (17 tables). Migrations for new columns run automatically.

Tables: users, teams, team_members, roster, invitations, games, player_game_stats, game_actions, tournaments, career_stats, shared_tournaments, tournament_team_links, usau_teams, usau_tournaments, usau_tournament_teams, usau_matchups, user_team_claims, sync_log.

## Testing

```bash
npm test
```

Tests use Node.js built-in `node --test` runner with `--test-concurrency=1`. Each test file creates a fresh in-memory SQLite database. No external services required.

Test files:
- `tests/auth.test.cjs` — registration, login, profile, password reset
- `tests/teams.test.cjs` — CRUD, roster, invitations, authorization
- `tests/games.test.cjs` — CRUD, end game, stats sync
- `tests/health.test.cjs` — health check endpoint
