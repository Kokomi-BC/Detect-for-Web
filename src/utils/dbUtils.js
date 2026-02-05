const { pool } = require('../config/db');

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

module.exports = {
    getNextAvailableUserId
};
