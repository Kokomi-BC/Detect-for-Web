const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const sharp = require('sharp');
const bcrypt = require('bcrypt');
const { ensureUserDir, getUserAvatarDir, findAvatarFile } = require('../utils/fsUtils');

async function handleAvatarUpload(userId, file) {
    await ensureUserDir(userId);
    const oldAvatar = await findAvatarFile(userId);
    if (oldAvatar) await fsPromises.unlink(oldAvatar);
    
    let buffer = file.buffer;
    const MB = 1024 * 1024;

    if (buffer.length > MB) {
        buffer = await sharp(buffer)
            .resize(500, 500, { fit: 'cover' })
            .jpeg({ quality: 80 })
            .toBuffer();
        
        if (buffer.length > MB) {
            buffer = await sharp(buffer).jpeg({ quality: 60 }).toBuffer();
        }
    }

    const newPath = path.join(getUserAvatarDir(userId), `avatar.jpg`);
    await fsPromises.writeFile(newPath, buffer);
    return true;
}

async function handleUpdateUser(pool, userId, body) {
    const { username, password, role } = body;
    
    if (role && role !== 'user' && body.isSelfUpdate) {
        throw new Error('不允许修改角色');
    }

    if (username) {
        const [existing] = await pool.query('SELECT id FROM users WHERE username = ? AND id != ?', [username, userId]);
        if (existing.length > 0) throw new Error('用户名已存在');
    }

    let q = 'UPDATE users SET id = id';
    let params = [];
    
    if (username) { q += ', username = ?'; params.push(username); }
    if (password) { 
        const hashedPassword = await bcrypt.hash(password, 10);
        q += ', password = ?'; 
        params.push(hashedPassword); 
    }
    if (role && !body.isSelfUpdate) { q += ', role = ?'; params.push(role); }
    
    q += ' WHERE id = ?';
    params.push(userId);
    
    const [result] = await pool.query(q, params);
    if (result.affectedRows === 0) throw new Error('用户不存在');
    return { success: true };
}

module.exports = {
    handleAvatarUpload,
    handleUpdateUser
};
