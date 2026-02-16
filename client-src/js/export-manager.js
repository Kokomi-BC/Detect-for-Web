
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

        // Clone the result item to modify it for export
        const clone = resultItem.cloneNode(true);
        clone.style.display = 'block'; // Ensure cloned version is visible for analysis
        
        // Remove ALL possible UI components from the clone
        const uiSelectors = [
            '#exportBtn', '.export-result-btn', '.exit-result-btn', 
            '.exit-detection-btn', '#exitDetectionBtn', '.toolbar-btn',
            '.drawer-panel', '.drawer-backdrop', '#exportDropdown',
            '#actionSheet', '#exportActionSheet', '.loading-toast',
            '.mobile-header', '#title-bar', '.sidebar-toggle-btn',
            '.result-header-container',
            '.summary-title-text'
        ];
        uiSelectors.forEach(selector => {
            clone.querySelectorAll(selector).forEach(el => el.remove());
        });

        // Add Header for Export (Left-aligned "检测结果" and Article Title)
        const exportHeader = document.createElement('div');
        exportHeader.className = 'export-header';
        exportHeader.style.textAlign = 'left';
        exportHeader.style.marginBottom = '30px';
        exportHeader.style.padding = '10px 0';

        const mainTitle = document.createElement('div');
        mainTitle.textContent = '检测结果';
        mainTitle.style.margin = '0 0 15px 0';
        mainTitle.style.fontSize = '24px';
        mainTitle.style.fontWeight = 'bold';
        mainTitle.style.color = 'var(--text-primary)';
        exportHeader.appendChild(mainTitle);

        // Try to find article title
        const articleTitle = clone.querySelector('#parsedTitle') || clone.querySelector('.parsed-text h1, .parsed-text h2');
        if (articleTitle) {
            const subTitle = document.createElement('div');
            subTitle.textContent = articleTitle.textContent;
            subTitle.style.textAlign = 'left';
            subTitle.style.fontSize = '20px';
            subTitle.style.fontWeight = 'bold';
            subTitle.style.color = 'var(--text-primary)';
            subTitle.style.paddingLeft = '15px';
            subTitle.style.borderLeft = '4px solid var(--accent-primary)';
            subTitle.style.margin = '10px 0';
            exportHeader.appendChild(subTitle);
            
            // Remove original title to avoid duplication
            articleTitle.remove();
        }
        clone.prepend(exportHeader);

        // Add specific class for export view styling
        const containerDiv = document.createElement('div');
        containerDiv.className = 'export-view';
        containerDiv.appendChild(clone);
        
        // Process images (convert to Base64)
        await this.processImages(clone);
        
        // Get CSS content
        const cssContent = await this.getAllCssContent();
        
        // Construct HTML
        const html = this.buildHtml(clone.outerHTML, cssContent);

        if (format === 'image' || format === 'pdf') {
            try {
                // Determine background color based on theme
                const bgColor = theme === 'dark' ? '#1e2128' : '#f3f4f6';
                
                // Give browser time to render if mobile
                if (isMobile) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
                
                const exportOptions = {
                    useCORS: true,
                    scale: 2,
                    backgroundColor: bgColor, 
                    logging: false,
                    onclone: (clonedDoc) => {
                        clonedDoc.documentElement.setAttribute('data-theme', theme);
                        clonedDoc.body.setAttribute('data-theme', theme);

                        const style = clonedDoc.createElement('style');
                        style.innerHTML = `
                            * { 
                                backdrop-filter: none !important; 
                                -webkit-backdrop-filter: none !important;
                                -webkit-text-stroke: 0 !important;
                                text-shadow: none !important;
                                transition: none !important;
                                animation: none !important;
                                box-shadow: none !important;
                                outline: none !important;
                                border: none !important;
                                --font-scale: 1.0 !important;
                            }
                            div, section, article, p, span {
                                border: none !important;
                                box-shadow: none !important;
                                outline: none !important;
                            }
                            .analysis-title {
                                border-left: 4px solid var(--primary-color) !important;
                            }
                            .fake-highlight {
                                border-bottom: 2px solid var(--warning-color) !important;
                            }
                            .result-score, .result-card, .analysis-item, .parsed-content, .result-analysis { 
                                background-color: var(--bg-primary) !important; 
                                opacity: 1 !important;
                                border: none !important;
                                box-shadow: none !important;
                            }
                            #resultItem .analysis-item {
                                background-color: var(--bg-secondary) !important;
                                border: 1px solid var(--border-color) !important;
                                border-radius: 12px !important;
                                box-shadow: none !important;
                                padding: 12px !important;
                                margin-bottom: 10px !important;
                            }
                            .parsed-text, .analysis-text, .summary-desc-text {
                                background: transparent !important;
                                border: none !important;
                                box-shadow: none !important;
                            }
                            .score-circle-container { 
                                background: transparent !important; 
                            }
                            #resultItem {
                                background-color: ${bgColor} !important;
                                transform: none !important;
                                opacity: 1 !important;
                                border: none !important;
                                box-shadow: none !important;
                            }
                            #resultItem .parsed-content.result-card, 
                            #resultItem .result-score, 
                            #resultItem .result-analysis {
                                background-color: var(--bg-primary) !important;
                                border: none !important;
                                border-radius: 16px !important;
                                box-shadow: none !important;
                                padding: 20px !important;
                                margin-bottom: 20px !important;
                            }
                        `;
                        clonedDoc.head.appendChild(style);

                        const toRemoveCount = [
                            '#actionSheet', '#exportActionSheet', '.drawer-backdrop', 
                            '#moreDropdown', '#userDropdown', '#exportDropdown',
                            '.mobile-header', '#title-bar', '.sidebar-toggle-btn',
                            '.loading-toast', '#customTooltip', '.resizer',
                            '.squeeze-mask', '.exit-detection-btn',
                            '.result-header-container', '.summary-title-text'
                        ];
                        toRemoveCount.forEach(s => {
                            clonedDoc.querySelectorAll(s).forEach(el => el.remove());
                        });

                        const clonedResult = clonedDoc.getElementById('resultItem');
                        if (clonedResult) {
                            clonedResult.style.display = 'block';
                            clonedResult.style.opacity = '1';
                            clonedResult.style.transform = 'none';
                            clonedResult.style.width = isMobile ? '100%' : '800px'; 
                            clonedResult.style.padding = isMobile ? '40px 20px 20px 20px' : '40px 30px 30px 30px';
                            clonedResult.style.position = 'relative';
                            clonedResult.style.boxShadow = 'none'; 
                            clonedResult.style.background = bgColor;
                            clonedDoc.body.style.background = bgColor;

                            // Add Export Header to Image
                            const expHeader = clonedDoc.createElement('div');
                            expHeader.style.textAlign = 'left';
                            expHeader.style.marginBottom = '30px';
                            expHeader.style.paddingBottom = '10px';

                            const mTitle = clonedDoc.createElement('div');
                            mTitle.textContent = '检测结果';
                            mTitle.style.margin = '0 0 15px 0';
                            mTitle.style.fontSize = '24px';
                            mTitle.style.fontWeight = 'bold';
                            mTitle.style.color = 'var(--text-primary)';
                            expHeader.appendChild(mTitle);

                            const aTitle = clonedResult.querySelector('#parsedTitle') || clonedResult.querySelector('.parsed-text h1, .parsed-text h2');
                            if (aTitle) {
                                const sTitle = clonedDoc.createElement('div');
                                sTitle.textContent = aTitle.textContent;
                                sTitle.style.textAlign = 'left';
                                sTitle.style.fontSize = '20px';
                                sTitle.style.fontWeight = 'bold';
                                sTitle.style.color = 'var(--text-primary)';
                                sTitle.style.paddingLeft = '15px';
                                sTitle.style.borderLeft = '4px solid var(--accent-primary)';
                                sTitle.style.margin = '10px 0';
                                expHeader.appendChild(sTitle);
                                aTitle.remove();
                            }
                            clonedResult.prepend(expHeader);

                            const scoreSvg = clonedResult.querySelector('.score-svg, .score-circle-svg');
                            if (scoreSvg) {
                                const innerContent = scoreSvg.innerHTML;
                                scoreSvg.innerHTML = `<g transform="rotate(-90 50 50)">${innerContent}</g>`;
                                scoreSvg.style.transform = 'none';
                            }
                        }
                    }
                };

                if (format === 'image') {
                    const canvas = await html2canvas(resultItem, exportOptions);
                    const imgData = canvas.toDataURL('image/png', 1.0);

                    const link = document.createElement('a');
                    const timestamp = new Date().getTime();
                    link.download = `分析报告_${timestamp}.png`;
                    link.href = imgData;
                    link.click();
                    
                    if (isMobile && window.hideLoadingToast) {
                        window.hideLoadingToast();
                        if (window.showToast) window.showToast('图片已导出', 'success');
                    } else if (window.showToast) {
                        window.showToast('结果已导出为图片', 'success');
                    }
                } else if (format === 'pdf') {
                    if (isMobile) {
                        // For mobile, use backend Playwright PDF generation
                        const fullHtml = this.buildHtml(clone.outerHTML, cssContent);
                        const invoker = window.api;
                        if (!invoker) {
                            throw new Error('系统环境错误，无法调用后端导出服务');
                        }

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
                        } else {
                            throw new Error('后端 PDF 生成失败');
                        }

                        if (window.hideLoadingToast) window.hideLoadingToast();
                        if (window.showToast) window.showToast('PDF 导出成功', 'success');
                    } else {
                        // For desktop, use browser native print
                        const printWindow = window.open('', '_blank');
                        if (!printWindow) {
                            throw new Error('无法打开打印窗口，请允许浏览器弹窗');
                        }

                        const printHtml = this.buildHtml(clone.outerHTML, cssContent);
                        printWindow.document.open();
                        printWindow.document.write(printHtml);
                        printWindow.document.close();
                        
                        // 设置标题以防止打印页眉显示 about:blank
                        printWindow.document.title = `分析报告_${new Date().getTime()}`;

                        printWindow.onload = () => {
                            setTimeout(() => {
                                printWindow.focus();
                                printWindow.print();
                            }, 200);
                        };

                        if (window.showToast) window.showToast('已打开打印窗口，可另存为 PDF', 'success');
                    }
                }
            } catch (err) {
                console.error('Export Error:', err);
                if (isMobile && window.hideLoadingToast) window.hideLoadingToast();
                if (window.showToast) window.showToast('导出失败，请检查浏览器权限', 'error');
            }
            return;
        }

        if (format === 'html') {
            try {
                this.downloadFile(html);
                if (isMobile && window.hideLoadingToast) window.hideLoadingToast();
                if (window.showToast) window.showToast('HTML 下载成功', 'success');
            } catch (err) {
                console.error('HTML Export Error:', err);
                if (isMobile && window.hideLoadingToast) window.hideLoadingToast();
            }
        }
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
        const urls = linkTags.map(link => link.getAttribute('href')).filter(url => url);
        
        // Add hardcoded files if not already in URL list (backward compatibility / fallback)
        for (const url of this.cssFiles) {
            if (!urls.includes(url)) urls.push(url);
        }

        // Fetch all CSS content
        for (const url of urls) {
            try {
                const response = await fetch(url);
                if (!response.ok) continue;
                const text = await response.text();
                styles += `<style>\n/* Source: ${url} */\n${text}\n</style>\n`;
            } catch (e) {
                console.error(`Failed to load CSS ${url}:`, e);
            }
        }

        // Add document <style> tags
        document.querySelectorAll('style').forEach(style => {
            styles += style.outerHTML;
        });

        // Add specific export styles to ensure layout is correct
        styles += `
        <style>
            html, body { 
                height: auto !important;
                overflow: auto !important;
                background: var(--bg-primary); 
                color: var(--text-primary);
                font-family: "HarmonyOS Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "WenQuanYi Zen Hei", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
                margin: 0;
                padding: 0;
                user-select: text !important;
                -webkit-user-select: text !important;
            }
            html {
                background: var(--bg-primary) !important;
            }
            body {
                padding: 40px;
                min-height: 100vh;
            }
            /* Proactively hide ALL UI in export */
            .drawer-panel, .drawer-backdrop, .loading-toast, .mobile-header, #title-bar, .sidebar-toggle-btn, .toolbar-btn, #exportBtn {
                display: none !important;
            }
            .image-modal, #customTooltip {
                display: none !important;
            }
            .container {
                display: block !important;
                height: auto !important;
                max-width: 900px;
                margin: 0 auto;
            }
            .right-panel {
                width: 100% !important;
                max-width: 100% !important;
                background: transparent !important;
                display: block !important;
                padding: 0 !important;
            }
            .result-content {
                padding: 0 !important;
                overflow: visible !important;
            }
            .result-item {
                display: block !important;
                opacity: 1 !important;
                transform: none !important;
                animation: none !important;
                box-shadow: none !important;
                border: none !important;
                background: transparent !important;
            }
            .custom-tooltip {
                position: absolute !important;
                z-index: 9999 !important;
            }
        </style>
        `;

        return styles;
    }

    buildHtml(content, styles) {
        const scriptContent = `
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
                <div class="tooltip-header">风险详情</div>
                <div class="tooltip-section">
                    <div class="tooltip-label">风险类型</div>
                    <div class="tooltip-tag">\${riskType}</div>
                </div>
                <div class="tooltip-section">
                    <div class="tooltip-label">检测原文</div>
                    <div class="tooltip-quote">"\${originalText}"</div>
                </div>
                <div class="tooltip-section">
                    <div class="tooltip-label">AI 分析理由</div>
                    <div class="tooltip-reason">\${description}</div>
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
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>检测报告</title>
    ${styles}
</head>
<body class="export-view">
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
