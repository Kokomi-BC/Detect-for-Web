const { pool } = require('../config/db');

const loggerMiddleware = async (req, res, next) => {
    // Skip logging for resource-heavy or frequent requests like icons and favicons
    if (req.url.endsWith('.ico') || req.url.includes('/ico/')) {
        return next();
    }

    const { method, url } = req;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    
    // Check Blacklist
    try {
         const [rows] = await pool.query('SELECT 1 FROM ip_blacklist WHERE ip = ?', [ip]);
         if (rows.length > 0) {
             return res.status(403).send('Access Denied');
         }
    } catch(e) {}

    const ua = req.headers['user-agent'] || 'Unknown';
    const accessDate = new Date().toISOString().split('T')[0];

    // Log to DB (Async, don't block request)
    (async () => {
        try {
            await pool.query(`
                INSERT INTO access_history (ip, ua, last_access) 
                VALUES (?, ?, NOW()) 
                ON DUPLICATE KEY UPDATE last_access = NOW()
            `, [ip, ua]);
            
            // Log for Today stats ONLY if not visited in session
            if (!req.cookies.visited_session) {
                await pool.query(`
                    INSERT INTO access_today (ip, access_date, hit_count)
                    VALUES (?, ?, 1)
                    ON DUPLICATE KEY UPDATE hit_count = hit_count + 1
                `, [ip, accessDate]);
            }
        } catch (e) {
            console.error('Failed to log access to DB:', e);
        }
    })();
    
    // Set daily session cookie if not set
    if (!req.cookies.visited_session) {
         res.cookie('visited_session', '1', { httpOnly: true, maxAge: 86400000 }); // 24 hours
    }

    const start = Date.now();
    // Capture response finish
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`[${new Date().toISOString()}] ${method} ${url} ${res.statusCode} - ${duration}ms - ${ip}`);
    });
    next();
};

module.exports = loggerMiddleware;
