# Ultimate Frisbee Stats API

REST API for Ultimate Frisbee Stats Tracker with AppSheet integration support.

## Quick Start

```bash
cd api
npm install
npm start
```

The API will run on `http://localhost:3001`

## AppSheet Integration

### Setting Up AppSheet Data Source

1. In AppSheet, go to **Data** > **+ New Data Source** > **REST API**
2. Use the following endpoints as your data sources:

| Data Type | Endpoint URL | Method |
|-----------|--------------|--------|
| Players | `http://YOUR_SERVER/api/players` | GET |
| Season Stats | `http://YOUR_SERVER/api/season/summary` | GET |
| Team Stats | `http://YOUR_SERVER/api/season/team` | GET |
| Games | `http://YOUR_SERVER/api/games` | GET |
| All Stats | `http://YOUR_SERVER/api/stats` | GET |

### Data Schema for AppSheet

#### Players Table
| Column | Type | Description |
|--------|------|-------------|
| id | Text | Unique identifier |
| name | Text | Player name |
| number | Text | Jersey number |
| position | Text | Player position |
| createdAt | DateTime | Creation timestamp |

#### Season Summary Table
| Column | Type | Description |
|--------|------|-------------|
| id | Text | Unique identifier |
| playerName | Text | Player name |
| gamesPlayed | Number | Total games played |
| totalGoals | Number | Season total goals |
| totalAssists | Number | Season total assists |
| totalBlocks | Number | Season total blocks |
| totalTurnovers | Number | Season total turnovers |
| totalYardsThrown | Number | Season total yards thrown |
| totalYardsCaught | Number | Season total yards caught |
| totalPoints | Number | Goals + Assists |
| avgGoalsPerGame | Decimal | Average goals per game |
| avgAssistsPerGame | Decimal | Average assists per game |

#### Team Stats Table
| Column | Type | Description |
|--------|------|-------------|
| id | Text | Unique identifier |
| totalGames | Number | Total games played |
| totalWins | Number | Total wins |
| totalLosses | Number | Total losses |
| totalPointsScored | Number | Total points scored |
| totalPointsAllowed | Number | Total points allowed |
| totalTeamGoals | Number | Total team goals |
| totalTeamAssists | Number | Total team assists |
| totalTeamBlocks | Number | Total team blocks |
| totalTeamTurnovers | Number | Total turnovers committed |
| totalTurnoversGained | Number | Total turnovers gained |

#### Games Table
| Column | Type | Description |
|--------|------|-------------|
| id | Text | Unique identifier |
| ourTeam | Text | Our team name |
| opponentTeam | Text | Opponent team name |
| date | Date | Game date |
| ourScore | Number | Our score |
| opponentScore | Number | Opponent score |
| status | Text | Game status |

## API Endpoints

### Players

```
GET    /api/players          - Get all players
GET    /api/players/:id      - Get single player
POST   /api/players          - Create player
PUT    /api/players/:id      - Update player
DELETE /api/players/:id      - Delete player
```

### Games

```
GET    /api/games            - Get all games
GET    /api/games/:id        - Get single game
POST   /api/games            - Create game
PUT    /api/games/:id        - Update game
```

### Stats

```
GET    /api/stats            - Get all stats (filter: ?gameId=X&playerId=Y)
GET    /api/stats/:id        - Get single stat entry
POST   /api/stats            - Create stat entry
PUT    /api/stats/:id        - Update stat entry
POST   /api/stats/bulk       - Bulk update stats for a game
```

### Season Data (Best for AppSheet)

```
GET    /api/season/summary   - Aggregated season stats per player
GET    /api/season/team      - Team season totals
```

### Turnovers

```
GET    /api/turnovers        - Get all turnovers (filter: ?gameId=X&type=our|their)
POST   /api/turnovers        - Record turnover
```

### Actions (Game Log)

```
GET    /api/actions          - Get actions (filter: ?gameId=X&limit=N)
POST   /api/actions          - Record action
```

### Sync (From Frontend)

```
POST   /api/sync             - Sync all game data from frontend
```

## Example Requests

### Create a Player
```bash
curl -X POST http://localhost:3001/api/players \
  -H "Content-Type: application/json" \
  -d '{"name": "John Smith", "number": "7", "position": "Handler"}'
```

### Create a Game
```bash
curl -X POST http://localhost:3001/api/games \
  -H "Content-Type: application/json" \
  -d '{"ourTeam": "Thunder", "opponentTeam": "Lightning", "date": "2026-01-15"}'
```

### Record Stats
```bash
curl -X POST http://localhost:3001/api/stats \
  -H "Content-Type: application/json" \
  -d '{
    "gameId": "game-uuid",
    "playerName": "John Smith",
    "goals": 3,
    "assists": 5,
    "blocks": 2,
    "turnovers": 1,
    "yardsThrown": 450,
    "yardsCaught": 280
  }'
```

### Sync from Frontend
```bash
curl -X POST http://localhost:3001/api/sync \
  -H "Content-Type: application/json" \
  -d '{
    "game": {
      "id": "game-uuid",
      "ourTeam": "Thunder",
      "opponentTeam": "Lightning",
      "date": "2026-01-15",
      "ourScore": 15,
      "opponentScore": 12
    },
    "players": ["John Smith", "Jane Doe"],
    "playerStats": {
      "John Smith": {"goals": 3, "assists": 5, "blocks": 2},
      "Jane Doe": {"goals": 4, "assists": 3, "blocks": 1}
    }
  }'
```

## Deployment

For AppSheet to access your API, you need to deploy it to a public URL. Options include:

1. **Render** (Free tier available)
2. **Railway** 
3. **Heroku**
4. **DigitalOcean App Platform**
5. **AWS/GCP/Azure**

### Environment Variables

- `PORT` - Server port (default: 3001)

## Data Storage

Data is stored in JSON files in the `/api/data/` directory:
- `players.json` - Player roster
- `games.json` - Game records
- `stats.json` - Individual player stats per game
- `turnovers.json` - Turnover locations
- `actions.json` - Game action log

For production, consider migrating to a proper database like PostgreSQL or MongoDB.
