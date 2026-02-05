const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;

async function handleExportPdf(req, res, args) {
    const { html } = args[0];
    let browser = null;
    try {
        const fontPath = path.join(__dirname, '../../font/HarmonyOS_Sans_Regular.ttf');
        const boldPath = path.join(__dirname, '../../font/HarmonyOS_Sans_Bold.ttf');
        
        let fontBase64 = '';
        let boldFontBase64 = '';
        
        try {
            if (fs.existsSync(fontPath)) {
                const regularFont = await fsPromises.readFile(fontPath);
                fontBase64 = regularFont.toString('base64');
            }
            if (fs.existsSync(boldPath)) {
                const boldFont = await fsPromises.readFile(boldPath);
                boldFontBase64 = boldFont.toString('base64');
            }
        } catch (fontErr) {
            console.warn('Font loading failed:', fontErr);
        }

        browser = await chromium.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const context = await browser.newContext();
        const page = await context.newPage();
        
        // Use a simpler approach for font injection to ensure stability
        await page.setContent(html, { waitUntil: 'load' });

        if (fontBase64) {
            await page.addStyleTag({
                content: `
                    @font-face {
                        font-family: 'HarmonyOS Sans';
                        src: url(data:font/ttf;base64,${fontBase64}) format('truetype');
                        font-weight: normal;
                        font-style: normal;
                    }
                    ${boldFontBase64 ? `
                    @font-face {
                        font-family: 'HarmonyOS Sans';
                        src: url(data:font/ttf;base64,${boldFontBase64}) format('truetype');
                        font-weight: bold;
                        font-style: normal;
                    }
                    ` : ''}
                    * {
                        font-family: 'HarmonyOS Sans', -apple-system, sans-serif !important;
                    }
                `
            });
        }

        // Wait for fonts to be ready
        await page.evaluateHandle('document.fonts.ready');
        
        // Wait a bit more for images and layout
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
            return res.status(500).json({ success: false, error: 'PDF 生成失败' });
        }
    } finally {
        if (browser) await browser.close();
    }
}

module.exports = {
    handleExportPdf
};
