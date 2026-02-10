# UltiStats Architecture

This document describes the modular architecture of the UltiStats application.

## Project Structure

```
windsurf-project-5/
├── src/
│   ├── js/                    # Modular JavaScript source
│   │   ├── index.js           # Main entry point, exports all modules
│   │   ├── constants.js       # Game constants and configuration
│   │   ├── storage.js         # LocalStorage management
│   │   ├── api.js             # API communication layer
│   │   ├── ui.js              # UI utilities and components
│   │   ├── stats.js           # Statistics calculations
│   │   ├── auth.js            # Authentication module
│   │   ├── game.js            # Game state and field interactions
│   │   └── utils.js           # General utilities
│   └── tests/                 # Unit tests
│       ├── stats.test.js
│       └── utils.test.js
├── api/
│   ├── db/
│   │   ├── database.js        # SQLite database module
│   │   ├── schema.sql         # Database schema
│   │   └── ultistats.db       # SQLite database file (generated)
│   ├── server-sqlite.js       # New SQLite-based server
│   ├── server.js              # Legacy JSON-based server
│   └── package.json
├── config.js                  # Client-side configuration loader
├── script.js                  # Legacy monolithic script (kept for compatibility)
├── .env.example               # Environment variables template
├── .gitignore
└── [HTML files]
```

## Modules

### constants.js
Central location for all application constants:
- `GAME_CONSTANTS` - Field dimensions, max players, etc.
- `STORAGE_KEYS` - LocalStorage key names
- `POSITIONS` - Player positions
- `HAPTIC_PATTERNS` - Vibration patterns
- `API_CONFIG` - API endpoint configuration
- `ROUTES` - Application routes

### storage.js
Wrapper for LocalStorage with JSON serialization:
- Safe get/set with error handling
- Typed functions for each data type (auth, game, roster, stats, etc.)
- Data migration utilities

### api.js
API communication layer:
- Centralized request handling
- Automatic auth header injection
- Error handling and response normalization
- Functions for all API endpoints (auth, teams, games, stats, tournaments)

### ui.js
UI utilities and components:
- Toast notifications
- Loading states
- Haptic feedback
- Sound effects
- Modal dialogs (confirm, input)
- DOM utilities

### stats.js
Statistics calculations:
- Player/team stats creation
- Distance calculations
- Endzone detection
- Leaderboards
- Win/loss records
- Aggregations

### auth.js
Authentication module:
- Login/logout/register
- Token management
- Team selection
- Invitation handling

### game.js
Game state management:
- Point tracking
- Player management (on-field, attendance)
- Action recording (throws, goals, turnovers, blocks)
- Undo functionality
- State persistence

### utils.js
General utilities:
- UUID generation
- Debounce/throttle
- Deep clone
- Date formatting
- JSON parsing
- Event emitter

## Database

### SQLite Schema
The application now uses SQLite for data persistence:

- **users** - User accounts
- **teams** - Team information
- **team_members** - Team membership (many-to-many)
- **roster** - Player roster per team
- **invitations** - Team invitations
- **games** - Game records
- **player_game_stats** - Per-game player statistics
- **game_actions** - Detailed action log
- **tournaments** - Tournament records
- **career_stats** - Aggregated career statistics

### Migration from JSON
To migrate from JSON files to SQLite:
1. Install dependencies: `cd api && npm install`
2. Start the new server: `npm start`
3. The schema will be automatically created
4. Import existing data using the provided migration scripts

## Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
# Server
PORT=3001
JWT_SECRET=your-secret-key

# Database
DATABASE_URL=./api/db/ultistats.db

# Email (for invitations)
SMTP_HOST=smtp.gmail.com
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# Google API (for Sheets integration)
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_API_KEY=your-api-key
```

## Testing

Run tests with Node.js built-in test runner:

```bash
# Run all tests
node --test src/tests/

# Run specific test file
node --test src/tests/stats.test.js
```

## Usage

### With ES Modules (Modern Browsers)
```html
<script type="module">
import { showToast, getGameState, recordGoal } from './src/js/index.js';

// Use imported functions
showToast('Game started!');
</script>
```

### With Legacy Script
The original `script.js` remains available for backwards compatibility:
```html
<script src="script.js?v=19"></script>
```

### With Build Tool (Recommended)
For production, use a bundler like Vite:
```bash
npm install vite
npx vite build
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/me` - Get current user
- `POST /api/auth/forgot-password` - Request password reset

### Teams
- `GET /api/teams` - Get user's teams
- `POST /api/teams` - Create team
- `GET /api/teams/:id` - Get team details
- `PUT /api/teams/:id` - Update team
- `DELETE /api/teams/:id` - Delete team
- `PUT /api/teams/:id/roster` - Update roster
- `POST /api/teams/:id/invite` - Invite user

### Games
- `GET /api/teams/:id/games` - Get team's games
- `POST /api/teams/:id/games` - Create game
- `PUT /api/games/:id` - Update game
- `POST /api/games/:id/end` - End game with final stats

### Stats
- `GET /api/teams/:id/stats` - Get team statistics
- `POST /api/teams/:id/stats/sync` - Sync stats

### Invitations
- `GET /api/invitations/pending` - Get pending invitations
- `POST /api/invitations/:id/accept` - Accept invitation
- `POST /api/invitations/:id/decline` - Decline invitation

## Best Practices

1. **Use constants** - Import from `constants.js` instead of hardcoding values
2. **Handle errors** - Use try/catch and the API error responses
3. **Save state** - Call storage functions after state changes
4. **Type hints** - Use JSDoc comments for better IDE support
5. **Test** - Write tests for new functionality
