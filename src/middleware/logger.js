const { pool } = require('../config/db');
const { getIpRegion } = require('../utils/utils');

// Cache for crawler settings to avoid DB hit on every request
let crawlerSettings = {
    ua_min_length: 10,
    ua_keywords: [],
    lastUpdate: 0
};

async function getCrawlerSettings() {
    const now = Date.now();
    if (now - crawlerSettings.lastUpdate > 60000) { // Update every 1 minute
        try {
            const [rows] = await pool.query('SELECT * FROM crawler_settings');
            const settings = {};
            rows.forEach(r => settings[r.setting_key] = r.setting_value);
            crawlerSettings = {
                ua_min_length: parseInt(settings.ua_min_length) || 10,
                ua_keywords: (settings.ua_keywords || '').split(',').map(s => s.trim().toLowerCase()).filter(s => s),
                lastUpdate: now
            };
        } catch (e) {
            console.error('Failed to fetch crawler settings:', e);
        }
    }
    return crawlerSettings;
}

const loggerMiddleware = async (req, res, next) => {
    // Skip logging for resource-heavy or frequent requests like icons and favicons
    if (req.url.endsWith('.ico') || req.url.includes('/ico/')) {
        return next();
    }

    const { method, url } = req;
    let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (ip && ip.includes(',')) ip = ip.split(',')[0].trim();
    if (ip && ip.startsWith('::ffff:')) ip = ip.substring(7);

    const ua = req.headers['user-agent'] || 'Unknown';

    // 1. Crawler Defense Logic
    const settings = await getCrawlerSettings();
    let isBlocked = false;
    let blockReason = '';

    if (ua.length < settings.ua_min_length) {
        isBlocked = true;
        blockReason = `UA 长度过短 (${ua.length} < ${settings.ua_min_length})`;
    } else {
        const lowerUA = ua.toLowerCase();
        const matched = settings.ua_keywords.find(k => lowerUA.includes(k));
        if (matched) {
            isBlocked = true;
            blockReason = `UA 包含敏感词: ${matched}`;
        }
    }

    if (isBlocked) {
        // Async log block
        (async () => {
            try {
                const region = await getIpRegion(ip);
                await pool.query(`
                    INSERT INTO blocked_logs (ip, ua, region, reason, last_blocked_at, block_count)
                    VALUES (?, ?, ?, ?, NOW(), 1)
                    ON DUPLICATE KEY UPDATE last_blocked_at = NOW(), block_count = block_count + 1, ua = VALUES(ua), region = IFNULL(region, VALUES(region))
                `, [ip, ua, region, blockReason]);

                // Update system stats
                await pool.query(`
                    INSERT INTO system_stats (stat_date, blocked_count)
                    VALUES (CURDATE(), 1)
                    ON DUPLICATE KEY UPDATE blocked_count = blocked_count + 1
                `);
            } catch (e) {
                console.error('Failed to log blocked crawler:', e);
            }
        })();
        return res.sendStatus(403);
    }

    // 2. Blacklist Check
    try {
        const [rows] = await pool.query('SELECT 1 FROM ip_blacklist WHERE ip = ?', [ip]);
        if (rows.length > 0) {
            // Record blacklist block in logs
            (async () => {
                try {
                    const region = await getIpRegion(ip);
                    await pool.query(`
                        INSERT INTO blocked_logs (ip, ua, region, reason, last_blocked_at, block_count)
                        VALUES (?, ?, ?, ?, NOW(), 1)
                        ON DUPLICATE KEY UPDATE last_blocked_at = NOW(), block_count = block_count + 1, ua = VALUES(ua), region = IFNULL(region, VALUES(region))
                    `, [ip, ua, region, 'IP 黑名单封禁']);

                    await pool.query(`
                        INSERT INTO system_stats (stat_date, blocked_count)
                        VALUES (CURDATE(), 1)
                        ON DUPLICATE KEY UPDATE blocked_count = blocked_count + 1
                    `);
                } catch (e) { }
            })();
            return res.status(403).json({
            "status": "fail",
            "code": 403,
            "message": 'Access Denied',
            "data": {},
            "error": {}
        });
        }
    } catch (e) { }

    // 3. Normal Access Log (Log to DB)
    (async () => {
        try {
            const isNewVisit = !req.cookies.visited_session;

            // 只有新访问（会话开始）才增加总访问频次统计
            if (isNewVisit) {
                await pool.query(`
                    INSERT INTO system_stats (stat_date, access_count)
                    VALUES (CURDATE(), 1)
                    ON DUPLICATE KEY UPDATE access_count = access_count + 1
                `);
            }

            // Get region if not already known for this IP
            const [existing] = await pool.query('SELECT region FROM access_history WHERE ip = ? AND region IS NOT NULL LIMIT 1', [ip]);
            let region = (existing && existing.length > 0) ? existing[0].region : null;
            if (!region) {
                region = await getIpRegion(ip);
            }

            // Log access_history - Update last_access ONLY, do not double count
            await pool.query(`
                INSERT INTO access_history (ip, ua, last_access, region) 
                VALUES (?, ?, NOW(), ?) 
                ON DUPLICATE KEY UPDATE last_access = NOW(), region = IFNULL(region, ?)
            `, [ip, ua, region, region]);

            // Log access_today - Check for unique IP today
            const [todayResult] = await pool.query(`
                INSERT IGNORE INTO access_today (ip, access_date, hit_count, last_access, region)
                VALUES (?, CURDATE(), 1, NOW(), ?)
            `, [ip, region]);

            if (todayResult.affectedRows > 0) {
                // This is a NEW IP for today, increment unique_visitor_count
                await pool.query(`
                    INSERT INTO system_stats (stat_date, unique_visitor_count)
                    VALUES (CURDATE(), 1)
                    ON DUPLICATE KEY UPDATE unique_visitor_count = unique_visitor_count + 1
                `);
            } else {
                // Existing IP today
                if (isNewVisit) {
                    // New session from same IP today: increment hit_count
                    await pool.query(`
                        UPDATE access_today 
                        SET hit_count = hit_count + 1, last_access = NOW(), region = IFNULL(region, ?)
                        WHERE ip = ? AND access_date = CURDATE()
                    `, [region, ip]);
                } else {
                    // Ongoing session: only update last_access
                    await pool.query(`
                        UPDATE access_today 
                        SET last_access = NOW(), region = IFNULL(region, ?)
                        WHERE ip = ? AND access_date = CURDATE()
                    `, [region, ip]);
                }
            }

        } catch (e) {
            console.error(`[Logger] Failed to record IP ${ip} to DB:`, e.stack);
        }
    })();

    // Set daily session cookie
    if (!res.headersSent && !req.cookies.visited_session) {
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
