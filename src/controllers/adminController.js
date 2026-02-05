const { 
    IMG_CACHE_DIR, 
    USERS_DATA_DIR, 
    ANOMALIES_DIR,
    getFolderSize, 
    clearFolderContents 
} = require('../utils/fsUtils');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');

// Admin Stats
async function getAdminStats(pool) {
    try {
        const [[userStats]] = await pool.query('SELECT COUNT(*) as total_users FROM users');
        const [[loginStats]] = await pool.query('SELECT login_count as today_logins FROM system_stats WHERE stat_date = CURDATE()');
        const [[visitorStats]] = await pool.query('SELECT visitor_count as today_visitors FROM system_stats WHERE stat_date = CURDATE()');
        const [[securityBlocks]] = await pool.query('SELECT SUM(block_count) as total_blocks FROM crawler_defense_logs WHERE CAST(created_at AS DATE) = CURDATE()');

        return {
            users: userStats.total_users,
            logins: loginStats ? loginStats.today_logins : 0,
            visitors: visitorStats ? visitorStats.today_visitors : 0,
            blocks: securityBlocks ? securityBlocks.total_blocks : 0
        };
    } catch (err) {
        console.error('Admin Stats Error:', err);
        throw err;
    }
}

async function handleListUsers(pool, query) {
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 10;
    const offset = (page - 1) * limit;
    const [[{total}]] = await pool.query('SELECT COUNT(*) as total FROM users');
    const [rows] = await pool.query('SELECT id, username, role, status, last_login_at, last_login_ip FROM users ORDER BY id DESC LIMIT ? OFFSET ?', [limit, offset]);
    return { success: true, data: rows, total, page, limit };
}

async function addUser(pool, userData) {
    const { username, password, role, status } = userData;
    const [rows] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
    if (rows.length > 0) throw new Error('用户名已存在');
    
    const { getNextAvailableUserId } = require('../utils/dbUtils');
    const nextId = await getNextAvailableUserId();
    
    await pool.query('INSERT INTO users (id, username, password, role, status, last_login_at) VALUES (?, ?, ?, ?, ?, NOW())', 
        [nextId, username, password, role || 'user', status || 'active']);

    await pool.query(`
        INSERT INTO system_stats (stat_date, new_user_count)
        VALUES (CURDATE(), 1)
        ON DUPLICATE KEY UPDATE new_user_count = new_user_count + 1
    `);
    return { success: true };
}

async function getCacheStats() {
    const cacheSize = await getFolderSize(IMG_CACHE_DIR);
    const anomaliesSize = await getFolderSize(ANOMALIES_DIR);
    const cacheFiles = await fsPromises.readdir(IMG_CACHE_DIR).catch(() => []);
    
    let disk = null;
    try {
        const stats = await fsPromises.statfs('/');
        disk = {
            free: stats.bavail * stats.bsize,
            total: stats.blocks * stats.bsize
        };
    } catch (e) {}

    return { 
        success: true,
        count: cacheFiles.length, 
        size: cacheSize + anomaliesSize,
        disk
    };
}

async function handleClearCache() {
    const success1 = await clearFolderContents(IMG_CACHE_DIR);
    const success2 = await clearFolderContents(ANOMALIES_DIR);
    return { success: success1 && success2 };
}

async function handleAdminHistories(pool, query) {
    if (!fs.existsSync(USERS_DATA_DIR)) return { success: true, data: [] };
    
    const userDirs = await fsPromises.readdir(USERS_DATA_DIR);
    let allHistory = [];
    
    const [users] = await pool.query('SELECT id, username FROM users');
    const userMap = users.reduce((acc, u) => { acc[u.id] = u.username; return acc; }, {});

    for (const userId of userDirs) {
        const hPath = path.join(USERS_DATA_DIR, userId, 'history.json');
        try {
            if (!fs.existsSync(hPath)) continue;
            const data = await fsPromises.readFile(hPath, 'utf8');
            const history = JSON.parse(data);
            const username = userMap[userId] || `User ${userId}`;
            
            history.forEach(item => {
                const q = query.q;
                const displayTitle = (item.result && item.result.title) || item.title || item.originalInput || 'Untitled';

                if (q) {
                     const text = displayTitle + (item.url || '') + (item.originalInput || '') + (item.content || '');
                     if (!text.toLowerCase().includes(q.toLowerCase())) return;
                }
                
                allHistory.push({
                    userId,
                    username,
                    timestamp: item.timestamp,
                    title: displayTitle,
                    url: item.url,
                    originalInput: item.originalInput,
                    score: item.result ? item.result.probability : 'N/A'
                });
            });
        } catch (e) {}
    }
    allHistory.sort((a,b) => b.timestamp - a.timestamp); 

    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 10;
    const start = (page - 1) * limit;

    return { 
        success: true, 
        data: allHistory.slice(start, start + limit),
        total: allHistory.length,
        page, limit
    };
}

async function handleAnomalies(extractionManager, query) {
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 10;
    const start = (page - 1) * limit;
    const anomalies = extractionManager.getAnomalies() || [];
    return {
        success: true,
        data: anomalies.slice(start, start + limit),
        total: anomalies.length,
        page, limit
    };
}

async function handleClearAnomalies(extractionManager) {
    extractionManager.clearAnomalies();
    return { success: true };
}

async function handleDeleteAnomaly(extractionManager, id) {
    extractionManager.deleteAnomaly(id);
    return { success: true };
}

async function handleIPLogs(pool, query) {
    const page = parseInt(query.page) || 1;
    const tpage = parseInt(query.tpage) || 1;
    const limit = parseInt(query.limit) || 10;
    const q = query.q || '';

    let hWhere = 'WHERE 1=1';
    let hParams = [];
    if (q) {
        hWhere += ' AND (ip LIKE ? OR ua LIKE ? OR region LIKE ?)';
        const pattern = `%${q}%`;
        hParams.push(pattern, pattern, pattern);
    }

    const [hCount] = await pool.query(`SELECT COUNT(*) as total FROM access_history ${hWhere}`, hParams);
    const [hRows] = await pool.query(`SELECT * FROM access_history ${hWhere} ORDER BY last_access DESC LIMIT ? OFFSET ?`, [...hParams, limit, (page - 1) * limit]);

    const [tCount] = await pool.query(`SELECT COUNT(*) as total FROM access_today WHERE access_date = CURDATE()`);
    const [tRows] = await pool.query(`SELECT * FROM access_today WHERE access_date = CURDATE() ORDER BY last_access DESC LIMIT ? OFFSET ?`, [limit, (tpage - 1) * limit]);

    return {
        success: true,
        history: hRows,
        total: hCount[0].total,
        page,
        today: tRows,
        ttotal: tCount[0].total,
        tpage,
        limit
    };
}

async function handleClearIPLogs(pool) {
    await pool.query('DELETE FROM access_history');
    await pool.query('DELETE FROM access_today');
    return { success: true };
}

async function handleBlacklist(pool, query) {
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 10;
    const offset = (page - 1) * limit;
    const [[{total}]] = await pool.query('SELECT COUNT(*) as total FROM ip_blacklist');
    const [rows] = await pool.query('SELECT * FROM ip_blacklist ORDER BY created_at DESC LIMIT ? OFFSET ?', [limit, offset]);
    return { success: true, data: rows, total, page, limit };
}

async function addBlacklist(pool, { ip, reason }) {
    await pool.query('INSERT IGNORE INTO ip_blacklist (ip, reason) VALUES (?, ?)', [ip, reason || 'Manual Ban']);
    return { success: true };
}

async function removeBlacklist(pool, id) {
    await pool.query('DELETE FROM ip_blacklist WHERE id = ?', [id]);
    return { success: true };
}

async function getCrawlerSettings(pool) {
    const [rows] = await pool.query('SELECT * FROM crawler_settings');
    const settings = {};
    rows.forEach(r => settings[r.setting_key] = r.setting_value);
    return { success: true, data: settings };
}

async function saveCrawlerSettings(pool, settings) {
    for (const [key, val] of Object.entries(settings)) {
        await pool.query('INSERT INTO crawler_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)', [key, val]);
    }
    return { success: true };
}

async function handleCrawlerLogs(pool, query) {
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 10;
    const offset = (page - 1) * limit;
    const [[{total}]] = await pool.query('SELECT COUNT(*) as total FROM blocked_logs');
    const [rows] = await pool.query('SELECT * FROM blocked_logs ORDER BY last_blocked_at DESC LIMIT ? OFFSET ?', [limit, offset]);
    return { success: true, data: rows, total, page, limit };
}

async function clearCrawlerLogs(pool) {
    await pool.query('DELETE FROM blocked_logs');
    return { success: true };
}

async function getConfig() {
    const configPath = path.join(__dirname, '../../data/config.json');
    try {
        if (!fs.existsSync(configPath)) return { success: true, data: {} };
        const data = await fsPromises.readFile(configPath, 'utf8');
        return { success: true, data: JSON.parse(data) };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function saveConfig(config) {
    const configPath = path.join(__dirname, '../../data/config.json');
    try {
        await fsPromises.writeFile(configPath, JSON.stringify(config, null, 2));
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

module.exports = {
    getAdminStats,
    handleListUsers,
    addUser,
    getCacheStats,
    handleClearCache,
    handleAdminHistories,
    handleAnomalies,
    handleClearAnomalies,
    handleDeleteAnomaly,
    handleIPLogs,
    handleClearIPLogs,
    handleBlacklist,
    addBlacklist,
    removeBlacklist,
    getCrawlerSettings,
    saveCrawlerSettings,
    handleCrawlerLogs,
    clearCrawlerLogs,
    getConfig,
    saveConfig
};
