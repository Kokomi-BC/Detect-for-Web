# Detect — AI Web Coding Agent Instructions

## Project Overview
**Detect** is a Web-based Fake News Detection application migrated from Electron.
- **Backend**: Node.js + Express + MySQL, managed by **PM2**.
- **Frontend**: Vanilla JS + HTML + CSS.
- **AI Provider**: Volcengine (Doubao) via OpenAI SDK.
- **Transport**: HTTPS (Self-signed) on port **443**.
- **Auth**: JWT-based authentication with local storage.

## Architecture & Key Components

### Backend Process (`src/`)
The application runs as an Express server.
- **Entry**: `src/server.js` (HTTPS server entry).
- **App**: `src/app.js` (Express application & middleware configuration).
- **`src/services/llmService.js`**: AI analysis logic using Doubao `251015` model.
- **`src/services/extractionManager.js`**: Advanced scraper using `Crawlee` (Playwright/Chromium), `jsdom`, and `Readability`.
- **`src/config/db.js`**: MySQL connection pool and initialization logic.
- **`src/routes/`**: API and Auth route definitions.
- **Data Storage**: 
    - **MySQL**: Stores user credentials.
    - **Local Files (`data/`)**: 
        - User history: `data/users/{userId}/history.json`.
        - Crawler Anomalies: `data/anomalies.json` (metadata) and `data/anomalies/*.html` (page snapshots).

### Frontend Process (`public/` & `dist/`)
- **`public/Main.html`**: The main desktop detection interface (Vanilla JS).
- **`public/Mobile.html`**: Mobile-optimized detection interface with "Dynamic Island" UI.
- **`public/Login.html`**: User authentication gateway.
- **`public/Welcome.html`**: Intermediate welcome screen.
- **`public/css/`**: Centralized style management.
    - `variables.css`: Global theme variables and color palette.
    - `common.css`: Shared resets and global components.
    - `main.css`, `mobile.css`, `admin.css`: Page-specific modular styles.
- **`public/js/`**: Client-side logic.
    - `mobile.js`: Core logic for mobile version, including Toast management.
    - `theme-loader.js`: Dynamic theme application.
    - `user-editor.js`: User profile editing logic.
- **`window.electronAPI` Mock**: A bridge in the frontend that converts old Electron `ipcRenderer.invoke` calls into REST API `fetch` requests to `/api/invoke`.

## Deployment & Development


### Commands
- **Start Server**: `npm start` or `pm2 start ecosystem.config.js`
  - Runs `src/server.js`.
  - Controlled by **PM2** (process name: `fake-news-detector`).
  - Listens on `https://0.0.0.0:443`.
  - Logs can be viewed via `pm2 logs`.
- **Build Frontend**: `npm run build:dev` / `npm run build:renderer`
  - Uses Webpack to process HTML files and output to `dist/`.
- **NPM Install**: `cnpm install` for faster dependency installation.

### Administrative Features
- **User Management**: Creating, editing, and deleting system users; status-based (active/pending) approval flow.
- **Workbench Metrics (3-Column Grid)**:
    - **Business Stats**: Total registered users and today's successful login count.
    - **Visitor Tracking**: Daily unique IP visitor count (session-based de-duplication).
    - **Security & Stability**: 
        - Web scraping anomaly tracking (automated content extraction errors).
        - Security defense blocks (Crawler de-denial & Blacklist hits).
- **Resource Monitoring**: 
    - Real-time disk space stats (Available vs. Total).
    - Image cache size tracking and one-click cleanup.
- **Logging & Defense**:
    - Detailed IP access logs with geographic region resolution.
    - Crawler defense configuration (UA length/keywords) and real-time block logs.

### Security & Access
- **HTTPS**: Required for all connections. Use `key.pem` and `cert.pem`.
- **Auth Middleware**: All `/api/invoke` and admin requests must include a JWT in the `Authorization` header or HTTP-only cookies.
- **IP Protection**: Built-in IP blacklist and session-aware visitor de-duplication to prevent stats inflation.

## Database & Documentation
- **MySQL (detect_db)**: Central storage for users, stats, and logs.
- **Schema Reference**: Refer to `db_schema.md` for full table structural details (`users`, `system_stats`, `access_history`, etc.).

## Coding Conventions

### Backend (Express)
- **API Pattern**: Use a unified `/api/invoke` endpoint with `channel` and `args` to maintain compatibility with the original IPC design.
- **Error Handling**: Always return `{ success: boolean, data?: any, error?: string }`.
- **File System**: Use `fsPromises` for non-blocking history read/writes.

### Frontend (Vanilla JS)
- **DOM**: Use `document.getElementById` and standard event listeners.
- **State**: Persistent storage in `localStorage` (tokens, userIds, themes).
- **Styling**: 
    - Use modular CSS files in `public/css/`.
    - Maintain "Single Source of Truth" for colors using `variables.css`.
    - Support Dark Mode via `[data-theme="dark"]` attribute on `<html>`.
    - Replace text-based buttons with SVG icons for a modern UI.
- **Mobile UX**:
    - **Loading Toast**: Use `showLoadingToast(message)` and `hideLoadingToast()` for consistent "Dynamic Island" status updates.
    - **Timing**: Loading Toasts have a minimum display duration (default 500ms) and use slide-out + fade animations.
    - **Actions**: Prefer high-feedback interactions (long press, transitions).

### Scraper (Extraction)
- **Engine**: `Crawlee` with `PlaywrightCrawler` (Headless Chromium). 
- **Anti-Bot**: Uses Stealth scripts, custom User-Agents, and dynamic rendering waits (2-4s) to bypass crawler detection.
- **Resource Management**: Strictly caps Chromium memory (`max-old-space-size=256`) and limits concurrency to 1 to prevent OOM.
- **Parsing**: Continues using `@mozilla/readability` on `JSDOM` objects after extraction.

## File Structure
```
src/
  app.js              # Express application configuration
  server.js           # HTTPS Server entry point
  config/
    db.js             # MySQL Connection
  services/
    llmService.js     # AI Logic & Vision Filter
    extractionManager.js # Playwright Scraper & Anomaly Tracker
    imageExtractor.js # Image filtering & Proxy logic
    urlProcessor.js   # Format & Domain blacklists
    fileParser.js     # Word/PDF Parser
  routes/
    api.js            # Main API & Admin Routes
    auth.js           # Authentication Routes
  middleware/
    auth.js           # JWT Auth middleware
    logger.js         # Request logger middleware
  utils/
    dbUtils.js        # Database helper functions
    fsUtils.js        # File system helper functions
    utils.js          # General purpose helpers
public/
  css/                # Unified CSS Management
    variables.css     # Global Colors & Variables
    common.css        # Shared Resets & Layouts
    mobile.css        # Mobile-specific styles
    main.css          # Desktop-specific styles
    admin.css         # Admin Dashboard specific
  js/                 # Client-side JS logic
    mobile.js         # Core logic for Mobile version
    theme-loader.js   # Dynamic theme injection
    user-editor.js    # Entry for user profile editing
    user-editor-core.js # Shared user editing logic
    export-manager.js # History export logic
  assets/             # Static images and icons
  Login.html          # Auth UI
  Welcome.html        # Welcome UI
  Main.html           # Main Desktop UI
  Admin.html          # Admin Dashboard UI
  Mobile.html         # Mobile-optimized UI
data/                 # Persistent storage
  img_cache/          # Cached external images
  anomalies/          # Extraction error snapshots
  anomalies.json      # Extraction error metadata
  users/              # User-specific history JSONs
dist/                 # Webpack build output
storage/              # Crawlee state storage (KV & Queues)
```

