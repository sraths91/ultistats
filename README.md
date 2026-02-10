# Ultimate Frisbee Stats Tracker

A comprehensive web application for tracking ultimate frisbee game statistics with iPad-optimized interface and Google Sheets synchronization.

## Features

### 🎯 Core Functionality
- **Interactive Field Tracking**: Tap on the field to record throws, turnovers, and scores
- **Automatic Distance Calculation**: Calculates yardage for throws based on field coordinates
- **Player Statistics**: Track goals, assists, blocks, turnovers, yards thrown, and yards caught
- **Team Statistics**: Monitor team score, turnovers, and total yardage
- **Live Dashboard**: Real-time updates of all statistics during the game

### 📱 iPad Optimized
- Touch-friendly interface with large tap targets
- Responsive design optimized for tablet screens
- Landscape and portrait orientation support
- Smooth animations and visual feedback

### 📊 Google Sheets Integration
- Automatic synchronization to Google Sheets
- Separate sheets for game info, player stats, and team stats
- Real-time data backup every 30 seconds
- Manual sync option available

### 🎨 Visual Features
- Interactive ultimate frisbee field with accurate dimensions
- Color-coded turnover markers (red for our turnovers, green for opponent turnovers)
- Throw trajectory visualization
- End zones and field markings

## Setup Instructions

### 1. Google Sheets API Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable the Google Sheets API
4. Create credentials:
   - Application type: Web application
   - Authorized JavaScript origins: `http://localhost:8000` (or your deployment URL)
5. Copy your Client ID and API Key

### 2. Configure the Application

1. Open `script.js`
2. Replace `YOUR_CLIENT_ID` with your actual Google Client ID
3. Replace `YOUR_API_KEY` with your actual Google API Key

### 3. Create a Google Sheet

1. Create a new Google Sheet
2. Copy the Sheet ID from the URL (the part between `/d/` and `/edit`)
3. This Sheet ID will be used in the application

### 4. Run the Application

1. Start a local server:
   ```bash
   # Using Python
   python -m http.server 8000
   
   # Using Node.js
   npx http-server
   ```

2. Open `http://localhost:8000` in your browser

## Usage Guide

### Starting a Game
1. Enter team names and game date
2. Add players to your roster
3. Enter your Google Sheet ID
4. Click "Start Game"

### Tracking Actions

#### Throws
1. Select "Throw" from action type
2. Select thrower and receiver from dropdowns
3. Click on the field where the throw starts
4. Click on the field where the throw is caught
5. Distance is automatically calculated and added to player stats

#### Turnovers
1. Select "Turnover (Our Team)" or "Turnover (Their Team)"
2. Click on the field where the turnover occurred
3. A colored marker will appear on the field

#### Scores
1. Select "Score" from action type
2. Select thrower and receiver
3. Click on the field where the score occurred
4. Goal is automatically recorded

#### Blocks
1. Click on any player card in the roster
2. Enter the number of blocks
3. Blocks are added to the player's statistics

### Google Sheets Sync
- Click "Connect Google Sheets" to authorize the application
- Data syncs automatically every 30 seconds
- Manual sync available through the refresh button
- Three sheets are created: Game Info, Player Stats, Team Stats

## Field Dimensions

The application uses official ultimate frisbee field dimensions:
- Total length: 100 meters (328 feet)
- Playing field: 64 meters (210 feet) 
- Width: 37 meters (120 feet)
- End zones: 18 meters (59 feet) deep

## Data Tracked

### Player Statistics
- **Goals**: Number of times player scored
- **Assists**: Number of successful throws leading to goals
- **Blocks**: Number of times player blocked opponent throws
- **Turnovers**: Number of times player turned over the disc
- **Yards Thrown**: Total distance of all successful throws
- **Yards Caught**: Total distance of all receptions

### Team Statistics
- **Team Score**: Total number of goals scored
- **Team Turnovers**: Total turnovers by the team
- **Total Yards Thrown**: Combined yards thrown by all players
- **Total Yards Caught**: Combined yards caught by all players

### Action Log
- Timestamped record of all game actions
- Color-coded by action type
- Shows last 20 actions during the game

## Technical Details

### Technologies Used
- **HTML5**: Semantic structure
- **CSS3**: Responsive design with Tailwind CSS
- **JavaScript**: Vanilla JS with Google Sheets API
- **SVG**: Interactive field visualization

### Browser Compatibility
- Modern browsers (Chrome, Firefox, Safari, Edge)
- iPad Safari optimized
- Touch device support

### Data Storage
- In-memory during game
- Google Sheets for persistent storage
- No local storage required

## Troubleshooting

### Google Sheets Connection Issues
1. Verify Client ID and API Key are correct
2. Check that Google Sheets API is enabled
3. Ensure authorized JavaScript origins include your URL
4. Make sure Sheet ID is correct

### Field Interaction Problems
1. Ensure game is started before clicking field
2. Check that players are added for throw actions
3. Verify action type is selected correctly

### Sync Issues
1. Check internet connection
2. Verify Google Sheets authorization
3. Confirm Sheet ID is valid
4. Try manual sync button

## Future Enhancements

Potential features for future versions:
- Player positioning tracking
- Advanced statistics and analytics
- Multiple game management
- Historical data comparison
- Export to other formats (CSV, PDF)
- Team management features
- Season-long statistics
- Video integration
- Offline mode support

## License

This project is open source and available under the MIT License.
