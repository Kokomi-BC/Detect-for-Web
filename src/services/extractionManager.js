const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');
const { PlaywrightCrawler, LogLevel, RequestQueue, Configuration } = require('crawlee');
const ImageExtractor = require('./imageExtractor');
const URLProcessor = require('./urlProcessor');
const { truncateText } = require('../utils/utils');
const fs = require('fs');
const path = require('path');

// 设置全局配置以降低内存压力
const config = Configuration.getGlobalConfig();
config.set('maxMemoryMbytes', 768); 
config.set('availableMemoryRatio', 0.15); 

class ExtractionManager {
  constructor() {
    this.imageExtractor = new ImageExtractor();
    this.urlProcessor = new URLProcessor();
    this.isExtractionCancelled = false;
    
    this.anomaliesDir = path.join(__dirname, '../../data/anomalies');
    this.anomaliesFile = path.join(__dirname, '../../data/anomalies.json');
    this.anomalies = this.loadAnomalies();
  }

  loadAnomalies() {
    try {
      if (fs.existsSync(this.anomaliesFile)) {
        return JSON.parse(fs.readFileSync(this.anomaliesFile, 'utf8'));
      }
    } catch (e) {
      console.error('[ExtractionManager] Failed to load anomalies:', e);
    }
    return [];
  }

  saveAnomalies() {
    try {
      if (!fs.existsSync(path.dirname(this.anomaliesFile))) {
        fs.mkdirSync(path.dirname(this.anomaliesFile), { recursive: true });
      }
      fs.writeFileSync(this.anomaliesFile, JSON.stringify(this.anomalies, null, 2));
    } catch (e) {
      console.error('[ExtractionManager] Failed to save anomalies:', e);
    }
  }

  async extractContent(url) {
    this.isExtractionCancelled = false;
    try {
      if (this.urlProcessor.isImageUrl(url)) {
        return this.createImageResult(url);
      }

      if (this.urlProcessor.isDownloadUrl(url)) {
        throw new Error('此链接指向下载资源，暂不支持此类内容检测');
      }

      // 微博搜索结果页面拦截
      if (url.includes('s.weibo.com')) {
        throw new Error('暂不支持访问搜索结果页面，请输入具体的微博正文地址');
      }

      // 微博链接特殊处理：强制使用移动端域名以获得更佳的提取效果
      if (url.includes('weibo.com')) {
          url = url.replace('weibo.com', 'm.weibo.cn').replace('www.', '');
          console.log(`[ExtractionManager] Converted Weibo URL to: ${url}`);
      }
      
      const isWechatArticle = this.urlProcessor.isWechatArticle(url);
      const isWeibo = url.includes('m.weibo.cn');
      
      let htmlContent = '';
      
      // 使用 Crawlee 的 PlaywrightCrawler
      const crawler = new PlaywrightCrawler({
          launchContext: {
              launchOptions: {
                  headless: true,
                  args: [
                      '--no-sandbox', 
                      '--disable-setuid-sandbox', 
                      '--disable-dev-shm-usage',
                      '--disable-gpu',
                      '--disable-software-rasterizer',
                      '--single-process',
                      '--no-zygote',
                      '--disable-accelerated-2d-canvas',
                      '--js-flags=--max-old-space-size=256', 
                      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 NetType/WIFI MicroMessenger/7.0.20.1781(0x6700143B) WindowsWechat(0x63090a13) UnifiedPCWindowsWechat(0xf254160e) XWEB/18055 Flue'
                  ]
              }
          },
          // 极致限制并发
          maxConcurrency: 1,
          minConcurrency: 1,
          requestHandlerTimeoutSecs: 60,
          navigationTimeoutSecs: 45,
          
          requestHandler: async ({ page, request }) => {
              if (this.isExtractionCancelled) {
                  console.log(`[Crawler] Extraction cancelled before processing: ${request.url}`);
                  return;
              }
              console.log(`[Crawler] Processing: ${request.url}`);
              
              // 模拟真实浏览器请求头
              await page.setExtraHTTPHeaders({
                  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
                  'DNT': '1',
                  'Referer': 'https://www.baidu.com/'
              });

              // 拦截无关资源以节省内存
              await page.route('**/*', (route) => {
                  const url = route.request().url().toLowerCase();
                  const resourceType = route.request().resourceType();
                  
                  // 严防下载请求
                  if (this.urlProcessor.isDownloadUrl(url)) {
                      console.log(`[Crawler] 拦截到潜在下载请求: ${url}`);
                      return route.abort('blockedbyclient');
                  }

                  // 定义需要拦截的文件后缀
                  const blockedExtensions = [
                      '.mp4', '.mp3', '.ttf', '.woff', '.woff2', '.ico',
                      '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'
                  ];
                  
                  const isBlockedExtension = blockedExtensions.some(ext => url.endsWith(ext) || url.includes(ext + '?'));
                  const isBlockedType = ['image', 'media', 'font', 'websocket', 'other'].includes(resourceType);

                  if (isBlockedExtension || isBlockedType) {
                      return route.abort();
                  }
                  
                  route.continue();
              });

              // 监听主请求响应，确认是否为 HTML
              page.on('response', response => {
                if (response.request().isNavigationRequest() && response.request().frame() === page.mainFrame()) {
                  const contentType = response.headers()['content-type'] || '';
                  if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
                    console.log(`[Crawler] 拦截到非网页内容类型: ${contentType}, URL: ${response.url()}`);
                    // 标记为错误，在后续逻辑中处理
                    request.userData.isNonHtml = true;
                    request.userData.contentType = contentType;
                  }
                }
              });
              
              try {
                  // 先进行初步加载等待
                  await Promise.race([
                      page.waitForLoadState('domcontentloaded', { timeout: 10000 }),
                      new Promise(resolve => setTimeout(resolve, 15000))
                  ]).catch(() => {});

                  // 处理非 HTML 内容
                  if (request.userData.isNonHtml) {
                      throw new Error(`该链接指向非网页内容 (类型: ${request.userData.contentType})，暂不支持检测`);
                  }

                  // 处理新浪访客系统（微博跳转）
                  const title = await page.title();
                  if (title.includes('Sina Visitor System') || title.includes('新浪访客系统')) {
                    console.log('[Crawler] 检测到新浪访客系统，等待跳转...');
                    let retries = 0;
                    while (retries < 15) {
                        await new Promise(r => setTimeout(r, 1000));
                        const newTitle = await page.title();
                        if (!newTitle.includes('Sina Visitor System') && !newTitle.includes('新浪访客系统')) {
                            console.log(`[Crawler] 新浪访客系统跳转完成: ${newTitle}`);
                            break;
                        }
                        retries++;
                    }
                  }

                  // 等待一小段时间让页面动态内容加载
                  const isSlowSite = request.url.includes('zhihu.com') || request.url.includes('weibo.com');
                  const waitTime = isSlowSite ? 4000 : 2000;
                  console.log(`[Crawler] 等待页面动态渲染 (${waitTime}ms)...`);
                  await new Promise(resolve => setTimeout(resolve, waitTime));

                  // 尝试轻微滚动以触发布局动态加载
                  await page.evaluate(() => window.scrollBy(0, 300)).catch(() => {});

                  // 如果是微信文章，执行特定的渲染等待
                  if (isWechatArticle) {
                      await this.imageExtractor.waitForWechatContent(page);
                  }
                  
                  // 等待所有正文图片加载以获取真实尺寸
                  await this.imageExtractor.waitForImagesLoad(page);

              } catch (e) {
                  console.warn(`[Crawler] 加载过程阶段性超时/错误 (非致命): ${e.message}`);
              }
              
              htmlContent = await page.content();
              console.log(`[Crawler] Content retrieved, length: ${htmlContent.length}`);

              // 异常检测（防爬虫拦截）
              const anomalyKeywords = [
                  '环境异常', '安全验证', '验证码', '访问受限', 'Forbidden', 'Cloudflare', 
                  '访问过于频繁', 'unsupported browser'
              ];
              const foundKeyword = anomalyKeywords.find(kw => htmlContent.includes(kw));
              const isTooShort = htmlContent.length < 8000 && !this.urlProcessor.isImageUrl(request.url);

              if (foundKeyword || isTooShort) {
                  const reason = foundKeyword || (isTooShort ? '页面内容过短' : '访问异常');
                  console.warn(`[Crawler] 检测到访问异常 (可能被拦截): ${request.url} - 原因: ${reason}`);
                  
                  // 记录异常链接（去重）
                  if (!this.anomalies.find(a => a.url === request.url)) {
                      const id = Date.now().toString();
                      const anomalyRecord = {
                          id: id,
                          url: request.url,
                          time: new Date().toLocaleString(),
                          reason: reason,
                          title: (await page.title().catch(() => '')) || '无标题'
                      };
                      
                      // 保存 HTML 现场以便管理员查看详情
                      try {
                          if (!fs.existsSync(this.anomaliesDir)) {
                              fs.mkdirSync(this.anomaliesDir, { recursive: true });
                          }
                          fs.writeFileSync(path.join(this.anomaliesDir, `${id}.html`), htmlContent);
                          anomalyRecord.hasDump = true;
                      } catch (e) {
                          console.error('[Crawler] Failed to save anomaly dump:', e);
                      }

                      this.anomalies.push(anomalyRecord);
                      
                      // 最多保留50条
                      if (this.anomalies.length > 50) {
                          const removed = this.anomalies.shift();
                          // 尝试删除对应的 dump 文件
                          if (removed.id) {
                              try { fs.unlinkSync(path.join(this.anomaliesDir, `${removed.id}.html`)); } catch(e){}
                          }
                      }
                      this.saveAnomalies();
                  }

                  // 抛出错误以通知前端
                  throw new Error(`检测到目标网站的机器验证或访问限制 (${reason})，请稍后再试或更换链接`);
              }
          },
          
          failedRequestHandler: ({ request, error }) => {
               console.warn(`[Crawler] Request failed: ${request.url}. Error: ${error.message}`);
          },
          
          maxRequestRetries: 0, // 内存有限，不建议重试
          useSessionPool: false, // 禁用 SessionPool 以减少内存占用
          persistCookiesPerSession: false,
          
          preNavigationHooks: [
              async ({ page }) => {
                  await page.setViewportSize({ width: 1280, height: 800 });
                  // 注入脚本以规避基础爬虫检测
                  await page.addInitScript(() => {
                    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                    window.chrome = { runtime: {} };
                  });
              },
          ],
          
          browserPoolOptions: {
              useFingerprints: false, // 禁用指纹以减少计算和内存
              operationTimeoutSecs: 30,
              closeInactiveBrowserAfterSecs: 10, // 任务完成后10秒关闭浏览器实例
          },
      });

      // 使用唯一的 uniqueKey 绕过 Crawlee 的去重机制，确保每次点击都能重新抓取
      await crawler.run([{ 
          url: url, 
          uniqueKey: `${url}-${Date.now()}` 
      }]);
      
      // 强制触发一次垃圾回收（如果 Node.js 启动时带有 --expose-gc 标志）
      if (global.gc) {
        global.gc();
      }
      
      if (!htmlContent) {
          throw new Error("无法获取页面正文内容，可能是该网页需要登录或配置了高级反爬");
      }

      return await this.processExtractedContent(htmlContent, url, isWechatArticle, isWeibo);
      
    } catch (error) {
      console.error('内容提取具体错误:', error);
      throw error;
    }
  }

  createImageResult(url) {
    return {
      success: true,
      title: '图像文件',
      content: 'URL指向图像文件',
      images: [url],
      url: url
    };
  }

  async processExtractedContent(htmlContent, url, isWechatArticle, isWeibo = false) {
    // 微博特殊提取逻辑：解析 $render_data JSON
    if (isWeibo) {
        try {
            // 匹配 $render_data = [{...}] 结构
            const match = htmlContent.match(/var\s+\$render_data\s*=\s*(\[\{.*?\}\](?:\[0\])?\s*\|\|\s*\{\});/s);
            if (match && match[1]) {
                // 清理并解析 JSON 数据
                const jsonStr = match[1].replace(/\[0\]\s*\|\|\s*\{\}$/, ''); // 移除尾部的取值逻辑，保留数组
                const data = JSON.parse(jsonStr);
                    const status = data[0]?.status;

                    if (status) {
                        console.log('[Processor] 使用微博专用提取逻辑');
                        // 提取微博正文（含HTML标签）
                        let content = status.text;
                        let textContent = status.text.replace(/<[^>]+>/g, '');

                        // 提取用户信息和元数据 (screen_name, verified_reason, region_name, followers_count)
                        const user = status.user;
                        if (user) {
                            const metaInfo = [];
                            if (user.screen_name) metaInfo.push(`发布者: ${user.screen_name}`);
                            if (user.verified_reason) metaInfo.push(`认证: ${user.verified_reason}`);
                            if (user.followers_count_str || user.followers_count) metaInfo.push(`粉丝数: ${user.followers_count_str || user.followers_count}`);
                            if (status.region_name) metaInfo.push(`ip: ${status.region_name}`);
                            
                            const metaStr = metaInfo.join(' | ');
                            content = `<div class="weibo-meta" style="margin-bottom:10px;color:#666;font-size:0.9em;">${metaStr}</div>${content}`;
                            textContent = `${metaStr}\n\n${textContent}`;
                        }
                        
                        // 提取高清图片
                    const images = [];
                    if (status.pics && Array.isArray(status.pics)) {
                        status.pics.forEach(pic => {
                            if (pic.large && pic.large.url) {
                                images.push(pic.large.url);
                            } else if (pic.url) {
                                images.push(pic.url);
                            }
                        });
                    }

                    return {
                        success: true,
                        title: status.status_title || `微博正文-${status.id}`,
                        content: content || '',
                        textContent: textContent || '',
                        images: images,
                        url: url
                    };
                }
            }
        } catch (e) {
            console.warn('[Processor] 微博专用提取失败，回退到通用模式:', e);
        }
    }

    // 预处理：移除所有 <style> 标签，防止 JSDOM 在解析某些复杂 CSS 时崩溃
    const safeHtml = htmlContent.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, '');

    // 使用Readability提取文章内容
    let dom = new JSDOM(safeHtml, { url });
    let reader = new Readability(dom.window.document, { charThreshold: 0 });
    let article = reader.parse();

    // 检查是否成功解析文章
    if (!article) {
      console.log(`[Processor] Readability解析失败，尝试使用后备模式提取... (HTML长度: ${htmlContent.length})`);
      dom = new JSDOM(safeHtml, { url });
      const doc = dom.window.document;
      
      // 移除明显的干扰元素
      const junkTags = ['script', 'style', 'noscript', 'iframe', 'header', 'footer', 'nav', 'aside', 'video', 'audio', 'object', 'embed'];
      junkTags.forEach(tagName => {
        const elements = doc.getElementsByTagName(tagName);
        while (elements.length > 0) {
          elements[0].parentNode.removeChild(elements[0]);
        }
      });

      let content = doc.body ? doc.body.innerHTML : '';
      let textContent = doc.body ? doc.body.textContent.trim() : '';
      let imageCount = doc.querySelectorAll('img').length;
      
      console.log(`[Processor] 后备模式: 文本长度=${textContent.length}, 图片数量=${imageCount}`);

      if (textContent.length > 0 || imageCount > 0) {
        article = {
          title: doc.title || '无标题',
          content: content,
          textContent: textContent,
          length: textContent.length
        };
      } else {
        // 如果彻底没内容，检查是否是已知的拦截页面
        const html = doc.documentElement.innerHTML;
        if (html.includes('验证码') || html.includes('安全验证') || html.includes('访问受限') || html.includes('环境异常')) {
            article = {
                title: '页面访问受限',
                content: '<div class="error-notice">检测到目标网站的机器验证或访问限制，无法提取正文。请稍后重试或更换链接。</div>',
                textContent: '检测到目标网站的机器验证或访问限制，无法提取正文。',
                length: 0
            };
        } else {
            throw new Error('无法解析该网页的文章内容，请检查链接是否正确或尝试文字检测');
        }
      }
    }

    const imageMetadata = this.imageExtractor.extractImageMetadata(htmlContent, url);
    const { cleanedContent, images } = await this.imageExtractor.processReadabilityContent(
      article.content, 
      imageMetadata, 
      url, 
      isWechatArticle
    );

    const MAX_CONTENT_LENGTH = 20000;
    const textContent = article.textContent ? 
      truncateText(article.textContent, MAX_CONTENT_LENGTH) : '';

    return {
      success: true,
      title: article.title || '',
      content: cleanedContent || '',   
      textContent: textContent,        
      images: images,                  
      url: url
    };
  }

  cancelExtraction() {
    this.isExtractionCancelled = true;
  }

  getAnomalies() {
    return this.anomalies;
  }

  deleteAnomaly(id) {
    const index = this.anomalies.findIndex(a => a.id === id);
    if (index !== -1) {
      const removed = this.anomalies.splice(index, 1)[0];
      try {
        const dumpPath = path.join(this.anomaliesDir, `${removed.id}.html`);
        if (fs.existsSync(dumpPath)) {
          fs.unlinkSync(dumpPath);
        }
      } catch (e) {
        console.error('[ExtractionManager] Failed to delete dump file:', e);
      }
      this.saveAnomalies();
      return true;
    }
    return false;
  }

  clearAnomalies() {
    this.anomalies = [];
    try {
      if (fs.existsSync(this.anomaliesDir)) {
        const files = fs.readdirSync(this.anomaliesDir);
        for (const file of files) {
          fs.unlinkSync(path.join(this.anomaliesDir, file));
        }
      }
    } catch (e) {
      console.error('[ExtractionManager] Failed to clear anomaly dumps:', e);
    }
    this.saveAnomalies();
  }
}

module.exports = ExtractionManager;
