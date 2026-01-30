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

// --- Elements ---
const textInput = document.getElementById('textInput');
const detectBtn = document.getElementById('detectBtn');
const plusBtn = document.getElementById('plusBtn');
const fileInput = document.getElementById('fileInput');
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

// Clear Button Logic
const clearBtn = document.getElementById('clearBtn');
if (clearBtn) {
    clearBtn.addEventListener('click', () => {
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
    });
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

function renderExtractedUrlCard() {
    if (!currentExtractedData) {
        extractedContentArea.style.display = 'none';
        extractedContentArea.innerHTML = '';
        return;
    }

    extractedContentArea.style.display = 'block';
    const isPending = currentExtractedData.pendingExtraction;
    
    extractedContentArea.innerHTML = `
        <div class="extracted-url-card ${isPending ? 'pending-style' : ''}">
            <div class="url-card-icon">
                <svg viewBox="0 0 24 24" width="24" height="24" fill="#4361ee">
                    <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/>
                </svg>
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
    if (currentExtractedData && currentExtractedData.url) {
        const urlMatch = currentExtractedData.url;
        // Also remove the URL from the text input if it exists there
        if (textInput.value.includes(urlMatch)) {
            textInput.value = textInput.value.replace(urlMatch, '').trim();
            handleInputChanges(); // Trigger word count and button state update
        }
    }
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

    const text = textInput.value;
    const images = uploadedImages.map(img => img.url);
    const url = currentExtractedData ? currentExtractedData.url : null;
    
    if (!text && images.length === 0 && !url) return;
    
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
    const hasText = textInput.value.trim().length > 0;
    const hasImages = uploadedImages.length > 0;
    const hasUrl = !!currentExtractedData;
    // If running (is-stop), button is always enabled (to allow stop)
    if (detectBtn.classList.contains('is-stop')) {
        detectBtn.disabled = false;
    } else {
        detectBtn.disabled = !(hasText || hasImages || hasUrl);
    }
}

function showToast(message, type = 'info') {
    // Reuse existing toast logic or create new
    const toast = document.createElement('div');
    toast.className = 'custom-toast';
    toast.textContent = message;
    toast.style.position = 'fixed';
    toast.style.bottom = '100px';
    toast.style.left = '50%';
    toast.style.transform = 'translateX(-50%)';
    toast.style.background = 'rgba(0,0,0,0.7)';
    toast.style.color = '#fff';
    toast.style.padding = '8px 16px';
    toast.style.borderRadius = '20px';
    toast.style.zIndex = '9999';
    toast.style.fontSize = '14px';
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.remove();
    }, 2000);
}



// --- Image Upload ---
function initActionSheet() {
    plusBtn.addEventListener('click', () => {
        // Restore Default Upload Menu
        const content = document.getElementById('actionSheetContent');
        content.innerHTML = `
             <div style="padding:20px; text-align:center; border-bottom:1px solid var(--bg-tertiary); font-size:16px;" onclick="triggerImageUpload()">添加图片</div>
             <div style="padding:20px; text-align:center; border-bottom:1px solid var(--bg-tertiary); font-size:16px;" onclick="triggerImageUpload()">打开文件</div> 
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
    // Same as image for now
    fileInput.click();
    closeActionSheet();
}

fileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    
    // Check total images limit (max 4)
    if (uploadedImages.length + files.length > 4) {
        showToast('最多仅支持上传4张图片', 'warning');
        fileInput.value = '';
        return;
    }
    
    files.forEach(file => {
        const reader = new FileReader();
        reader.onload = (ev) => {
            uploadedImages.push({
                url: ev.target.result,
                file: file
            });
            renderImages();
            updateButtonState();
        };
        reader.readAsDataURL(file);
    });
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
        
        // Strip HTML tags for preview
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = item.content || '';
        const plainText = tempDiv.textContent || tempDiv.innerText || '';
        
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
            <div class="history-preview">${plainText || '[无文本内容]'}</div>
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
    if (!confirm('确定要删除这条记录吗？')) return;
    
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

       urlDiv.innerHTML = `
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>
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
