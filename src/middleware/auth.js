const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');

const SECRET_KEY = 'your_secret_key'; // In a real app, this should be in an env var

const authenticate = async (req, res, next) => {
    const token = req.cookies.token;
    
    if (!token) return res.status(401).json({ success: false, error: 'Unauthorized' });
    
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        
        // Check single session
        const [rows] = await pool.query('SELECT token_version FROM users WHERE id = ?', [decoded.userId]);
        if (rows.length === 0 || rows[0].token_version !== decoded.token_version) {
            res.clearCookie('token');
            return res.status(401).json({ success: false, error: 'Session expired or logged in on another device' });
        }

        req.userId = decoded.userId;
        next();
    } catch (err) {
        res.status(401).json({ success: false, error: 'Invalid token' });
    }
};

const authenticateAdmin = async (req, res, next) => {
    if (!req.userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    try {
        const [rows] = await pool.query('SELECT role FROM users WHERE id = ?', [req.userId]);
        if (rows.length > 0 && rows[0].role === 'admin') {
            next();
        } else {
            res.status(403).json({ success: false, error: 'Forbidden' });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

module.exports = {
    authenticate,
    authenticateAdmin,
    SECRET_KEY
};
