Detect 是一款基于网页端的假新闻检测应用，由 Electron 版本迁移而来，核心技术栈与部署规范如下：
- 后端：采用 Node.js + Express + MySQL 架构，通过 PM2 进行进程管理。
- 前端：基于原生 JS（Vanilla JS）+ HTML + CSS 开发，无框架依赖。
- AI 服务提供商：接入火山引擎（豆包）AI 服务，通过 OpenAI SDK 实现调用。
- 传输协议：采用 HTTPS 协议（自签名证书），默认监听 443 端口。
- 身份认证：基于 JWT（JSON Web Token）实现身份验证，令牌存储于本地 localStorage 中。

架构与核心组件
后端流程（src/ 目录）
应用以 Express 服务器形式运行，各核心文件及功能如下：
- 入口文件：src/server.js（HTTPS 服务器入口，负责启动服务）。
- 应用配置：src/app.js（Express 应用初始化及中间件配置）。
- AI 分析服务：src/services/llmService.js，基于豆包 251015 模型实现 AI 内容分析逻辑。
- 内容提取服务：src/services/extractionManager.js，采用 Crawlee（基于 Playwright/Chromium）、jsdom 及 Readability 开发的高级网页爬虫，负责提取网页内容。
- 数据库配置：src/config/db.js，实现 MySQL 连接池初始化及数据库连接逻辑。
- 路由管理：src/routes/ 目录，定义所有 API 接口及身份认证相关路由。
- 数据存储：
  - MySQL 数据库：用于存储用户身份凭证（账号密码等二次加密）。
  - 本地文件（data/ 目录）：
    - 用户检测历史：存储路径为 data/users/{userId}/history.json（按用户ID分目录管理）。

    - 爬虫异常记录：data/anomalies.json（异常元数据）及 data/anomalies/*.html（异常页面快照文件）。

前端流程（client-src/、public/ 与 dist/ 目录）

- 核心页面：
  - 项目根目录下的 Main.html、Mobile.html、Login.html、Welcome.html、Admin.html 作为 Vite 指定的多页面入口。
- 源码管理：client-src/ 目录，包含前端逻辑与样式源码。
  - client-src/css/：
    - variables.css：全局主题变量及配色方案定义。
    - common.css：通用样式重置及全局组件样式。
    - main.css、mobile.css、admin.css：各页面专属样式。
  - client-src/js/：
    - mobile.js：移动端核心逻辑及 Toast 管理。
    - theme-loader.js：动态主题切换逻辑。
    - user-editor.js：用户资料编辑逻辑。
- 静态资源：public/ 目录，存放图标（如 /ico/Detect.ico）等静态文件，构建时将直接复制到 dist/ 根目录。
- Electron API 兼容层：前端内置 window.electronAPI 模拟层，将旧版本 Electron 的 ipcRenderer.invoke 调用，转换为 /api/invoke 的 fetch 请求。

部署与开发规范

核心命令

- 启动服务器：npm run server 或 pm2 start ecosystem.config.js
  - 启动 src/server.js，通过 PM2 管理。
- 前端开发：npm run dev
  - 启动 Vite 开发服务器。
- 前端构建：npm run build
  - 使用 Vite 进行多页面构建与压缩，产物输出至 dist/ 目录。
- 依赖安装：推荐使用 cnpm install。

管理员功能

- 用户管理：支持系统用户的创建、编辑、删除操作，实现基于状态（启用/待审核）的用户审核流程。

- 工作台指标（三栏布局）：
        

  - 业务数据统计：总注册用户数、今日成功登录次数。

  - 访客跟踪：每日独立 IP 访客数（基于会话去重）。

  - 安全与稳定性监控：
            

    - 网页爬取异常跟踪（自动内容提取失败的记录）。

    - 安全防御拦截记录（爬虫防护拦截、黑名单匹配拦截）。

- 资源监控：
        

  - 实时磁盘空间统计（可用空间 vs 总空间）。

  - 图片缓存大小跟踪及一键清理功能。

- 日志与防御配置：
        

  - 详细 IP 访问日志，支持 IP 地理区域解析。

  - 爬虫防御配置（用户代理（UA）长度/关键词校验）及实时拦截日志查看。

安全与访问控制

- HTTPS 强制启用：所有客户端连接均需通过 HTTPS 协议，依赖 key.pem（私钥）和 cert.pem（证书）实现自签名认证。

- 认证中间件：所有 /api/invoke 接口及管理员相关请求，均需在请求头（Authorization）或 HTTP-only Cookie 中携带有效的 JWT 令牌，否则拒绝访问。

- IP 防护：内置 IP 黑名单机制，结合会话感知的访客去重逻辑，防止统计数据被恶意刷取。

数据库与文档

- MySQL 数据库：核心数据库为 detect_db，用于存储用户信息、系统统计数据、访问日志等核心数据。

- 表结构参考：详细的数据库表结构（如 users、system_stats、access_history 等表），请参考 db_schema.md 文档。

编码规范

后端编码规范（Express）

- API 接口规范：统一采用 /api/invoke 端点，通过 channel（渠道）和 args（参数）传递请求信息，保持与原 Electron 版本的 IPC 设计兼容。

- 错误处理规范：所有 API 响应均需遵循标准格式。失败响应格式为：`{ "status": "fail", "code": 400, "message": "...", "data": {}, "error": {} }`。

- 文件操作规范：读取/写入用户历史等本地文件时，需使用 fsPromises 异步方法，避免阻塞服务器进程。

前端编码规范（原生 JS）

- DOM 操作：统一使用 document.getElementById 方法获取 DOM 元素，采用标准事件监听器（addEventListener）处理交互，避免使用非标准方法。

- 状态存储：用户令牌、用户 ID、主题设置等持久化数据，统一存储于 localStorage 中，确保状态一致性。

- 样式规范：
        

  - 样式文件统一放置于 public/css/ 目录，采用模块化管理。

  - 配色方案统一在 variables.css 中定义，保持“单一数据源”，便于主题维护。

  - 支持深色模式，通过为 <html> 标签添加 [data-theme="dark"] 属性实现主题切换。

  - 按钮组件优先使用 SVG 图标替代纯文本按钮，提升界面现代感。

- 移动端用户体验（UX）规范：
        

  - 加载提示：统一使用 showLoadingToast(message) 和 hideLoadingToast() 方法控制加载提示，适配“灵动岛”UI 风格。

  - 提示时长：加载提示最小显示时长为 500ms，采用“滑出+淡出”动画，提升交互流畅度。

  - 交互设计：优先采用高反馈交互方式（如长按操作、过渡动画），贴合移动端使用习惯。

爬虫编码规范（内容提取）

- 爬虫引擎：基于 Crawlee 框架，使用 PlaywrightCrawler（无头 Chromium）实现网页爬取。

- 反反爬策略：集成 Stealth 脚本、自定义 User-Agents，设置 2-4 秒动态渲染等待时间，规避目标网站的爬虫检测机制。

- 资源管控：严格限制 Chromium 内存使用（max-old-space-size=256），并发爬取数限制为 1，防止出现内存溢出（OOM）问题。

- 内容解析：网页内容提取后，通过 JSDOM 对象结合 @mozilla/readability 库进行文本解析，确保提取内容的准确性。

文件结构

src/
  app.js              # Express 应用配置（中间件、路由注册等）
  server.js           # HTTPS 服务器入口文件
  config/
    db.js             # MySQL 连接池配置及初始化
  services/
    llmService.js     # AI 分析逻辑（基于豆包 251015 模型）
    extractionManager.js # Playwright 爬虫及异常跟踪逻辑
    imageExtractor.js # 图片过滤及代理相关逻辑
    urlProcessor.js   # URL 格式校验及域名黑名单管理
    fileParser.js     # 文档解析逻辑（Word/PDF 等）
  routes/
    api.js            # 主 API 及管理员路由定义
    auth.js           # 身份认证相关路由（登录、注册等）
  middleware/
    auth.js           # JWT 认证中间件（接口权限控制）
    logger.js         # 请求日志中间件（记录访问信息）
  utils/
    dbUtils.js        # 数据库操作工具函数（增删改查封装）
    fsUtils.js        # 文件系统操作工具函数（异步读写封装）
    utils.js          # 通用工具函数（格式转换、校验等）
public/
  css/                # 样式文件统一管理目录
    variables.css     # 全局主题变量、配色方案
    common.css        # 通用样式重置、全局组件样式
    mobile.css        # 移动端专属样式
    main.css          # 桌面端专属样式
    admin.css         # 管理员控制台专属样式
  js/                 # 客户端前端逻辑目录
    mobile.js         # 移动端核心交互逻辑
    theme-loader.js   # 动态主题切换逻辑（深色/浅色）
    user-editor.js    # 用户资料编辑入口逻辑
    user-editor-core.js # 用户资料编辑核心逻辑（可复用）
    export-manager.js # 检测历史导出逻辑
  assets/             # 静态资源目录（图片、图标等）
  Login.html          # 登录页面（身份认证入口）
  Welcome.html        # 应用欢迎页面（过渡页）
  Main.html           # 桌面端核心检测页面
  Admin.html          # 管理员控制台页面
  Mobile.html         # 移动端优化检测页面
data/                 # 本地持久化存储目录
  img_cache/          # 外部图片缓存目录
  anomalies/          # 爬虫异常页面快照存储目录
  anomalies.json      # 爬虫异常元数据记录（异常信息汇总）
  users/              # 用户个人检测历史目录（按用户ID分目录）
dist/                 # Webpack 构建产物目录（前端部署目录）
storage/              # Crawlee 状态存储目录（键值对、任务队列等）
