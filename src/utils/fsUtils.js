const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const crypto = require('crypto');

const IMG_CACHE_DIR = path.join(__dirname, '../../data/img_cache');
const USERS_DATA_DIR = path.join(__dirname, '../../data/users');

if (!fs.existsSync(IMG_CACHE_DIR)) {
    fs.mkdirSync(IMG_CACHE_DIR, { recursive: true });
}

function getUserHistoryPath(userId) {
    return path.join(USERS_DATA_DIR, String(userId), 'history.json');
}

function getUserAvatarDir(userId) {
    return path.join(USERS_DATA_DIR, String(userId));
}

async function ensureUserDir(userId) {
    const userDir = getUserAvatarDir(userId);
    await fsPromises.mkdir(userDir, { recursive: true });
}

async function findAvatarFile(userId) {
    const dir = getUserAvatarDir(userId);
    if (!fs.existsSync(dir)) return null;
    const files = await fsPromises.readdir(dir);
    const avatarFile = files.find(f => f.startsWith('avatar.'));
    return avatarFile ? path.join(dir, avatarFile) : null;
}

async function deleteCachedImages(imageUrls) {
    if (!imageUrls || !Array.isArray(imageUrls)) return;
    for (const url of imageUrls) {
        let targetUrl = url;
        // Decode nested proxy URLs
        while (targetUrl && (targetUrl.startsWith('/api/proxy-image') || targetUrl.includes('api/proxy-image?url='))) {
            try {
                const urlObj = new URL(targetUrl, 'https://localhost');
                targetUrl = urlObj.searchParams.get('url');
            } catch (e) { break; }
        }
        if (!targetUrl || !targetUrl.startsWith('http')) continue;

        const cacheKey = crypto.createHash('md5').update(targetUrl).digest('hex');
        try {
            const cachePath = path.join(IMG_CACHE_DIR, cacheKey);
            const metaPath = cachePath + '.json';
            if (fs.existsSync(cachePath)) await fsPromises.unlink(cachePath);
            if (fs.existsSync(metaPath)) await fsPromises.unlink(metaPath);
        } catch (e) { console.error('Delete cache error:', e); }
    }
}

module.exports = {
    IMG_CACHE_DIR,
    USERS_DATA_DIR,
    getUserHistoryPath,
    getUserAvatarDir,
    ensureUserDir,
    findAvatarFile,
    deleteCachedImages
};
