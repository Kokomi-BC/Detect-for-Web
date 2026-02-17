const express = require('express');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const { getUserPreferencesPath } = require('./utils/fsUtils');

const loggerMiddleware = require('./middleware/logger');
const { authenticate, SECRET_KEY } = require('./middleware/auth');
const ExtractionManager = require('./services/extractionManager');
const FileParser = require('./services/fileParser');
const LLMService = require('./services/llmService');
const PdfService = require('./services/pdfService');

const authRouter = require('./routes/auth');
const apiRouter = require('./routes/api');

const app = express();

app.use(cors({
    origin: true,
    credentials: true
}));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(cookieParser());
app.use(loggerMiddleware);

// --- SERVICES ---
const { pool } = require('./config/db');
const services = {
    extractionManager: new ExtractionManager(pool),
    fileParser: new FileParser(),
    llmService: new LLMService(),
    pdfService: PdfService
};

const state = {
    sseClients: new Map()
};

// --- ROUTES ---
app.use('/auth', authRouter);
app.use('/api', apiRouter(services, state));

// Public Theme Config
app.get('/api/public/theme', (req, res) => {
    // 1. Get Global Config (Default)
    const configPath = path.join(__dirname, '../data/config.json');
    let themeConfig = {};
    if (fs.existsSync(configPath)) {
        try {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            themeConfig = config.theme || {};
        } catch (e) { }
    }

    // 2. Check User Override
    const token = req.cookies.token;
    if (token) {
        try {
            const decoded = jwt.verify(token, SECRET_KEY);
            const userId = decoded.userId;
            const userPrefsPath = getUserPreferencesPath(userId);
            
            if (fs.existsSync(userPrefsPath)) {
                const prefs = JSON.parse(fs.readFileSync(userPrefsPath, 'utf8'));
                if (prefs.themeId) {
                    const presetsPath = path.join(__dirname, '../data/presets/themes.json');
                    if (fs.existsSync(presetsPath)) {
                        const presets = JSON.parse(fs.readFileSync(presetsPath, 'utf8'));
                        const preset = presets.find(p => p.id === prefs.themeId);
                        if (preset && preset.colors && preset.colors.length >= 22) {
                             // Override themeConfig with preset
                             const c = preset.colors;
                             themeConfig = {
                                lightPrimary: c[0],
                                lightBackground: c[1],
                                darkPrimary: c[2],
                                darkBackground: c[3],
                                lightSecondary: c[4],
                                darkSecondary: c[5],
                                lightCard: c[6],
                                darkCard: c[7],
                                lightBgSec: c[8],
                                darkBgSec: c[9],
                                lightBorder: c[10],
                                darkBorder: c[11],
                                lightGlassBorder: c[12],
                                darkGlassBorder: c[13],
                                lightTextMain: c[14],
                                darkTextMain: c[15],
                                lightTextMuted: c[16],
                                darkTextMuted: c[17],
                                lightBgTertiary: c[18],
                                darkBgTertiary: c[19],
                                lightBgMenu: c[20],
                                darkBgMenu: c[21]
                             };
                        }
                    }
                }
            }
        } catch(e) { /* Ignore token errors */ }
    }

    res.json({ status: 'success', theme: themeConfig });
});

// --- Security Policy ---
// Enforce that unauthenticated users can only access the Login page and essential assets.
app.use((req, res, next) => {
    // 1. Allow essential public assets and icons
    const publicPrefixes = ['/js/', '/css/', '/ico/', '/assets/'];
    if (publicPrefixes.some(p => req.path.startsWith(p)) || req.path === '/favicon.ico') {
        return next();
    }
    
    // 2. Allow API and Auth endpoints (they implement their own authentication)
    if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) {
        return next();
    }

    // 3. Enforce access control for all pages
    const token = req.cookies.token;
    const isLoginPage = req.path === '/Login' || req.path === '/Login.html';

    if (!token) {
        if (isLoginPage) return next();
        return res.redirect('/Login');
    }

    try {
        jwt.verify(token, SECRET_KEY);
        // Authenticated users are redirected from Login to Welcome
        if (isLoginPage) return res.redirect('/Welcome');
        next();
    } catch (err) {
        res.clearCookie('token');
        if (isLoginPage) return next();
        return res.redirect('/Login');
    }
});

// Access Control Helpers
const checkAdminAuth = async (req, res, next) => {
    const token = req.cookies.token;
    if (!token) return res.redirect('/Login');
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        req.userId = decoded.userId;
        const [rows] = await pool.query('SELECT role FROM users WHERE id = ?', [req.userId]);
        if (rows.length > 0 && rows[0].role === 'admin') next();
        else res.redirect('/Welcome');
    } catch { res.redirect('/Login'); }
};

app.get('/favicon.ico', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(path.join(__dirname, '../public/ico/Detect.ico'));
});

app.use('/ico', express.static(path.join(__dirname, '../public/ico'), {
    maxAge: '31536000',
    immutable: true
}));

app.use('/js', express.static(path.join(__dirname, '../public/js'), {
    maxAge: '1h'
}));

// 动态解析带哈希的 JS 模块
app.get(['/js/export-manager.js', '/js/user-editor.js'], (req, res, next) => {
    try {
        const moduleName = req.path.split('/').pop().replace('.js', '');
        const candidateDirs = [
            path.join(__dirname, '../dist/js'),
            path.join(__dirname, '../dist/assets'),
            path.join(__dirname, '../client-src/js') // Fallback to source in dev
        ];

        let foundPath = null;

        for (const dir of candidateDirs) {
            if (!fs.existsSync(dir)) continue;
            
            // Try exact match first (dev/src)
            const exactFile = path.join(dir, `${moduleName}.js`);
            if (fs.existsSync(exactFile)) {
                foundPath = exactFile;
                break;
            }

            // Try hashed match (dist)
            const files = fs.readdirSync(dir);
            const hashedMatch = files.find(name => 
                name.startsWith(`${moduleName}.`) && name.endsWith('.js') && !name.includes('legacy')
            );
            
            if (hashedMatch) {
                foundPath = path.join(dir, hashedMatch);
                break;
            }
        }

        if (!foundPath) {
            res.setHeader('Content-Type', 'application/javascript');
            return res.status(404).send(`/* Bundle ${moduleName} not found */`);
        }

        res.setHeader('Content-Type', 'application/javascript');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        return res.sendFile(foundPath);
    } catch (e) {
        console.error('JS Module Resolution Error:', e);
        next();
    }
});

app.get('/Login', (req, res) => {
    const token = req.cookies.token;
    if (token) {
        try {
            jwt.verify(token, SECRET_KEY);
            return res.redirect('/Welcome');
        } catch { }
    }
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.sendFile(path.join(__dirname, '../dist/Login.html'));
});

app.get('/Admin', checkAdminAuth, (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.sendFile(path.join(__dirname, '../dist/Admin.html'));
});

app.get('/Main', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.sendFile(path.join(__dirname, '../dist/Main.html'));
});

app.get('/Welcome', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.sendFile(path.join(__dirname, '../dist/Welcome.html'));
});

// Handle Mobile route with optional trailing slash to prevent relative asset path resolution errors
app.get(['/Mobile', '/Mobile/'], (req, res) => {
    // Check if the actual requested path ends with /Mobile/
    if (req.path === '/Mobile/' || (req.originalUrl && req.originalUrl.split('?')[0].endsWith('/Mobile/'))) {
        return res.redirect(301, '/Mobile');
    }
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.sendFile(path.join(__dirname, '../dist/Mobile.html')); 
});

// Robust fallbacks for relative asset paths requested from /Mobile/ directory
app.use(['/Mobile/css', '*/css', '/Mobile/result/css'], express.static(path.join(__dirname, '../dist/css')));
app.use(['/Mobile/js', '*/js', '/Mobile/result/js'], express.static(path.join(__dirname, '../dist/js')));
app.use(['/Mobile/assets', '*/assets', '/Mobile/result/assets'], express.static(path.join(__dirname, '../dist/assets')));
app.use(['/Mobile/ico', '*/ico', '/Mobile/result/ico'], express.static(path.join(__dirname, '../public/ico')));

// Redirect .html requests
app.get('/*.html', (req, res) => {
    const page = req.path.replace('.html', '');
    res.redirect(301, page);
});

app.use(express.static(path.join(__dirname, '../dist'), {
    maxAge: '1h',
    setHeaders: (res, path) => {
        if (path.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
}));
// Fallback to public for non-bundled assets
app.use(express.static(path.join(__dirname, '../public'), {
    maxAge: '1h',
    setHeaders: (res, path) => {
        if (path.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
}));

app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({
            "status": "fail",
            "code": 404,
            "message": 'API route not found',
            "data": {},
            "error": {}
        });
    if (req.path === '/') {
        const token = req.cookies.token;
        if (token) {
            try {
                jwt.verify(token, SECRET_KEY);
                return res.redirect('/Welcome');
            } catch {}
        }
        return res.redirect('/Login');
    }
    if (req.path.endsWith('.html') || !req.path.includes('.')) return res.redirect('/Login');
    return res.status(404).json({
            "status": "fail",
            "code": 404,
            "message": 'Not Found',
            "data": {},
            "error": {}
        });
});

module.exports = app;
