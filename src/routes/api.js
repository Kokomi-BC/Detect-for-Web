const express = require('express');
const router = express.Router();
const path = require('path');
const fsPromises = require('fs').promises;
const fs = require('fs');
const crypto = require('crypto');
const { pool } = require('../config/db');
const { authenticate, authenticateAdmin } = require('../middleware/auth');

const IMG_CACHE_DIR = path.join(__dirname, '../../data/img_cache');
if (!fs.existsSync(IMG_CACHE_DIR)) {
    fs.mkdirSync(IMG_CACHE_DIR, { recursive: true });
}

module.exports = function(services, state) {
    const { extractionManager, fileParser, llmService } = services;
    const { sseClients } = state;

    const getUserHistoryPath = (userId) => path.join(__dirname, '../../data/users', String(userId), 'history.json');
    const ensureUserDir = async (userId) => {
        const userDir = path.dirname(getUserHistoryPath(userId));
        await fsPromises.mkdir(userDir, { recursive: true });
    };

    const deleteCachedImages = async (imageUrls) => {
        if (!imageUrls || !Array.isArray(imageUrls)) return;
        for (const url of imageUrls) {
            let targetUrl = url;
            // Decode nested proxy URLs
            while (targetUrl && (targetUrl.startsWith('/api/proxy-image') || targetUrl.includes('api/proxy-image?url='))) {
                try {
                    const urlObj = new URL(targetUrl.startsWith('http') ? targetUrl : 'http://localhost' + targetUrl);
                    targetUrl = urlObj.searchParams.get('url');
                } catch (e) { break; }
            }
            if (!targetUrl || !targetUrl.startsWith('http')) continue;

            const cacheKey = crypto.createHash('md5').update(targetUrl).digest('hex');
            try {
                await fsPromises.unlink(path.join(IMG_CACHE_DIR, cacheKey));
                await fsPromises.unlink(path.join(IMG_CACHE_DIR, cacheKey + '.json'));
            } catch (e) { if (e.code !== 'ENOENT') console.error('Cache delete error:', e); }
        }
    };

    // SSE for Real-time Updates
    router.get('/events', authenticate, (req, res) => {
        const userId = req.userId;
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        sseClients.set(userId, res);
        console.log(`[SSE] Client connected: User ${userId}`);

        const heartbeat = setInterval(() => {
            res.write(': heartbeat\n\n');
        }, 30000);

        req.on('close', () => {
            console.log(`[SSE] Client disconnected: User ${userId}`);
            clearInterval(heartbeat);
            sseClients.delete(userId);
        });
    });

    router.post('/invoke', authenticate, async (req, res) => {
        const { channel, args } = req.body;
        if (channel === 'extract-content-sync') {
            console.log(`[${new Date().toISOString()}] API Invoke: ${channel} - Target: ${args[0]}`);
        } else {
            console.log(`[${new Date().toISOString()}] API Invoke: ${channel}`);
        }

        try {
            let result;
            if (['get-history', 'save-history', 'delete-history', 'clear-history'].includes(channel)) {
                await ensureUserDir(req.userId);
            }

            switch (channel) {
                case 'extract-content-sync':
                    result = await extractionManager.extractContent(args[0]);
                    break;
                case 'process-file-upload': {
                    const { name, data } = args[0];
                    const buffer = Buffer.from(data, 'base64');
                    result = await fileParser.parseFile(buffer, name);
                    break;
                }
                case 'analyze-content': {
                    const { text, imageUrls, url } = args[0];
                    const onStatusChange = (status, data) => {
                        const client = sseClients.get(req.userId);
                        if (client) {
                            const eventData = JSON.stringify({ status, data });
                            client.write(`event: status-update\ndata: ${eventData}\n\n`);
                        }
                    };
                    result = await llmService.analyzeContent(text, imageUrls, url, onStatusChange);
                    break;
                }
                case 'convert-image-to-base64': {
                    let imageUrl = args[0];
                    if (!imageUrl) { result = null; break; }

                    // Handle nested proxy URLs
                    while (imageUrl && (imageUrl.startsWith('/api/proxy-image') || imageUrl.startsWith('api/proxy-image'))) {
                        try {
                            const urlObj = new URL(imageUrl, 'https://localhost');
                            imageUrl = urlObj.searchParams.get('url');
                        } catch (e) { break; }
                    }

                    if (!imageUrl || !imageUrl.startsWith('http')) {
                        result = null;
                        break;
                    }

                    const cacheKey = crypto.createHash('md5').update(imageUrl).digest('hex');
                    const cachePath = path.join(IMG_CACHE_DIR, cacheKey);
                    const metaPath = cachePath + '.json';

                    try {
                        let buffer, contentType;
                        if (fs.existsSync(cachePath) && fs.existsSync(metaPath)) {
                            buffer = await fsPromises.readFile(cachePath);
                            const meta = JSON.parse(await fsPromises.readFile(metaPath, 'utf8'));
                            contentType = meta.contentType;
                        } else {
                            const isBaidu = imageUrl.includes('baidu.com') || imageUrl.includes('bdstatic.com') || imageUrl.includes('bcebos.com');
                            const isWechat = imageUrl.includes('mmbiz.qpic.cn') || imageUrl.includes('weixin.qq.com');
                            const isWeibo = imageUrl.includes('sinaimg.cn') || imageUrl.includes('weibo.com');
                            
                            const fetchHeaders = {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
                            };

                            if (isBaidu) fetchHeaders['Referer'] = 'https://www.baidu.com/';
                            else if (isWechat) fetchHeaders['Referer'] = 'https://mp.weixin.qq.com/';
                            else if (isWeibo) fetchHeaders['Referer'] = 'https://weibo.com/';

                            const response = await fetch(imageUrl, { headers: fetchHeaders, timeout: 15000 });
                            if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
                            
                            const arrayBuffer = await response.arrayBuffer();
                            buffer = Buffer.from(arrayBuffer);
                            contentType = response.headers.get('content-type') || 'image/jpeg';
                            
                            // Save to cache
                            await fsPromises.writeFile(cachePath, buffer);
                            await fsPromises.writeFile(metaPath, JSON.stringify({ contentType, url: imageUrl }));
                        }
                        result = `data:${contentType};base64,${buffer.toString('base64')}`;
                    } catch (err) {
                        console.error('Convert Image Error:', err);
                        result = null;
                    }
                    break;
                }
                case 'get-history': {
                    const historyPath = getUserHistoryPath(req.userId);
                    try {
                        const data = await fsPromises.readFile(historyPath, 'utf8');
                        result = JSON.parse(data);
                    } catch (err) {
                        result = (err.code === 'ENOENT') ? [] : (function(){throw err})();
                    }
                    break;
                }
                case 'save-history': {
                    const historyPath = getUserHistoryPath(req.userId);
                    let currentHistory = [];
                    try {
                        const data = await fsPromises.readFile(historyPath, 'utf8');
                        currentHistory = JSON.parse(data);
                    } catch (err) { if (err.code !== 'ENOENT') throw err; }
                    
                    const newItem = args[0];
                    if (newItem) {
                        currentHistory.unshift(newItem);
                        if (currentHistory.length > 100) currentHistory = currentHistory.slice(0, 100);
                        await fsPromises.writeFile(historyPath, JSON.stringify(currentHistory, null, 2));
                    }
                    result = { success: true };
                    break;
                }
                case 'delete-history': {
                    const historyPath = getUserHistoryPath(req.userId);
                    try {
                        const data = await fsPromises.readFile(historyPath, 'utf8');
                        const history = JSON.parse(data);
                        const itemToDelete = history.find(item => item.timestamp === args[0]);
                        if (itemToDelete && itemToDelete.images) {
                            await deleteCachedImages(itemToDelete.images);
                        }
                        const newHistory = history.filter(item => item.timestamp !== args[0]);
                        await fsPromises.writeFile(historyPath, JSON.stringify(newHistory, null, 2));
                        result = { success: true };
                    } catch (err) { result = (err.code === 'ENOENT') ? {success:true} : (function(){throw err})(); }
                    break;
                }
                case 'clear-history':
                    try {
                        const historyPath = getUserHistoryPath(req.userId);
                        const data = await fsPromises.readFile(historyPath, 'utf8');
                        const history = JSON.parse(data);
                        for(const item of history) {
                            if(item.images) await deleteCachedImages(item.images);
                        }
                    } catch(e) {}
                    await fsPromises.writeFile(getUserHistoryPath(req.userId), '[]');
                    result = { success: true };
                    break;
                case 'cancel-extraction':
                    extractionManager.cancelExtraction();
                    result = { success: true };
                    break;
                default: result = { success: false, error: "Unknown channel" };
            }
            res.json({ success: true, data: result });
        } catch (error) {
            console.error(`Error handling ${channel}:`, error);
            res.json({ success: false, error: error.message });
        }
    });

    // Image Proxy
    router.get('/proxy-image', async (req, res) => {
        let imageUrl = req.query.url;
        if (!imageUrl) return res.status(400).send('URL required');

        // Handle nested proxy URLs
        while (imageUrl && (imageUrl.startsWith('/api/proxy-image') || imageUrl.startsWith('api/proxy-image'))) {
            try {
                const urlObj = new URL(imageUrl, 'https://localhost');
                imageUrl = urlObj.searchParams.get('url');
            } catch (e) { break; }
        }

        if (!imageUrl || !imageUrl.startsWith('http')) {
            console.error('Invalid image URL:', imageUrl);
            return res.status(400).send('Absolute URL required');
        }

        const cacheKey = crypto.createHash('md5').update(imageUrl).digest('hex');
        const cachePath = path.join(IMG_CACHE_DIR, cacheKey);
        const metaPath = cachePath + '.json';

        try {
            if (fs.existsSync(cachePath) && fs.existsSync(metaPath)) {
                const meta = JSON.parse(await fsPromises.readFile(metaPath, 'utf8'));
                if (meta.contentType) res.setHeader('Content-Type', meta.contentType);
                res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
                return fs.createReadStream(cachePath).pipe(res);
            }

            const fetchOptions = {
                headers: { 
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
                }
            };
            if (imageUrl.includes('mmbiz.qpic.cn') || imageUrl.includes('weixin')) fetchOptions.headers['Referer'] = 'https://mp.weixin.qq.com/';
            else if (imageUrl.includes('baidu.com') || imageUrl.includes('bdstatic.com')) fetchOptions.headers['Referer'] = 'https://www.baidu.com/';
            else if (imageUrl.includes('sinaimg.cn') || imageUrl.includes('weibo.com')) fetchOptions.headers['Referer'] = 'https://weibo.com/';
            
            const response = await fetch(imageUrl, { ...fetchOptions, timeout: 15000 });
            if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
            
            const contentType = response.headers.get('content-type');
            if (contentType) res.setHeader('Content-Type', contentType);
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            
            // Save to cache (Async, but we can wait here)
            await fsPromises.writeFile(cachePath, buffer);
            await fsPromises.writeFile(metaPath, JSON.stringify({ contentType, url: imageUrl }));

            res.send(buffer);
        } catch (error) {
            console.error('Proxy Image Error:', error);
            res.status(500).send('Error fetching image');
        }
    });

    // Admin Users
    router.get('/admin/users', authenticate, authenticateAdmin, async (req, res) => {
        try {
            const [rows] = await pool.query('SELECT id, username, role, status, last_login_at, last_login_ip FROM users ORDER BY id DESC');
            res.json({ success: true, data: rows });
        } catch (err) { res.status(500).json({ success: false, error: err.message }); }
    });

    router.post('/admin/user/add', authenticate, authenticateAdmin, async (req, res) => {
        const { username, password, role, status } = req.body;
        if (!username || username.length < 3 || username.length > 20) return res.status(400).json({ success: false, error: '用户名长度错误' });
        try {
            const [rows] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
            if (rows.length > 0) return res.status(400).json({ success: false, error: '用户名已存在' });
            const { getNextAvailableUserId } = require('./auth');
            const nextId = await getNextAvailableUserId();
            await pool.query('INSERT INTO users (id, username, password, role, status, last_login_at) VALUES (?, ?, ?, ?, ?, NOW())', 
                [nextId, username, password, role || 'user', status || 'active']);
            res.json({ success: true });
        } catch (err) { res.status(500).json({ success: false, error: err.message }); }
    });

    router.post('/admin/user/approve', authenticate, authenticateAdmin, async (req, res) => {
        const { userId } = req.body;
        try {
            await pool.query('UPDATE users SET status = ? WHERE id = ?', ['active', userId]);
            res.json({ success: true });
        } catch (err) { res.status(500).json({ success: false, error: err.message }); }
    });

    router.post('/admin/user/delete', authenticate, authenticateAdmin, async (req, res) => {
        const { userId } = req.body;
        try {
            const [userRows] = await pool.query('SELECT role FROM users WHERE id = ?', [userId]);
            if (userRows.length > 0 && userRows[0].role === 'admin') {
                const [adminCountRows] = await pool.query("SELECT COUNT(*) as count FROM users WHERE role = 'admin'");
                if (adminCountRows[0].count <= 1) return res.status(400).json({ success: false, error: '唯一的管理员账户不可删除' });
            }
            await pool.query('DELETE FROM users WHERE id = ?', [userId]);
            const userDir = path.join(__dirname, '../../data/users', userId.toString());
            try { await fsPromises.rm(userDir, { recursive: true, force: true }); } catch (e) {}
            res.json({ success: true });
        } catch (err) { res.status(500).json({ success: false, error: err.message }); }
    });

    router.post('/admin/user/update', authenticate, authenticateAdmin, async (req, res) => {
        const { userId, username, password, role } = req.body;
        try {
            let q = 'UPDATE users SET username = ?';
            let params = [username];
            if (role) { q += ', role = ?'; params.push(role); }
            if (password) { q += ', password = ?'; params.push(password); }
            q += ' WHERE id = ?';
            params.push(userId);
            await pool.query(q, params);
            res.json({ success: true });
        } catch (err) { res.status(500).json({ success: false, error: err.message }); }
    });

    // Admin Logs and Blacklist
    router.get('/admin/ip-logs', authenticate, authenticateAdmin, async (req, res) => {
        try {
            const [history] = await pool.query('SELECT * FROM access_history ORDER BY last_access DESC LIMIT 1000');
            const [today] = await pool.query('SELECT ip, hit_count FROM access_today WHERE access_date = CURDATE() ORDER BY hit_count DESC');
            res.json({ success: true, history, today });
        } catch (err) { res.status(500).json({ success: false, error: err.message }); }
    });

    router.post('/admin/ip-logs/clear', authenticate, authenticateAdmin, async (req, res) => {
        try {
            await pool.query('DELETE FROM access_history');
            await pool.query('DELETE FROM access_today');
            res.json({ success: true });
        } catch (err) { res.status(500).json({ success: false, error: err.message }); }
    });

    router.get('/admin/blacklist', authenticate, authenticateAdmin, async (req, res) => {
        try {
            const [rows] = await pool.query('SELECT * FROM ip_blacklist ORDER BY created_at DESC');
            res.json({ success: true, data: rows });
        } catch (err) { res.status(500).json({ success: false, error: err.message }); }
    });

    router.post('/admin/blacklist/add', authenticate, authenticateAdmin, async (req, res) => {
        const { ip, reason } = req.body;
        if (!ip) return res.status(400).json({ success: false, error: 'IP is required' });
        try {
            await pool.query('INSERT IGNORE INTO ip_blacklist (ip, reason) VALUES (?, ?)', [ip, reason || 'Manual Admin Block']);
            res.json({ success: true });
        } catch (err) { res.status(500).json({ success: false, error: err.message }); }
    });

    router.post('/admin/blacklist/remove', authenticate, authenticateAdmin, async (req, res) => {
        const { id } = req.body;
        try {
            await pool.query('DELETE FROM ip_blacklist WHERE id = ?', [id]);
            res.json({ success: true });
        } catch (err) { res.status(500).json({ success: false, error: err.message }); }
    });

    // Admin Anomalies
    router.get('/admin/anomalies', authenticate, authenticateAdmin, (req, res) => {
        res.json({ success: true, data: extractionManager.getAnomalies() });
    });

    router.post('/admin/anomalies/clear', authenticate, authenticateAdmin, (req, res) => {
        extractionManager.clearAnomalies();
        res.json({ success: true });
    });

    router.post('/admin/anomalies/delete', authenticate, authenticateAdmin, (req, res) => {
        const { id } = req.body;
        const success = extractionManager.deleteAnomaly(id);
        res.json({ success });
    });

    // Admin History Management
    router.get('/admin/histories', authenticate, authenticateAdmin, async (req, res) => {
        try {
            const usersDir = path.join(__dirname, '../../data/users');
            if (!fs.existsSync(usersDir)) return res.json({ success: true, data: [] });
            
            const userDirs = await fsPromises.readdir(usersDir);
            let allHistory = [];
            
            // Get user map for usernames
            const [users] = await pool.query('SELECT id, username FROM users');
            const userMap = users.reduce((acc, u) => { acc[u.id] = u.username; return acc; }, {});

            for (const userId of userDirs) {
                const hPath = path.join(usersDir, userId, 'history.json');
                try {
                    const data = await fsPromises.readFile(hPath, 'utf8');
                    const history = JSON.parse(data);
                    const username = userMap[userId] || `User ${userId}`;
                    
                    history.forEach(item => {
                        const q = req.query.q;
                        const displayTitle = (item.result && item.result.title) || item.title || item.originalInput || 'Untitled';

                        if (q) {
                             const text = displayTitle + (item.url || '') + (item.originalInput || '') + (item.content || '');
                             if (!text.toLowerCase().includes(q.toLowerCase())) return;
                        }
                        
                        // Extract probability/score
                        let score = 'N/A';
                        if (item.result) score = item.result.probability;
                        
                        allHistory.push({
                            userId,
                            username,
                            timestamp: item.timestamp,
                            title: displayTitle,
                            url: item.url,
                            originalInput: item.originalInput,
                            score
                        });
                    });
                } catch (e) { /* ignore read errors */ }
            }
            // Sort by timestamp desc
            allHistory.sort((a,b) => b.timestamp - a.timestamp); 
            res.json({ success: true, data: allHistory });
        } catch (err) { res.status(500).json({ success: false, error: err.message }); }
    });
    
    router.post('/admin/history/delete', authenticate, authenticateAdmin, async (req, res) => {
         const { userId, timestamp } = req.body;
         const hPath = getUserHistoryPath(userId);
         try {
             const data = await fsPromises.readFile(hPath, 'utf8');
             let history = JSON.parse(data);
             
             const target = history.find(h => h.timestamp == timestamp);
             if (target && target.images) await deleteCachedImages(target.images);
             
             history = history.filter(h => h.timestamp != timestamp);
             await fsPromises.writeFile(hPath, JSON.stringify(history, null, 2));
             res.json({ success: true });
         } catch (e) { res.status(500).json({ success: false, error: e.message }); }
    });

    // Admin Cache Management
    router.get('/admin/cache/stats', authenticate, authenticateAdmin, async (req, res) => {
        try {
             const files = await fsPromises.readdir(IMG_CACHE_DIR);
             let totalSize = 0;
             for (const file of files) {
                  const stats = await fsPromises.stat(path.join(IMG_CACHE_DIR, file));
                  totalSize += stats.size;
             }

             // Get disk space stats
             let diskInfo = null;
             try {
                 const diskStats = await fsPromises.statfs('/');
                 diskInfo = {
                     free: diskStats.bavail * diskStats.bsize,
                     total: diskStats.blocks * diskStats.bsize
                 };
             } catch (diskErr) {
                 console.error('Failed to get disk stats:', diskErr);
             }

             res.json({ 
                 success: true, 
                 count: files.length, 
                 size: totalSize,
                 disk: diskInfo
             });
        } catch (e) { res.status(500).json({ success: false, error: e.message }); }
    });

    router.post('/admin/cache/clear', authenticate, authenticateAdmin, async (req, res) => {
        try {
             await fsPromises.rm(IMG_CACHE_DIR, { recursive: true, force: true });
             await fsPromises.mkdir(IMG_CACHE_DIR, { recursive: true });
             res.json({ success: true });
        } catch (e) { res.status(500).json({ success: false, error: e.message }); }
    });

    router.get('/admin/anomalies/view', authenticate, authenticateAdmin, (req, res) => {
        const { id } = req.query;
        const dumpPath = path.join(__dirname, '../../data/anomalies', `${id}.html`);
        if (fs.existsSync(dumpPath)) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.sendFile(dumpPath);
        } else { res.status(404).send('Dump file not found'); }
    });

    router.get('/admin/proxy', authenticate, authenticateAdmin, async (req, res) => {
        const targetUrl = req.query.url;
        if (!targetUrl) return res.status(400).send('URL required');
        try {
            const response = await fetch(targetUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36', 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8', 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8', 'Cache-Control': 'no-cache' }
            });
            if (!response.ok) return res.status(response.status).send(`Target site returned error: ${response.status}`);
            const text = await response.text();
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(text);
        } catch (err) { res.status(500).send('Proxy Error: ' + err.message); }
    });

    // Admin Config Management
    router.get('/admin/config', authenticate, authenticateAdmin, async (req, res) => {
        const configPath = path.join(__dirname, '../../data/config.json');
        try {
            if (!fs.existsSync(configPath)) {
                return res.json({ success: true, data: { llm: { apiKey: '', baseURL: '', model: '' }, search: { apiKey: '' } } });
            }
            const data = await fsPromises.readFile(configPath, 'utf8');
            res.json({ success: true, data: JSON.parse(data) });
        } catch (err) { res.status(500).json({ success: false, error: err.message }); }
    });

    router.post('/admin/config', authenticate, authenticateAdmin, async (req, res) => {
        const configPath = path.join(__dirname, '../../data/config.json');
        try {
            const newConfig = req.body;
            await fsPromises.writeFile(configPath, JSON.stringify(newConfig, null, 2));
            
            // Reload config in service
            if (llmService && typeof llmService.loadConfig === 'function') {
                llmService.loadConfig();
            }
            
            res.json({ success: true });
        } catch (err) { res.status(500).json({ success: false, error: err.message }); }
    });

    return router;
};
