const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;

async function handleExportPdf(req, res, args) {
    const { html } = args[0] || {};
    let browser = null;
    try {
        const PDF_FONT_FAMILY = 'HarmonyOS Sans';
        const fontFiles = {
            '100': '../../font/HarmonyOS_Sans_Thin.ttf',
            '300': '../../font/HarmonyOS_Sans_Light.ttf',
            '400': '../../font/HarmonyOS_Sans_Regular.ttf',
            '500': '../../font/HarmonyOS_Sans_Medium.ttf',
            '700': '../../font/HarmonyOS_Sans_Bold.ttf',
            '900': '../../font/HarmonyOS_Sans_Black.ttf'
        };

        let fontStyles = '';
        let loadedFontCount = 0;
        for (const [weight, relativePath] of Object.entries(fontFiles)) {
            const fontPath = path.join(__dirname, relativePath);
            if (fs.existsSync(fontPath)) {
                try {
                    const buffer = await fsPromises.readFile(fontPath);
                    const base64 = buffer.toString('base64');
                    // 使用更加标准的 data url 格式，并增加针对 PDF 渲染优化的属性
                    fontStyles += `
                        @font-face {
                            font-family: '${PDF_FONT_FAMILY}';
                            src: url(data:application/x-font-ttf;charset=utf-8;base64,${base64}) format('truetype');
                            font-weight: ${weight};
                            font-style: normal;
                            font-display: block;
                        }
                    `;
                    loadedFontCount++;
                } catch (e) {
                    console.warn(`Failed to load font weight ${weight}:`, e);
                }
            }
        }

        if (loadedFontCount === 0) {
            throw new Error('未找到可用的 HarmonyOS 字体文件，请检查 /root/Detect/font 目录');
        }

        if (!html) {
            return res.status(400).json({ status: 'fail', message: '缺少导出内容' });
        }

        browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--font-render-hinting=none',
                '--disable-font-subpixel-positioning',
                '--lang=zh-CN'
            ]
        });
        const context = await browser.newContext();
        const page = await context.newPage();
        
        // 构造完整的 HTML 结构，将字体样式放在最前面
        const fullHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    ${fontStyles}
                    
                    /* 全局强制字体覆盖 */
                    html, body, div, p, span, h1, h2, h3, h4, h5, h6, strong, b, article, section, label, li, td, th {
                        font-family: '${PDF_FONT_FAMILY}', "PingFang SC", "Microsoft YaHei", sans-serif !important;
                    }
                    
                    body {
                        margin: 0;
                        padding: 0;
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                        background-color: white !important;
                    }

                    h1, h2, h3, h4, h5, h6, strong, b {
                        font-weight: 700 !important;
                    }

                    /* 确保背景颜色和图片能正常显示 */
                    * {
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                    }
                </style>
            </head>
            <body>
                ${html}
            </body>
            </html>
        `;

        await page.setContent(fullHtml, { waitUntil: 'networkidle' });

        // 深度检查并注入字体样式到所有元素
        await page.evaluate((familyName) => {
            const forceFont = `'${familyName}', "PingFang SC", "Microsoft YaHei", sans-serif`;
            const elements = document.querySelectorAll('*');
            elements.forEach(el => {
                if (el.style) {
                    el.style.setProperty('font-family', forceFont, 'important');
                }
            });
        }, PDF_FONT_FAMILY);

        // 等待字体就绪
        await page.evaluateHandle(() => document.fonts.ready);
        await page.waitForTimeout(1000); // 额外等待渲染稳定

        const pdfBuffer = await page.pdf({
            format: 'A4',
            margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
            printBackground: true,
            preferCSSPageSize: true,
            displayHeaderFooter: false
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="report_${Date.now()}.pdf"`);
        return res.send(pdfBuffer);
    } catch (err) {
        console.error('PDF Export Backend Error:', err);
        if (!res.headersSent) {
            return res.status(500).json({
            "status": "fail",
            "code": 500,
            "message": 'PDF 生成失败',
            "data": {},
            "error": {}
        });
        }
    } finally {
        if (browser) await browser.close();
    }
}

module.exports = {
    handleExportPdf
};
