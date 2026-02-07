const express = require('express');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

const loggerMiddleware = require('./middleware/logger');
const { authenticate, SECRET_KEY } = require('./middleware/auth');
const ExtractionManager = require('./services/extractionManager');
const FileParser = require('./services/fileParser');
const LLMService = require('./services/llmService');

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
    llmService: new LLMService()
};

const state = {
    sseClients: new Map()
};

// --- ROUTES ---
app.use('/auth', authRouter);
app.use('/api', apiRouter(services, state));

// Public Theme Config
const fs = require('fs');
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
            const userPrefsPath = path.join(__dirname, '../data/users', String(userId), 'preferences.json');
            
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

    res.json({ success: true, theme: themeConfig });
});

// Static Pages and Access Control
const checkCookieAuth = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) {
        if (req.path === '/Login' || req.path === '/Login.html') return next();
        return res.redirect('/Login');
    }
    try {
        jwt.verify(token, SECRET_KEY);
        if (req.path === '/Login' || req.path === '/Login.html') return res.redirect('/Welcome');
        next();
    } catch (err) {
        res.clearCookie('token');
        return res.redirect('/Login');
    }
};

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
    res.sendFile(path.join(__dirname, '../public/assets/ico/Detect.ico'));
});

app.use('/ico', express.static(path.join(__dirname, '../public/assets/ico'), {
    maxAge: '31536000',
    immutable: true
}));

app.use('/js', express.static(path.join(__dirname, '../public/js'), {
    maxAge: '1h'
}));

app.use('/css', express.static(path.join(__dirname, '../dist/css'), {
    maxAge: '1h'
}));
app.use('/css', express.static(path.join(__dirname, '../public/css'), {
    maxAge: '1h'
}));
app.use('/js', express.static(path.join(__dirname, '../public/js'), {
    maxAge: '1h'
}));

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

app.get('/Main', checkCookieAuth, (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.sendFile(path.join(__dirname, '../dist/Main.html'));
});

app.get('/Welcome', checkCookieAuth, (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.sendFile(path.join(__dirname, '../dist/Welcome.html'));
});

app.get('/Mobile', checkCookieAuth, (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    // Serve from dist if built, or check public if needed. Assuming dist for consistency
    // But since I won't run full build, I'll direct to public for now or ensure I copy it.
    // Let's stick to dist pattern and I will copy it.
    res.sendFile(path.join(__dirname, '../public/Mobile.html')); 
});

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
    if (req.path.startsWith('/api/')) return res.status(404).json({ success: false, error: 'API route not found' });
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
    res.status(404).send('Not Found');
});

module.exports = app;
