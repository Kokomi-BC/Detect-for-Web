const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;

async function handleExportPdf(req, res, args) {
    const { html } = args[0];
    let browser = null;
    try {
        const fontFiles = {
            '400': '../../font/HarmonyOS_Sans_Regular.ttf',
            '700': '../../font/HarmonyOS_Sans_Bold.ttf',
            '500': '../../font/HarmonyOS_Sans_Medium.ttf',
            '300': '../../font/HarmonyOS_Sans_Light.ttf'
        };

        let fontStyles = '';
        for (const [weight, relativePath] of Object.entries(fontFiles)) {
            const fontPath = path.join(__dirname, relativePath);
            if (fs.existsSync(fontPath)) {
                try {
                    const buffer = await fsPromises.readFile(fontPath);
                    const base64 = buffer.toString('base64');
                    fontStyles += `
                        @font-face {
                            font-family: 'HarmonyOS Sans';
                            src: url(data:font/ttf;base64,${base64}) format('truetype');
                            font-weight: ${weight};
                            font-style: normal;
                            font-display: block;
                        }
                    `;
                } catch (e) {
                    console.warn(`Failed to load font weight ${weight}:`, e);
                }
            }
        }

        browser = await chromium.launch({
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-font-subpixel-positioning',
                '--font-render-hinting=none'
            ]
        });
        const context = await browser.newContext();
        const page = await context.newPage();
        
        // 1. Set content
        await page.setContent(html, { waitUntil: 'networkidle' });

        // 2. Inject font facial and force override
        // We use addStyleTag which is more reliable than embedding in setContent for some reason
        await page.addStyleTag({
            content: `
                ${fontStyles}
                
                * {
                    font-family: 'HarmonyOS Sans', "PingFang SC", "Microsoft YaHei", sans-serif !important;
                }
                
                h1, h2, h3, h4, h5, h6, strong, b {
                    font-weight: 700 !important;
                }
                
                body {
                    -webkit-font-smoothing: antialiased;
                    -moz-osx-font-smoothing: grayscale;
                    text-rendering: optimizeLegibility;
                }
            `
        });

        // 3. Wait for all fonts (including the newly added ones) to be loaded
        await page.evaluate(async () => {
            await document.fonts.ready;
            // Force a layout reflow
            document.body.getBoundingClientRect();
        });
        
        // Extra wait for layout stabilization
        await page.waitForTimeout(1500);

        const pdfBuffer = await page.pdf({
            format: 'A4',
            margin: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' },
            printBackground: true,
            displayHeaderFooter: false,
            preferCSSPageSize: true
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
