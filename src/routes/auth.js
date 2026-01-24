const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { SECRET_KEY, authenticate } = require('../middleware/auth');

// Brute force protection
const loginAttempts = new Map(); // IP -> { count, lastAttempt }
const loginBlockHistory = new Map(); // IP -> { count, lastBlockTime }

// --- Helper to get smallest available ID ---
async function getNextAvailableUserId() {
    const [rows] = await pool.query(`
        SELECT 
            CASE 
                WHEN NOT EXISTS (SELECT 1 FROM users WHERE id = 1) THEN 1 
                ELSE (SELECT MIN(id + 1) FROM users WHERE (id + 1) NOT IN (SELECT id FROM users)) 
            END AS next_id
    `);
    return rows[0].next_id;
}

router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    
    // Length validation
    if (!username || username.length < 3 || username.length > 20) {
        return res.status(400).json({ success: false, error: '用户名长度需在3-20位之间' });
    }
    // Password is SHA256 hashed on client (64 chars)
    if (!password || password.length < 10 || password.length > 128) {
        return res.status(400).json({ success: false, error: '无效的要求' });
    }

    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    // Brute force protection
    const now = Date.now();
    const attempts = loginAttempts.get(ip) || { count: 0, lastAttempt: 0 };
    
    // Check if currently blocked (30s)
    if (attempts.count >= 3 && now - attempts.lastAttempt < 30000) {
        return res.status(429).json({ success: false, error: '登录失败次数过多，请30秒后再试' });
    }
    
    // If block expired, reset count (partially, but we keep history in another map)
    if (attempts.count >= 3 && now - attempts.lastAttempt >= 30000) {
       attempts.count = 0; 
       attempts.lastAttempt = 0;
       loginAttempts.set(ip, attempts);
    }

    try {
        const [rows] = await pool.query('SELECT * FROM users WHERE username = ? AND password = ?', [username, password]);
        if (rows.length > 0) {
            const user = rows[0];
            
            if (user.status !== 'active') {
                return res.status(401).json({ success: false, error: '账户待审核，请联系管理员' });
            }

            // Reset attempts on successful login
            loginAttempts.delete(ip);
            loginBlockHistory.delete(ip); // Also clear block history on success

            // Invalidate old sessions by incrementing token_version
            const newTokenVersion = (user.token_version || 0) + 1;
            await pool.query('UPDATE users SET last_login_at = NOW(), last_login_ip = ?, token_version = ? WHERE id = ?', 
                [ip, newTokenVersion, user.id]);

            // Sign token with version
            const token = jwt.sign({ userId: user.id, role: user.role, token_version: newTokenVersion }, SECRET_KEY, { expiresIn: '24h' });
            
            // Set HttpOnly Cookie
            res.cookie('token', token, {
                httpOnly: true,
                secure: true, 
                sameSite: 'strict',
                maxAge: 12 * 60 * 60 * 1000 
            });
            
            res.json({ success: true, userId: user.id, role: user.role });
        } else {
            // Track failed attempts
            attempts.count++;
            attempts.lastAttempt = now;
            loginAttempts.set(ip, attempts);
            
            // Check if this failure triggers a block
            if (attempts.count >= 3) {
                // Increment global block history for this IP
                const blockHist = loginBlockHistory.get(ip) || { count: 0 };
                blockHist.count++;
                loginBlockHistory.set(ip, blockHist);
                
                // If blocked 3 times in a row (meaning 3 sets of 3 failures), then ban
                if (blockHist.count >= 3) {
                     try {
                        await pool.query('INSERT IGNORE INTO ip_blacklist (ip, reason) VALUES (?, ?)', [ip, '多次触发登录频次限制 (自动封禁)']);
                        loginAttempts.delete(ip);
                        loginBlockHistory.delete(ip);
                        return res.status(403).json({ success: false, error: '您的 IP 已被暂时封禁，请联系管理员' });
                     } catch (e) {
                         console.error('Auto ban failed:', e);
                     }
                }
                
                return res.status(429).json({ success: false, error: '登录失败次数过多，请30秒后再试' });
            }
            
            res.status(401).json({ success: false, error: '用户名或密码错误' });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/register', async (req, res) => {
    const { username, password } = req.body;

    // Length validation
    if (!username || username.length < 3 || username.length > 20) {
        return res.status(400).json({ success: false, error: '用户名长度需在3-20位之间' });
    }
    // Password is SHA256 hashed on client (64 chars)
    if (!password || password.length < 10 || password.length > 128) {
        return res.status(400).json({ success: false, error: '注册参数错误' });
    }

    try {
        // Check for pending users count
        const [pendingRows] = await pool.query('SELECT COUNT(*) as count FROM users WHERE status = ?', ['pending']);
        if (pendingRows[0].count >= 10) {
            return res.status(403).json({ success: false, error: '目前待审批用户较多，请稍后重试或联系管理员' });
        }

        const [rows] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
        if (rows.length > 0) {
            return res.status(400).json({ success: false, error: '用户名已存在' });
        }
        
        const nextId = await getNextAvailableUserId();
        await pool.query('INSERT INTO users (id, username, password, status, role, last_login_at) VALUES (?, ?, ?, ?, ?, NOW())', 
            [nextId, username, password, 'pending', 'user']);
            
        res.json({ success: true, message: '注册成功，请等待管理员审核' });
    } catch (err) {
        res.status(500).json({ success: false, error: '注册失败: ' + err.message });
    }
});

router.get('/me', authenticate, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT username, role, last_login_at, last_login_ip FROM users WHERE id = ?', [req.userId]);
        if (rows.length > 0) {
            res.json({ success: true, user: rows[0] });
        } else {
            res.status(404).json({ success: false, error: 'User not found' });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ success: true });
});

module.exports = router;
module.exports.getNextAvailableUserId = getNextAvailableUserId;
