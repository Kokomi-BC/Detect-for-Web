const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

// Global state for brute force protection
const loginAttempts = new Map(); 
const loginBlockHistory = new Map(); 

const { pool } = require('../config/db');
const { SECRET_KEY, authenticate } = require('../middleware/auth');
const { getNextAvailableUserId } = require('../utils/dbUtils');

router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        // Length validation
        if (!username || username.length < 3 || username.length > 20) {
            return res.status(400).json({
            "status": "fail",
            "code": 400,
            "message": '用户名长度需在3-20位之间',
            "data": {},
            "error": {}
        });
        }
        // Password is SHA256 hashed on client (64 chars)
        if (!password || password.length < 10 || password.length > 128) {
            return res.status(400).json({
            "status": "fail",
            "code": 400,
            "message": '无效的要求',
            "data": {},
            "error": {}
        });
        }

        const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '0.0.0.0';

        // Brute force protection
        const now = Date.now();
        const attempts = loginAttempts.get(ip) || { count: 0, lastAttempt: 0 };
        
        // Check if currently blocked (30s)
        if (attempts.count >= 3 && now - attempts.lastAttempt < 30000) {
            return res.status(429).json({
            "status": "fail",
            "code": 429,
            "message": '登录失败次数过多，请30秒后再试',
            "data": {},
            "error": {}
        });
        }
        
        // If block expired, reset count
        if (attempts.count >= 3 && now - attempts.lastAttempt >= 30000) {
           attempts.count = 0; 
           attempts.lastAttempt = 0;
           loginAttempts.set(ip, attempts);
        }

        const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
        if (rows.length > 0) {
            const user = rows[0];
            
            // Verify password
            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                const count = (attempts.count || 0) + 1;
                loginAttempts.set(ip, { count, lastAttempt: now });
                return res.status(401).json({
            "status": "fail",
            "code": 401,
            "message": '用户名或密码错误',
            "data": {},
            "error": {}
        });
            }

            if (user.status !== 'active') {
                return res.status(401).json({
            "status": "fail",
            "code": 401,
            "message": '账户待审核，请联系管理员',
            "data": {},
            "error": {}
        });
            }

            // Reset attempts on successful login
            loginAttempts.delete(ip);
            loginBlockHistory.delete(ip);

            // Invalidate old sessions by incrementing token_version
            const newTokenVersion = (user.token_version || 0) + 1;
            await pool.query('UPDATE users SET last_login_at = NOW(), last_login_ip = ?, token_version = ? WHERE id = ?', 
                [ip, newTokenVersion, user.id]);

            // Update login stats
            try {
                await pool.query(`
                    INSERT INTO system_stats (stat_date, login_user_count)
                    VALUES (CURDATE(), 1)
                    ON DUPLICATE KEY UPDATE login_user_count = login_user_count + 1
                `);
            } catch(e) {}

            // Sign token with version
            const token = jwt.sign({ userId: user.id, role: user.role, token_version: newTokenVersion }, SECRET_KEY, { expiresIn: '24h' });
            
            // Set HttpOnly Cookie
            res.cookie('token', token, {
                httpOnly: true,
                secure: true, 
                sameSite: 'strict',
                maxAge: 12 * 60 * 60 * 1000 
            });
            
            return res.json({ status: "success", userId: user.id, role: user.role });
        } else {
            // Track failed attempts
            attempts.count++;
            attempts.lastAttempt = now;
            loginAttempts.set(ip, attempts);

            // Update login fail stats
            try {
                await pool.query(`
                    INSERT INTO system_stats (stat_date, login_fail_count)
                    VALUES (CURDATE(), 1)
                    ON DUPLICATE KEY UPDATE login_fail_count = login_fail_count + 1
                `);
            } catch(e) {}
            
            // Check if this failure triggers a block
            if (attempts.count >= 3) {
                const blockHist = loginBlockHistory.get(ip) || { count: 0 };
                blockHist.count++;
                loginBlockHistory.set(ip, blockHist);
                
                if (blockHist.count >= 3) {
                     try {
                        await pool.query('INSERT IGNORE INTO ip_blacklist (ip, reason) VALUES (?, ?)', [ip, '多次触发登录频次限制 (自动封禁)']);
                        loginAttempts.delete(ip);
                        loginBlockHistory.delete(ip);
                        return res.status(403).json({
            "status": "fail",
            "code": 403,
            "message": '您的 IP 已被暂时封禁，请联系管理员',
            "data": {},
            "error": {}
        });
                     } catch (e) { }
                }
                return res.status(429).json({
            "status": "fail",
            "code": 429,
            "message": '登录失败次数过多，请30秒后再试',
            "data": {},
            "error": {}
        });
            }
            return res.status(401).json({
            "status": "fail",
            "code": 401,
            "message": '用户名或密码错误',
            "data": {},
            "error": {}
        });
        }
    } catch (err) {
        console.error('Login error:', err);
        return res.status(500).json({
            "status": "fail",
            "code": 500,
            "message": err.message,
            "data": {},
            "error": {}
        });
    }
});

router.post('/register', async (req, res) => {
    const { username, password } = req.body;

    // Length validation
    if (!username || username.length < 3 || username.length > 20) {
        return res.status(400).json({
            "status": "fail",
            "code": 400,
            "message": '用户名长度需在3-20位之间',
            "data": {},
            "error": {}
        });
    }
    // Password is SHA256 hashed on client (64 chars)
    if (!password || password.length < 10 || password.length > 128) {
        return res.status(400).json({
            "status": "fail",
            "code": 400,
            "message": '注册参数错误',
            "data": {},
            "error": {}
        });
    }

    try {
        // Check for pending users count
        const [pendingRows] = await pool.query('SELECT COUNT(*) as count FROM users WHERE status = ?', ['pending']);
        if (pendingRows[0].count >= 10) {
            return res.status(403).json({
            "status": "fail",
            "code": 403,
            "message": '目前待审批用户较多，请稍后重试或联系管理员',
            "data": {},
            "error": {}
        });
        }

        const [rows] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
        if (rows.length > 0) {
            return res.status(400).json({
            "status": "fail",
            "code": 400,
            "message": '用户名已存在',
            "data": {},
            "error": {}
        });
        }
        
        const nextId = await getNextAvailableUserId();
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query('INSERT INTO users (id, username, password, status, role, last_login_at) VALUES (?, ?, ?, ?, ?, NOW())', 
            [nextId, username, hashedPassword, 'pending', 'user']);

        // Update new user stats
        try {
            await pool.query(`
                INSERT INTO system_stats (stat_date, new_user_count)
                VALUES (CURDATE(), 1)
                ON DUPLICATE KEY UPDATE new_user_count = new_user_count + 1
            `);
        } catch(e) {}
            
        return res.json({ status: "success", message: '注册成功，请等待管理员审核' });
    } catch (err) {
        return res.status(500).json({
            "status": "fail",
            "code": 500,
            "message": '注册失败: ' + err.message,
            "data": {},
            "error": {}
        });
    }
});

router.get('/me', authenticate, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT id, username, role, last_login_at, last_login_ip FROM users WHERE id = ?', [req.userId]);
        if (rows.length > 0) {
            return res.json({ status: "success", user: rows[0] });
        } else {
            return res.status(404).json({
            "status": "fail",
            "code": 404,
            "message": 'User not found',
            "data": {},
            "error": {}
        });
        }
    } catch (err) {
        return res.status(500).json({
            "status": "fail",
            "code": 500,
            "message": err.message,
            "data": {},
            "error": {}
        });
    }
});

router.post('/logout', (req, res) => {
    res.clearCookie('token');
    return res.json({ status: "success" });
});

module.exports = router;
