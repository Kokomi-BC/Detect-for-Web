const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');

const SECRET_KEY = 'your_secret_key'; // In a real app, this should be in an env var

const authenticate = async (req, res, next) => {
    const token = req.cookies.token;
    
    if (!token) return res.status(401).json({
        "status": "fail",
        "code": 401,
        "message": "未登录",
        "data": {},
        "error": {}
    });
    
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        
        // Check single session
        const [rows] = await pool.query('SELECT token_version FROM users WHERE id = ?', [decoded.userId]);
        if (rows.length === 0 || rows[0].token_version !== decoded.token_version) {
            res.clearCookie('token');
            return res.status(401).json({
                "status": "fail",
                "code": 401,
                "message": "登录已过期",
                "data": {},
                "error": {}
            });
        }

        req.userId = decoded.userId;
        next();
    } catch (err) {
        return res.status(401).json({
            "status": "fail",
            "code": 401,
            "message": "验证失败",
            "data": {},
            "error": {}
        });
    }
};

const authenticateAdmin = async (req, res, next) => {
    if (!req.userId) return res.status(401).json({
        "status": "fail",
        "code": 401,
        "message": "未登录",
        "data": {},
        "error": {}
    });
    try {
        const [rows] = await pool.query('SELECT role FROM users WHERE id = ?', [req.userId]);
        if (rows.length > 0 && rows[0].role === 'admin') {
            next();
        } else {
            return res.status(403).json({
                "status": "fail",
                "code": 403,
                "message": "权限不足",
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
};

module.exports = {
    authenticate,
    authenticateAdmin,
    SECRET_KEY
};
