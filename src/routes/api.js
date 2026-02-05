const express = require('express');
const router = express.Router();
const path = require('path');
const fsPromises = require('fs').promises;
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const multer = require('multer');
const { pool } = require('../config/db');
const { authenticate, authenticateAdmin } = require('../middleware/auth');

// Utils & Controllers
const { IMG_CACHE_DIR, USERS_DATA_DIR, PRESETS_DIR, getUserHistoryPath, findAvatarFile, deleteCachedImages, ensureUserDir } = require('../utils/fsUtils');
const historyController = require('../controllers/historyController');
const adminController = require('../controllers/adminController');
const userController = require('../controllers/userController');
const exportController = require('../controllers/exportController');

// Multer storage configuration for avatars
const uploadAvatar = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /image\/(jpeg|png|gif|webp|jpg)/;
        if (allowedTypes.test(file.mimetype)) cb(null, true);
        else cb(new Error('Only images are allowed (jpg, png, gif, webp)'));
    }
});

module.exports = function(services, state) {
    const { extractionManager, fileParser, llmService } = services;
    const { sseClients } = state;

    // SSE for Real-time Updates
    router.get('/events', authenticate, (req, res) => {
        const userId = req.userId;
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        sseClients.set(userId, res);
        const heartbeat = setInterval(() => {
            if (!res.writableEnded) {
                res.write(': heartbeat\n\n');
            }
        }, 30000);
        req.on('close', () => {
            clearInterval(heartbeat);
            sseClients.delete(userId);
        });
    });

    // Unified Invoke Endpoint
    router.post('/invoke', authenticate, async (req, res) => {
        const { channel, args } = req.body;
        try {
            let result;
            switch (channel) {
                // History
                case 'get-history': result = await historyController.handleGetHistory(req, args); break;
                case 'get-history-item': result = await historyController.handleGetHistoryItem(req, args); break;
                case 'save-history': result = await historyController.handleSaveHistory(req, args); break;
                case 'delete-history': result = await historyController.handleDeleteHistory(req, args, deleteCachedImages); break;
                case 'clear-history': result = await historyController.handleClearHistory(req, deleteCachedImages); break;
                
                // Export
                case 'export-pdf': return exportController.handleExportPdf(req, res, args);
                
                // Core Features
                case 'process-file-upload': {
                    const { name, data } = args[0];
                    result = await fileParser.parseFile(Buffer.from(data, 'base64'), name);
                    break;
                }
                case 'analyze-content': {
                    const { text, imageUrls, url } = args[0];
                    const onStatusChange = (status, data) => {
                        const client = sseClients.get(req.userId);
                        if (client) {
                            client.write(`event: status-update\ndata: ${JSON.stringify({ status, data })}\n\n`);
                        }
                    };
                    result = await llmService.analyzeContent(text, imageUrls, url, onStatusChange);
                    break;
                }
                case 'convert-image-to-base64': result = await handleConvertImage(args[0]); break;
                default: result = { success: false, error: 'Unknown channel: ' + channel };
            }
            res.json({ success: true, data: result });
        } catch (error) {
            console.error(`Error handling ${channel}:`, error);
            res.json({ success: false, error: error.message });
        }
    });

    async function handleConvertImage(imageUrl) {
        if (!imageUrl) return null;
        while (imageUrl && (imageUrl.startsWith('/api/proxy-image') || imageUrl.startsWith('api/proxy-image'))) {
            try {
                const urlObj = new URL(imageUrl, 'https://localhost');
                imageUrl = urlObj.searchParams.get('url');
            } catch (e) { break; }
        }
        if (!imageUrl || !imageUrl.startsWith('http')) return null;
        const cacheKey = crypto.createHash('md5').update(imageUrl).digest('hex');
        const cachePath = path.join(IMG_CACHE_DIR, cacheKey);
        const metaPath = cachePath + '.json';
        try {
            let buffer, contentType;
            if (fs.existsSync(cachePath) && fs.existsSync(metaPath)) {
                buffer = await fsPromises.readFile(cachePath);
                contentType = JSON.parse(await fsPromises.readFile(metaPath, 'utf8')).contentType;
            } else {
                const response = await fetch(imageUrl, { 
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } 
                });
                if (!response.ok) throw new Error('Fetch failed');
                const arrayBuffer = await response.arrayBuffer();
                buffer = Buffer.from(arrayBuffer);
                contentType = response.headers.get('content-type') || 'image/jpeg';
                await fsPromises.writeFile(cachePath, buffer);
                await fsPromises.writeFile(metaPath, JSON.stringify({ contentType, url: imageUrl }));
            }
            return `data:${contentType};base64,${buffer.toString('base64')}`;
        } catch (e) { return null; }
    }

    // Image Proxy
    router.get('/proxy-image', authenticate, async (req, res) => {
        let imageUrl = req.query.url;
        if (!imageUrl) return res.status(400).send('URL required');
        while (imageUrl && (imageUrl.startsWith('/api/proxy-image') || imageUrl.startsWith('api/proxy-image'))) {
            try {
                const urlObj = new URL(imageUrl, 'https://localhost');
                imageUrl = urlObj.searchParams.get('url');
            } catch (e) { break; }
        }
        if (!imageUrl || !imageUrl.startsWith('http')) return res.status(400).send('Absolute URL required');
        const cacheKey = crypto.createHash('md5').update(imageUrl).digest('hex');
        const cachePath = path.join(IMG_CACHE_DIR, cacheKey);
        const metaPath = cachePath + '.json';
        try {
            let buffer, contentType;
            if (fs.existsSync(cachePath) && fs.existsSync(metaPath)) {
                buffer = await fsPromises.readFile(cachePath);
                contentType = JSON.parse(await fsPromises.readFile(metaPath, 'utf8')).contentType;
            } else {
                const response = await fetch(imageUrl, { 
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } 
                });
                const arrayBuffer = await response.arrayBuffer();
                buffer = Buffer.from(arrayBuffer);
                contentType = response.headers.get('content-type') || 'image/jpeg';
                await fsPromises.writeFile(cachePath, buffer);
                await fsPromises.writeFile(metaPath, JSON.stringify({ contentType, url: imageUrl }));
            }
            res.setHeader('Content-Type', contentType); res.send(buffer);
        } catch (e) { res.status(500).send('Proxy error'); }
    });

    // Admin Routes
    router.get('/admin/users', authenticate, authenticateAdmin, async (req, res) => {
        try { res.json(await adminController.handleListUsers(pool, req.query)); }
        catch (err) { res.status(500).json({ success: false, error: err.message }); }
    });

    router.post('/admin/user/add', authenticate, authenticateAdmin, async (req, res) => {
        try { res.json(await adminController.addUser(pool, req.body)); }
        catch (err) { res.status(500).json({ success: false, error: err.message }); }
    });

    router.post('/admin/user/delete', authenticate, authenticateAdmin, async (req, res) => {
        try {
            const userId = req.body.userId;
            const [rows] = await pool.query('SELECT role FROM users WHERE id = ?', [userId]);
            if (rows.length > 0 && rows[0].role === 'admin') {
                const [admins] = await pool.query("SELECT COUNT(*) as c FROM users WHERE role = 'admin'");
                if (admins[0].c <= 1) return res.status(400).json({ success: false, error: '无法删除最后一位管理员' });
            }
            await pool.query('DELETE FROM users WHERE id = ?', [userId]);
            await fsPromises.rm(path.join(USERS_DATA_DIR, userId.toString()), { recursive: true, force: true }).catch(() => {});
            res.json({ success: true });
        } catch (err) { res.status(500).json({ success: false, error: err.message }); }
    });

    router.post('/admin/user/update', authenticate, authenticateAdmin, async (req, res) => {
        try { res.json(await userController.handleUpdateUser(pool, req.body.userId, { ...req.body, isSelfUpdate: req.body.userId == req.userId })); }
        catch (err) { res.status(500).json({ success: false, error: err.message }); }
    });

    router.get('/admin/histories', authenticate, authenticateAdmin, async (req, res) => {
        try { res.json(await adminController.handleAdminHistories(pool, req.query, USERS_DATA_DIR)); }
        catch (err) { res.status(500).json({ success: false, error: err.message }); }
    });

    router.get('/admin/stats/today', authenticate, authenticateAdmin, async (req, res) => {
        try {
            const [[stats]] = await pool.query('SELECT * FROM system_stats WHERE stat_date = CURDATE()');
            const [[yesterday]] = await pool.query('SELECT * FROM system_stats WHERE stat_date = DATE_SUB(CURDATE(), INTERVAL 1 DAY)');
            const [[{ totalUsers }]] = await pool.query('SELECT COUNT(*) as totalUsers FROM users');
            res.json({ 
                success: true, 
                data: stats || {}, 
                yesterday: yesterday || {}, 
                totalUsers, 
                totalAnomalies: extractionManager.getAnomalies().length, 
                system: { cpuUsage: 0, memUsage: 0, uptime: os.uptime() } 
            });
        } catch (err) { res.status(500).json({ success: false, error: err.message }); }
    });

    router.get('/public/avatar/:userId', authenticate, async (req, res) => {
        try {
            const path = await findAvatarFile(req.params.userId);
            if (path && fs.existsSync(path)) res.sendFile(path);
            else res.setHeader('Content-Type', 'image/svg+xml').send('<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" fill="#e2e8f0"/><path d="M12 12C14.2091 12 16 10.2091 16 8C16 5.79086 14.2091 4 12 4C9.79086 4 8 5.79086 8 8C8 10.2091 9.79086 12 12 12Z" fill="#94a3b8"/><path d="M12 14C8.13401 14 5 17.134 5 21H19C19 17.134 15.866 14 12 14Z" fill="#94a3b8"/></svg>');
        } catch(e) { res.status(500).send('Error'); }
    });

    router.post('/user/avatar', authenticate, uploadAvatar.single('avatar'), async (req, res) => {
        try { 
            if (!req.file) throw new Error('No file'); 
            await userController.handleAvatarUpload(req.userId, req.file); 
            res.json({ success: true }); 
        } catch (e) { res.status(500).json({ success: false, error: e.message }); }
    });

    router.get('/user/preferences', authenticate, async (req, res) => {
        try { 
            const p = path.join(USERS_DATA_DIR, String(req.userId), 'preferences.json'); 
            res.json({ success: true, preferences: fs.existsSync(p) ? JSON.parse(await fsPromises.readFile(p, 'utf8')) : { themeId: null } }); 
        } catch (e) { res.status(500).json({ success: false, error: e.message }); }
    });

    router.post('/user/preferences', authenticate, async (req, res) => {
        try { 
            await ensureUserDir(req.userId); 
            const p = path.join(USERS_DATA_DIR, String(req.userId), 'preferences.json'); 
            let cur = fs.existsSync(p) ? JSON.parse(await fsPromises.readFile(p, 'utf8')) : {}; 
            await fsPromises.writeFile(p, JSON.stringify({ ...cur, ...req.body }, null, 2)); 
            res.json({ success: true }); 
        } catch (e) { res.status(500).json({ success: false, error: e.message }); }
    });

    return router;
};
