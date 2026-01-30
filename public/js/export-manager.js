
class ExportManager {
    constructor() {
        this.cssFiles = [
            '/css/variables.css',
            '/css/common.css',
            '/css/main.css'
        ];
    }

    async exportResult() {
        const resultItem = document.getElementById('resultItem');
        if (!resultItem || !resultItem.classList.contains('active')) {
            if (window.showToast) {
                window.showToast('暂无检测结果可导出', 'warning');
            }
            return;
        }
        
        if (window.showToast) {
            window.showToast('正在准备导出...', 'info');
        }

        // Clone the result item to modify it for export
        const clone = resultItem.cloneNode(true);
        
        // Remove export button if exists in clone
        const exportBtnInClone = clone.querySelector('#exportBtn');
        if (exportBtnInClone) {
            exportBtnInClone.remove();
        }

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

        // Trigger download
        this.downloadFile(html);
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
        
        // Fetch external CSS files
        for (const url of this.cssFiles) {
            try {
                const response = await fetch(url);
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
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
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
            <div class="result-header" style="justify-content: center; margin-bottom: 20px;">
                <h2 class="result-title">检测结果报告</h2>
            </div>
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
}

// Attach to window
window.exportManager = new ExportManager();
