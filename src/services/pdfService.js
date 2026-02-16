const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

class PdfService {
    async generatePdf(htmlContent) {
        let browser = null;
        try {
            browser = await chromium.launch({
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            const context = await browser.newContext();
            const page = await context.newPage();
            
            // Set viewport for consistent mobile rendering if needed
            await page.setViewportSize({ width: 750, height: 1334 });

            // Inject font-face if needed or just set default font family
            // Since we installed fonts to the system, Chromium should pick them up.
            // We force the font family in a style tag with absolute paths to be safe.
            const styledHtml = `
                <style>
                    @font-face {
                        font-family: 'HarmonyOS Sans';
                        src: url('file:///usr/share/fonts/truetype/harmonyos/HarmonyOS_Sans_Regular.ttf') format('truetype');
                        font-weight: normal;
                        font-style: normal;
                    }
                    @font-face {
                        font-family: 'HarmonyOS Sans';
                        src: url('file:///usr/share/fonts/truetype/harmonyos/HarmonyOS_Sans_Bold.ttf') format('truetype');
                        font-weight: bold;
                        font-style: normal;
                    }
                    body {
                        font-family: 'HarmonyOS Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
                    }
                    /* Ensure headers use the font too */
                    h1, h2, h3, h4, h5, h6, .main-title, .sub-title, div, p, span {
                        font-family: 'HarmonyOS Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
                    }
                </style>
                ${htmlContent}
            `;

            await page.setContent(styledHtml, { waitUntil: 'networkidle' });

            const pdfBuffer = await page.pdf({
                format: 'A4',
                printBackground: true,
                margin: {
                    top: '20mm',
                    right: '20mm',
                    bottom: '20mm',
                    left: '20mm'
                }
            });

            return pdfBuffer;
        } finally {
            if (browser) {
                await browser.close();
            }
        }
    }
}

module.exports = new PdfService();
