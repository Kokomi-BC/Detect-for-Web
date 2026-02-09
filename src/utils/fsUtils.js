const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '../../data');
const IMG_CACHE_DIR = path.join(DATA_DIR, 'img_cache');
const USERS_DATA_DIR = path.join(DATA_DIR, 'users');
const PRESETS_DIR = path.join(DATA_DIR, 'presets');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const ANOMALIES_DIR = path.join(DATA_DIR, 'anomalies');

// Ensure essential directories exist
[DATA_DIR, IMG_CACHE_DIR, USERS_DATA_DIR, PRESETS_DIR, UPLOADS_DIR, ANOMALIES_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

/**
 * Validates if a target path is safely contained within a base directory.
 * @param {string} base The intended parent directory (must be absolute)
 * @param {string} target The constructed target path
 * @returns {boolean}
 */
function isPathSafe(base, target) {
    const resolvedBase = path.resolve(base);
    const resolvedTarget = path.resolve(target);
    return resolvedTarget.startsWith(resolvedBase);
}

/**
 * Sanitizes a string to be used as a filename or directory name.
 * @param {string|number} input 
 * @returns {string}
 */
function sanitizeId(input) {
    return String(input).replace(/[^a-zA-Z0-9_-]/g, '');
}

function getUserHistoryPath(userId) {
    const safeId = sanitizeId(userId);
    return path.join(USERS_DATA_DIR, safeId, 'history.json');
}

function getUserPreferencesPath(userId) {
    const safeId = sanitizeId(userId);
    return path.join(USERS_DATA_DIR, safeId, 'preferences.json');
}

function getUserAvatarDir(userId) {
    const safeId = sanitizeId(userId);
    return path.join(USERS_DATA_DIR, safeId);
}

async function ensureUserDir(userId) {
    const userDir = getUserAvatarDir(userId);
    if (!fs.existsSync(userDir)) {
        await fsPromises.mkdir(userDir, { recursive: true });
    }
}

async function findAvatarFile(userId) {
    const dir = getUserAvatarDir(userId);
    if (!isPathSafe(USERS_DATA_DIR, dir) || !fs.existsSync(dir)) return null;
    try {
        const files = await fsPromises.readdir(dir);
        const avatarFile = files.find(f => f.startsWith('avatar.'));
        if (!avatarFile) return null;
        const fullPath = path.join(dir, avatarFile);
        return isPathSafe(dir, fullPath) ? fullPath : null;
    } catch (e) {
        return null;
    }
}

async function getFolderSize(dirPath) {
    if (!fs.existsSync(dirPath)) return 0;
    try {
        const files = await fsPromises.readdir(dirPath);
        let totalSize = 0;
        for (const file of files) {
            const fullPath = path.join(dirPath, file);
            const stats = await fsPromises.stat(fullPath);
            if (stats.isFile()) {
                totalSize += stats.size;
            } else if (stats.isDirectory()) {
                totalSize += await getFolderSize(fullPath);
            }
        }
        return totalSize;
    } catch (e) {
        return 0;
    }
}

async function clearFolderContents(dirPath) {
    if (!fs.existsSync(dirPath)) return true;
    try {
        const files = await fsPromises.readdir(dirPath);
        for (const file of files) {
            await fsPromises.rm(path.join(dirPath, file), { recursive: true, force: true });
        }
        return true;
    } catch (e) {
        console.error(`Error clearing folder ${dirPath}:`, e);
        return false;
    }
}

async function deleteCachedImages(imageUrls) {
    if (!imageUrls || !Array.isArray(imageUrls)) return;
    for (const url of imageUrls) {
        let targetUrl = url;
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
        } catch (e) {}
    }
}

module.exports = {
    DATA_DIR,
    IMG_CACHE_DIR,
    USERS_DATA_DIR,
    PRESETS_DIR,
    UPLOADS_DIR,
    ANOMALIES_DIR,
    isPathSafe,
    sanitizeId,
    getUserHistoryPath,
    getUserPreferencesPath,
    getUserAvatarDir,
    ensureUserDir,
    findAvatarFile,
    getFolderSize,
    clearFolderContents,
    deleteCachedImages
};
