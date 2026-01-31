// Mobile Logic for AI Detective

// --- API Mock ---
window.api = {
    invoke: async (channel, ...args) => {
        const response = await fetch('/api/invoke', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channel, args })
        });
        const result = await response.json();
        // Standard API Logic
        if (result.error) throw new Error(result.error);
        if (result.success === false) throw new Error('Request failed');
        // Handle direct data return or nested data property depending on backend
        // Backend returns: { success: true, data: ... }
        return result.data; 
    }
};

// --- State ---
let uploadedImages = [];
let currentMode = 'input'; // input, result
let isInputFullscreen = false;
let allHistory = [];
let lastBackPress = 0;
let pendingConflict = null;

// --- Elements ---
const textInput = document.getElementById('textInput');
const detectBtn = document.getElementById('detectBtn');
const plusBtn = document.getElementById('plusBtn');
const fileInput = document.getElementById('fileInput');
const docInput = document.getElementById('docInput');
const previewImages = document.getElementById('previewImages');
const historyBtn = document.getElementById('historyBtn');
const exitEditBtn = document.getElementById('exitEditBtnInside');
const exitResultBtn = document.getElementById('exitResultBtn');
const headerTitle = document.getElementById('headerTitle');
const inputCard = document.getElementById('inputCard');
const extractedContentArea = document.getElementById('extractedContentArea');
const startBranding = document.getElementById('startBranding');

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    initInputLogic();
    initActionSheet();
    initHistory();
    loadHistory();
    initSSE(); // Ensure SSE is initialized for real-time status
    setupNavigation();

    // Add global click listener for tooltips
    document.addEventListener('click', (e) => {
        const tooltip = document.getElementById('customTooltip');
        // If tooltip is active and click is not on a highlight or inside the tooltip itself
        if (tooltip && tooltip.classList.contains('active')) {
            if (!e.target.closest('.fake-highlight') && !e.target.closest('.custom-tooltip')) {
                hideTooltip();
            }
        }
    });
});

function setupNavigation() {
    // Push initial state to enable back interception
    if (window.history.state?.page !== 'home') {
        window.history.pushState({ page: 'home' }, '');
    }

    window.addEventListener('popstate', (event) => {
        // If we are navigating away from home or state is null, we might be exiting
        // But we want to intercept as long as we have overlays
        
        const historyDrawer = document.getElementById('historyDrawer');
        const actionSheet = document.getElementById('actionSheet');
        const tooltip = document.getElementById('customTooltip');
        const conflictModal = document.getElementById('conflictModal');
        const confirmModal = document.getElementById('confirmModal');
        const imageModal = document.getElementById('imageModal');

        // Check priorities (Topmost UI first)
        if (imageModal && imageModal.style.display === 'flex') {
            imageModal.style.display = 'none';
            window.history.pushState({ page: 'home' }, '');
            return;
        }

        if (tooltip && tooltip.classList.contains('active')) {
            hideTooltip();
            window.history.pushState({ page: 'home' }, '');
            return;
        }

        if (confirmModal && confirmModal.style.display === 'flex') {
            closeConfirmModal();
            window.history.pushState({ page: 'home' }, '');
            return;
        }

        if (conflictModal && conflictModal.style.display === 'flex') {
            closeConflictModal();
            window.history.pushState({ page: 'home' }, '');
            return;
        }

        if (historyDrawer && historyDrawer.classList.contains('active')) {
            toggleHistory(false);
            window.history.pushState({ page: 'home' }, '');
            return;
        }

        if (actionSheet && actionSheet.classList.contains('active')) {
            closeActionSheet();
            window.history.pushState({ page: 'home' }, '');
            return;
        }

        if (currentMode === 'result') {
            showInputView();
            window.history.pushState({ page: 'home' }, '');
            return;
        }

        if (isInputFullscreen) {
            exitFullscreenInput();
            window.history.pushState({ page: 'home' }, '');
            return;
        }

        // Home page double back to exit
        const now = Date.now();
        if (now - lastBackPress < 2000) {
            // Close the app or go back to actual previous page
            window.history.back(); 
        } else {
            lastBackPress = now;
            showToast('再按一次返回键退出程序', 'info');
            window.history.pushState({ page: 'home' }, '');
        }
    });
}

function initSSE() {
    const eventSource = new EventSource('/api/events');
    eventSource.addEventListener('status-update', (event) => {
        try {
            const data = JSON.parse(event.data);
            updateStatusUI(data.status, data.data);
        } catch (e) {
            console.error('Error parsing status update', e);
        }
    });

    eventSource.onerror = (err) => {
        console.warn('SSE connection closed, reconnecting...', err);
    };
}

function updateStatusUI(status, data) {
    const summaryDescText = document.getElementById('summaryDescText');
    const loadingToast = document.getElementById('loadingToast');
    
    if (!summaryDescText) return;

    let message = '';
    switch(status) {
        case 'extracting':
            message = '正在提取内容...';
            break;
        case 'parsing':
            message = '正在解析文本...';
            break;
        case 'analyzing':
            message = 'AI 正在推理中...';
            break;
        default:
            message = '正在分析中...';
    }

    setToastText(message);
    
    if (summaryDescText && summaryDescText.textContent !== message) {
        summaryDescText.textContent = message;
    }
    
    // Show toast if we are in input mode (detection just started)
    if (currentMode === 'input' && loadingToast && !loadingToast.classList.contains('active')) {
        loadingToast.classList.add('active');
    }
}

// Global helper to update Toast with "Dynamic Island" transition
function setToastText(message) {
    const toastMessage = document.getElementById('toastMessage');
    const loadingToast = document.getElementById('loadingToast');
    if (!toastMessage || !loadingToast) return;
    if (toastMessage.textContent === message) return; // Ignore if identical

    // Apply fade transition for text
    toastMessage.style.opacity = '0';
    toastMessage.style.transform = 'translateY(5px)';
    
    setTimeout(() => {
        toastMessage.textContent = message;
        toastMessage.style.opacity = '1';
        toastMessage.style.transform = 'translateY(0)';
        
        // Dynamic Island Width Transition Trick
        // We set explicitly to permit CSS transition
        const contentWidth = document.querySelector('.toast-content').scrollWidth;
        loadingToast.style.width = (contentWidth + 60) + 'px'; 
    }, 150);
}

// --- View Logic ---
function enterFullscreenInput() {
    if (currentMode === 'result') return;
    
    isInputFullscreen = true;
    inputCard.classList.add('fullscreen');
    
    // Header changes
    historyBtn.style.display = 'none';
    const exitEditBtn = document.getElementById('exitEditBtnInside'); 
    
    if (exitEditBtn) exitEditBtn.style.display = 'flex';
    exitResultBtn.style.display = 'none';
    if (headerTitle) headerTitle.style.display = 'none';
    if (startBranding) startBranding.style.display = 'none';
    
    // Completely hide the mobile header to avoid grey bars
    const mobileHeader = document.querySelector('.mobile-header');
    if (mobileHeader) mobileHeader.style.display = 'none'; 
    
    // Capture and move bottom button
    const bottomArea = document.querySelector('.bottom-action-area');
    inputCard.appendChild(bottomArea);
    bottomArea.style.display = 'block';
    bottomArea.style.marginTop = 'auto';
}

function exitFullscreenInput() {
    isInputFullscreen = false;
    inputCard.classList.remove('fullscreen');
    
    // Header restore
    const exitEditBtn = document.getElementById('exitEditBtnInside');
    if (exitEditBtn) exitEditBtn.style.display = 'none';
    historyBtn.style.display = 'flex';
    if (startBranding) startBranding.style.display = 'block';
    
    const mobileHeader = document.querySelector('.mobile-header');
    if (mobileHeader) mobileHeader.style.display = 'flex';

    textInput.blur();
    
    // Move button back
    const bottomArea = document.querySelector('.bottom-action-area');
    document.getElementById('inputView').appendChild(bottomArea);
}

function showResultView() {
    currentMode = 'result';
    document.getElementById('inputView').classList.remove('active');
    document.getElementById('resultView').classList.add('active');
    
    // Header
    historyBtn.style.display = 'none';
    exitEditBtn.style.display = 'none';
    exitResultBtn.style.display = 'flex';
    if (headerTitle) headerTitle.style.display = 'block';
    if (startBranding) startBranding.style.display = 'none';
    
    if (isInputFullscreen) exitFullscreenInput();
}

function showInputView() {
    currentMode = 'input';
    document.getElementById('resultView').classList.remove('active');
    document.getElementById('inputView').classList.add('active');
    
    // Header restore
    exitResultBtn.style.display = 'none';
    exitEditBtn.style.display = 'none';
    historyBtn.style.display = 'flex';
    
    // Explicitly restore elements hidden by fullscreen mode if we were stuck
    if (startBranding) startBranding.style.display = 'block';
    if (headerTitle) headerTitle.style.display = 'none'; 
    const mobileHeader = document.querySelector('.mobile-header');
    if (mobileHeader) mobileHeader.style.display = 'flex';
    
    // Ensure we are not in fullscreen class (double check)
    inputCard.classList.remove('fullscreen');
     // Move button back if needed
    const bottomArea = document.querySelector('.bottom-action-area');
    if (bottomArea && bottomArea.parentNode === inputCard) {
        document.getElementById('inputView').appendChild(bottomArea);
    }
}

// Exit Buttons Logic
exitEditBtn.addEventListener('click', () => {
    exitFullscreenInput();
});

exitResultBtn.addEventListener('click', () => {
    showInputView();
});

// --- Confirmation Modal Logic ---
let confirmCallback = null;

function showConfirm(title, message, onConfirm) {
    const modal = document.getElementById('confirmModal');
    const titleEl = document.getElementById('confirmTitle');
    const msgEl = document.getElementById('confirmMessage');
    const execBtn = document.getElementById('confirmExecuteBtn');

    if (!modal || !titleEl || !msgEl || !execBtn) return;

    titleEl.textContent = title || '确认提示';
    msgEl.textContent = message || '';
    confirmCallback = onConfirm;

    execBtn.onclick = () => {
        if (confirmCallback) confirmCallback();
        closeConfirmModal();
    };

    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('active'), 10);
}

window.closeConfirmModal = function() {
    const modal = document.getElementById('confirmModal');
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => { modal.style.display = 'none'; }, 300);
    }
    confirmCallback = null;
}

// Clear Button Logic
const clearBtn = document.getElementById('clearBtn');
if (clearBtn) {
    clearBtn.addEventListener('click', () => {
        if (textInput.value.trim() || uploadedImages.length > 0 || currentExtractedData) {
            showConfirm('清空内容', '确定要清空当前所有内容吗？此操作不可恢复。', () => {
                executeClear();
            });
        } else {
            executeClear();
        }
    });
}

function executeClear() {
    // Clear logic
    textInput.value = '';
    const indicator = document.getElementById('wordCountIndicator');
    if (indicator) {
        indicator.textContent = '0/10000';
        indicator.style.color = 'var(--text-muted)';
    }
    currentExtractedData = null;
    uploadedImages = [];
    renderImages();
    renderExtractedUrlCard();
    updateButtonState();
    showToast('内容已清空', 'success');
}

// --- Input Logic ---
let extractionLock = false;
let currentExtractedData = null;

function initInputLogic() {
    textInput.addEventListener('focus', () => {
        if (!isInputFullscreen) {
            // Delay slightly to prevent breaking the initial focus/paste context on mobile
            // Some browsers break the context menu if the element moves during the Tap/Focus sequence
            setTimeout(() => {
                enterFullscreenInput();
            }, 100); // 增加到 100ms 提高稳定性
        }
    });

    textInput.addEventListener('input', async (e) => {
        handleInputChanges();
        
        // Auto-extract URL if detected
        const text = textInput.value;
        const trimmedText = text.trim();
        const urlMatch = trimmedText.match(/https?:\/\/[^\s]+/);
        if (urlMatch && !extractionLock && !currentExtractedData) {
            const url = urlMatch[0];
            await handleUrlExtraction(url);
        }
    });
    

    detectBtn.addEventListener('click', runDetection);
}

function handleInputChanges() {
    const text = textInput.value;
    
    // 10000 Character Limit
    if (text.length > 10000) {
        textInput.value = text.slice(0, 10000);
        showToast('正文内容最多支持10000字', 'warning');
    }
    
    // Update Word Count Indicator
    const indicator = document.getElementById('wordCountIndicator');
    if (indicator) {
        indicator.textContent = `${textInput.value.length}/10000`;
        indicator.style.color = textInput.value.length >= 10000 ? 'var(--danger-color)' : 'var(--text-muted)';
    }

    updateButtonState();
}

// Logic: Show domain and wait for "Start Detect"
async function handleUrlExtraction(url) {
    if (extractionLock) return;
    
    // Conflict Check: If images exist, show modal
    if (uploadedImages.length > 0) {
        pendingConflict = { type: 'link', data: url };
        showConflictModal();
        return;
    }

    try {
        const domain = (new URL(url)).hostname;
        currentExtractedData = {
            url: url,
            title: domain,
            excerpt: '',
            content: '',
            pendingExtraction: true 
        };
        
        // Removed: textInput.value = '' clearing logic to prevent "empty box" confusion on first paste

        renderExtractedUrlCard();
        updateButtonState();

    } catch(e) {
        console.warn('URL parsing failed', e);
    }
}

function getFaviconUrl(url) {
    try {
        const urlObj = new URL(url);
        return `https://ico.kucat.cn/get.php?url=${urlObj.hostname}&sz=32`;
    } catch (e) {
        return null;
    }
}

function renderExtractedUrlCard() {
    if (!currentExtractedData) {
        extractedContentArea.style.display = 'none';
        extractedContentArea.innerHTML = '';
        return;
    }

    extractedContentArea.style.display = 'block';
    
    if (currentExtractedData.type === 'doc') {
        const ext = currentExtractedData.format || 'DOC';
        extractedContentArea.innerHTML = `
            <div class="extracted-url-card" style="background: var(--bg-secondary); border: 1px solid var(--border-color); margin-bottom: 4px;">
                <div class="url-card-icon" style="background: var(--primary-light);">
                    <svg viewBox="0 0 24 24" width="24" height="24" fill="var(--primary-color)">
                        <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
                    </svg>
                </div>
                <div class="url-card-info">
                    <div class="url-card-title" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${currentExtractedData.title}</div>
                    <div class="url-card-tag" style="color: var(--primary-color);">已解析 ${ext} 格式文件</div>
                </div>
                <div class="url-card-remove" onclick="removeExtractedUrl()">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                </div>
            </div>
        `;
        return;
    }

    const isPending = currentExtractedData.pendingExtraction;
    const faviconUrl = getFaviconUrl(currentExtractedData.url);
    const iconContent = faviconUrl 
        ? `<img src="${faviconUrl}" style="width:20px; height:20px; object-fit:contain;" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
           <svg viewBox="0 0 24 24" width="24" height="24" fill="#4361ee" style="display:none;">
               <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/>
           </svg>`
        : `<svg viewBox="0 0 24 24" width="24" height="24" fill="#4361ee">
               <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/>
           </svg>`;
    
    extractedContentArea.innerHTML = `
        <div class="extracted-url-card ${isPending ? 'pending-style' : ''}">
            <div class="url-card-icon">
                ${iconContent}
            </div>
            <div class="url-card-info">
                <div class="url-card-title">${currentExtractedData.title || '检测网页'}</div>
                <div class="url-card-tag">${isPending ? '等待系统提取正文...' : '内容已就绪'}</div>
            </div>
            <div class="url-card-remove" onclick="removeExtractedUrl()">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </div>
        </div>
    `;
}

window.removeExtractedUrl = function() {
    if (currentExtractedData) {
        const typeName = currentExtractedData.type === 'doc' ? '解析文件' : '解析链接';
        showConfirm('移除内容', `确定要移除已加载的${typeName}吗？${currentExtractedData.type === 'doc' ? '移除后将同时清空输入框。' : ''}`, () => {
            executeRemoveExtractedUrl();
        });
    }
}

function executeRemoveExtractedUrl() {
    if (!currentExtractedData) return;

    if (currentExtractedData.url) {
        const urlMatch = currentExtractedData.url;
        // Also remove the URL from the text input if it exists there
        if (textInput.value.includes(urlMatch)) {
            textInput.value = textInput.value.replace(urlMatch, '').trim();
        }
    }
    
    // If it was a document, we clear the whole input because the input IS the document content
    if (currentExtractedData.type === 'doc') {
        textInput.value = '';
    }
    
    handleInputChanges(); // Trigger word count and button state update
    
    currentExtractedData = null;
    renderExtractedUrlCard();
    updateButtonState();
}

// Actually fetch content (called by runDetection)
async function performRealExtraction(progressCallback) {
    if (!currentExtractedData || !currentExtractedData.pendingExtraction) return true;
    
    const url = currentExtractedData.url;
    // We don't update toast here anymore, controlled by runDetection
    
    try {
        // Start extraction progress simulation if callback provided
        let extProgress = 0;
        const extInterval = setInterval(() => {
            if (extProgress < 40) {
                 extProgress += 1;
                 if (progressCallback) progressCallback(extProgress, '正在解析网页内容...');
            }
        }, 200);

        const result = await window.api.invoke('extract-content-sync', url);
        
        clearInterval(extInterval);

        if (window._abortController && window._abortController.signal.aborted) {
            throw new Error('Aborted');
        }

        if (result && (result.title || result.content)) {
            // Logic reused from Main.html: prioritize textContent for analysis
            currentExtractedData = {
                url: url,
                title: result.title || currentExtractedData.title,
                excerpt: result.excerpt || '',
                // Ensure we have clean text for AI
                content: result.textContent || result.content || '',
                // Keep raw HTML if needed for preview? Mobile usually prefers clean text.
                htmlContent: result.content || '',
                images: result.images || [] // Save images for AI and result view
            };
            currentExtractedData.pendingExtraction = false;
            
            renderExtractedUrlCard();
            updateButtonState(); // Re-check button state after extraction
            return true;
        }
    } catch(e) {
        if (e.message === 'Aborted') throw e;
        console.warn('Real extraction failed', e);
        showToast('提取失败，将仅对当前文本进行检测', 'error');
        currentExtractedData.pendingExtraction = false; 
    }
    return true;
}

window._abortController = null;
window.currentAnalysisStatus = 'initializing'; // Global state for SSE updates

async function runDetection() {
    if (detectBtn.classList.contains('is-stop')) {
        // Handle Cancel
        if (window._abortController) {
            window._abortController.abort();
        }
        return;
    }

    const text = textInput.value.trim();
    const images = uploadedImages.map(img => img.url);
    const url = currentExtractedData ? currentExtractedData.url : null;
    
    if (text.length === 0) {
        showToast('请输入文本', 'info');
        return;
    }
    
    // Init Loading State
    const originalText = '开始检测';
    detectBtn.classList.add('is-stop');
    detectBtn.innerHTML = '停止检测';
    window._abortController = new AbortController();
    window.currentAnalysisStatus = 'initializing';
    
    const loadingToast = document.getElementById('loadingToast');
    const toastMessage = document.getElementById('toastMessage');
    const progressBar = document.getElementById('progressBar');
    const progressContainer = document.getElementById('progressBarContainer');

    if (loadingToast) {
        loadingToast.classList.add('active');
        setToastText('正在初始化...');
    }
    if (progressContainer) progressContainer.style.display = 'block';
    
    // --- Progress Bar Logic (Ported from Main.html) ---
    let progress = 0;
    progressBar.style.width = '0%';
    let statusTimer = 0;
    let customText = ''; // To override default logic if extraction is happening

    const progressInterval = setInterval(() => {
        // If we are in "extraction mode" (progress < 40 and pendingExtraction was true), 
        // the performRealExtraction callback handles the *value* but we need to render it here?
        // Actually, let's let one main loop handle the bar to avoid conflicts.
        // But extraction is synchronous-ish (await). 
        // We will pause this main interval's logic if customized, or mix them.
        
        // Let's implement the Main.html "Analysis" curve logic here primarily.
        // If we are extracting, we might manually set progress.
        
        if (window.isExtracting) {
            // Handled by extraction callback mostly, but we can ensure it doesn't stall
            return; 
        }

        // Analysis Phase Logic
        statusTimer += 80;
        
        // Simulating status changes
        if (statusTimer > 3000 && window.currentAnalysisStatus === 'initializing') {
            window.currentAnalysisStatus = 'searching';
        }
        if (statusTimer > 8000 && window.currentAnalysisStatus === 'searching') {
            window.currentAnalysisStatus = 'deep-analysis';
        }

        let targetMax = 40; 
        if (window.currentAnalysisStatus === 'searching') targetMax = 70;
        else if (window.currentAnalysisStatus === 'deep-analysis') targetMax = 91;

            if (progress < targetMax) {
                // Speed Control
                let increment = (progress < 20) ? 0.6 : (progress < 40) ? 0.3 : (progress < 70) ? 0.2 : 0.1;
                progress += increment;
                if (progress > 91) progress = 91;

                progressBar.style.width = Math.min(progress, 90) + '%';
                
                // Text Updates
                let statusText = '正在分析中...';
                if (window.currentAnalysisStatus === 'searching' && progress >= 38) {
                    statusText = '正在联网搜索相关信息...';
                } else if (window.currentAnalysisStatus === 'deep-analysis' && (progress >= 68 || (progress >= 38 && statusTimer > 8000))) {
                    statusText = '正在进行深度分析...';
                } else if (progress < 30) {
                     statusText = '正在初始化分析...';
                }
                
                setToastText(statusText);
            }
        }, 150); // Increased interval slightly to reduce calculation overhead

    try {
        // 1. Check if we need to extract content FIRST
        if (currentExtractedData && currentExtractedData.pendingExtraction) {
             window.isExtracting = true;
             // Manually drive progress for extraction phase (0-40%)
             await performRealExtraction((val, msg) => {
                 progress = val;
                 progressBar.style.width = progress + '%';
                 setToastText(msg);
             });
             window.isExtracting = false;
             // Extraction done. We are at ~40%.
             // Reset status timer for analysis phase to start smoothly from here
             statusTimer = 3000; // Skip to searching phase logic roughly
             window.currentAnalysisStatus = 'searching';
        }

        if (window._abortController.signal.aborted) throw new Error('Aborted');

        // 2. Run Analysis
        const analysisText = (currentExtractedData && currentExtractedData.content) ? currentExtractedData.content : text;
        const analysisUrl = url;
        
        // Include extracted images if available
        let finalImages = [...images];
        if (currentExtractedData && currentExtractedData.images) {
             currentExtractedData.images.forEach(img => {
                 const url = typeof img === 'string' ? img : img.url;
                 if (url && !finalImages.includes(url)) finalImages.push(url);
             });
        }

        const data = await window.api.invoke('analyze-content', { 
            text: analysisText, 
            imageUrls: finalImages,
            url: analysisUrl
        });

        if (window._abortController.signal.aborted) throw new Error('Aborted');
        
        // Finish Progress
        clearInterval(progressInterval);
        progressBar.style.width = '100%';
        setToastText('分析完成');

        // Save to history
        const historyItem = {
             id: Date.now().toString(),
             timestamp: new Date().toISOString(),
             content: analysisText || (url ? currentExtractedData.title : (images.length > 0 ? '[图片分析]' : '未知内容')),
             images: finalImages,
             result: data,
             url: url,
             // Fix for Main.html compatibility: provide the original input (URL or Text) 
             // so Main restores the link/input instead of the full extracted text.
             originalInput: url || text 
        };
        await window.api.invoke('save-history', historyItem);
        loadHistory();
        
        // Pass original HTML if available for nice rendering
        const displayContent = (currentExtractedData && currentExtractedData.htmlContent) ? currentExtractedData.htmlContent : ((currentExtractedData && currentExtractedData.content) ? currentExtractedData.content : text);
        
        showResult(data, displayContent, finalImages, url);
        showResultView();
        
    } catch (e) {
        clearInterval(progressInterval);
        if (e.message === 'Aborted') {
            showToast('提取已取消', 'info');
        } else {
            console.error(e);
            alert('检测失败: ' + e.message);
        }
    } finally {
        // Cleanup
        clearInterval(progressInterval);
        window.isExtracting = false;
        detectBtn.classList.remove('is-stop'); // BUG FIX: Ensure is-stop is removed
        detectBtn.disabled = false;
        detectBtn.textContent = originalText;
        if (loadingToast) loadingToast.classList.remove('active');
        if (progressContainer) {
            setTimeout(() => {
                progressContainer.style.display = 'none';
                progressBar.style.width = '0%';
            }, 300);
        }
        updateButtonState();
        window._abortController = null;
    }
}

function updateButtonState() {
    // If running (is-stop), button is always enabled (to allow stop)
    if (detectBtn.classList.contains('is-stop')) {
        detectBtn.disabled = false;
    } else {
        // We keep it enabled to show hints if clicked while empty
        detectBtn.disabled = false;
    }
}

function showToast(message, type = 'info') {
    // Remove any existing non-loading toasts to prevent overlapping
    const existing = document.querySelectorAll('.custom-toast:not(.is-loading)');
    existing.forEach(t => t.remove());

    const toast = document.createElement('div');
    toast.className = 'custom-toast';
    toast.textContent = message;
    toast.style.position = 'fixed';
    toast.style.bottom = '120px'; /* Raised slightly to avoid conflict with buttons */
    toast.style.left = '50%';
    toast.style.transform = 'translateX(-50%)';
    toast.style.background = 'rgba(0,0,0,0.85)';
    toast.style.color = '#fff';
    toast.style.padding = '10px 20px';
    toast.style.borderRadius = '24px';
    toast.style.zIndex = '10000';
    toast.style.fontSize = '14px';
    toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
    toast.style.whiteSpace = 'nowrap';
    toast.style.pointerEvents = 'none';
    
    document.body.appendChild(toast);
    
    // Simple fade in/out
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    requestAnimationFrame(() => toast.style.opacity = '1');

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}



// --- Image Upload ---
function initActionSheet() {
    plusBtn.addEventListener('click', () => {
        // Restore Default Upload Menu
        const content = document.getElementById('actionSheetContent');
        content.innerHTML = `
             <div style="padding:20px; text-align:center; border-bottom:1px solid var(--bg-tertiary); font-size:16px;" onclick="triggerImageUpload()">添加图片</div>
             <div style="padding:20px; text-align:center; border-bottom:1px solid var(--bg-tertiary); font-size:16px;" onclick="triggerFileUpload()">打开文件</div> 
        `;
        
        document.getElementById('actionSheetBackdrop').classList.add('active');
        document.getElementById('actionSheet').classList.add('active'); // CSS translate
        document.getElementById('actionSheet').style.transform = 'translateY(0)';
    });
}

window.closeActionSheet = function() {
    document.getElementById('actionSheetBackdrop').classList.remove('active');
    document.getElementById('actionSheet').style.transform = 'translateY(100%)';
}

window.triggerImageUpload = function() {
    fileInput.click();
    closeActionSheet();
}

window.triggerFileUpload = function() {
    // Overwrite Check: If there's content, ask the user first
    const hasText = textInput.value.trim().length > 0;
    const hasImages = uploadedImages.length > 0;
    const hasUrl = !!currentExtractedData;

    if (hasText || hasImages || hasUrl) {
        showConfirm('上传确认', '上传文件可能会合并或覆盖当前内容，是否继续？', () => {
            docInput.click();
            closeActionSheet();
        });
    } else {
        docInput.click();
        closeActionSheet();
    }
}

docInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Type validation
    const docExtensions = ['.doc', '.docx', '.pdf', '.txt', '.md'];
    const imgExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'];
    const fileName = file.name.toLowerCase();
    
    const isDoc = docExtensions.some(ext => fileName.endsWith(ext));
    const isImg = imgExtensions.some(ext => fileName.endsWith(ext));
    
    if (!isDoc && !isImg) {
        showToast('暂不支持此文件', 'error');
        docInput.value = '';
        return;
    }

    // Size limit: 15MB
    const maxSize = 15 * 1024 * 1024;
    if (file.size > maxSize) {
        showToast('超过文件大小限制 (最大 15MB)', 'warning');
        docInput.value = '';
        return;
    }

    // If it's an image, redirect to image logic
    if (isImg) {
        // Image logic already handles its own conflicts internally when adding
        if (!!currentExtractedData) {
            pendingConflict = { type: 'images', data: [file] };
            showConflictModal();
        } else {
            await processAndAddImages([file]);
        }
        docInput.value = '';
        return;
    }

    // Conflict Check for Documents: Files count as "extraction content", similar to links
    if (uploadedImages.length > 0 && !currentExtractedData) {
        pendingConflict = { type: 'doc', data: file };
        showConflictModal();
        docInput.value = '';
        return;
    }

    await handleDocParsing(file);
    docInput.value = '';
});

async function handleDocParsing(file) {
    const reader = new FileReader();
    
    // Show loading UI
    const loadingToast = document.getElementById('loadingToast');
    if (loadingToast) {
        loadingToast.classList.add('active');
        setToastText('正在解析文件...');
    }

    try {
        const base64Data = await new Promise((resolve, reject) => {
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });

        const result = await window.api.invoke('process-file-upload', {
            name: file.name,
            data: base64Data
        });

        // Backend returns result.data.text usually
        const parsedContent = result.data?.text || result.content || '';
        const parsedImages = result.data?.images || result.images || [];

        if (parsedContent || parsedImages.length > 0) {
            const ext = file.name.split('.').pop().toUpperCase();
            currentExtractedData = {
                type: 'doc', 
                title: file.name,
                format: ext,
                content: parsedContent,
                images: parsedImages,
                pendingExtraction: false
            };

            // If images were extracted from the doc, add them to uploadedImages
            if (parsedImages.length > 0) {
                parsedImages.forEach(img => {
                    const url = typeof img === 'string' ? img : img.url;
                    if (url && uploadedImages.length < 4) {
                        uploadedImages.push({ url: url, isExtracted: true });
                    }
                });
                renderImages();
            }

            // Sync text to editor
            if (parsedContent) {
                textInput.value = parsedContent.trim(); // Overwrite instead of append to avoid mess
                handleInputChanges();
            }

            renderExtractedUrlCard();
            updateButtonState();
            showToast('文件解析成功', 'success');
        } else {
            showToast('文件内容为空或解析失败', 'warning');
        }
    } catch (err) {
        console.error('Doc parse error:', err);
        showToast('解析失败: ' + err.message, 'error');
    } finally {
        if (loadingToast) loadingToast.classList.remove('active');
    }
}

fileInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    
    // Conflict Check: If URL already extracted, show modal
    if (currentExtractedData) {
        pendingConflict = { type: 'images', data: files };
        showConflictModal();
        fileInput.value = '';
        return;
    }

    // Check total images limit (max 4)
    if (uploadedImages.length + files.length > 4) {
        showToast('最多仅支持上传4张图片', 'warning');
        fileInput.value = '';
        return;
    }
    
    await processAndAddImages(files);
    fileInput.value = '';
});

function renderImages() {
    previewImages.innerHTML = '';
    uploadedImages.forEach((img, index) => {
        const div = document.createElement('div');
        div.className = 'preview-img-wrapper';
        div.innerHTML = `
            <img src="${img.url}">
            <div class="remove-img-btn" onclick="removeImage(${index})">×</div>
        `;
        previewImages.appendChild(div);
    });
}

window.removeImage = function(index) {
    uploadedImages.splice(index, 1);
    renderImages();
    updateButtonState();
}

// --- History Logic --- 
function initHistory() {
    historyBtn.addEventListener('click', () => {
        toggleHistory(true);
    });
}

function toggleHistory(show) {
    const backdrop = document.getElementById('historyDrawerBackdrop');
    const drawer = document.getElementById('historyDrawer');
    if (show) {
        backdrop.classList.add('active');
        drawer.classList.add('active');
    } else {
        backdrop.classList.remove('active');
        drawer.classList.remove('active');
    }
}

async function loadHistory() {
    try {
        const history = await window.api.invoke('get-history');
        if (Array.isArray(history)) {
            allHistory = history;
            renderHistoryList();
        }
    } catch(e) {
        console.warn('Failed to load history', e);
    }
}

function renderHistoryList() {
    const list = document.getElementById('historyList');
    list.innerHTML = '';
    
    if (allHistory.length === 0) {
        list.innerHTML = '<div style="text-align:center; color:var(--text-secondary); padding:20px;">暂无历史记录</div>';
        return;
    }
    
    let pressTimer;

    allHistory.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'history-item';
        
        // Touch events for long press
        div.addEventListener('touchstart', (e) => {
            pressTimer = setTimeout(() => {
                showHistoryContext(item, index, e);
            }, 600);
        });

        div.addEventListener('touchend', () => {
            clearTimeout(pressTimer);
        });

        div.addEventListener('touchmove', () => {
            clearTimeout(pressTimer);
        });

        div.onclick = () => {
             showResult(item.result, item.content, item.images || [], item.url); 
             showResultView();
             toggleHistory(false);
        };

        const dateStr = new Date(item.timestamp).toLocaleString();
        
        // Use result title, scraper title, or fallback to content preview
        let displayTitle = '';
        if (item.result && item.result.title) {
            displayTitle = item.result.title;
        } else if (item.title) {
            displayTitle = item.title;
        } else {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = item.content || '';
            displayTitle = tempDiv.textContent || tempDiv.innerText || '[无标题内容]';
        }
        
        // Show URL if available
        let urlDisplay = '';
        if (item.url) {
            let hostname = item.url;
            try { hostname = new URL(item.url).hostname; } catch(e) {}
            urlDisplay = `<div style="color:#4361ee; font-size:12px; margin-bottom:4px; display:flex; align-items:center; gap:4px;">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>
                <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${hostname}</span>
            </div>`;
        }

        div.innerHTML = `
            <div class="history-date">${dateStr}</div>
            ${urlDisplay}
            <div class="history-preview">${displayTitle}</div>
        `;
        list.appendChild(div);
    });
}

function showHistoryContext(item, index, e) {
    const backdrop = document.getElementById('actionSheetBackdrop');
    const sheet = document.getElementById('actionSheet');
    const content = document.getElementById('actionSheetContent');

    content.innerHTML = `
        <div style="padding:15px; font-weight:bold; border-bottom:1px solid var(--bg-tertiary); color:var(--text-secondary); font-size:14px;">操作记录</div>
        <div style="padding:20px; text-align:center; border-bottom:1px solid var(--bg-tertiary); color:#ff4d4f; font-size:16px;" onclick="deleteHistoryItem(${index})">删除此条记录</div>
        <div style="padding:20px; text-align:center; border-bottom:1px solid var(--bg-tertiary); font-size:16px;" onclick="showResultFromHistory(${index})">查看详情</div>
    `;

    backdrop.classList.add('active');
    sheet.classList.add('active');
    sheet.style.transform = 'translateY(0)';
}

window.showResultFromHistory = function(index) {
    const item = allHistory[index];
    showResult(item.result, item.content, item.images || [], item.url);
    showResultView();
    closeActionSheet();
    toggleHistory(false);
}

window.deleteHistoryItem = async function(index) {
    showConfirm('删除记录', '确定要删除这条历史记录吗？', async () => {
        const item = allHistory[index];
        try {
            await window.api.invoke('delete-history', item.timestamp);
            allHistory.splice(index, 1);
            renderHistoryList();
            closeActionSheet();
            showToast('记录已删除', 'success');
        } catch (err) {
            console.error('Delete failed', err);
            showToast('删除失败', 'error');
        }
    });
}

// --- Result Rendering ---
function showResult(result, originalText, originalImages, sourceUrl) {
   // Hide tooltip on result change
   hideTooltip();

   const resultItem = document.getElementById('resultItem');
   resultItem.style.display = 'block';

   // Score Card Update - New Layout
   const percentage = Math.round(result.probability * 100);
   
   // Circle Update
   const scoreProgress = document.getElementById('scoreProgress');
   const circumference = 2 * Math.PI * 45;
   const offset = circumference - (percentage / 100) * circumference;
   scoreProgress.style.strokeDashoffset = offset;
   document.getElementById('scoreValue').textContent = percentage + '%';
   
   // Summary Text Update
   const summaryValText = document.getElementById('summaryValText');
   const summaryTitleText = document.getElementById('summaryTitleText');
   const summaryDescText = document.getElementById('summaryDescText');
   
   summaryValText.textContent = percentage + '%';
   
   const scoreContainer = document.getElementById('scoreCircleContainer');
   scoreContainer.classList.remove('real', 'uncertain', 'fake');
   
   let colorVar = '';
   
   if (result.type === 1) { // True
       scoreContainer.classList.add('real');
       colorVar = 'var(--success-color)'; 
       summaryTitleText.textContent = '可信度高';
       summaryValText.style.color = colorVar;
       summaryDescText.innerHTML = result.explanation;
   } else if (result.type === 2) { // Uncertain
       scoreContainer.classList.add('uncertain');
       colorVar = 'var(--warning-color)'; 
       summaryTitleText.textContent = '真假参半';
       summaryValText.style.color = colorVar;
       summaryDescText.innerHTML = result.explanation;
   } else { // Fake
       scoreContainer.classList.add('fake');
       colorVar = 'var(--danger-color)'; 
       summaryTitleText.textContent = '虚假消息';
       summaryValText.style.color = colorVar;
       summaryDescText.innerHTML = result.explanation;
   }
   
   scoreProgress.style.stroke = colorVar;

   // Analysis Points
   const analysisContainer = document.getElementById('analysisContainer');
   // Keep title
   const title = analysisContainer.querySelector('.analysis-title');
   analysisContainer.innerHTML = '';
   analysisContainer.appendChild(title);
   
   // Add Analysis Items logic from Main.html (Simplified)
   if (result.analysis_points) {
       result.analysis_points.forEach(point => {
            const div = document.createElement('div');
            div.className = 'analysis-item';
            let iconClass = point.status === 'negative' ? 'negative' : (point.status === 'warning' ? 'warning' : 'positive');
            let icon = point.status === 'negative' ? '✕' : (point.status === 'warning' ? '!' : '✓');
            div.innerHTML = `
                <div class="analysis-icon ${iconClass}">${icon}</div>
                <div class="analysis-text">${point.description}</div>
            `;
            analysisContainer.appendChild(div);
       });
   }
   
   // Content Highlighting
   const parsedContent = document.getElementById('parsedContent');
   const parsedText = document.getElementById('parsedText');
   const parsedTitle = document.getElementById('parsedTitle');
   const parsedImages = document.getElementById('parsedImages');
   
   parsedContent.style.display = 'block';
   parsedTitle.textContent = result.title || '检测内容';

   // Inject Source URL if available
   const existingUrlDisplay = parsedContent.querySelector('.source-url-display');
   if (existingUrlDisplay) existingUrlDisplay.remove();

   if (sourceUrl) {
       const urlDiv = document.createElement('div');
       urlDiv.className = 'source-url-display';
       urlDiv.style.marginBottom = '12px';
       urlDiv.style.padding = '8px 12px';
       urlDiv.style.background = 'var(--bg-tertiary)';
       urlDiv.style.borderRadius = '8px';
       urlDiv.style.fontSize = '12px';
       urlDiv.style.color = 'var(--text-secondary)';
       urlDiv.style.display = 'flex';
       urlDiv.style.alignItems = 'center';
       urlDiv.style.gap = '8px';
       
       let displayUrl = sourceUrl;
       try { displayUrl = new URL(sourceUrl).hostname; } catch(e){}

       const faviconUrl = getFaviconUrl(sourceUrl);
       const iconHtml = faviconUrl 
           ? `<img src="${faviconUrl}" style="width:14px; height:14px; object-fit:contain;" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline-block';">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style="display:none;"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>`
           : `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>`;

       urlDiv.innerHTML = `
            ${iconHtml}
            <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">来源: ${displayUrl}</span>
            <a href="${sourceUrl}" target="_blank" style="color:var(--primary-color); text-decoration:none; margin-left:auto;">访问</a>
       `;
       // Insert after title
       parsedTitle.insertAdjacentElement('afterend', urlDiv);
   }
   
   // NEW: Strip images from the content text to avoid double/large display in text area
   let safeText = (originalText || '').replace(/<img[^>]*>/gi, '');
   
   // Check if content looks like HTML
   const isHtml = /<[a-z][\s\S]*>/i.test(safeText);
   
   if (!isHtml) {
       safeText = safeText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
   }
   
   if ((result.type === 2 || result.type === 3) && result.fake_parts) {
       const parts = [...result.fake_parts].sort((a,b) => (b.text||'').length - (a.text||'').length);
       parts.forEach(part => {
           if (part.text && safeText.includes(part.text)) {
                let safePart = part.text;
                if (!isHtml) {
                    safePart = part.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
                }
                const reasonObj = {
                    r: part.risk_type || '内容存疑',
                    d: part.reason || ''
                };
                const reasonStr = JSON.stringify(reasonObj).replace(/"/g, '&quot;');
                const span = `<span class="fake-highlight" data-reason="${reasonStr}" onclick="showReasonTooltip(this)">${safePart}</span>`; // Added onclick for mobile
                
                safeText = safeText.replace(safePart, span);
           }
       });
   }
   
   parsedText.innerHTML = safeText;

    // --- Render Images Logic ---
    if (parsedImages) {
        parsedImages.innerHTML = '';
        let imagesToRender = [];
        // Combine manually uploaded images and extracted result images
        if (originalImages && originalImages.length > 0) {
            originalImages.forEach(img => {
                imagesToRender.push({ url: (typeof img === 'string' ? img : img.url), name: '上传图片' });
            });
        }
        if (result.images && result.images.length > 0) {
             result.images.forEach(img => {
                 const url = (typeof img === 'string' ? img : img.url);
                 if (!imagesToRender.some(existing => existing.url === url)) {
                     imagesToRender.push({ url: url, name: '网页图片' });
                 }
             });
        }

        if (imagesToRender.length > 0) {
            const container = document.createElement('div');
            container.className = 'parsed-images-grid';
            container.style.display = 'grid';
            container.style.gridTemplateColumns = 'repeat(auto-fill, minmax(80px, 1fr))';
            container.style.gap = '8px';
            container.style.marginBottom = '12px';

            imagesToRender.forEach(img => {
                const item = document.createElement('div');
                item.className = 'parsed-image-item';
                item.style.position = 'relative';
                item.style.width = '100%';
                item.style.aspectRatio = '1 / 1';
                item.style.overflow = 'hidden';
                item.style.borderRadius = '8px';
                item.style.background = '#f0f0f0';
                
                let displaySrc = img.url;
                if (displaySrc && !displaySrc.startsWith('data:') && !displaySrc.startsWith('blob:') && displaySrc.startsWith('http')) {
                     displaySrc = `/api/proxy-image?url=${encodeURIComponent(displaySrc)}`;
                }

                item.innerHTML = `<img src="${displaySrc}" style="width:100%; height:100%; object-fit:cover;" onerror="this.style.opacity='0.2'">`;
                item.onclick = () => openImageModal(displaySrc);
                container.appendChild(item);
            });
            parsedImages.appendChild(container);
        }
    }
}

window.openImageModal = function(src) {
    const modal = document.getElementById('imageModal');
    const modalImg = document.getElementById('modalImage');
    modalImg.src = src;
    modal.style.display = 'flex';
}

// --- Tooltip ---
window.showReasonTooltip = function(element) {
    const tooltip = document.getElementById('customTooltip');
    const reasonAttr = element.getAttribute('data-reason');
    if (!reasonAttr) return;
    
    let riskType = '内容存疑';
    let description = reasonAttr;
    let originalText = element.textContent;

    try {
        if (reasonAttr.startsWith('{')) {
            const data = JSON.parse(reasonAttr);
            riskType = data.r || riskType;
            description = data.d || '';
        }
    } catch(e) {}

    tooltip.innerHTML = `
        <div class="tooltip-header" style="font-weight:600; margin-bottom:10px; padding:18px 20px 14px; border-bottom:1px solid var(--border-color); font-size:18px;">风险详情 <span style="float:right; cursor:pointer; color:var(--text-muted);" onclick="hideTooltip()">×</span></div>
        <div style="padding: 20px 24px 40px;">
            <div class="tooltip-section">
                <div class="tooltip-label" style="font-size:13px; color:var(--text-muted); font-weight:500;">风险类型</div>
                <div class="tooltip-tag">${riskType}</div>
            </div>
            <div class="tooltip-section" style="margin-top:18px;">
                <div class="tooltip-label" style="font-size:13px; color:var(--text-muted); font-weight:500;">检测原文</div>
                <div class="tooltip-quote">"${originalText}"</div>
            </div>
            <div class="tooltip-section" style="margin-top:18px;">
                <div class="tooltip-label" style="font-size:13px; color:var(--text-muted); font-weight:500;">AI 分析理由</div>
                <div class="tooltip-reason" style="font-size:17px; margin-top:6px; line-height:1.6; color:var(--text-main);">${description}</div>
            </div>
        </div>
    `;
    tooltip.classList.add('active');
}

window.hideTooltip = function() {
    document.getElementById('customTooltip').classList.remove('active');
}

// --- Conflict Modal Logic ---
function showConflictModal() {
    const modal = document.getElementById('conflictModal');
    if (modal) {
        // Adjust text if it's a link conflict vs image conflict
        const desc = modal.querySelector('div[style*="font-size: 14px"]');
        const keepLinkBtn = modal.querySelector('button[onclick*="link"]');
        
        if (pendingConflict.type === 'link') {
            desc.textContent = '检测网页链接时，无法同时分析已上传的本地图片。是否清空图片并继续提取链接？';
            keepLinkBtn.textContent = '保留网页链接';
        } else if (pendingConflict.type === 'doc') {
            desc.textContent = '解析文档文件时，无法同时分析已上传的本地图片。是否清空图片并继续解析？';
            keepLinkBtn.textContent = '保留文档文件';
        } else {
            desc.textContent = '检测图片内容时，无法同时分析检测到的网页或文件。是否移除它们并继续上传图片？';
            keepLinkBtn.textContent = '保留网页/文件';
        }
        modal.style.display = 'flex';
    }
}

window.closeConflictModal = function() {
    const modal = document.getElementById('conflictModal');
    if (modal) modal.style.display = 'none';
    pendingConflict = null;
}

// Helper to handle image processing including HEIC conversion
async function processAndAddImages(files) {
    for (const file of files) {
        if (uploadedImages.length >= 4) break;
        
        // Basic type validation for images
        const isHEIC = file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif');
        if (!file.type.startsWith('image/') && !isHEIC) {
            showToast('暂不支持此文件', 'error');
            continue;
        }

        let processFile = file;
        
        // HEIC/HEIF conversion logic
        if (isHEIC) {
            try {
                // Show Dynamic Island Toast for conversion
                const loadingToast = document.getElementById('loadingToast');
                if (loadingToast) {
                    setToastText('正在转换 HEIC 图片...');
                    loadingToast.classList.add('active');
                }

                const blob = await heic2any({
                    blob: file,
                    toType: 'image/jpeg',
                    quality: 0.7
                });
                
                if (loadingToast) loadingToast.classList.remove('active');
                
                const finalBlob = Array.isArray(blob) ? blob[0] : blob;
                processFile = new File([finalBlob], file.name.replace(/\.(heic|heif)$/i, '.jpg'), { type: 'image/jpeg' });
            } catch (err) {
                console.error('HEIC conversion failed', err);
                showToast('HEIC 转换失败', 'error');
                continue;
            }
        }

        const reader = new FileReader();
        await new Promise((resolve) => {
            reader.onload = (ev) => {
                uploadedImages.push({
                    url: ev.target.result,
                    file: processFile
                });
                resolve();
            };
            reader.readAsDataURL(processFile);
        });
    }
    renderImages();
    updateButtonState();
}

window.resolveConflict = async function(choice) {
    if (!pendingConflict) return;

    const modal = document.getElementById('conflictModal');
    const keepLinkBtn = modal.querySelector('button[onclick*="link"]');

    if (choice === 'link') {
        // Keep Link/Doc: Remove existing images and proceed
        uploadedImages = [];
        renderImages();
        
        if (pendingConflict.type === 'link') {
            handleUrlExtraction(pendingConflict.data); 
        } else if (pendingConflict.type === 'doc') {
            handleDocParsing(pendingConflict.data);
        }
    } else if (choice === 'images') {
        // Keep Images: Remove existing link/doc and proceed
        currentExtractedData = null;
        renderExtractedUrlCard();

        if (pendingConflict.type === 'images') {
            await processAndAddImages(pendingConflict.data);
        }
    }
    
    closeConflictModal();
}
