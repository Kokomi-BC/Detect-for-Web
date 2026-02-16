// Mobile Logic for AI Detective

// --- API Mock ---
window.api = {
    invoke: async (channel, ...args) => {
        try {
            const response = await fetch('/api/invoke', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ channel: channel, args })
            });
            
            if (response.status === 401) {
                window.location.href = '/Login';
                return;
            }

            // Handle binary responses (e.g., PDF)
            const contentType = response.headers.get('Content-Type');
            if (contentType && contentType.includes('application/pdf')) {
                return await response.arrayBuffer();
            }

            const result = await response.json();
            // Standard API Logic
            if (result.status === 'fail') {
                throw new Error(result.message || result.error || 'Request failed');
            }
            // Handle direct data return or nested data property depending on backend
            // Backend returns: { success: true, data: ... }
            return result.data;
        } catch (err) {
            console.error(`API Invoke Error (${channel}):`, err);
            throw err;
        }
    }
};

// --- Constants ---
const UI_CLOSE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display: block;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

// --- State ---
let uploadedImages = [];
let currentMode = 'input'; // input, result
let isInputFullscreen = false;
let allHistory = [];
let lastBackPress = 0;
let pendingConflict = null;

let mobileStatusTimeout = null;
let searchStartTime = 0;
let _abortController = null;
let currentAnalysisStatus = 'initializing';
let isExtracting = false;
let currentUser = null;
let _exportManagerPromise = null;
let _userEditorPromise = null;

let historyPage = 1;
let historyLoading = false;
let hasMoreHistory = true;
let historySearchQuery = '';
let isResultHeaderAtTop = false;

async function getExportManager() {
    if (window.exportManager) return window.exportManager;
    if (!_exportManagerPromise) {
        _exportManagerPromise = new Promise((resolve, reject) => {
            const existing = document.querySelector('script[data-module="export-manager"]');
            if (existing) {
                existing.addEventListener('load', () => resolve(window.exportManager), { once: true });
                existing.addEventListener('error', () => reject(new Error('导出模块加载失败')), { once: true });
                return;
            }

            const script = document.createElement('script');
            script.type = 'module';
            script.src = '/js/export-manager.js';
            script.setAttribute('data-module', 'export-manager');
            script.onload = () => resolve(window.exportManager);
            script.onerror = () => reject(new Error('导出模块加载失败'));
            document.head.appendChild(script);
        })
            .finally(() => {
                _exportManagerPromise = null;
            });
    }
    return _exportManagerPromise;
}

async function getUserEditor() {
    if (window.userEditor) return window.userEditor;
    if (!_userEditorPromise) {
        _userEditorPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.type = 'module';
            script.src = '/js/user-editor.js';
            script.onload = () => resolve(window.userEditor);
            script.onerror = () => reject(new Error('用户编辑模块加载失败'));
            document.head.appendChild(script);
        }).finally(() => {
            _userEditorPromise = null;
        });
    }
    return _userEditorPromise;
}

// 暴露全局 Toast 函数，供加载的独立组件使用
window.showLoadingToast = showLoadingToast;
window.hideLoadingToast = hideLoadingToast;
window.showToast = showToast;
let searchTimeout = null;
const historyLimit = 20;

// --- Elements ---
let textInput, detectBtn, plusBtn, fileInput, docInput, previewImages, historyBtn, userBtn, exitEditBtn, exitResultBtn, exportBtn, headerTitle, inputCard, extractedContentArea, startBranding, clearBtn;
let actionSheet, actionSheetBackdrop, exportActionSheet, exportActionSheetBackdrop;

function initElements() {
    textInput = document.getElementById('textInput');
    detectBtn = document.getElementById('detectBtn');
    plusBtn = document.getElementById('plusBtn');
    fileInput = document.getElementById('fileInput');
    docInput = document.getElementById('docInput');
    previewImages = document.getElementById('previewImages');
    historyBtn = document.getElementById('historyBtn');
    userBtn = document.getElementById('userBtn');
    exitEditBtn = document.getElementById('exitEditBtnInside');
    exitResultBtn = document.getElementById('exitResultBtn');
    exportBtn = document.getElementById('exportBtn');
    headerTitle = document.getElementById('headerTitle');
    inputCard = document.getElementById('inputCard');
    extractedContentArea = document.getElementById('extractedContentArea');
    startBranding = document.getElementById('startBranding');
    clearBtn = document.getElementById('clearBtn');
    
    actionSheet = document.getElementById('actionSheet');
    actionSheetBackdrop = document.getElementById('actionSheetBackdrop');
    exportActionSheet = document.getElementById('exportActionSheet');
    // Using existing backdrop for export too or handle separately
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    initElements();
    initInputLogic();
    initActionSheet();
    initHistory();
    initThemeToggle();
    initUser();
    initFileInputs();
    loadHistory();
    initSSE(); // Ensure SSE is initialized for real-time status
    setupNavigation();
    renderImages(); // Ensure initial UI state is correct
    initResultHeaderScrollBehavior();
    
    // Bind static elements for Mobile.html
    const bind = (id, fn) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', fn);
    };

    bind('closeActionSheetBtn', closeActionSheet);
    bind('actionSheetBackdrop', closeActionSheet);
    bind('historyDrawerBackdrop', () => toggleHistory(false));

    // Bind Exit Buttons
    if (exitEditBtn) exitEditBtn.addEventListener('click', exitFullscreenInput);
    if (exitResultBtn) exitResultBtn.addEventListener('click', showInputView);
    
    // Bind Clear Button
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

    bind('imageModal', (e) => {
        e.currentTarget.style.display = 'none';
    });
    bind('keepLinkBtn', () => resolveConflict('link'));
    bind('keepImagesBtn', () => resolveConflict('images'));
    bind('closeConflictBtn', closeConflictModal);
    bind('closeConfirmBtn', closeConfirmModal);

    // Event Delegation for fake-highlights
    const parsedText = document.getElementById('parsedText');
    if (parsedText) {
        parsedText.addEventListener('click', (e) => {
            const highlight = e.target.closest('.fake-highlight');
            if (highlight) {
                showReasonTooltip(highlight);
            }
        });
    }

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
    let exitCount = 0;
    let exitTimer = null;

    // 状态恢复函数：确保始终处于 home 运行态
    const resetToHomeState = () => {
        if (!window.history.state || window.history.state.page !== 'home') {
            window.history.pushState({ page: 'home', initialized: true }, '');
        }
    };

    // 初始状态：仅标记当前页，不增加深度以避免 "Session History Item Has Been Marked Skippable" 警告
    // 该警告是因为在用户交互前进行了多次 pushState
    if (!window.history.state || !window.history.state.page) {
        window.history.replaceState({ page: 'home' }, '');
    }

    // 延迟初始化：仅在用户首次点击或触摸后扩展历史栈深度
    const initNavigationStack = () => {
        if (window.history.state && window.history.state.initialized) return;
        
        try {
            window.history.replaceState({ page: 'base', initialized: true }, '');
            window.history.pushState({ page: 'stable', initialized: true }, '');
            window.history.pushState({ page: 'home', initialized: true }, '');
            console.log('Navigation stack initialized after user interaction');
        } catch (e) {
            console.warn('Failed to initialized navigation stack:', e);
        }
        
        window.removeEventListener('touchstart', initNavigationStack);
        window.removeEventListener('mousedown', initNavigationStack);
    };

    window.addEventListener('touchstart', initNavigationStack, { passive: true });
    window.addEventListener('mousedown', initNavigationStack, { passive: true });

    window.addEventListener('popstate', (event) => {
        // 如果从未初始化过（即用户未进行任何交互就点击返回），允许浏览器正常跳转回上一页面
        if (!window.history.state || !window.history.state.initialized) return;

        // 关键逻辑：只要被监测到离开 home 态，不论是回到 stable 还是 base，都视为一次返回尝试
        if (!event.state || event.state.page !== 'home') {
            
            // 实时状态检测
            const getOverlayActive = () => {
                const els = ['imageModal', 'confirmModal', 'conflictModal'];
                let active = els.some(id => {
                    const el = document.getElementById(id);
                    return el && el.style.display === 'flex';
                });
                
                const classes = ['customTooltip', 'historyDrawer', 'actionSheet'];
                active = active || classes.some(id => {
                    const el = document.getElementById(id);
                    return el && el.classList.contains('active');
                });
                return active;
            };

            const getResultActive = () => {
                const inputView = document.getElementById('inputView');
                const isInputActive = inputView && inputView.classList.contains('active');
                return (currentMode === 'result' || !isInputActive || isInputFullscreen);
            };

            // 1. 浮层计数器逻辑
            if (getOverlayActive()) {
                if (document.getElementById('imageModal')) document.getElementById('imageModal').style.display = 'none';
                if (typeof hideTooltip === 'function') hideTooltip();
                if (typeof closeConfirmModal === 'function') closeConfirmModal();
                if (typeof closeConflictModal === 'function') closeConflictModal();
                if (typeof toggleHistory === 'function') toggleHistory(false);
                if (typeof closeActionSheet === 'function') closeActionSheet();
                
                exitCount = 0; 
                resetToHomeState();
                console.log('Intercepted back for Overlay');
                return;
            }

            // 2. 结果页/全屏态计数器逻辑
            if (getResultActive()) {
                if (currentMode === 'result' || !document.getElementById('inputView').classList.contains('active')) {
                    if (typeof showInputView === 'function') showInputView();
                } else if (isInputFullscreen) {
                    if (typeof exitFullscreenInput === 'function') exitFullscreenInput();
                }
                
                exitCount = 0;
                resetToHomeState();
                console.log('Intercepted back for Result/Fullscreen');
                return;
            }

            // 3. 处于主页面，二次退出计数器逻辑
            exitCount++;
            
            if (exitCount === 1) {
                showToast('再按一次返回键退出程序', 'info');
                resetToHomeState(); // 立即补回 home 运行态

                if (exitTimer) clearTimeout(exitTimer);
                exitTimer = setTimeout(() => {
                    exitCount = 0;
                }, 2000);
                console.log('Intercepted back for Exit Step 1');
            } else if (exitCount >= 2) {
                // 2秒内连续返回，且无拦截需求：允许退出
                showToast('正在退出程序...', 'info');
                console.log('Final Exit allowed');
                // 不再 pushState，允许浏览器穿透到 base 之前的真实记录（即退出）
            }
        }
    });

    // 补偿机制：极少情况下用户可能卡在 base 态
    document.addEventListener('click', () => {
        if (!window.history.state || window.history.state.page === 'base') {
            resetToHomeState();
        }
    }, { capture: true, passive: true });
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
    
    if (!summaryDescText) return;

    // Clear any existing search timer
    if (mobileStatusTimeout) {
        clearTimeout(mobileStatusTimeout);
        mobileStatusTimeout = null;
    }

    const applyMessage = (msg) => {
        setToastText(msg);
        if (summaryDescText && summaryDescText.textContent !== msg) {
            summaryDescText.textContent = msg;
        }
        if (currentMode === 'input') {
            showLoadingToast(msg);
        }
    };

    let message = '';
    switch(status) {
        case 'extracting':
        case 'parsing':
            message = '正在解析网页...';
            applyMessage(message);
            break;
        case 'analyzing':
            message = '进行初步分析中...';
            applyMessage(message);
            break;
        case 'searching':
            searchStartTime = Date.now();
            message = `联网搜索: ${data?.query || ''}`;
            applyMessage(message);
            // Limit search word display to max 5 seconds
            mobileStatusTimeout = setTimeout(() => {
                updateStatusUI('deep-analysis', null);
            }, 5000);
            break;
        case 'search-failed':
            message = '联网搜索失败，进行离线分析...';
            applyMessage(message);
            break;
        case 'deep-analysis':
            const elapsed = Date.now() - (searchStartTime || 0);
            const minDisplay = 4000;
            message = '深度分析中...';

            if (elapsed < minDisplay && searchStartTime) {
                // Keep the search keyword visible for at least 4 seconds
                mobileStatusTimeout = setTimeout(() => {
                    applyMessage(message);
                }, minDisplay - elapsed);
            } else {
                applyMessage(message);
            }
            break;
        default:
            message = '正在分析中...';
            applyMessage(message);
    }
}

// Global helper to update Toast with "Dynamic Island" transition
let toastShowTime = 0;
let toastHideTimeout = null;
function showLoadingToast(message) {
    if (toastHideTimeout) {
        clearTimeout(toastHideTimeout);
        toastHideTimeout = null;
    }

    const loadingToast = document.getElementById('loadingToast');
    if (loadingToast) {
        // Reset exit animation styles
        loadingToast.style.transform = '';
        loadingToast.style.opacity = '';
    }

    setToastText(message);
    if (loadingToast) {
        if (!loadingToast.classList.contains('active')) {
            loadingToast.classList.add('active');
        }
        toastShowTime = Date.now(); // Always refresh to ensure minimum display time for the current message
    }
}

function hideLoadingToast() {
    const loadingToast = document.getElementById('loadingToast');
    
    // Clear any lingering status update timeouts
    if (mobileStatusTimeout) {
        clearTimeout(mobileStatusTimeout);
        mobileStatusTimeout = null;
    }

    if (!loadingToast) return;
    
    // Minimum display time of 0.5 seconds
    const minTime = 500;
    const elapsed = Date.now() - toastShowTime;
    const remaining = Math.max(0, minTime - elapsed);
    
    if (toastHideTimeout) clearTimeout(toastHideTimeout);
    
    toastHideTimeout = setTimeout(() => {
        // Exit animation: Slide up out of screen, then fade out
        loadingToast.style.transform = 'translateX(-50%) translateY(-150%)';
        
        setTimeout(() => {
            loadingToast.style.opacity = '0';
        }, 300);

        setTimeout(() => {
            loadingToast.classList.remove('active');
            // Restore styles after it's hidden so it can show again normally
            loadingToast.style.transform = '';
            loadingToast.style.opacity = '';
            toastHideTimeout = null;
        }, 700);
    }, remaining);
}

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
        // We measure the natural width of the content (now that width: 100% is removed from css)
        const content = document.querySelector('.toast-content');
        const contentWidth = content.offsetWidth || content.scrollWidth;
        // Adding specific padding for the capsule look
        loadingToast.style.width = (contentWidth + 60) + 'px'; 
    }, 150);
}

function applyResultHeaderState(atTop) {
    const mobileHeader = document.querySelector('.mobile-header');
    if (!mobileHeader) return;

    if (atTop) {
        mobileHeader.classList.remove('bg-glass');
        mobileHeader.classList.add('header-top-expanded');
    } else {
        mobileHeader.classList.remove('header-top-expanded');
        mobileHeader.classList.add('bg-glass');
    }

    isResultHeaderAtTop = atTop;
}

function updateResultHeaderByScroll(force = false) {
    if (currentMode !== 'result') return;

    const resultView = document.getElementById('resultView');
    const mobileHeader = document.querySelector('.mobile-header');
    if (!resultView || !mobileHeader) return;

    const scrollTop = resultView.scrollTop || 0;
    
    // Calculate progress: 1 at top, 0 at 40px scroll
    // We use a slightly larger range (40px) to make the transition smooth
    const range = 40; 
    const progress = Math.max(0, Math.min(1, 1 - (scrollTop / range)));
    
    // Apply progress as CSS variable for micro-animations
    mobileHeader.style.setProperty('--header-progress', progress.toFixed(3));

    // Still manage the state classes for logic and fallback
    const enterTopThreshold = 2;
    const exitTopThreshold = 10;

    let nextAtTop = isResultHeaderAtTop;
    if (scrollTop <= enterTopThreshold) {
        nextAtTop = true;
    } else if (scrollTop >= exitTopThreshold) {
        nextAtTop = false;
    }

    if (force || nextAtTop !== isResultHeaderAtTop) {
        applyResultHeaderState(nextAtTop);
    }
}

function initResultHeaderScrollBehavior() {
    const resultView = document.getElementById('resultView');
    if (!resultView) return;

    resultView.addEventListener('scroll', () => {
        updateResultHeaderByScroll(false);
    }, { passive: true });
}

// --- View Logic ---
function enterFullscreenInput() {
    if (currentMode === 'result') return;
    
    isInputFullscreen = true;
    inputCard.classList.add('fullscreen');
    
    // Header changes
    historyBtn.style.display = 'none';
    if (userBtn) userBtn.style.display = 'none';
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
    if (userBtn) userBtn.style.display = 'flex';
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
    const mobileHeader = document.querySelector('.mobile-header');
    if (mobileHeader) {
        mobileHeader.classList.remove('header-top-expanded');
    }

    historyBtn.style.display = 'none';
    if (userBtn) userBtn.style.display = 'none';
    exitEditBtn.style.display = 'none';
    exitResultBtn.style.display = 'flex';
    if (exportBtn) exportBtn.style.display = 'flex';
    if (headerTitle) headerTitle.style.display = 'block';
    if (startBranding) startBranding.style.display = 'none';

    updateResultHeaderByScroll(true);
    
    if (isInputFullscreen) exitFullscreenInput();
}

function showInputView() {
    currentMode = 'input';
    document.getElementById('resultView').classList.remove('active');
    document.getElementById('inputView').classList.add('active');
    
    // Header restore - set to expanded state (progress 1) to avoid shadow at top
    const mobileHeader = document.querySelector('.mobile-header');
    if (mobileHeader) {
        mobileHeader.classList.remove('bg-glass');
        mobileHeader.classList.remove('header-top-expanded');
        mobileHeader.style.setProperty('--header-progress', '1');
    }
    isResultHeaderAtTop = true; // Set to true as we are at the top of input view

    exitResultBtn.style.display = 'none';
    if (exportBtn) exportBtn.style.display = 'none';
    exitEditBtn.style.display = 'none';
    historyBtn.style.display = 'flex';
    if (userBtn) userBtn.style.display = 'flex';
    
    // Explicitly restore elements hidden by fullscreen mode if we were stuck
    if (startBranding) startBranding.style.display = 'block';
    if (headerTitle) headerTitle.style.display = 'none'; 
    if (mobileHeader) mobileHeader.style.display = 'flex';
    
    // Ensure we are not in fullscreen class (double check)
    inputCard.classList.remove('fullscreen');
     // Move button back if needed
    const bottomArea = document.querySelector('.bottom-action-area');
    if (bottomArea && bottomArea.parentNode === inputCard) {
        document.getElementById('inputView').appendChild(bottomArea);
    }
}

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
    modal.offsetHeight;
    modal.classList.add('active');
}

function closeConfirmModal() {
    const modal = document.getElementById('confirmModal');
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => {
            if (!modal.classList.contains('active')) modal.style.display = 'none';
        }, 300);
    }
    confirmCallback = null;
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

    // Image/Text paste logic for mobile
    textInput.addEventListener('paste', async (e) => {
        let hasHandled = false;

        // 1. Files from clipboard
        if (e.clipboardData.files && e.clipboardData.files.length > 0) {
            const imageFiles = Array.from(e.clipboardData.files).filter(file => {
                const isHEIC = file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif');
                return file.type.startsWith('image/') || isHEIC;
            });
            if (imageFiles.length > 0) {
                e.preventDefault();
                await processAndAddImages(imageFiles);
                hasHandled = true;
            }
        }

        // 2. Items (screenshots, etc)
        if (!hasHandled) {
            const items = e.clipboardData.items;
            for (let item of items) {
                if (item.type.indexOf('image') !== -1 || item.type.indexOf('heic') !== -1 || item.type.indexOf('heif') !== -1) {
                    const file = item.getAsFile();
                    if (file) {
                        e.preventDefault();
                        await processAndAddImages([file]);
                        hasHandled = true;
                    }
                    break;
                }
            }
        }
    });
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
        const faviconUrl = `https://ico.kucat.cn/get.php?url=${urlObj.hostname}&sz=32`;
        return `/api/proxy-image?url=${encodeURIComponent(faviconUrl)}`;
    } catch (e) {
        return null;
    }
}

function renderExtractedUrlCard() {
    if (!currentExtractedData) {
        extractedContentArea.style.display = 'none';
        extractedContentArea.innerHTML = '';
        renderImages(); // Refresh to remove doc/url from previewImages if it was deleted
        return;
    }

    // Both Docs and URLs are now rendered inside previewImages (Unified Media Area)
    extractedContentArea.style.display = 'none';
    extractedContentArea.innerHTML = '';
    renderImages();
}

function removeExtractedUrl() {
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

        if (_abortController && _abortController.signal.aborted) {
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

_abortController = null;
currentAnalysisStatus = 'initializing'; // Global state for SSE updates

async function runDetection() {
    if (detectBtn.classList.contains('is-stop')) {
        // Handle Cancel
        if (_abortController) {
            _abortController.abort();
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
    _abortController = new AbortController();
    currentAnalysisStatus = 'initializing';
    
    const progressBar = document.getElementById('progressBar');
    const progressContainer = document.getElementById('progressBarContainer');

    showLoadingToast('正在初始化...');
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
        
        if (isExtracting) {
            // Handled by extraction callback mostly, but we can ensure it doesn't stall
            return; 
        }

        // Analysis Phase Logic
        statusTimer += 80;
        
        // Simulating status changes
        if (statusTimer > 3000 && currentAnalysisStatus === 'initializing') {
            currentAnalysisStatus = 'searching';
        }
        if (statusTimer > 8000 && currentAnalysisStatus === 'searching') {
            currentAnalysisStatus = 'deep-analysis';
        }

        let targetMax = 40; 
        if (currentAnalysisStatus === 'searching') targetMax = 70;
        else if (currentAnalysisStatus === 'deep-analysis') targetMax = 91;

            if (progress < targetMax) {
                // Speed Control
                let increment = (progress < 20) ? 0.6 : (progress < 40) ? 0.3 : (progress < 70) ? 0.2 : 0.1;
                progress += increment;
                if (progress > 91) progress = 91;

                progressBar.style.width = Math.min(progress, 90) + '%';
            }
        }, 150); // Increased interval slightly to reduce calculation overhead

    try {
        // 1. Check if we need to extract content FIRST
        if (currentExtractedData && currentExtractedData.pendingExtraction) {
             isExtracting = true;
             // Manually drive progress for extraction phase (0-40%)
             await performRealExtraction((val, msg) => {
                 progress = val;
                 progressBar.style.width = progress + '%';
                 setToastText(msg);
             });
             isExtracting = false;
             // Extraction done. We are at ~40%.
             // Reset status timer for analysis phase to start smoothly from here
             statusTimer = 3000; // Skip to searching phase logic roughly
             currentAnalysisStatus = 'searching';
        }

        if (_abortController.signal.aborted) throw new Error('Aborted');

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

        if (_abortController.signal.aborted) throw new Error('Aborted');
        
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
        isExtracting = false;
        detectBtn.classList.remove('is-stop'); // BUG FIX: Ensure is-stop is removed
        detectBtn.disabled = false;
        detectBtn.textContent = originalText;
        hideLoadingToast();
        if (progressContainer) {
            setTimeout(() => {
                progressContainer.style.display = 'none';
                progressBar.style.width = '0%';
            }, 300);
        }
        updateButtonState();
        _abortController = null;
    }
}

function updateButtonState() {
    // If running (is-stop), button is always enabled (to allow stop)
    if (detectBtn.classList.contains('is-stop')) {
        detectBtn.disabled = false;
    } else {
        // Only enable if there is content
        detectBtn.disabled = textInput.value.trim().length === 0;
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
    const backdrop = document.getElementById('actionSheetBackdrop');
    const actionSheet = document.getElementById('actionSheet');
    const exportSheet = document.getElementById('exportActionSheet');

    const closeAllSheets = () => {
        backdrop.classList.remove('active');
        if (actionSheet) {
            actionSheet.classList.remove('active');
            actionSheet.style.transform = 'translateY(100%)';
        }
        if (exportSheet) {
            exportSheet.classList.remove('active');
            exportSheet.style.transform = 'translateY(100%)';
        }
        hideTooltip();
    };

    plusBtn.addEventListener('click', () => {
        backdrop.classList.add('active');
        actionSheet.classList.add('active');
        actionSheet.style.transform = 'translateY(0)';
    });

    if (exportBtn) {
        exportBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            backdrop.classList.add('active');
            exportSheet.classList.add('active');
            exportSheet.style.transform = 'translateY(0)';
        });
    }

    // Bind Export Options
    document.querySelectorAll('.export-option').forEach(btn => {
        btn.addEventListener('click', async () => {
            const format = btn.getAttribute('data-format');
            closeAllSheets();
            try {
                const exportManager = await getExportManager();
                if (exportManager) {
                    await exportManager.exportResult(format);
                } else {
                    throw new Error('Export manager unavailable');
                }
            } catch (e) {
                console.error('Failed to load export manager:', e);
                showToast('导出模块加载失败', 'error');
            }
        });
    });

    document.getElementById('closeActionSheetBtn')?.addEventListener('click', closeAllSheets);
    document.getElementById('closeExportActionSheetBtn')?.addEventListener('click', closeAllSheets);
    backdrop.addEventListener('click', closeAllSheets);

    document.getElementById('uploadImageBtn').addEventListener('click', triggerImageUpload);
    document.getElementById('uploadDocBtn').addEventListener('click', triggerFileUpload);
}

function closeActionSheet() {
    const backdrop = document.getElementById('actionSheetBackdrop');
    const actionSheet = document.getElementById('actionSheet');
    const exportSheet = document.getElementById('exportActionSheet');

    backdrop.classList.remove('active');
    if (actionSheet) {
        actionSheet.classList.remove('active');
        actionSheet.style.transform = 'translateY(100%)';
    }
    if (exportSheet) {
        exportSheet.classList.remove('active');
        exportSheet.style.transform = 'translateY(100%)';
    }
    // Also hide tooltips if any
    hideTooltip();
}

function triggerImageUpload() {
    fileInput.click();
    closeActionSheet();
}

function triggerFileUpload() {
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

function initFileInputs() {
    if (docInput) {
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
                if (!!currentExtractedData && currentExtractedData.type === 'link') {
                    pendingConflict = { type: 'images', data: [file] };
                    showConflictModal();
                } else {
                    await processAndAddImages([file]);
                }
                docInput.value = '';
                return;
            }

            // Conflict Check for Documents: Only conflict with links
            if (currentExtractedData && currentExtractedData.type === 'link') {
                pendingConflict = { type: 'doc', data: file };
                showConflictModal();
                docInput.value = '';
                return;
            }

            await handleDocParsing(file);
            docInput.value = '';
        });
    }

    if (fileInput) {
        fileInput.addEventListener('change', async (e) => {
            const files = Array.from(e.target.files);
            if (files.length === 0) return;
            
            // Conflict Check: Only conflict with links
            if (currentExtractedData && currentExtractedData.type === 'link') {
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
    }
}

async function handleDocParsing(file) {
    const reader = new FileReader();
    
    // Show loading UI
    showLoadingToast('正在解析文件...');

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
                size: file.size,
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
        hideLoadingToast();
    }
}

function renderImages() {
    previewImages.innerHTML = '';
    
    const hasMedia = currentExtractedData; // Could be doc or url
    const hasImages = uploadedImages.length > 0;

    // Use shared SVG constant
    const closeSvg = UI_CLOSE_SVG.replace('<svg', '<svg width="12" height="12"');

    // Handle Media Card (Document or URL)
    if (hasMedia) {
        const isAlone = !hasImages;
        const data = currentExtractedData;
        const isDoc = data.type === 'doc';
        
        const mediaDiv = document.createElement('div');
        mediaDiv.className = `preview-doc-card bg-glass ${isAlone ? 'is-alone' : ''}`;
        
        // Icon logic
        let iconContent = '';
        if (isDoc) {
            iconContent = `<svg viewBox="0 0 24 24" width="22" height="22" fill="var(--primary-color)">
                <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
            </svg>`;
        } else {
            const faviconUrl = getFaviconUrl(data.url);
            iconContent = faviconUrl 
                ? `<img src="${faviconUrl}" style="width:22px; height:22px; object-fit:contain;" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
                   <svg viewBox="0 0 24 24" width="22" height="22" fill="var(--primary-color)" style="display:none;">
                       <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/>
                   </svg>`
                : `<svg viewBox="0 0 24 24" width="22" height="22" fill="var(--primary-color)">
                       <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/>
                   </svg>`;
        }

        const title = data.title || (isDoc ? '解析文件' : '检测网页');
        const metaLine = isDoc 
            ? `<span class="doc-ext">${data.format || 'DOC'}</span>${data.size ? `<span class="doc-divider">|</span><span class="doc-size">${formatFileSize(data.size)}</span>` : ''}`
            : `<span class="doc-ext" style="color:var(--text-muted); font-size:11px;">${data.pendingExtraction ? '等待解析...' : '内容已就绪'}</span>`;

        mediaDiv.innerHTML = `
            <div class="doc-icon">
                ${iconContent}
            </div>
            <div class="doc-info">
                <div class="doc-title">${escapeHTML(title)}</div>
                <div class="doc-meta">
                    ${metaLine}
                </div>
            </div>
            <div class="doc-right">
                <div class="remove-doc-btn close-circle-btn">
                    ${closeSvg}
                </div>
            </div>
        `;

        // Direct click removal
        const removeBtn = mediaDiv.querySelector('.remove-doc-btn');
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeExtractedUrl();
        });

        // Long press for media
        let pressTimer;
        mediaDiv.addEventListener('touchstart', (e) => {
            pressTimer = setTimeout(() => {
                if (navigator.vibrate) navigator.vibrate(50);
                if (isDoc) showFileContext();
                else showActionSheetForUrl(); // Might need a new helper
            }, 600);
        });
        mediaDiv.addEventListener('touchend', () => clearTimeout(pressTimer));
        mediaDiv.addEventListener('touchmove', () => clearTimeout(pressTimer));

        previewImages.appendChild(mediaDiv);
    }

    // Handle Images
    uploadedImages.forEach((img, index) => {
        const div = document.createElement('div');
        div.className = 'preview-img-wrapper';
        
        let displayUrl = img.url;
        if (displayUrl && !displayUrl.startsWith('data:') && !displayUrl.startsWith('blob:') && displayUrl.startsWith('http')) {
            displayUrl = `/api/proxy-image?url=${encodeURIComponent(displayUrl)}`;
        }

        div.innerHTML = `
            <img src="${displayUrl}">
            <div class="remove-img-btn close-circle-btn">${closeSvg}</div>
        `;

        // Click to preview
        div.addEventListener('click', () => {
            previewImage(img.url);
        });

        // Click removal
        const removeBtn = div.querySelector('.remove-img-btn');
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeImage(index);
        });

        // Long press for image
        let pressTimer;
        div.addEventListener('touchstart', (e) => {
            pressTimer = setTimeout(() => {
                if (navigator.vibrate) navigator.vibrate(50);
                showImageContext(img.url, index);
            }, 600);
        });
        div.addEventListener('touchend', () => clearTimeout(pressTimer));
        div.addEventListener('touchmove', () => clearTimeout(pressTimer));

        previewImages.appendChild(div);
    });

    if (previewImages.innerHTML === '') {
        previewImages.style.display = 'none';
        previewImages.classList.remove('has-content');
    } else {
        previewImages.style.display = 'flex';
        previewImages.classList.add('has-content');
    }
}

function showFileContext() {
    const backdrop = document.getElementById('actionSheetBackdrop');
    const sheet = document.getElementById('actionSheet');
    const content = document.getElementById('actionSheetContent');

    const isDoc = currentExtractedData && currentExtractedData.type === 'doc';

    content.innerHTML = `
        <div style="padding:15px; font-weight:bold; border-bottom:1px solid var(--bg-tertiary); color:var(--text-secondary); font-size:14px;">${isDoc ? '文件' : '链接'}操作</div>
        <div style="padding:20px; text-align:center; border-bottom:1px solid var(--bg-tertiary); color:#ff4d4f; font-size:16px;" id="removeDocBtnSheet">移除${isDoc ? '文件' : '链接'}</div>
    `;

    document.getElementById('removeDocBtnSheet').addEventListener('click', () => {
        removeExtractedUrl();
        closeActionSheet();
    });

    backdrop.classList.add('active');
    sheet.classList.add('active');
    sheet.style.transform = 'translateY(0)';
}

function showActionSheetForUrl() {
    showFileContext();
}

function showImageContext(imgUrl, index) {
    const backdrop = document.getElementById('actionSheetBackdrop');
    const sheet = document.getElementById('actionSheet');
    const content = document.getElementById('actionSheetContent');

    content.innerHTML = `
        <div style="padding:15px; font-weight:bold; border-bottom:1px solid var(--bg-tertiary); color:var(--text-secondary); font-size:14px;">图片操作</div>
        <div style="padding:20px; text-align:center; border-bottom:1px solid var(--bg-tertiary); color:#ff4d4f; font-size:16px;" id="removeImgBtnSheet">删除该图片</div>
        <div style="padding:20px; text-align:center; border-bottom:1px solid var(--bg-tertiary); font-size:16px;" id="previewImgBtnSheet">预览图片</div>
    `;

    document.getElementById('removeImgBtnSheet').addEventListener('click', () => {
        removeImage(index);
        closeActionSheet();
    });

    document.getElementById('previewImgBtnSheet').addEventListener('click', () => {
        previewImage(imgUrl);
        closeActionSheet();
    });

    backdrop.classList.add('active');
    sheet.classList.add('active');
    sheet.style.transform = 'translateY(0)';
}

function previewImage(url) {
    const modal = document.getElementById('imageModal');
    const img = document.getElementById('modalImage');
    if (modal && img) {
        let displayUrl = url;
        if (displayUrl && !displayUrl.startsWith('data:') && !displayUrl.startsWith('blob:') && displayUrl.startsWith('http')) {
            displayUrl = `/api/proxy-image?url=${encodeURIComponent(displayUrl)}`;
        }
        img.src = displayUrl;
        modal.style.display = 'flex';
    }
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function removeImage(index) {
    uploadedImages.splice(index, 1);
    renderImages();
    updateButtonState();
}

// --- History Logic --- 
function initHistory() {
    historyBtn.addEventListener('click', () => {
        toggleHistory(true);
        // Refresh history when opening
        loadHistory(false);
    });

    const list = document.getElementById('historyList');
    list.addEventListener('scroll', () => {
        if (list.scrollTop + list.clientHeight >= list.scrollHeight - 50) {
            if (hasMoreHistory && !historyLoading) {
                loadHistory(true);
            }
        }
    });

    // Search Logic
    const searchInput = document.getElementById('historySearchInput');
    const clearSearchBtn = document.getElementById('clearHistorySearch');

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const val = e.target.value.trim();
            historySearchQuery = val;
            
            // Toggle clear button
            if (clearSearchBtn) {
                clearSearchBtn.style.display = val ? 'flex' : 'none';
            }

            if (searchTimeout) clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                loadHistory(false);
            }, 400);
        });

        // Hide keyboard on Enter
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                searchInput.blur();
            }
        });
    }

    if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', () => {
            searchInput.value = '';
            historySearchQuery = '';
            clearSearchBtn.style.display = 'none';
            searchInput.focus();
            loadHistory(false);
        });
    }
}

// --- Theme Logic ---
function initThemeToggle() {
    const themeBtn = document.getElementById('themeToggleBtn');
    if (!themeBtn) return;

    // Initial icon state
    updateThemeIcon();

    themeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const currentTheme = document.documentElement.getAttribute('data-theme') || localStorage.getItem('theme') || 'light';
        const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
        
        applyTheme(nextTheme);
    });
}

async function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    updateThemeIcon();
    
    // Trigger renderTheme from theme-loader.js if it exists
    if (typeof window.applyDynamicTheme === 'function') {
        await window.applyDynamicTheme(true); // Force re-render with new mode
    }
}

function updateThemeIcon() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || localStorage.getItem('theme') || 'light';
    const sunIcon = document.querySelector('.sun-icon');
    const moonIcon = document.querySelector('.moon-icon');
    
    if (!sunIcon || !moonIcon) return;

    if (currentTheme === 'dark') {
        sunIcon.style.display = 'block';
        moonIcon.style.display = 'none';
        document.getElementById('themeToggleBtn').style.color = '#ffcf40'; // Warm yellow for sun
    } else {
        sunIcon.style.display = 'none';
        moonIcon.style.display = 'block';
        document.getElementById('themeToggleBtn').style.color = '#6366f1'; // Indigo for moon
    }
}

function toggleHistory(show) {
    const backdrop = document.getElementById('historyDrawerBackdrop');
    const drawer = document.getElementById('historyDrawer');
    if (show) {
        backdrop.style.display = 'block';
        setTimeout(() => {
            backdrop.classList.add('active');
            drawer.classList.add('active');
        }, 10);
    } else {
        backdrop.classList.remove('active');
        drawer.classList.remove('active');
        setTimeout(() => {
            if (!backdrop.classList.contains('active')) {
                backdrop.style.display = 'none';
            }
        }, 300);
    }
}

async function loadHistory(isLoadMore = false) {
    if (historyLoading) return;
    if (isLoadMore && !hasMoreHistory) return;

    historyLoading = true;
    
    // Show a small loader if loading more
    const list = document.getElementById('historyList');
    let loader = null;
    if (isLoadMore) {
        loader = document.createElement('div');
        loader.className = 'history-loader-item';
        loader.style.textAlign = 'center';
        loader.style.padding = '10px';
        loader.innerHTML = '<span style="color:var(--text-muted); font-size:12px;">加载中...</span>';
        list.appendChild(loader);
    } else {
        historyPage = 1;
        hasMoreHistory = true;
        list.scrollTop = 0;
    }

    try {
        const result = await window.api.invoke('get-history', { 
            metadataOnly: true,
            page: historyPage,
            limit: historyLimit,
            query: historySearchQuery
        });
        
        if (!result) return;
        
        const data = result.data || [];
        hasMoreHistory = result.hasMore;

        if (isLoadMore) {
            if (loader) loader.remove();
            allHistory = allHistory.concat(data);
        } else {
            allHistory = data;
        }

        renderHistoryList();
        historyPage++;
    } catch(e) {
        console.warn('Failed to load history', e);
        if (isLoadMore && loader) loader.remove();
        if (!isLoadMore) list.innerHTML = '<div style="text-align:center; color:var(--text-secondary); padding:20px;">加载失败</div>';
    } finally {
        historyLoading = false;
    }
}

function renderHistoryList() {
    const list = document.getElementById('historyList');
    list.innerHTML = '';
    
    if (allHistory.length === 0) {
        const emptyMsg = historySearchQuery ? '未找到相关记录' : '暂无历史记录';
        list.innerHTML = `<div style="text-align:center; color:var(--text-secondary); padding:20px;">${emptyMsg}</div>`;
        return;
    }
    
    let pressTimer;

    allHistory.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'history-item';
        
        // Touch events for long press (context menu or delete)
        div.addEventListener('touchstart', (e) => {
            pressTimer = setTimeout(() => {
                if (navigator.vibrate) navigator.vibrate(50);
                showHistoryContext(item, index, e);
            }, 600);
        });

        div.addEventListener('touchend', () => clearTimeout(pressTimer));
        div.addEventListener('touchmove', () => clearTimeout(pressTimer));

        div.onclick = async () => {
             // If info is not full, load it now
             let fullItem = item;
             if (!item.result && !item.content) {
                 try {
                     showLoadingToast('正在加载详情...');

                     fullItem = await window.api.invoke('get-history-item', item.timestamp);
                     
                     hideLoadingToast();
                     
                     if (!fullItem) {
                         showToast('无法加载历史详情', 'error');
                         return;
                     }
                     // Update local cache
                     allHistory[index] = fullItem;
                 } catch (err) {
                     console.error(err);
                     showToast('加载失败', 'error');
                     return;
                 }
             }

             showResult(fullItem.result, fullItem.content, fullItem.images || [], fullItem.url); 
             showResultView();
             toggleHistory(false);
        };

        const dateStr = new Date(item.timestamp).toLocaleString();
        
        // Use pre-computed title from metadata
        let displayTitle = item.title || '[无标题内容]';
        
        // Show URL if available
        let urlDisplay = '';
        if (item.url) {
            let hostname = item.url;
            try { hostname = new URL(item.url).hostname; } catch(e) {}
            urlDisplay = `<div style="color:var(--primary-color); font-size:12px; margin-bottom:4px; display:flex; align-items:center; gap:4px;">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>
                <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHTML(hostname)}</span>
            </div>`;
        }

        div.innerHTML = `
            <div class="history-date">${dateStr}</div>
            ${urlDisplay}
            <div class="history-preview">${escapeHTML(displayTitle)}</div>
        `;
        list.appendChild(div);
    });
}

function showHistoryContext(item, index, e) {
    const backdrop = document.getElementById('actionSheetBackdrop');
    const sheet = document.getElementById('actionSheet');
    const content = document.getElementById('actionSheetContent');

    const displayTitle = item.title || '操作记录';

    content.innerHTML = `
        <div style="padding:15px; font-weight:bold; border-bottom:1px solid var(--bg-tertiary); color:var(--text-secondary); font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHTML(displayTitle)}</div>
        <div style="padding:20px; text-align:center; border-bottom:1px solid var(--bg-tertiary); color:#ff4d4f; font-size:16px;" id="deleteHistoryItemBtn">删除此条记录</div>
        <div style="padding:20px; text-align:center; border-bottom:1px solid var(--bg-tertiary); font-size:16px;" id="showHistoryItemBtn">查看详情</div>
    `;

    document.getElementById('deleteHistoryItemBtn').addEventListener('click', () => {
        deleteHistoryItem(index);
        closeActionSheet();
    });

    document.getElementById('showHistoryItemBtn').addEventListener('click', () => {
        showResultFromHistory(index);
        closeActionSheet();
    });

    backdrop.classList.add('active');
    sheet.classList.add('active');
    sheet.style.transform = 'translateY(0)';
}

async function showResultFromHistory(index) {
    let item = allHistory[index];
    
    // If info is not full, load it now
    if (!item.result && !item.content) {
        try {
            showLoadingToast('正在加载详情...');

            const fullItem = await window.api.invoke('get-history-item', item.timestamp);
            
            hideLoadingToast();
            
            if (!fullItem) {
                showToast('无法加载历史详情', 'error');
                return;
            }
            // Update local cache
            allHistory[index] = fullItem;
            item = fullItem;
        } catch (err) {
            console.error(err);
            hideLoadingToast();
            showToast('加载失败', 'error');
            return;
        }
    }

    showResult(item.result, item.content, item.images || [], item.url);
    showResultView();
    closeActionSheet();
    toggleHistory(false);
}

async function deleteHistoryItem(index) {
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
            let iconSvg = '';
            if (point.status === 'negative') {
                iconSvg = '✕';
            } else if (point.status === 'warning') {
                iconSvg = '!';
            } else {
                iconSvg = '✓';
            }
            div.innerHTML = `
                <div class="analysis-icon ${iconClass}">${iconSvg}</div>
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
                const span = `<span class="fake-highlight" data-reason="${reasonStr}">${safePart}</span>`; // Removed onclick for delegation
                
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

function openImageModal(src) {
    const modal = document.getElementById('imageModal');
    const modalImg = document.getElementById('modalImage');
    modalImg.src = src;
    modal.style.display = 'flex';
}

// --- Tooltip ---
function showReasonTooltip(element) {
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
        <div class="tooltip-header" style="font-weight:600; margin-bottom:10px; padding:18px 20px 14px; border-bottom:1px solid var(--border-color); font-size:18px; display: flex; justify-content: space-between; align-items: center;">
            <span>风险详情</span>
            <span class="close-circle-btn" style="width: 30px; height: 30px;" id="closeTooltipBtn">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </span>
        </div>
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

    const backdrop = document.getElementById('actionSheetBackdrop');
    backdrop.classList.add('active');
    
    // For tooltips, clicking backdrop should also hide it
    // We can manually override the backdrop behavior or just let it close everything
    
    document.getElementById('closeTooltipBtn').addEventListener('click', hideTooltip);
    tooltip.classList.add('active');
}

function hideTooltip() {
    document.getElementById('customTooltip').classList.remove('active');
    document.getElementById('actionSheetBackdrop').classList.remove('active');
}

// --- Conflict Modal Logic ---
function showConflictModal() {
    const modal = document.getElementById('conflictModal');
    if (modal) {
        // Adjust text if it's a link conflict vs image conflict
        const desc = modal.querySelector('div[style*="font-size: 14px"]');
        const keepLinkBtn = document.getElementById('keepLinkBtn');
        
        if (pendingConflict.type === 'link') {
            desc.textContent = '检测网页链接时，无法同时分析已上传的本地图片。是否清空图片并继续提取链接？';
            if (keepLinkBtn) keepLinkBtn.textContent = '保留网页链接';
        } else if (pendingConflict.type === 'doc') {
            desc.textContent = '解析文档文件时，无法同时分析已上传的本地图片。是否清空图片并继续解析？';
            if (keepLinkBtn) keepLinkBtn.textContent = '保留文档文件';
        } else {
            desc.textContent = '检测图片内容时，无法同时分析检测到的网页或文件。是否移除它们并继续上传图片？';
            if (keepLinkBtn) keepLinkBtn.textContent = '保留网页/文件';
        }
        modal.style.display = 'flex';
        modal.offsetHeight;
        modal.classList.add('active');
    }
}

function closeConflictModal() {
    const modal = document.getElementById('conflictModal');
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => {
            if (!modal.classList.contains('active')) modal.style.display = 'none';
        }, 300);
    }
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
                showLoadingToast('正在转换 HEIC 图片...');

                // Dynamically load heic2any if not already loaded
                if (typeof heic2any === 'undefined') {
                    await new Promise((resolve, reject) => {
                        const script = document.createElement('script');
                        // 智能尝试多个路径以兼容开发和生产环境
                        const paths = [
                            '/js/heic2any.min.js',
                            '/client-src/js/heic2any.min.js'
                        ];
                        let pathIdx = 0;

                        const loadNext = () => {
                            if (pathIdx >= paths.length) {
                                reject(new Error('所有路径均无法加载 heic2any 脚本'));
                                return;
                            }
                            script.src = paths[pathIdx++];
                        };

                        script.onload = () => {
                            if (typeof heic2any !== 'undefined') resolve();
                            else reject(new Error('heic2any not found after script load'));
                        };
                        script.onerror = loadNext;
                        document.head.appendChild(script);
                        loadNext();
                    });
                }

                const blob = await heic2any({
                    blob: file,
                    toType: 'image/jpeg',
                    quality: 0.7
                });
                
                const finalBlob = Array.isArray(blob) ? blob[0] : blob;
                processFile = new File([finalBlob], file.name.replace(/\.(heic|heif)$/i, '.jpg'), { type: 'image/jpeg' });
            } catch (err) {
                console.error('HEIC conversion failed', err);
                showToast('HEIC 转换失败', 'error');
                continue;
            } finally {
                hideLoadingToast();
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

async function resolveConflict(choice) {
    if (!pendingConflict) return;

    const modal = document.getElementById('conflictModal');
    const keepLinkBtn = document.getElementById('keepLinkBtn');

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

// --- User Logic (Reused from PC) ---
async function initUser() {
    const userBtn = document.getElementById('userBtn');
    if (!userBtn) return;

    userBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showUserActionSheet();
    });

    try {
        const res = await fetch('/auth/me');
        if (res.status === 401) {
            window.location.href = '/Login';
            return;
        }
        const data = await res.json();
        if (data.status !== "fail") {
            currentUser = data.user;
            updateAvatar(data.user);
        }
    } catch (err) {
        console.error('Failed to fetch user info', err);
    }
}

function updateAvatar(user) {
    const avatarImg = document.getElementById('topBarAvatar');
    const userIcon = document.getElementById('topBarUserIcon');
    if (!avatarImg || !userIcon || !user) return;

    // Use thumbnail for top bar
    avatarImg.src = `/api/public/avatar/${user.id}?thumbnail=1`;
    
    avatarImg.onload = () => {
        avatarImg.style.display = 'block';
        userIcon.style.display = 'none';
    };
    
    avatarImg.onerror = () => {
        avatarImg.style.display = 'none';
        userIcon.style.display = 'block';
    };
}

function showUserActionSheet() {
    const user = currentUser;
    if (!user) return;

    const actionSheet = document.getElementById('actionSheet');
    const backdrop = document.getElementById('actionSheetBackdrop');
    const content = document.getElementById('actionSheetContent');

    content.innerHTML = `
        <div style="padding:15px; text-align:center; border-bottom:1px solid var(--bg-tertiary); font-weight:600; color:var(--text-primary); font-size: 16px;">
            ${user.username}${user.role === 'admin' ? ' (管理员)' : ''}
        </div>
        <div style="padding:20px; text-align:center; border-bottom:1px solid var(--bg-tertiary); font-size:16px;" id="mobileEditUserBtn">修改用户信息</div>
        ${user.role === 'admin' ? '<div style="padding:20px; text-align:center; border-bottom:1px solid var(--bg-tertiary); font-size:16px;" id="mobileAdminBtn">进入后台管理</div>' : ''}
        <div style="padding:20px; text-align:center; font-size:16px; color:var(--danger-color);" id="mobileLogoutBtn">退出登录</div>
    `;

    document.getElementById('mobileEditUserBtn').addEventListener('click', openMobileUserEditor);
    if (user.role === 'admin') {
        document.getElementById('mobileAdminBtn').addEventListener('click', () => {
            location.href = '/Admin';
        });
    }
    document.getElementById('mobileLogoutBtn').addEventListener('click', handleLogout);

    backdrop.classList.add('active');
    actionSheet.style.transform = 'translateY(0)';
    actionSheet.classList.add('active');
}

async function openMobileUserEditor() {
    try {
        const userEditor = await getUserEditor();
        if (userEditor && currentUser) {
            userEditor.open({
                userId: currentUser.id,
                username: currentUser.username,
                role: currentUser.role,
                is_online: true,
                isSelf: true,
                isAdminContext: false,
                onSuccess: (data) => {
                    // The editor returns { userId, username, avatarTimestamp }
                    if (currentUser.id === data.userId) {
                        currentUser.username = data.username;
                        updateAvatar(currentUser);
                    }
                }
            });
        }
    } catch (error) {
        console.error('Failed to open user editor:', error);
    }
    closeActionSheet();
}

async function handleLogout() {
    try {
        await fetch('/auth/logout', { method: 'POST' });
        location.href = '/Login';
    } catch (err) {
        showToast('退出失败', 'error');
    }
}

function escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, function(m) {
        switch (m) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            case "'": return '&#039;';
            default: return m;
        }
    });
}
