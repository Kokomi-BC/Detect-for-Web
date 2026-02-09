const fsPromises = require('fs').promises;
const path = require('path');
const { getUserHistoryPath } = require('../utils/fsUtils');

async function handleGetHistory(req, args) {
    const historyPath = getUserHistoryPath(req.userId);
    try {
        const data = await fsPromises.readFile(historyPath, 'utf8');
        let history = JSON.parse(data);
        
        const params = args[0] || {};
        const page = parseInt(params.page) || 1;
        const limit = parseInt(params.limit) || 20;
        const query = params.query ? params.query.toLowerCase().trim() : '';

        // Apply filtering if query exists
        if (query) {
            history = history.filter(item => {
                const title = (item.result?.title || item.title || '').toLowerCase();
                const content = (item.content || '').toLowerCase();
                const url = (item.url || '').toLowerCase();
                return title.includes(query) || content.includes(query) || url.includes(query);
            });
        }
        
        const startIndex = (page - 1) * limit;
        const endIndex = page * limit;
        
        const hasMore = history.length > endIndex;
        let pageResult = history.slice(startIndex, endIndex);

        if (params.metadataOnly) {
            pageResult = pageResult.map(item => {
                let preview = '';
                if (item.content) {
                    preview = item.content.replace(/<[^>]*>/g, '').substring(0, 50).trim();
                }
                
                return {
                    timestamp: item.timestamp,
                    title: item.result?.title || item.title || (preview ? preview.substring(0, 15) : '未命名分析'),
                    preview: preview,
                    url: item.url,
                    hasResult: !!item.result,
                    hasImages: !!(item.images && item.images.length > 0)
                };
            });
        }
        return {
            data: pageResult,
            hasMore: hasMore,
            total: history.length
        };
    } catch (err) {
        if (err.code === 'ENOENT') return { data: [], hasMore: false, total: 0 };
        throw err;
    }
}

async function handleGetHistoryItem(req, args) {
    const historyPath = getUserHistoryPath(req.userId);
    const timestamp = args[0];
    try {
        const data = await fsPromises.readFile(historyPath, 'utf8');
        const history = JSON.parse(data);
        return history.find(item => item.timestamp === timestamp);
    } catch (err) {
        return null;
    }
}

async function handleSaveHistory(req, args) {
    const historyPath = getUserHistoryPath(req.userId);
    let currentHistory = [];
    try {
        const data = await fsPromises.readFile(historyPath, 'utf8');
        currentHistory = JSON.parse(data);
    } catch (err) { if (err.code !== 'ENOENT') throw err; }
    
    const newItem = args[0];
    if (newItem) {
        currentHistory.unshift(newItem);
        if (currentHistory.length > 100) currentHistory = currentHistory.slice(0, 100);
        await fsPromises.writeFile(historyPath, JSON.stringify(currentHistory, null, 2));
    }
    return { success: true };
}

async function handleDeleteHistory(req, args, deleteCachedImages) {
    const historyPath = getUserHistoryPath(req.userId);
    try {
        const data = await fsPromises.readFile(historyPath, 'utf8');
        const history = JSON.parse(data);
        const itemToDelete = history.find(item => item.timestamp === args[0]);
        if (itemToDelete && itemToDelete.images) {
            await deleteCachedImages(itemToDelete.images);
        }
        const newHistory = history.filter(item => item.timestamp !== args[0]);
        await fsPromises.writeFile(historyPath, JSON.stringify(newHistory, null, 2));
        return { success: true };
    } catch (err) { 
        if (err.code === 'ENOENT') return {success:true};
        throw err;
    }
}

async function handleClearHistory(req, deleteCachedImages) {
    try {
        const historyPath = getUserHistoryPath(req.userId);
        const data = await fsPromises.readFile(historyPath, 'utf8');
        const history = JSON.parse(data);
        for(const item of history) {
            if(item.images) await deleteCachedImages(item.images);
        }
        await fsPromises.writeFile(historyPath, JSON.stringify([], null, 2));
        return { success: true };
    } catch(e) {
        return { success: true };
    }
}

module.exports = {
    handleGetHistory,
    handleGetHistoryItem,
    handleSaveHistory,
    handleDeleteHistory,
    handleClearHistory
};
