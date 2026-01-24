const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'detect_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function initDB() {
    const connection = await pool.getConnection();
    try {
        await connection.query(`CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME || 'detect_db'}\``);
        await connection.query(`USE \`${process.env.DB_NAME || 'detect_db'}\``);
        
        await connection.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                role VARCHAR(20) DEFAULT 'user',
                status VARCHAR(20) DEFAULT 'pending',
                last_login_at DATETIME,
                last_login_ip VARCHAR(45)
            )
        `);

        // Migration for existing tables
        try { await connection.query("ALTER TABLE users ADD COLUMN role VARCHAR(20) DEFAULT 'user'"); } catch (e) {}
        try { await connection.query("ALTER TABLE users ADD COLUMN status VARCHAR(20) DEFAULT 'active'"); } catch (e) {}
        try { await connection.query("ALTER TABLE users ADD COLUMN last_login_at DATETIME"); } catch (e) {}
        try { await connection.query("ALTER TABLE users ADD COLUMN last_login_ip VARCHAR(45)"); } catch (e) {}
        try { await connection.query("ALTER TABLE users ADD COLUMN token_version INT DEFAULT 0"); } catch (e) {}
        
        // Ensure at least one admin exists
        const [adminRows] = await connection.query("SELECT * FROM users WHERE role = 'admin'");
        if (adminRows.length === 0) {
            // Get smallest available ID
            const [idRows] = await connection.query(`
                SELECT 
                    CASE 
                        WHEN NOT EXISTS (SELECT 1 FROM users WHERE id = 1) THEN 1 
                        ELSE (SELECT MIN(id + 1) FROM users WHERE (id + 1) NOT IN (SELECT id FROM users)) 
                    END AS next_id
            `);
            const nextId = idRows[0].next_id;

            // Password 'admin123' hashed (SHA-256)
            await connection.query("INSERT INTO users (id, username, password, role, status) VALUES (?, ?, ?, 'admin', 'active')", 
                [nextId, 'admin', '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9']);
            console.log(`No admin found. Default admin account created with ID ${nextId}: admin / admin123`);
        }
        
        await connection.query(`
            CREATE TABLE IF NOT EXISTS audit_history (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT,
                title TEXT,
                content TEXT,
                text_content TEXT,
                images JSON,
                url TEXT,
                timestamp BIGINT,
                result JSON,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS access_history (
                ip VARCHAR(45),
                ua TEXT,
                last_access DATETIME,
                PRIMARY KEY (ip, ua(255))
            )
        `);
        
        await connection.query(`
            CREATE TABLE IF NOT EXISTS access_today (
                ip VARCHAR(45),
                access_date DATE,
                hit_count INT DEFAULT 1,
                PRIMARY KEY (ip, access_date)
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS ip_blacklist (
                id INT AUTO_INCREMENT PRIMARY KEY,
                ip VARCHAR(45) UNIQUE NOT NULL,
                reason VARCHAR(255),
                created_at DATETIME DEFAULT NOW()
            )
        `);

        console.log('Database initialized successfully');
    } catch (err) {
        console.error('Database initialization failed:', err);
    } finally {
        connection.release();
    }
}

module.exports = { pool, initDB };
