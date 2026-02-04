const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');

const SECRET_KEY = 'your_secret_key'; // In a real app, this should be in an env var

const authenticate = async (req, res, next) => {
    const token = req.cookies.token;
    
    if (!token) return res.sendStatus(401);
    
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        
        // Check single session
        const [rows] = await pool.query('SELECT token_version FROM users WHERE id = ?', [decoded.userId]);
        if (rows.length === 0 || rows[0].token_version !== decoded.token_version) {
            res.clearCookie('token');
            return res.sendStatus(401);
        }

        req.userId = decoded.userId;
        next();
    } catch (err) {
        res.sendStatus(401);
    }
};

const authenticateAdmin = async (req, res, next) => {
    if (!req.userId) return res.sendStatus(401);
    try {
        const [rows] = await pool.query('SELECT role FROM users WHERE id = ?', [req.userId]);
        if (rows.length > 0 && rows[0].role === 'admin') {
            next();
        } else {
            res.sendStatus(403);
        }
    } catch (err) {
        res.sendStatus(500);
    }
};

module.exports = {
    authenticate,
    authenticateAdmin,
    SECRET_KEY
};
