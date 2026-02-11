# UltiStats

Real-time ultimate frisbee stat tracking with interactive field visualization, live analysis, and USAU tournament integration. Built as a mobile-first PWA for sideline use on phones and tablets.

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/sraths91/ultistats.git
cd ultistats
npm install
cd api && npm install && cd ..

# 2. Configure environment
cp .env.example .env
# Edit .env — at minimum, set a strong JWT_SECRET:
#   node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# 3. Run (two terminals)
cd api && npm run dev     # API server on :3001
npm run dev               # Vite dev server on :3000
```

Open `http://localhost:3000` in your browser. The Vite dev server proxies `/api` requests to the API server automatically.

## Features

### Game Tracking
- **Interactive field** — tap to record throws, catches, turnovers, blocks, and scores with automatic yardage calculation
- **7-player line selection** with sort modes: alphabetical, position, playing time, +/-, and predictive "Best Fit"
- **Undo system** — revert any action with full state rollback
- **Outdoor mode** — high-contrast UI for bright sunlight
- **Haptic feedback** — vibration patterns for different events on mobile

### Live Analysis
In-game analysis panel (violet bar-chart button) with three views:
- **Pairings** — top thrower-to-receiver connections with completion counts and goals scored
- **Lines** — performance of each unique 7-player combination (points played, scored, allowed, +/-)
- **Player Impact** — per-player +/-, offensive rating, defensive rating, and completion percentage

### USAU Integration
- Search USAU team/tournament registry
- Import rosters from USAU team pages
- Pull pool play results and bracket data
- Auto-sync tournament standings

### Multi-User & Teams
- User registration and authentication (JWT via HttpOnly cookies)
- Create teams, manage rosters, invite coaches
- Per-team game history and career stats

### Progressive Web App
- Installable on iOS and Android home screens
- Offline-capable via service worker (network-first for API/code, stale-while-revalidate for assets)
- Works in landscape and portrait

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JS, Tailwind CSS (CDN), Lucide icons, SVG field |
| Build | Vite |
| API | Express.js (Node.js) |
| Database | SQLite via `sqlite3` |
| Auth | JWT (HttpOnly cookies), bcrypt, CSRF double-submit |
| Testing | Node.js built-in test runner (`node --test`) |
| CI | GitHub Actions (Node 20 + 22) |

## Project Structure

```
ultistats/
├── index.html              # Login / registration
├── dashboard.html          # Team dashboard
├── game.html               # Game tracking (main app)
├── testgame.html           # Demo game with pre-loaded roster
├── tournament.html         # USAU tournament view
├── league.html             # League standings
├── season.html             # Season stats
├── player-profile.html     # Individual player stats
├── script.js               # Game engine (~10,900 lines)
├── styles.css              # Custom styles + outdoor mode
├── config.js               # Client-side config loader
├── sw.js                   # Service worker
├── manifest.json           # PWA manifest
├── vite.config.js          # Vite build config
├── src/js/                 # ES module layer
│   ├── constants.js        # App constants and config
│   ├── api.js              # API client (fetch + CSRF)
│   ├── storage.js          # LocalStorage wrapper
│   ├── auth.js             # Auth flows
│   ├── game.js             # Game state helpers
│   ├── stats.js            # Stat calculations
│   ├── ui.js               # Toast, modals, haptics
│   ├── utils.js            # General utilities
│   └── pages/              # Page-specific modules
├── api/
│   ├── server-sqlite.js    # Express API server
│   ├── db/
│   │   ├── database.js     # SQLite ORM layer
│   │   └── schema.sql      # 17 tables + indexes
│   ├── lib/
│   │   └── usau-scraper.js # USAU page parser
│   ├── tests/              # API integration tests
│   └── package.json
├── .env.example            # Environment template
├── .github/workflows/ci.yml
└── package.json
```

## Environment Variables

Copy `.env.example` to `.env`. Required variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_SECRET` | Yes | Random 64+ byte hex string for signing tokens |
| `PORT` | No | API server port (default: 3001) |
| `NODE_ENV` | No | `development` or `production` |
| `DATABASE_URL` | No | SQLite path (default: `./api/db/ultistats.db`) |
| `CLIENT_URL` | No | Comma-separated CORS origins (default: `http://localhost:3000,http://localhost:3001`) |
| `JWT_EXPIRES_IN` | No | Token lifetime (default: `7d`) |
| `GOOGLE_CLIENT_ID` | No | For Google Sheets export |
| `GOOGLE_API_KEY` | No | For Google Sheets export |
| `SMTP_HOST` | No | For email invitations |
| `SMTP_USER` | No | SMTP username |
| `SMTP_PASS` | No | SMTP password |

## API Endpoints

All endpoints are prefixed with `/api`. Auth-required routes use HttpOnly JWT cookies.

### Auth
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/register` | No | Create account |
| POST | `/auth/login` | No | Login (sets cookie) |
| GET | `/auth/me` | Yes | Get profile |
| POST | `/auth/logout` | No | Clear cookie |
| POST | `/auth/forgot-password` | No | Request reset |

### Teams
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/teams` | Yes | List user's teams |
| POST | `/teams` | Yes | Create team |
| GET | `/teams/:id` | Yes | Get team details |
| PUT | `/teams/:id` | Owner | Update team |
| DELETE | `/teams/:id` | Owner | Delete team |
| PUT | `/teams/:id/roster` | Owner | Update roster |
| POST | `/teams/:id/invite` | Owner | Invite coach |

### Games
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/teams/:id/games` | Member | List games |
| POST | `/teams/:id/games` | Member | Create game |
| PUT | `/games/:id` | Member | Update game |
| POST | `/games/:id/end` | Member | End game + save stats |

### Stats
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/teams/:id/stats` | Member | Get team stats |
| POST | `/teams/:id/stats/sync` | Member | Sync game stats |

### Invitations
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/invitations/pending` | Yes | List pending |
| POST | `/invitations/:id/accept` | Yes | Accept |
| POST | `/invitations/:id/decline` | Yes | Decline |

### USAU
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/usau/search-teams` | Optional | Search USAU teams |
| GET | `/usau/team?url=` | Optional | Scrape team roster |
| GET | `/usau/tournament?url=` | Optional | Tournament details |
| GET | `/usau/tournament/pools?url=` | Optional | Pool play results |
| GET | `/usau/tournament/bracket?url=` | Optional | Bracket results |

## Testing

```bash
# Frontend unit tests (51 tests)
npm test

# API integration tests (39 tests)
npm run test:api

# All tests
npm run test:all
```

Tests use Node.js built-in test runner — no additional test framework needed. API tests run against an in-memory SQLite database.

## Building for Production

```bash
npm run build
```

Outputs to `dist/`. The Vite build bundles HTML pages and ES modules. Static files (`script.js`, `sw.js`, `manifest.json`, `config.js`) are copied automatically.

To serve in production, deploy the `dist/` folder behind a static file server and run the API server separately:

```bash
cd api && NODE_ENV=production npm start
```

## Security

The application includes:
- **HttpOnly JWT cookies** — tokens are not accessible to JavaScript
- **CSRF protection** — double-submit cookie pattern on all state-changing requests
- **Content Security Policy** — restricts script, style, font, and connection sources
- **Rate limiting** — 20 req/15min on auth, 100 req/min general, 10 req/min USAU scraping
- **Authorization checks** — team membership/ownership verified on all protected routes
- **Input validation** — express-validator on all user inputs
- **SRI hashes** — subresource integrity on pinned CDN scripts
- **SSRF prevention** — USAU scraping URLs validated against allowlist
- **XSS prevention** — `escapeHtml()` on all user-controlled content in innerHTML

## License

MIT
