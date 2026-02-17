
import html2canvas from 'html2canvas';

class ExportManager {
    constructor() {
        // We will collect CSS from the document instead of using hardcoded paths
        this.cssFiles = [];
    }

    async exportResult(format = 'html') {
        const resultItem = document.getElementById('resultItem');
        if (!resultItem || (resultItem.style.display === 'none' && !resultItem.classList.contains('active'))) {
            if (window.showToast) {
                window.showToast('暂无检测结果可导出', 'warning');
            }
            return;
        }
        
        const isMobile = window.innerWidth <= 768 || !!document.querySelector('.mobile-container');
        const theme = document.documentElement.getAttribute('data-theme') || 'light';
        const exportLabelMap = {
            html: 'HTML',
            pdf: 'PDF',
            image: '图片'
        };
        const exportLabel = exportLabelMap[format] || format.toUpperCase();

        if (isMobile && window.showLoadingToast) {
            window.showLoadingToast(format === 'image' ? '正在导出图片...' : `正在生成 ${exportLabel}...`);
        } else if (window.showToast) {
            const startMessage = format === 'image'
                ? '正在导出图片，请稍候...'
                : `正在生成 ${exportLabel} 导出文件，请稍候...`;
            window.showToast(startMessage, 'info', 0);
        }

        try {
            // Extract Data First
            const data = this.extractExportData(resultItem);
            
            if (format === 'html') {
                const html = this.generateStaticHtml(data, theme);
                this.downloadFile(html);
                if (isMobile && window.hideLoadingToast) window.hideLoadingToast();
                if (window.showToast) window.showToast('HTML 下载成功', 'success');
                return;
            }

            // For Image/PDF, we still rely on html2canvas but we give it a CLEAN DOM to work with
            // 1. Create a clean container off-screen
            const container = document.createElement('div');
            container.style.position = 'fixed';
            container.style.top = '-9999px';
            container.style.left = '-9999px';
            
            // Match actual display width as requested
            const actualWidth = resultItem.offsetWidth > 0 ? resultItem.offsetWidth : (isMobile ? window.innerWidth : 800);
            const exportWidth = Math.max(actualWidth, isMobile ? 320 : 600);
            
            container.style.width = exportWidth + 'px';
            container.style.zIndex = '-1';
            container.innerHTML = this.generateStaticHtml(data, theme, true); // true = raw body content only
            document.body.appendChild(container);

            // Wait for images to load if they were passed as data URIs or need fetching
            // Since we extracted data, images might be URLs. We need to Base64 them.
            await this.processImages(container);
            
            // Give browser a moment to render the layout
            await new Promise(r => setTimeout(r, 600));

            const bgColor = theme === 'dark' ? '#0f172a' : '#f3f4f6';
            container.style.backgroundColor = bgColor;
            container.style.fontFamily = '"HarmonyOS Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
            
            const exportOptions = {
                useCORS: true,
                scale: 2.2, // Balanced scale for quality vs size
                backgroundColor: bgColor,
                logging: false,
                width: exportWidth,
                windowWidth: exportWidth
            };

            const canvas = await html2canvas(container, exportOptions);
            const imgData = canvas.toDataURL('image/png', 1.0);

            // Clean up
            document.body.removeChild(container);

            if (format === 'image') {
                const link = document.createElement('a');
                const timestamp = new Date().getTime();
                link.download = `分析报告_${timestamp}.png`;
                link.href = imgData;
                link.click();
            } else if (format === 'pdf') {
                // PDF Logic (simplified: send image to backend or simple print)
                if (isMobile) {
                    const fullHtml = this.generateStaticHtml(data, theme);
                    const invoker = window.api;
                    const response = await invoker.invoke('export-pdf', { html: fullHtml });
                     if (response && response.pdfBase64) {
                        const blob = this.base64ToBlob(response.pdfBase64, 'application/pdf');
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = url;
                        link.download = response.fileName || `分析报告_${new Date().getTime()}.pdf`;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        URL.revokeObjectURL(url);
                    }
                } else {
                     const printWindow = window.open('', '_blank');
                     printWindow.document.write(this.generateStaticHtml(data, theme));
                     printWindow.document.close();
                     printWindow.onload = () => { setTimeout(() => { printWindow.print(); }, 500); };
                }
            }

            if (isMobile && window.hideLoadingToast) window.hideLoadingToast();
            if (window.showToast) window.showToast(`${exportLabel} 导出成功`, 'success');

        } catch (err) {
            console.error('Export Error:', err);
            if (isMobile && window.hideLoadingToast) window.hideLoadingToast();
            if (window.showToast) window.showToast('导出失败: ' + err.message, 'error');
        }
    }

    extractExportData(el) {
        // Safe extraction helpers
        const getText = (sel) => {
            const node = el.querySelector(sel);
            return node ? node.textContent.trim() : '';
        };
        const getHtml = (sel) => {
             const node = el.querySelector(sel);
             return node ? node.innerHTML : '';
        };

        // Determine Risk Class & Color
        let riskClass = 'uncertain';
        const circleContainer = el.querySelector('.score-circle-container');
        if (circleContainer) {
            if (circleContainer.classList.contains('fake')) riskClass = 'fake';
            if (circleContainer.classList.contains('real')) riskClass = 'real';
        }

        // Analysis Items
        const analysisItems = [];
        el.querySelectorAll('.analysis-item').forEach(item => {
            let type = 'neutral';
            if (item.classList.contains('positive')) type = 'positive';
            if (item.classList.contains('warning')) type = 'warning';
            if (item.classList.contains('negative')) type = 'negative';
            
            // Also check child icon class if item doesn't have it
            const icon = item.querySelector('.analysis-icon');
            if (icon) {
                 if (icon.classList.contains('positive')) type = 'positive';
                 else if (icon.classList.contains('warning')) type = 'warning';
                 else if (icon.classList.contains('negative')) type = 'negative';
            }

            const iconText = icon ? icon.textContent.trim() : '';
            const text = item.querySelector('.analysis-text') ? item.querySelector('.analysis-text').textContent.trim() : item.textContent.trim();
            
            analysisItems.push({ type, iconText, text });
        });

        // Parse Title / Text
        // Main.html: <h3 id="parsedTitle"></h3> or inside .parsed-text h1
        let title = getText('#parsedTitle');
        if (!title) {
             const h1 = el.querySelector('.parsed-text h1, .parsed-text h2');
             if (h1) title = h1.textContent.trim();
        }
        if (!title) title = '检测报告'; // Fallback

        // Parsed Content Text (HTML to preserve formatting slightly, or just text)
        // We use innerHTML but strip scripts
        const contentDiv = el.querySelector('#parsedText');
        let contentHtml = contentDiv ? contentDiv.innerHTML.trim() : '';
        
        // Remove trailing/leading newlines that might cause odd spacing with pre-wrap
        contentHtml = contentHtml.replace(/^[\r\n]+|[\r\n]+$/g, '');

        // Normalize leading indent spaces (full-width/nbsp/space) for first paragraph lines
        // 1. Remove all leading whitespace from the very first line of the content
        contentHtml = contentHtml.replace(/^(\s|\u00A0|\u3000)+/, '');
        
        // 2. Handle lines inside content
        contentHtml = contentHtml
            .split('\n')
            .map((line, index) => {
                if (index === 0) {
                    // Remove leading spaces even if after a tag like <p> (to fix indentation inside tags)
                    return line.replace(/^(<[^>]+>)?(\s|\u00A0|\u3000|&nbsp;)+/gi, '$1');
                }
                return line.replace(/^[\t\u00A0\u3000\s]{2,}/, '');
            })
            .join('\n');
            
        // 3. More aggressive removal of any leading spaces after a tag at the start of any line
        contentHtml = contentHtml
            .replace(/(<[^>]+>)(?:\s|\u00A0|\u3000|&nbsp;)+/gi, '$1')
            .trim();

        // Source URL display
        const sourceDisplay = el.querySelector('.source-url-display');
        const sourceLinkNode = sourceDisplay ? sourceDisplay.querySelector('a[href]') : null;
        const sourceLabelNode = sourceDisplay ? sourceDisplay.querySelector('span') : null;
        
        // Find visible icon
        let sourceIconNode = null;
        if (sourceDisplay) {
            const icons = sourceDisplay.querySelectorAll('img, svg');
            for (const icon of icons) {
                if (window.getComputedStyle(icon).display !== 'none' && !icon.closest('[style*="display: none"]')) {
                    sourceIconNode = icon;
                    break;
                }
            }
            // Fallback to first icon if none found
            if (!sourceIconNode && icons.length > 0) sourceIconNode = icons[0];
        }
        
        let sourceText = sourceLabelNode ? sourceLabelNode.textContent.trim() : '';
        const sourceLink = sourceLinkNode ? sourceLinkNode.href : '';
        let sourceIconHtml = '';

        if (sourceIconNode) {
             // Clone to safely modify
             const iconClone = sourceIconNode.cloneNode(true);
             iconClone.style.display = 'inline-block';
             iconClone.style.width = '16px';
             iconClone.style.height = '16px';
             iconClone.style.marginRight = '8px';
             iconClone.style.flexShrink = '0';
             iconClone.style.objectFit = 'contain';
             iconClone.style.verticalAlign = 'middle';
             sourceIconHtml = iconClone.outerHTML;
        }

        if (!sourceText && sourceDisplay) {
            sourceText = sourceDisplay.textContent.trim().replace(/访问$/, '');
        }
        if (!sourceText && sourceLink) {
            try {
                sourceText = `来源: ${new URL(sourceLink).hostname}`;
            } catch (e) {
                sourceText = '来源: 网页链接';
            }
        }
        if (!sourceText && !sourceLink) {
             sourceText = ''; // Don't show anything for plain text input
        }

        const scoreVal = getText('#scoreValue') || getText('.score-val') || '--%';
        const summaryPercent = getText('.summary-val-text') || getText('#scoreText') || scoreVal;
        const summaryTitle = getText('.summary-title-text');
        const scoreLabel = summaryTitle || this.getDefaultRiskLabel(riskClass);

        // Images
        const images = [];
        el.querySelectorAll('.parsed-images-grid img, .parsed-images-container img').forEach(img => {
            images.push(img.src);
        });

        return {
            scoreVal: scoreVal,
            scoreText: summaryPercent,
            scoreLabel: scoreLabel,
            scoreDesc: getText('#scoreDescription') || getText('.summary-desc-text') || '',
            riskClass: riskClass,
            analysisItems: analysisItems,
            title: title,
            contentHtml: contentHtml,
            images: images,
            sourceText: sourceText,
            sourceLink: sourceLink,
            sourceIconHtml: sourceIconHtml
        };
    }

    getDefaultRiskLabel(riskClass) {
        if (riskClass === 'fake') return '虚假消息';
        if (riskClass === 'real') return '真实信息';
        return '真假参半';
    }

    parsePercent(text) {
        if (!text) return 0;
        const matched = String(text).match(/(\d+(?:\.\d+)?)/);
        if (!matched) return 0;
        const val = Number(matched[1]);
        if (!Number.isFinite(val)) return 0;
        return Math.max(0, Math.min(100, val));
    }

    generateStaticHtml(data, theme, bodyOnly = false) {
        // Theme Colors
        const isDark = theme === 'dark';
        const colors = {
            bg: isDark ? '#0f172a' : '#f3f4f6',
            card: isDark ? '#1e293b' : '#ffffff',
            text: isDark ? '#f8fafc' : '#111827',
            textSec: isDark ? '#94a3b8' : '#6b7280',
            border: isDark ? '#334155' : '#e5e7eb',
            primary: isDark ? '#38bdf8' : '#4361ee',
            success: '#2ec4b6',
            warning: '#ff9f1c',
            danger: isDark ? '#ef4444' : '#e71d36',
            successBg: isDark ? 'rgba(46, 196, 182, 0.2)' : 'rgba(46, 196, 182, 0.15)',
            warningBg: isDark ? 'rgba(255, 159, 28, 0.2)' : 'rgba(255, 159, 28, 0.15)',
            dangerBg: isDark ? 'rgba(239, 68, 68, 0.2)' : 'rgba(231, 29, 54, 0.15)',
        };

        // Calc Risk Color
        let riskColor = colors.warning;
        if (data.riskClass === 'fake') riskColor = colors.danger;
        if (data.riskClass === 'real') riskColor = colors.success;

        const progressPercent = this.parsePercent(data.scoreVal || data.scoreText);
        const circleRadius = 45;
        const circleLength = 2 * Math.PI * circleRadius;
        const circleOffset = circleLength * (1 - progressPercent / 100);

        const style = `
            font-family: "HarmonyOS Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background-color: ${colors.bg};
            color: ${colors.text};
            margin: 0; padding: 0;
            box-sizing: border-box;
            width: 100%;
            display: flex;
            flex-direction: column;
            align-items: center;
        `;

        const cardStyle = `
            background: ${colors.card};
            border-radius: 16px;
            padding: 24px;
            margin-bottom: 20px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04);
            border: 1px solid ${colors.border};
        `;

        const headerHtml = `
            <div style="margin-bottom: 24px; text-align: center; padding-top: 10px;">
                <h1 style="margin: 0; font-size: 22px; color: ${colors.text}; font-weight: 800; letter-spacing: 0.5px;">检测结果</h1>
            </div>
        `;

        // SVGs for Icons
        const checkIcon = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`;
        const warnIcon = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>`;
        const closeIcon = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
        const globeIcon = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm6.93 6h-2.95c-.32-1.25-.78-2.45-1.38-3.56 1.84.63 3.37 1.91 4.33 3.56zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.09.66-.14 1.32-.14 2s.05 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56-1.84-.63-3.37-1.91-4.33-3.56zm2.95-8H5.08c.96-1.65 2.49-2.93 4.33-3.56-.6 1.11-1.06 2.31-1.38 3.56zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.14-1.32-.14-2s.05-1.34.14-2h4.68c.09.66.14 1.32.14 2s-.05 1.34-.14 2zm.84 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95c-.96 1.65-2.49 2.93-4.33 3.56zM16.36 14c.09-.66.14-1.32.14-2s-.05-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z"/></svg>`;

        const scoreCardHtml = `
            <div style="${cardStyle} display: flex; align-items: flex-start; gap: 20px;">
                <!-- Circle -->
                <div style="position: relative; width: 80px; height: 80px; flex-shrink: 0;">
                    <svg viewBox="0 0 100 100" style="width: 100%; height: 100%;">
                        <g transform="rotate(-90 50 50)">
                            <circle cx="50" cy="50" r="45" fill="none" stroke="${isDark ? '#334155' : '#f1f5f9'}" stroke-width="8" />
                            <circle cx="50" cy="50" r="45" fill="none" stroke="${riskColor}" stroke-width="8" stroke-dasharray="${circleLength.toFixed(2)}" stroke-dashoffset="${circleOffset.toFixed(2)}" stroke-linecap="round" />
                        </g>
                    </svg>
                    <div style="position: absolute; top:0; left:0; width:100%; height:100%; display:flex; align-items:center; justify-content:center;">
                        <span style="font-size: 20px; font-weight: 700; color: ${colors.text}; font-family: 'HarmonyOS Sans', sans-serif;">${data.scoreVal}</span>
                    </div>
                </div>

                <!-- Text -->
                <div style="flex: 1; display: flex; flex-direction: column; justify-content: center;">
                    <div style="font-size: 24px; font-weight: 800; line-height: 1.0; color: ${riskColor}; margin-bottom: 6px; font-family: 'HarmonyOS Sans', sans-serif;">
                        ${data.scoreText || data.scoreVal}
                    </div>
                    <div style="font-size: 15px; font-weight: bold; line-height: 1.2; color: ${colors.text}; margin-bottom: 8px;">
                        ${data.scoreLabel || this.getDefaultRiskLabel(data.riskClass)}
                    </div>
                    <div style="font-size: 13px; color: ${colors.textSec}; line-height: 1.5; font-weight: 400; opacity: 0.9;">
                        ${data.scoreDesc}
                    </div>
                </div>
            </div>
        `;

        let analysisListHtml = '';
        data.analysisItems.forEach(item => {
            let bg = colors.bg; 
            let fg = colors.text;
            let iconSvg = checkIcon;
            
            if (item.type === 'positive') { bg = colors.successBg; fg = colors.success; iconSvg = checkIcon; }
            if (item.type === 'warning') { bg = colors.warningBg; fg = colors.warning; iconSvg = warnIcon; }
            if (item.type === 'negative') { bg = colors.dangerBg; fg = colors.danger; iconSvg = closeIcon; }

            // Handle pure icon class extraction if type is neutral but icon has class
            if (item.type === 'neutral') {
                 // Try to guess from text or just default
                 if (item.iconText === '✔' || item.iconText === '✓') { bg = colors.successBg; fg = colors.success; iconSvg = checkIcon; }
                 else if (item.iconText === '✕') { bg = colors.dangerBg; fg = colors.danger; iconSvg = closeIcon; }
                 else if (item.iconText === '!') { bg = colors.warningBg; fg = colors.warning; iconSvg = warnIcon; }
            }

            analysisListHtml += `
                <div style="display: flex; gap: 12px; margin-bottom: 10px; padding: 12px; background: ${isDark ? 'rgba(255,255,255,0.03)' : '#f9fafb'}; border-radius: 12px; border: 1px solid ${colors.border}15;">
                    <div style="width: 24px; height: 24px; border-radius: 50%; background: ${bg}; color: ${fg}; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 12px;">
                        ${iconSvg}
                    </div>
                    <div style="font-size: 14px; line-height: 1.5; color: ${colors.text}; font-weight: 400;">
                        ${item.text}
                    </div>
                </div>
            `;
        });

        const analysisCardHtml = `
            <div style="${cardStyle}">
                <div style="display: flex; align-items: center; margin-bottom: 10px;">
                    <div style="width: 4px; height: 16px; background: ${colors.primary}; margin-right: 8px; border-radius: 2px;"></div>
                    <div style="font-size: 16px; font-weight: 600; color: ${colors.text};">
                        详细分析
                    </div>
                </div>
                <div>${analysisListHtml}</div>
            </div>
        `;

        let imagesHtml = '';
        if (data.images.length > 0) {
            const thumbItems = data.images.map(src => `
                <div class="parsed-image-item" style="position: relative; width: 100%; aspect-ratio: 1 / 1; overflow: hidden; border-radius: 8px; background: ${isDark ? '#1f2937' : '#f0f0f0'};">
                    <img src="${src}" style="width: 100%; height: 100%; object-fit: cover; display: block;" />
                </div>
            `).join('');

            imagesHtml = `
                <div class="parsed-images-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)); gap: 8px; margin-bottom: 12px;">
                    ${thumbItems}
                </div>
            `;
        }

        const sourceIcon = data.sourceIconHtml || globeIcon;
        const showSourceBar = data.sourceLink || (data.sourceText && data.sourceText !== '来源: 网络搜索 / 官方通报');

        const contentCardHtml = `
            <div style="${cardStyle}">
                <h3 style="margin: 0 0 16px 0; font-size: 18px; font-weight: 800; line-height: 1.5; color: ${colors.text};">${data.title}</h3>
                
                ${showSourceBar ? `
                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 20px; padding: 6px 12px; background: ${isDark ? 'rgba(255,255,255,0.03)' : '#f3f4f6'}; border-radius: 8px; border: 1px solid ${colors.border}15;">
                    <div style="color: ${colors.textSec}; flex-shrink: 0; display: flex; align-items: center;">${sourceIcon}</div>
                    <div style="font-size: 14px; color: ${colors.textSec}; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500;">${data.sourceText}</div>
                    ${data.sourceLink ? `<a href="${data.sourceLink}" target="_blank" rel="noopener noreferrer" style="font-size: 13px; color: ${colors.primary}; text-decoration: none; font-weight: 700;">访问</a>` : ''}
                </div>
                ` : ''}

                ${imagesHtml}
                <div class="export-content" style="font-size: 16px; line-height: 1.6; color: ${colors.text}; white-space: pre-wrap; text-align: justify; word-break: break-all; font-weight: 400;">${data.contentHtml}</div>
            </div>
        `;

        const helperStyle = `
            <style>
                @font-face {
                    font-family: 'HarmonyOS Sans';
                    src: local('HarmonyOS Sans SC'), local('HarmonyOS Sans');
                }
                .export-container {
                    font-family: "HarmonyOS Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                }
                .export-content .fake-highlight {
                    background-color: ${isDark ? 'rgba(255, 159, 28, 0.25)' : 'rgba(255, 159, 28, 0.22)'};
                    border-bottom: 2px solid ${colors.warning};
                    padding: 0 1px;
                    border-radius: 2px;
                    font-weight: 500;
                }
                .export-content img {
                    max-width: 100%;
                    height: auto;
                }
                .export-content p {
                    margin: 0;
                    text-indent: 0 !important;
                }
                .export-content > :first-child {
                    margin-top: 0 !important;
                    text-indent: 0 !important;
                }
            </style>
        `;

        const bodyContent = `
            <div class="export-container" style="max-width: 800px; width: calc(100% - 40px); margin: 0 auto; padding: 20px 0;">
                ${helperStyle}
                ${headerHtml}
                ${scoreCardHtml}
                ${analysisCardHtml}
                ${contentCardHtml}
                <div style="text-align: center; color: ${colors.textSec}; font-size: 12px; margin-top: 40px; padding-bottom: 20px; font-weight: 500; opacity: 0.7;">
                    Powered by Detect AI
                </div>
            </div>
        `;

        if (bodyOnly) return bodyContent;

        return `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>检测报告 - ${data.title}</title>
        </head>
        <body style="${style}">
            ${bodyContent}
        </body>
        </html>`;
    }

    async processImages(container) {
        // Find original images
        const originalImages = document.getElementById('resultItem').querySelectorAll('img');
        // Find cloned images
        const clonedImages = container.querySelectorAll('img');

        for (let i = 0; i < clonedImages.length; i++) {
            const cloneImg = clonedImages[i];
            const originalImg = originalImages[i];
            
            if (!originalImg) continue;

            try {
                // Try to get base64 from the original image (using canvas) first
                // This is robust because if it's visible on screen, we can grab it.
                if (originalImg.complete && originalImg.naturalWidth > 0) {
                     const base64 = await this.imageToDataURL(originalImg);
                     if (base64) {
                         cloneImg.src = base64;
                         continue;
                     }
                }

                // Fallback mechanisms
                const src = cloneImg.src;
                if (src && !src.startsWith('data:')) {
                    let base64 = null;
                    if (src.startsWith('blob:')) {
                        base64 = await this.blobUrlToBase64(src);
                    } else {
                        // Use fetch with credentials as backup
                        base64 = await this.fetchImageAsBase64(src);
                    }
                    
                    if (base64) {
                        cloneImg.src = base64;
                    }
                }
            } catch (e) {
                console.error('Failed to convert image:', e);
            }
        }
    }

    async imageToDataURL(imgElement) {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = imgElement.naturalWidth;
            canvas.height = imgElement.naturalHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(imgElement, 0, 0);
            return canvas.toDataURL('image/png');
        } catch (e) {
            console.warn('Cannot draw image to canvas (tainted?):', e);
            // If tainted, we return null and fall back to fetch
            return null;
        }
    }

    async blobUrlToBase64(blobUrl) {
        try {
            const response = await fetch(blobUrl);
            const blob = await response.blob();
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        } catch (e) {
            console.error('Blob conversion failed:', e);
            return null;
        }
    }

    async fetchImageAsBase64(url) {
        try {
            // Include credentials to handle protected proxy routes
            const response = await fetch(url, { credentials: 'include' });
            if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
            const blob = await response.blob();
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        } catch (e) {
            console.warn('Fetch image failed for url:', url, e);
            return null;
        }
    }

    async getAllCssContent() {
        let styles = '';
        
        // Find all <link rel="stylesheet"> tags
        const linkTags = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
        // Use .href property to get absolute URLs
        const urls = linkTags.map(link => link.href).filter(url => url);
        
        // Add hardcoded files if not already in URL list
        for (const url of this.cssFiles) {
            let absUrl = url;
            if (url.startsWith('/')) {
                absUrl = window.location.origin + url;
            }
            if (!urls.includes(absUrl)) urls.push(absUrl);
        }

        // Fetch all CSS content
        for (const url of urls) {
            try {
                // Only fetch from same origin or data URIs to avoid CORS issues
                if (!url.includes(window.location.host) && !url.startsWith('data:')) continue;

                const response = await fetch(url);
                if (!response.ok) continue;
                const text = await response.text();
                styles += `<style>\n/* Source: ${url} */\n${text}\n</style>\n`;
            } catch (e) {
                console.warn(`Failed to fetch CSS from ${url}:`, e);
            }
        }

        // Add document inline <style> tags (Vite often injects styles here)
        document.querySelectorAll('style').forEach(style => {
            styles += style.outerHTML;
        });

        // Add specific export styles to ensure layout is correct
        styles += `
        <style>
            :root {
                --primary-color: #4361ee;
                --accent-primary: #4361ee;
                --success-color: #2ec4b6;
                --success-light: rgba(46, 196, 182, 0.15);
                --warning-color: #ff9f1c;
                --warning-light: rgba(255, 159, 28, 0.15);
                --danger-color: #e71d36;
                --danger-light: rgba(231, 29, 54, 0.15);
                --bg-main: #f3f4f6;
                --bg-primary: #ffffff;
                --bg-secondary: #f8f9fa;
                --bg-tertiary: #f1f3f5;
                --text-primary: #111827;
                --text-main: #111827;
                --text-secondary: #6c757d;
                --text-muted: #6b7280;
                --border-color: #e5e7eb;
            }
            html[data-theme="dark"] {
                --primary-color: #4cc9f0;
                --accent-primary: #4cc9f0;
                --success-color: #2ec4b6;
                --success-light: rgba(46, 196, 182, 0.2);
                --warning-color: #ff9f1c;
                --warning-light: rgba(255, 159, 28, 0.2);
                --danger-color: #ef4444;
                --danger-light: rgba(239, 68, 68, 0.2);
                --bg-main: #0f172a;
                --bg-primary: #111315;
                --bg-secondary: #1a1d20;
                --bg-tertiary: #212529;
                --text-primary: #f9fafb;
                --text-main: #f8fafc;
                --text-secondary: #adb5bd;
                --text-muted: #94a3b8;
                --border-color: #374151;
            }
            html, body { 
                height: auto !important;
                overflow: auto !important;
                background: var(--bg-main) !important; 
                color: var(--text-primary);
                font-family: "HarmonyOS Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "WenQuanYi Zen Hei", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
                margin: 0;
                padding: 0;
                user-select: text !important;
                -webkit-user-select: text !important;
            }
            body {
                padding: 24px;
                min-height: 100vh;
            }
            .drawer-panel, .drawer-backdrop, .loading-toast, .mobile-header, #title-bar, .sidebar-toggle-btn, .toolbar-btn, #exportBtn, .export-result-btn, .exit-result-btn {
                display: none !important;
            }
            .image-modal, #customTooltip {
                display: none !important;
            }
            .container {
                display: block !important;
                height: auto !important;
                max-width: 850px;
                margin: 0 auto;
            }
            .right-panel {
                width: 100% !important;
                background: transparent !important;
                display: block !important;
                padding: 0 !important;
            }
            #resultItem {
                width: 100% !important;
                display: block !important;
                opacity: 1 !important;
                transform: none !important;
                background: transparent !important;
            }
            .result-card, .result-score, .result-analysis, .parsed-content.result-card {
                background: var(--bg-primary) !important;
                border: 1px solid var(--border-color) !important;
                border-radius: 16px !important;
                box-shadow: 0 4px 15px rgba(0,0,0,0.05) !important;
                padding: 30px !important;
                margin-bottom: 24px !important;
                display: block !important;
                overflow: visible !important;
            }
            .summary-header {
                display: flex !important;
                flex-direction: row !important;
                align-items: center !important;
                gap: 30px !important;
                margin-bottom: 0 !important;
                width: 100% !important;
            }
            .score-circle-container {
                width: 100px !important;
                height: 100px !important;
                min-width: 100px !important;
                flex: 0 0 100px !important;
                position: relative !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
            }
            .score-circle-svg {
                width: 100% !important;
                height: 100% !important;
                transform: rotate(-90deg) !important;
            }
            .score-circle-progress {
                stroke-width: 8 !important;
                stroke-linecap: round !important;
            }
            .score-inner {
                position: absolute !important;
                top: 0; left: 0; width: 100%; height: 100%;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
            }
            .score-val {
                font-size: 22px !important;
                font-weight: bold !important;
            }
            .summary-text-content {
                flex: 1 !important;
                display: flex !important;
                flex-direction: column !important;
                justify-content: center !important;
            }
            .summary-val-text {
                font-size: 34px !important;
                font-weight: 800 !important;
                margin-bottom: 4px !important;
                color: var(--text-primary) !important;
                line-height: 1.2 !important;
            }
            .summary-title-text {
                font-size: 16px !important;
                font-weight: bold !important;
                margin-bottom: 8px !important;
                color: var(--text-primary) !important;
            }
            .summary-desc-text {
                font-size: 15px !important;
                color: var(--text-secondary) !important;
                line-height: 1.6 !important;
            }
            .analysis-item {
                display: flex !important;
                flex-direction: row !important;
                align-items: flex-start !important;
                gap: 15px !important;
                padding: 18px !important;
                background-color: var(--bg-secondary) !important;
                border-radius: 12px !important;
                border: 1px solid var(--border-color) !important;
                margin-bottom: 12px !important;
            }
            .analysis-icon {
                width: 30px !important;
                height: 30px !important;
                min-width: 30px !important;
                border-radius: 15px !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                font-weight: 800 !important;
                font-size: 16px !important;
                flex-shrink: 0 !important;
            }
            .analysis-icon.positive {
                background: var(--success-light) !important;
                color: var(--success-color) !important;
            }
            .analysis-icon.warning {
                background: var(--warning-light) !important;
                color: var(--warning-color) !important;
            }
            .analysis-icon.negative {
                background: var(--danger-light) !important;
                color: var(--danger-color) !important;
            }
            .analysis-text {
                font-size: 15px !important;
                line-height: 1.6 !important;
                color: var(--text-primary) !important;
            }
            .export-header {
                margin-bottom: 40px !important;
                padding-bottom: 20px !important;
                border-bottom: 1px solid var(--border-color) !important;
            }
        </style>
        `;

        return styles;
    }

    buildHtml(content, styles, theme = 'light') {
        const scriptContent = `
        // Remove base tags to prevent path mutation in cloned environment
        document.querySelectorAll('base').forEach(b => b.remove());
        
        // Image Modal Logic
        function showImageModal(url, reason = null) {
            const modal = document.getElementById('imageModal');
            const modalImage = document.getElementById('modalImage');
            const modalReason = document.getElementById('modalReason');
            
            modalImage.src = url;
            if (modalReason) {
                if (reason) {
                    modalReason.textContent = reason;
                    modalReason.classList.add('active');
                } else {
                    modalReason.classList.remove('active');
                }
            }
            modal.classList.add('active');
        }

        const modal = document.getElementById('imageModal');
        const modalClose = document.getElementById('modalClose');
        
        if (modalClose) {
            modalClose.addEventListener('click', () => {
                modal.classList.remove('active');
            });
        }

        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.remove('active');
                }
            });
        }

        // Re-bind click events to images
        document.querySelectorAll('.parsed-image-item img').forEach(img => {
            img.style.cursor = 'pointer';
            img.onclick = function() {
                showImageModal(this.src);
            };
        });

        // Tooltip Logic
        let activeTooltipElement = null;
        let tooltipUpdateRaf = null;
        let tooltipIsLocked = false;

        function updateTooltipPosition() {
            const tooltip = document.getElementById('customTooltip');
            if (!tooltip || !tooltip.classList.contains('active') || !activeTooltipElement) return;

            const rect = activeTooltipElement.getBoundingClientRect();
            const tooltipRect = tooltip.getBoundingClientRect();
            
            const scrollX = window.scrollX || window.pageXOffset;
            const scrollY = window.scrollY || window.pageYOffset;

            let top = rect.bottom + scrollY + 10;
            let left = rect.left + scrollX + (rect.width / 2) - (tooltipRect.width / 2);

            const padding = 16;
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            
            if (left < scrollX + padding) {
                left = scrollX + padding;
            } else if (left + tooltipRect.width > scrollX + viewportWidth - padding) {
                left = scrollX + viewportWidth - tooltipRect.width - padding;
            }
            
            if (rect.bottom + 10 + tooltipRect.height > viewportHeight - padding) {
                top = rect.top + scrollY - tooltipRect.height - 10;
            }

            tooltip.style.top = top + 'px';
            tooltip.style.left = left + 'px';
        }

        function showReasonTooltip(event, element, mode = 'click') {
            if (event) event.stopPropagation();
            
            if (mode === 'hover' && tooltipIsLocked && activeTooltipElement !== element) {
                return;
            }

            if (mode === 'click') {
                tooltipIsLocked = true;
            }

            if (activeTooltipElement && activeTooltipElement !== element) {
                activeTooltipElement.classList.remove('active');
            }

            const reasonAttr = element.getAttribute('data-reason');
            if (!reasonAttr) return;

            activeTooltipElement = element;
            activeTooltipElement.classList.add('active');

            const tooltip = document.getElementById('customTooltip');
            
            // Handle both legacy (string) and new (JSON) formats
            let riskType = '内容存疑';
            let description = reasonAttr;
            let originalText = element.textContent;

            try {
                if (reasonAttr.startsWith('{')) {
                    const data = JSON.parse(reasonAttr);
                    riskType = data.r || riskType;
                    description = data.d || '';
                }
            } catch (e) {
                console.warn('Failed to parse tooltip JSON', e);
            }

            tooltip.innerHTML = \`
                <div class="tooltip-header" style="font-weight: bold; font-size: 16px; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border-color);">风险详情</div>
                <div class="tooltip-section" style="margin-bottom: 12px;">
                    <div class="tooltip-label" style="font-size: 12px; color: #9ca3af; margin-bottom: 4px;">风险类型</div>
                    <div class="tooltip-tag" style="display: inline-block; padding: 2px 8px; border-radius: 4px; background: rgba(239, 68, 68, 0.1); color: #ef4444; font-size: 12px; font-weight: 500;">\${riskType}</div>
                </div>
                <div class="tooltip-section" style="margin-bottom: 12px;">
                    <div class="tooltip-label" style="font-size: 12px; color: #9ca3af; margin-bottom: 4px;">检测原文</div>
                    <div class="tooltip-quote" style="font-style: italic; color: var(--text-primary); border-left: 3px solid var(--border-color); padding-left: 8px;">"\${originalText}"</div>
                </div>
                <div class="tooltip-section">
                    <div class="tooltip-label" style="font-size: 12px; color: #9ca3af; margin-bottom: 4px;">AI 分析理由</div>
                    <div class="tooltip-reason" style="line-height: 1.5; color: var(--text-primary);">\${description}</div>
                </div>
            \`;
            tooltip.classList.add('active');

            updateTooltipPosition();
        }

        // Expose to global scope for onclick attribute
        window.showReasonTooltip = showReasonTooltip;

        function hideTooltip(force = true) {
            if (!force && tooltipIsLocked) return;
            if (force) tooltipIsLocked = false;

            const tooltip = document.getElementById('customTooltip');
            if (tooltip) {
                tooltip.classList.remove('active');
            }
            if (activeTooltipElement) {
                activeTooltipElement.classList.remove('active');
                activeTooltipElement = null;
            }
        }

        document.addEventListener('click', function(e) {
            const tooltip = document.getElementById('customTooltip');
            if (tooltip && tooltip.contains(e.target)) return;
            if (e.target.classList.contains('fake-highlight')) return;
            hideTooltip();
        });

        window.addEventListener('scroll', function() {
            if (activeTooltipElement) {
                if (tooltipUpdateRaf) cancelAnimationFrame(tooltipUpdateRaf);
                tooltipUpdateRaf = requestAnimationFrame(updateTooltipPosition);
            }
        }, true);

        window.addEventListener('resize', function() {
            if (activeTooltipElement) {
                updateTooltipPosition();
            }
        });
        `;

        return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="${theme}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>检测报告</title>
    ${styles}
</head>
<body class="export-view" data-theme="${theme}">
    <div class="container">
        <div class="right-panel">
            <div class="result-content">
                ${content}
            </div>
        </div>
    </div>

    <!-- Image Modal -->
    <div class="image-modal" id="imageModal">
        <button class="modal-close" id="modalClose">
            <svg viewBox="0 0 24 24" width="24" height="24">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor"/>
            </svg>
        </button>
        <img class="modal-image" id="modalImage" src="" alt="预览图片">
        <div id="modalReason" class="modal-reason"></div>
    </div>

    <!-- Tooltip -->
    <div id="customTooltip" class="custom-tooltip"></div>

    <script>
        ${scriptContent}
    <\/script>
</body>
</html>`;
    }

    downloadFile(htmlContent) {
        const blob = new Blob([htmlContent], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `分析结果_${new Date().getTime()}.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        if (window.showToast) {
            window.showToast('已生成分析结果导出文件', 'success');
        }
    }

    base64ToBlob(base64, mimeType) {
        const byteCharacters = atob(base64);
        const byteArrays = [];
        for (let offset = 0; offset < byteCharacters.length; offset += 512) {
            const slice = byteCharacters.slice(offset, offset + 512);
            const byteNumbers = new Array(slice.length);
            for (let i = 0; i < slice.length; i++) {
                byteNumbers[i] = slice.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            byteArrays.push(byteArray);
        }
        return new Blob(byteArrays, { type: mimeType });
    }
}

// Attach to window
window.exportManager = new ExportManager();
