const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');

class LLMService {
  constructor() {
    this.configPath = path.join(__dirname, '../../data/config.json');
    this.loadConfig();
  }

  loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const configData = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
        this.config = configData;
        
        if (configData.llm && configData.llm.apiKey) {
          this.client = new OpenAI({
            apiKey: configData.llm.apiKey,
            baseURL: configData.llm.baseURL,
          });
          this.model = configData.llm.model;
          this.method = configData.llm.method || 'sdk';
          this.isThinking = !!configData.llm.thinking;
        } else {
          this.client = null;
          this.model = null;
          this.method = 'sdk';
          this.isThinking = false;
        }

        this.bochaApiKey = (configData.search && configData.search.apiKey) || null;
      } else {
        this.config = null;
        this.client = null;
        this.model = null;
        this.bochaApiKey = null;
        this.method = 'sdk';
        this.isThinking = false;
        // Create empty config file if not exists
        const emptyConfig = {
          llm: { apiKey: '', baseURL: '', model: '', method: 'sdk', thinking: false },
          search: { apiKey: '', baseURL: '' }
        };
        fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
        fs.writeFileSync(this.configPath, JSON.stringify(emptyConfig, null, 2));
      }
    } catch (error) {
      console.error('Failed to load LLM config:', error);
      this.config = null;
      this.client = null;
      this.model = null;
      this.bochaApiKey = null;
    }
  }

  /**
   * 将JSON转换为TOON格式以减少Token消耗
   * @param {Array} data 
   * @returns {string}
   */
  jsonToToon(data) {
    if (!Array.isArray(data) || data.length === 0) return '[]';
    const keys = Object.keys(data[0]);
    const header = `results[${data.length}]{${keys.join(',')}}:`;
    const rows = data.map(item => {
      return '  ' + keys.map(key => {
        let val = item[key];
        if (val === null || val === undefined) return '';
        val = String(val).trim();
        val = val.replace(/\s+/g, ' '); // 合并空白字符
        // TOON/CSV规范：仅当包含逗号或双引号时才需要引号，冒号不需要
        if (val.includes(',') || val.includes('"')) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return val;
      }).join(',');
    });
    return [header, ...rows].join('\n');
  }

  /**
   * 执行联网搜索
   * @param {string} query 搜索关键词
   * @returns {Promise<string>} 搜索结果摘要
   */
  async performWebSearch(query) {
    try {
      if (!this.bochaApiKey) {
        throw new Error('搜索接口未配置 (Search API Key is missing)');
      }
      
      let searchUrl = (this.config && this.config.search && this.config.search.baseURL) || 'https://api.bochaai.com/v1/web-search';
      
      // Fix: If it's a versioned base URL, append the endpoint
      if (searchUrl.endsWith('/v1') || searchUrl.endsWith('/v1/')) {
        searchUrl = searchUrl.replace(/\/$/, '') + '/web-search';
      }

      console.log(`正在执行联网搜索: ${query} (URL: ${searchUrl})`);
      const response = await fetch(searchUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.bochaApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: query,
          summary: true,
          count: 5
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Bocha API Error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      
      // 兼容不同的返回结构 (data.webPages 或 data.data.webPages)
      const webPages = data.webPages || (data.data && data.data.webPages);
      
      if (webPages && webPages.value && webPages.value.length > 0) {
        // 优化：返回toon格式的搜索结果，方便模型解析
        const results = webPages.value.map(item => ({
          title: item.name,
          url: item.url,
          summary: item.summary,
          date: item.datePublished || '未知'
        }));
        const toonResult = this.jsonToToon(results);
        console.log('联网搜索结果 (类json格式):\n', toonResult);
        
        // 返回包含格式化字符串和原始数据的对象
        return {
          success: true,
          formattedString: toonResult,
          rawResults: results
        };
      }
      
      return { success: true, formattedString: "未搜索到相关结果。", rawResults: [] };
    } catch (error) {
      console.error('联网搜索失败:', error);
      // Return error structure that matches the expected object format
      return { 
        success: false,
        formattedString: `(搜索遇到错误: ${error.message})`, 
        rawResults: [] 
      };
    }
  }

  /**
   * 分析内容真伪
   * @param {string} text 文本内容
   * @param {string[]} imageUrls 图片URL数组
   * @param {string} sourceUrl 来源URL（可选）
   * @param {Function} onStatusChange 状态变化回调函数（可选）
   * @returns {Promise<Object>} 分析结果
   */
  async analyzeContent(text, imageUrls = [], sourceUrl = '', onStatusChange = null) {
    const currentDate = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const systemPrompt = `You are a professional fake news detection assistant. Current date: ${currentDate}.
  Analyze the provided content and determine its authenticity. You can request a web search for verification. If images are provided, you MUST also check text-image consistency (图文一致性): extract visible text from images (OCR mentally), identify key entities/objects/scenes/time/watermarks, and compare with the written claims and captions. Flag mismatches explicitly.

### JSON Output Format (STRICT JSON, NO MARKDOWN):
{
  "needs_search": boolean, // True if verification is needed for specific events, data, or recent facts.
  "search_query": string,  // If needs_search=true, provide concise Chinese keywords (entities, events, time). No long sentences.
  "title": string,         // Objective news title (Simplified Chinese).
  "probability": number,   // Float (0-1) of being true.
  "type": number,          // 1: Real (>=0.8), 2: Mixed/Uncertain (0.2-0.8), 3: Fake (<=0.2).
  "explanation": string,   // Brief judgment summary (Simplified Chinese).
  "analysis_points": [     // Variable length points (Simplified Chinese).
    // Rule 1: If NO images exist, provide EXACTLY 3 points (source reliability, linguistic objectivity, factual consistency).
    // Rule 2: If images exist, add a 4th point: "图文一致性分析" (Image-Text Consistency) to evaluate if labels/captions/context match the image content.
    { "description": "Analysis detail", "status": "positive"|"warning"|"negative" }
  ],
  "fake_parts": [          // Only if type is 2 or 3. List specific problematic segments (Simplified Chinese).
    { 
      "text": "Exact quote from the content", 
      "risk_type": "Concise risk category (e.g.内容存疑, 绝对化表述, 煽动性营销, 逻辑谬误)", 
      "reason": "Detailed AI analysis reason (Simplified Chinese). Explain WHY it is a risk." 
    }
  ],
  "fake_images": [         // List any images that are manipulated, AI-generated, or used out of context.
    { "url": "The exact URL provided in userContent", "reason": "Detailed explanation of why this image is fake/misleading" }
  ]
}

### Core Rules:
1. **Search Priority**: If facts are unclear or time-sensitive, set "needs_search": true with concise Chinese keywords.
2. **Finality**: If search results are provided, "needs_search" MUST be false. Prioritize search evidence.
3. **Image Analysis**: 
   - **Image-Text Consistency**: When images exist, assess whether images support, contradict, or are unrelated to textual claims. 
   - **Specific Image Evaluation**: Evaluate each image provided. If an image is AI-generated (AIGC), photoshopped, from a different event (out-of-context), or otherwise deceptive, list it in "fake_images" with the ORIGINAL URL provided in the prompt.
   - **Reporting**: Explicitly include a "图文一致性分析" point in "analysis_points". If mismatches are found, put the specific claim into "fake_parts" and the image into "fake_images".
4. **Language**: All descriptive fields MUST be in Simplified Chinese.
5. **Format**: Return ONLY raw JSON. No markdown blocks.

Summary: Use concise Chinese keywords for search; output strictly valid JSON; all analysis text must be in Simplified Chinese; explicitly check and report image-text consistency when images are provided.`;

    const userContent = [];
    
    if (sourceUrl) {
        userContent.push({ type: 'text', text: `[来源链接]: ${sourceUrl}\n` });
    }

    if (text) {
      userContent.push({ type: 'text', text: text });
    }

    if (imageUrls && imageUrls.length > 0) {
      for (let url of imageUrls) {
        // Un-proxy URL if it's our local proxy
        if (url.includes('/api/proxy-image?url=')) {
          try {
            const urlObj = new URL(url, 'http://localhost');
            const originalUrl = urlObj.searchParams.get('url');
            if (originalUrl) url = originalUrl;
          } catch (e) {
            console.error('Failed to unproxy URL:', url);
          }
        }
        
        // 过滤不支持的图片格式（根据日志，API可能不支持部分百度生成的 cap/img 或 WEBP 等）
        // 常见的 OpenAI/Doubao 支持格式为: png, jpeg, jpg, webp (有时限定), non-gif
        const lowerUrl = url.toLowerCase();
        
        // 更加鲁棒的 GIF/SVG 检查 (包含常见参数形式)
        const isGif = lowerUrl.includes('.gif') || lowerUrl.includes('fmt=gif') || lowerUrl.includes('format=gif');
        const isSvg = lowerUrl.includes('.svg') || lowerUrl.includes('fmt=svg') || lowerUrl.includes('format=svg');
        
        if (isGif || isSvg) {
            console.log(`[LLM Service] 跳过不支持的格式 (${isGif ? 'GIF' : 'SVG'}): ${url}`);
            continue;
        }

        // 百度某些 cap/img 动态生成的验证码或特殊图片，API 容易报错
        if (lowerUrl.includes('passport.baidu.com/cap/img')) {
            console.log(`[LLM Service] 跳过可能的验证码/动态图片: ${url}`);
            continue;
        }
        
        userContent.push({
          type: 'image_url',
          image_url: { url: url }
        });
      }
    }

    if (userContent.length === 0) {
      throw new Error('没有提供文本或图片进行分析');
    }

    if (!this.client || !this.model) {
      throw new Error('模型服务未配置 (LLM API is not configured)');
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ];

    try {
      const callArgs = {
        model: this.model,
        messages: messages,
        temperature: 0.1
      };
      if (this.isThinking) callArgs.thinking = { type: 'enabled' };

      // 第一次调用
      console.log('第一次调用...');
      let response;
      if (this.method === 'curl') {
        let fullUrl = (this.config.llm.baseURL || '').replace(/\/$/, '');
        if (!fullUrl.endsWith('/chat/completions')) {
          fullUrl += '/chat/completions';
        }
        const res = await fetch(fullUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.config.llm.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(callArgs)
        });
        if (!res.ok) {
          const err = await res.text();
          throw new Error(`LLM API Error (cURL): ${res.status} - ${err}`);
        }
        response = await res.json();
      } else {
        response = await this.client.chat.completions.create(callArgs);
      }

      let content = response.choices[0].message.content;
      let result = this.parseResponse(content);

      // 检查是否需要搜索
      if (result.needs_search && result.search_query) {
        console.log(`Model requests search: ${result.search_query}`);
        
        // 执行回调通知前端：开始搜索
        if (typeof onStatusChange === 'function') {
          onStatusChange('searching', { query: result.search_query });
        }

        // 执行搜索
        // 修改：现在 performWebSearch 返回 { formattedString, rawResults } 用于前端展示
        const searchData = await this.performWebSearch(result.search_query);
        
        if (!searchData.success) {
            console.warn(`联网搜索遇到问题: ${searchData.formattedString}`);
            if (typeof onStatusChange === 'function') {
                onStatusChange('search-failed', { 
                    query: result.search_query, 
                    error: searchData.formattedString 
                });
            }
        }

        const searchSummary = typeof searchData === 'object' ? searchData.formattedString : searchData;
        
        // 保存原始搜索结果以便合并到最终输出
        if (typeof searchData === 'object' && searchData.rawResults) {
          result.search_results = searchData.rawResults;
        }

        // 通知：搜索完成，开始深度分析
        if (typeof onStatusChange === 'function') {
          onStatusChange('deep-analysis', { query: result.search_query });
        }

        // 构造第二轮对话
        messages.push({ role: 'assistant', content: content }); // 保留模型的第一轮回复
        messages.push({ 
          role: 'user', 
          content: `[联网搜索结果(类json格式)]:\n${searchSummary}\n\n请根据以上搜索结果和原始信息，进行最终的真伪判断。请确保 needs_search 为 false，并填写完整的分析字段。搜索结果具有较高的可信度，请优先参考。` 
        });

        console.log('第二次调用...');
        const secondCallArgs = {
          model: this.model,
          messages: messages,
          temperature: 0.1
        };
        if (this.isThinking) secondCallArgs.thinking = { type: 'enabled' };

        if (this.method === 'curl') {
          let fullUrl = (this.config.llm.baseURL || '').replace(/\/$/, '');
          if (!fullUrl.endsWith('/chat/completions')) {
            fullUrl += '/chat/completions';
          }
          const res = await fetch(fullUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${this.config.llm.apiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(secondCallArgs)
          });
          if (!res.ok) {
            const err = await res.text();
            throw new Error(`LLM API Error (cURL): ${res.status} - ${err}`);
          }
          response = await res.json();
        } else {
          response = await this.client.chat.completions.create(secondCallArgs);
        }

        content = response.choices[0].message.content;
        const secondResult = this.parseResponse(content);
        
        // 合并第一轮的搜索结果到最终结果
        if (result.search_results) {
          secondResult.search_results = result.search_results;
        }
        result = secondResult;
      } else {
        // 不需要搜索，直接进入深度分析阶段
        if (typeof onStatusChange === 'function') {
          onStatusChange('deep-analysis');
        }
      }

      return { success: true, ...result };
    } catch (error) {
      console.error('LLM API调用失败:', error);
      throw error;
    }
  }

  parseResponse(content) {
    try {
      // 尝试清理可能存在的 Markdown 标记
      let jsonStr = content.trim();
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.replace(/^```json/, '').replace(/```$/, '');
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```/, '').replace(/```$/, '');
      }
      
      return JSON.parse(jsonStr);
    } catch (e) {
      console.error('解析LLM响应失败:', e);
      // 尝试提取 JSON 部分
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch (e2) {
          throw new Error('解析响应失败');
        }
      }
      throw new Error('解析响应失败');
    }
  }
}

module.exports = LLMService;
