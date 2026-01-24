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
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());
app.use(loggerMiddleware);

// --- SERVICES ---
const services = {
    extractionManager: new ExtractionManager(),
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
    const configPath = path.join(__dirname, '../data/config.json');
    try {
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            return res.json({ success: true, theme: config.theme || {} });
        }
    } catch (e) { }
    res.json({ success: true, theme: {} });
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

const { pool } = require('./config/db');
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
    res.sendFile(path.join(__dirname, '../ico/Detect.ico'));
});

app.use('/ico', express.static(path.join(__dirname, '../ico'), {
    maxAge: '31536000',
    immutable: true
}));

app.get('/theme-loader.js', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/theme-loader.js'));
});

app.get('/user-editor.js', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/user-editor.js'));
});

app.use('/css', express.static(path.join(__dirname, '../public/css'), {
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

// Redirect .html requests
app.get('/*.html', (req, res) => {
    const page = req.path.replace('.html', '');
    res.redirect(301, page);
});

app.use(express.static(path.join(__dirname, '../dist'), {
    maxAge: '1h'
}));

app.get('*', (req, res) => {
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
