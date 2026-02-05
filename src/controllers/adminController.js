const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;

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

// User Management Logic
async function listUsers(pool, page, limit) {
    const offset = (page - 1) * limit;
    const [[{total}]] = await pool.query('SELECT COUNT(*) as total FROM users');
    const [rows] = await pool.query('SELECT id, username, role, status, last_login_at, last_login_ip FROM users ORDER BY id DESC LIMIT ? OFFSET ?', [limit, offset]);
    return { data: rows, total, page, limit };
}

async function addUser(pool, userData) {
    const { username, password, role, status } = userData;
    const [rows] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
    if (rows.length > 0) throw new Error('用户名已存在');
    
    // Use the utility to get the next available ID
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

// Cache stats
async function getCacheStats(IMG_CACHE_DIR) {
    const files = await fsPromises.readdir(IMG_CACHE_DIR);
    let totalSize = 0;
    for (const file of files) {
        try {
            const stats = await fsPromises.stat(path.join(IMG_CACHE_DIR, file));
            totalSize += stats.size;
        } catch(e) {}
    }

    let diskInfo = null;
    try {
        const diskStats = await fsPromises.statfs('/');
        diskInfo = {
            free: diskStats.bavail * diskStats.bsize,
            total: diskStats.blocks * diskStats.bsize
        };
    } catch (diskErr) {}

    return { 
        count: files.length, 
        size: totalSize,
        disk: diskInfo
    };
}

module.exports = {
    getAdminStats,
    listUsers,
    addUser,
    getCacheStats,
    handleListUsers,
    handleAdminHistories
};

// ... existing code ...
async function handleListUsers(pool, query) {
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 10;
    const offset = (page - 1) * limit;
    const [[{total}]] = await pool.query('SELECT COUNT(*) as total FROM users');
    const [rows] = await pool.query('SELECT id, username, role, status, last_login_at, last_login_ip FROM users ORDER BY id DESC LIMIT ? OFFSET ?', [limit, offset]);
    return { success: true, data: rows, total, page, limit };
}

async function handleAdminHistories(pool, query, USERS_DATA_DIR) {
    if (!fs.existsSync(USERS_DATA_DIR)) return { success: true, data: [] };
    
    const userDirs = await fsPromises.readdir(USERS_DATA_DIR);
    let allHistory = [];
    
    const [users] = await pool.query('SELECT id, username FROM users');
    const userMap = users.reduce((acc, u) => { acc[u.id] = u.username; return acc; }, {});

    for (const userId of userDirs) {
        const hPath = path.join(USERS_DATA_DIR, userId, 'history.json');
        try {
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
