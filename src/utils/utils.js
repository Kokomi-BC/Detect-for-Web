/**
 * 工具函数集合 - 提供通用的工具方法
 */

/**
 * 等待指定时间
 * @param {number} ms 等待时间（毫秒）
 * @returns {Promise}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 重试执行函数
 * @param {Function} fn 要执行的函数
 * @param {number} maxRetries 最大重试次数
 * @param {number} delay 初始延迟时间（毫秒）
 * @param {Function} isRetryCondition 可选的retry条件检查函数
 * @returns {Promise}
 */
async function retry(fn, maxRetries = 3, delay = 1000, isRetryCondition = null) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      console.log(`第${attempt}次尝试失败:`, error.message);
      
      if (attempt < maxRetries) {
        // 检查是否应该重试
        if (isRetryCondition && !isRetryCondition(error)) {
          throw error;
        }
        
        const waitTime = delay * Math.pow(1.5, attempt - 1); // 指数退避
        console.log(`等待${waitTime}ms后重试...`);
        await sleep(waitTime);
      }
    }
  }
  
  throw lastError;
}

/**
 * 安全的JSON解析
 * @param {string} jsonString JSON字符串
 * @param {any} defaultValue 解析失败时返回的默认值
 * @returns {any}
 */
function safeJsonParse(jsonString, defaultValue = null) {
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    console.error('JSON解析失败:', error);
    return defaultValue;
  }
}

/**
 * 安全的URL解析
 * @param {string} urlString URL字符串
 * @param {string} baseUrl 基础URL
 * @returns {URL|null}
 */
function safeUrlParse(urlString, baseUrl = null) {
  try {
    return new URL(urlString, baseUrl);
  } catch (error) {
    console.error('URL解析失败:', urlString, error);
    return null;
  }
}

/**
 * 限制文本长度
 * @param {string} text 原始文本
 * @param {number} maxLength 最大长度
 * @param {string} suffix 截断后添加的后缀
 * @returns {string}
 */
function truncateText(text, maxLength = 20000, suffix = '...') {
  if (!text || typeof text !== 'string') {
    return '';
  }
  
  if (text.length <= maxLength) {
    return text;
  }
  
  return text.substring(0, maxLength - suffix.length) + suffix;
}

/**
 * 获取 IP 地理位置信息 (百度 API)
 * @param {string} ip IP 地址
 * @returns {Promise<string>} 地理位置字符串
 */
async function getIpRegion(ip) {
    if (!ip || ip === '::1' || ip === '127.0.0.1') return '内网/本地';
    try {
        const res = await fetch(`https://opendata.baidu.com/api.php?co=&resource_id=6006&oe=utf8&query=${encodeURIComponent(ip)}`, {
            signal: AbortSignal.timeout(3000)
        });
        const json = await res.json();
        if (json && json.status === '0' && json.data && json.data[0]) {
            return json.data[0].location || '未知地区';
        }
    } catch (e) {
        console.error('IP Region lookup failed:', e.message);
    }
    return '';
}

function stripHtmlTags(html) {
  if (!html || typeof html !== 'string') {
    return '';
  }
  
  return html.replace(/<[^>]*>/g, '');
}

/**
 * 格式化文件大小
 * @param {number} bytes 字节数
 * @returns {string}
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * 检查是否为有效的邮箱地址
 * @param {string} email 邮箱地址
 * @returns {boolean}
 */
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * 生成随机ID
 * @param {number} length ID长度
 * @returns {string}
 */
function generateRandomId(length = 8) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * 深度克隆对象
 * @param {any} obj 要克隆的对象
 * @returns {any}
 */
function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  
  if (obj instanceof Date) {
    return new Date(obj.getTime());
  }
  
  if (obj instanceof Array) {
    return obj.map(item => deepClone(item));
  }
  
  const cloned = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      cloned[key] = deepClone(obj[key]);
    }
  }
  
  return cloned;
}

/**
 * 防抖函数
 * @param {Function} func 要执行的函数
 * @param {number} delay 延迟时间
 * @returns {Function}
 */
function debounce(func, delay) {
  let timeoutId;
  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func.apply(this, args), delay);
  };
}

/**
 * 节流函数
 * @param {Function} func 要执行的函数
 * @param {number} limit 时间限制
 * @returns {Function}
 */
function throttle(func, limit) {
  let inThrottle;
  return function (...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

/**
 * 将错误对象转换为可序列化的格式
 * @param {Error} error 错误对象
 * @returns {Object}
 */
function serializeError(error) {
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    code: error.code
  };
}

/**
 * 检查对象是否为空
 * @param {any} obj 要检查的对象
 * @returns {boolean}
 */
function isEmpty(obj) {
  if (obj == null) return true;
  if (Array.isArray(obj) || typeof obj === 'string') return obj.length === 0;
  if (typeof obj === 'object') return Object.keys(obj).length === 0;
  return false;
}

/**
 * 从URL中提取域名
 * @param {string} url URL字符串
 * @returns {string}
 */
function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch (error) {
    return '';
  }
}

/**
 * 格式化日期
 * @param {Date} date 日期对象
 * @param {string} format 格式字符串
 * @returns {string}
 */
function formatDate(date, format = 'YYYY-MM-DD HH:mm:ss') {
  if (!(date instanceof Date)) {
    date = new Date(date);
  }
  
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  
  return format
    .replace('YYYY', year)
    .replace('MM', month)
    .replace('DD', day)
    .replace('HH', hours)
    .replace('mm', minutes)
    .replace('ss', seconds);
}

/**
 * 获取远程图片的尺寸
 * @param {string} url 图片的完整 URL
 * @returns {Promise<{width: number, height: number} | null>}
 */
async function getImageDimensions(url) {
  const https = require('https');
  const http = require('http');
  const sizeOf = require('image-size');

  return new Promise((resolve) => {
    const protocol = url.startsWith('https') ? https : http;
    const options = {
      headers: { 
          'User-Agent': 'Mozilla/5.Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36 Edg/144.0.0.00 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      },
      timeout: 5000,
      rejectUnauthorized: false
    };

    // 添加特定站点的 Referer 头
    if (url.includes('sinaimg.cn') || url.includes('weibo.com')) {
        options.headers['Referer'] = 'https://weibo.com/';
    } else if (url.includes('mmbiz.qpic.cn') || url.includes('weixin.qq.com')) {
        options.headers['Referer'] = 'https://mp.weixin.qq.com/';
    } else if (url.includes('baidu.com') || url.includes('bdstatic.com')) {
        options.headers['Referer'] = 'https://www.baidu.com/';
    }

    const req = protocol.get(url, options, (res) => {
      if (res.statusCode !== 200) {
        req.destroy();
        return resolve(null);
      }

      let buffer = Buffer.alloc(0);
      res.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        try {
          const dims = sizeOf(buffer);
          if (dims && dims.width && dims.height) {
            req.destroy(); 
            resolve({ 
              width: dims.width, 
              height: dims.height, 
              type: dims.type // 返回图片类型 (gif, png, jpg, etc)
            });
          }
        } catch (e) {
          // 继续攒 buffer
        }

        if (buffer.length > 512 * 1024) { // 限制 512KB
          req.destroy();
          resolve(null);
        }
      });

      res.on('end', () => {
        resolve(null);
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

module.exports = {
  sleep,
  retry,
  safeJsonParse,
  safeUrlParse,
  truncateText,
  stripHtmlTags,
  formatFileSize,
  isValidEmail,
  generateRandomId,
  deepClone,
  debounce,
  throttle,
  serializeError,
  isEmpty,
  extractDomain,
  formatDate,
  getImageDimensions,
  getIpRegion
};
