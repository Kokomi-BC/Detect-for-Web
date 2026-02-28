// Mobile Logic for AI Detective

// --- API Mock ---
window.api = {
    invoke: async (channel, ...args) => {
        let signal = null;
        if (args.length > 0 && args[args.length - 1] instanceof AbortSignal) {
            signal = args.pop();
        }

        try {
            const response = await fetch('/api/invoke', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ channel: channel, args }),
                signal: signal
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
            if (err.name === 'AbortError') {
                console.log(`API Invoke Aborted (${channel})`);
                throw new Error('Aborted');
            }
            console.error(`API Invoke Error (${channel}):`, err);
            throw err;
        }
    }
};

// --- Constants ---
const UI_CLOSE_SVG = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display: block;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

// --- State ---
let uploadedImages = [];
window._lastImageThumbEl = null;
window.currentMode = 'input'; // input, result
let isInputFullscreen = false;
let allHistory = [];
let lastBackPress = 0;
let pendingConflict = null;

// Image Interaction State
let imageScale = 1;
let imageRotation = 0;
let imageX = 0;
let imageY = 0;
const ROTATION_INTENT_THRESHOLD = 18;

let mobileStatusTimeout = null;
let searchStartTime = 0;
let analysisStageStartTime = 0;
const STAGE_MIN_DISPLAY_MS = 2000;
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
            const script = document.createElement('script');
            script.type = 'module';
            script.src = '/js/export-manager.js';
            script.onload = () => resolve(window.exportManager);
            script.onerror = () => reject(new Error('Export manager load failed'));
            document.head.appendChild(script);
        }).finally(() => {
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
            script.onerror = () => reject(new Error('User editor load failed'));
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
let textInput, detectBtn, detectBtnLabel, plusBtn, fileInput, docInput, previewImages, historyBtn, userBtn, exitEditBtn, exitResultBtn, exportBtn, headerTitle, inputCard, extractedContentArea, startBranding, clearBtn;
let actionSheet, actionSheetBackdrop, exportActionSheet, exportActionSheetBackdrop;

function initElements() {
    textInput = document.getElementById('textInput');
    detectBtn = document.getElementById('detectBtn');
    detectBtnLabel = document.getElementById('detectBtnLabel');
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
    initImageTouchHandlers();
    
    // Bind static elements for Mobile.html
    const bind = (id, fn) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', fn);
    };

    bind('closeActionSheetBtn', closeActionSheet);
    bind('actionSheetBackdrop', () => window.history.back());
    bind('historyDrawerBackdrop', () => window.history.back());
    bind('closeImageModalBtn', () => window.history.back());
    
    const closeBtn = document.getElementById('closeImageModalBtn');
    if (closeBtn) closeBtn.innerHTML = UI_CLOSE_SVG;

    // Bind Exit Buttons
    if (exitEditBtn) exitEditBtn.addEventListener('click', () => window.history.back());
    if (exitResultBtn) exitResultBtn.addEventListener('click', () => window.history.back());
    
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
        // 点击背景关闭图片预览
        if (e.target.id === 'imageModal') {
            // 防抖：如果模态框已经不是 active 状态，不再触发 back
            const modal = document.getElementById('imageModal');
            if (modal && modal.classList.contains('active')) {
                window.history.back();
            }
        }
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
});

// 实时状态检测工具 (全局)
const getOverlayActive = () => {
    const els = ['imageModal', 'confirmModal', 'conflictModal'];
    let active = els.some(id => {
        const el = document.getElementById(id);
        return el && (el.style.display === 'flex' || el.style.display === 'block' || el.classList.contains('active'));
    });
    
    // Check known overlay classes
    const classes = ['customTooltip', 'historyDrawer', 'actionSheet', 'exportActionSheet'];
    active = active || classes.some(id => {
        const el = document.getElementById(id);
        return el && el.classList.contains('active');
    });
    return active;
};

function setupNavigation() {
    let exitCount = 0;
    let exitTimer = null;

    window._pushHybridHash = (view, overlay = null) => {
        let path = '/Mobile';
        if (view === 'result') {
            path += overlay ? `/result/${overlay}` : '/result';
        } else if (view === 'edit') {
            path += overlay ? `/edit/${overlay}` : '/edit';
        } else {
            // Home/Input mode
            path += overlay ? `/${overlay}` : '';
        }

        if (window.location.pathname !== path) {
            window.history.pushState({ page: 'home', initialized: true }, '', path);
        }
    };

    window.closeAllOverlays = (noPush = false) => {
        // 1. 关闭图片预览
        const imageModal = document.getElementById('imageModal');
        const modalImg = document.getElementById('modalImage');
        if (imageModal && imageModal.classList.contains('active')) {
            imageModal.classList.remove('active');
            
            if (modalImg) {
                // Normalize rotation to prevent wild spinning back to 0
                let currentRot = imageRotation;
                let normalizedRot = currentRot % 360;
                if (normalizedRot > 180) normalizedRot -= 360;
                if (normalizedRot < -180) normalizedRot += 360;
                
                if (currentRot !== normalizedRot) {
                    modalImg.style.transition = 'none';
                    modalImg.style.transform = `translate(${imageX}px, ${imageY}px) scale(${imageScale}) rotate(${normalizedRot}deg)`;
                    modalImg.offsetHeight; // force reflow
                }

                if (window._lastImageThumbEl) {
                    // 两阶段关闭动画：先移动到缩略图位置，再执行自动裁剪与淡出
                    const moveDuration = 320;
                    const cropDuration = 140;
                    const t = getThumbnailTransform(window._lastImageThumbEl);

                    // Phase 1: 仅位移/缩放到目标位置（不裁剪）
                    modalImg.style.transition = `transform ${moveDuration}ms cubic-bezier(0.32, 0.72, 0, 1)`;
                    modalImg.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.scale}) rotate(0deg)`;
                    modalImg.style.clipPath = 'inset(0% 0% 0% 0% round 0px)';
                    modalImg.style.webkitClipPath = 'inset(0% 0% 0% 0% round 0px)';
                    modalImg.style.opacity = '1';

                    // Phase 2: 到位后再裁剪并淡出
                    setTimeout(() => {
                        if (imageModal.classList.contains('active')) return;
                        modalImg.style.transition = `clip-path ${cropDuration}ms cubic-bezier(0.32, 0.72, 0, 1), -webkit-clip-path ${cropDuration}ms cubic-bezier(0.32, 0.72, 0, 1), opacity ${cropDuration}ms ease-in`;
                        modalImg.style.clipPath = t.clip;
                        modalImg.style.webkitClipPath = t.clip;
                        modalImg.style.opacity = '0';
                    }, moveDuration);
                } else {
                    modalImg.style.transition = 'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.3s ease-out';
                    // If transformed, just fade out and scale down slightly
                    modalImg.style.transform = `translate(${imageX}px, ${imageY}px) scale(${imageScale * 0.8}) rotate(${normalizedRot}deg)`;
                    modalImg.style.opacity = '0';
                }
            }

            // 如果路径包含子状态且不是 popstate 触发的，则后退
            if (!noPush) {
                const relPath = window.location.pathname.replace('/Mobile', '').replace(/^\//, '');
                if (relPath.includes('/') || ['image', 'plus-menu', 'user-menu', 'export-menu', 'menu', 'history', 'user-edit'].includes(relPath)) {
                    window.history.back();
                }
            }

            // 等待动画结束后隐藏
            setTimeout(() => {
                if (!imageModal.classList.contains('active')) {
                    imageModal.style.display = 'none';
                    if (modalImg) {
                        modalImg.style.transform = '';
                        modalImg.style.transition = '';
                        modalImg.style.clipPath = '';
                        modalImg.style.webkitClipPath = '';
                        modalImg.style.opacity = '1';
                        // 重置尺寸锁定，为下一次进入做准备
                        modalImg.style.width = '';
                        modalImg.style.height = '';
                        modalImg.style.maxWidth = '';
                        modalImg.style.maxHeight = '';
                    }
                }
            }, 520);
        }

        // 2. 关闭 Tooltip
        const tooltip = document.getElementById('customTooltip');
        if (tooltip && tooltip.classList.contains('active')) {
            hideTooltip(true);
        }

        // 3. 关闭用户信息编辑 (User Editor)
        const userEditModal = document.getElementById('user-edit-modal');
        if (userEditModal && userEditModal.classList.contains('active')) {
             userEditModal.classList.remove('active');
             setTimeout(() => { userEditModal.style.display = 'none'; }, 300);
             if (!noPush) {
                 const relPath = window.location.pathname.replace('/Mobile', '').replace(/^\//, '');
                 if (relPath.includes('user-edit')) {
                     window.history.back();
                 }
             }
        }

        // 4. 其他常规浮层
        if (document.getElementById('confirmModal')) closeConfirmModal();
        if (document.getElementById('conflictModal')) closeConflictModal();
        
        // 5. 抽屉式浮层
        if (typeof toggleHistory === 'function') toggleHistory(false, true);
        if (typeof closeActionSheet === 'function') closeActionSheet(true);
    };

    // 状态恢复函数：确保始终处于 home 运行态
    const resetToHomeState = () => {
        const currentPath = window.location.pathname;
        if (!window.history.state || window.history.state.page !== 'home' || !window.history.state.initialized) {
            window.history.pushState({ page: 'home', initialized: true }, '', currentPath);
        }
    };

    // 初始状态
    if (!window.history.state || !window.history.state.page) {
        window.history.replaceState({ page: 'home' }, '', window.location.pathname || '/Mobile');
    }

    // 延迟初始化堆栈 (基础防御，防止误触退出)
    const initNavigationStack = () => {
        if (window.history.state && window.history.state.initialized) return;
        
        try {
            const currentPath = window.location.pathname;
            window.history.replaceState({ page: 'base', initialized: true }, '', '/Mobile/base');
            window.history.pushState({ page: 'stable', initialized: true }, '', '/Mobile/stable');
            window.history.pushState({ page: 'home', initialized: true }, '', currentPath);
            console.log('Navigation stack initialized');
        } catch (e) {
            console.warn('Failed to initialize navigation stack:', e);
        }
        
        window.removeEventListener('touchstart', initNavigationStack);
        window.removeEventListener('mousedown', initNavigationStack);
    };

    window.addEventListener('touchstart', initNavigationStack, { passive: true });
    window.addEventListener('mousedown', initNavigationStack, { passive: true });

    window.addEventListener('popstate', (event) => {
        if (!window.history.state || !window.history.state.initialized) return;

        const fullPath = window.location.pathname;
        console.log('Popstate detected, current path:', fullPath);

        // 解析复合路径: /Mobile/view/overlay
        const relPath = fullPath.replace('/Mobile', '').replace(/^\//, '');
        let targetView = '';
        let targetOverlay = '';
        
        if (relPath.includes('/')) {
            const parts = relPath.split('/');
            targetView = parts[0];
            targetOverlay = parts[1];
        } else if (['result', 'edit'].includes(relPath)) {
            targetView = relPath;
        } else {
            targetOverlay = relPath; // e.g. 'history', 'menu', or ''
        }

        // 1. 处理视图切换 (Base View)
        if (targetView === 'result') {
            if (window.currentMode !== 'result') showResultView(true);
        } else if (targetView === 'edit') {
            if (!isInputFullscreen) enterFullscreenInput(true);
        } else {
            // Home/Input 视图
            if (window.currentMode === 'result') showInputView(true);
            if (isInputFullscreen) exitFullscreenInput(true);
        }

        // 2. 处理覆盖层状态 (Overlay)
        // 先关闭所有，如果 path 里有 overlay 再打开
        window.closeAllOverlays(true);

        if (targetOverlay === 'history') {
            if (typeof toggleHistory === 'function') toggleHistory(true, true);
        } else if (targetOverlay === 'plus-menu') {
            if (typeof showPlusActionSheet === 'function') showPlusActionSheet(true);
        } else if (targetOverlay === 'user-menu') {
            if (typeof showUserActionSheet === 'function') showUserActionSheet(true);
        } else if (targetOverlay === 'export-menu') {
            if (typeof showExportActionSheet === 'function') showExportActionSheet(true);
        } else if (targetOverlay === 'tooltip') {
            // Tooltip state handling is usually by showing the last active highlight if needed, 
            // but for simplicity we just ensure it's closed in closeAllOverlays
        } else if (targetOverlay === 'image') {
            // 图片预览通常由点击触发，popstate 只能处理关闭逻辑（已由 closeAllOverlays 完成）
        } else if (targetOverlay === 'user-edit') {
            if (window.userEditor && typeof window.userEditor.open === 'function') {
                window.userEditor.open({
                    userId: currentUser?.id,
                    username: currentUser?.username,
                    role: currentUser?.role,
                    is_online: true,
                    isSelf: true,
                    noPush: true // 重要：popstate 触发的不要再 push
                });
            }
        }

        // 3. 关键拦截逻辑：只要由于返回动作进入了非 home 态（如 stable 或 base），就触发退出逻辑
        if (!event.state || event.state.page !== 'home') {
            
            // 实时检测并关闭浮层 (作为防御)
            if (getOverlayActive()) {
                closeAllOverlays(true);
                exitCount = 0; 
                resetToHomeState();
                return;
            }

            // 二次退出逻辑
            exitCount++;
            if (exitCount === 1) {
                showToast('再按一次返回键退出程序', 'info');
                resetToHomeState();

                if (exitTimer) clearTimeout(exitTimer);
                exitTimer = setTimeout(() => {
                    exitCount = 0;
                }, 2000);
            } else if (exitCount >= 2) {
                showToast('正在退出程序...', 'info');
                // 这里通常由系统接管退出
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
    // 基础防御：如果没有在检测中，不响应任何状态更新 (防止延迟的 SSE 或 Timer 导致 Toast 无法关闭)
    if (!document.body.classList.contains('is-detecting')) return;

    // If local extraction is happening, ignore SSE status updates to prevent flickering
    if (isExtracting) return;

    const elapsedInitMs = Date.now() - (analysisStageStartTime || 0);
    const shouldDelayInitTransition =
        analysisStageStartTime &&
        elapsedInitMs < STAGE_MIN_DISPLAY_MS &&
        (status === 'analyzing' || status === 'searching' || status === 'deep-analysis' || status === 'search-failed');

    if (shouldDelayInitTransition) {
        if (mobileStatusTimeout) {
            clearTimeout(mobileStatusTimeout);
        }
        const delay = STAGE_MIN_DISPLAY_MS - elapsedInitMs;
        mobileStatusTimeout = setTimeout(() => {
            mobileStatusTimeout = null;
            if (!document.body.classList.contains('is-detecting')) return;
            updateStatusUI(status, data);
        }, delay);

        const summaryDescText = document.getElementById('summaryDescText');
        if (summaryDescText && summaryDescText.textContent !== '正在初始化分析') {
            summaryDescText.textContent = '正在初始化分析';
        }
        showLoadingToast('正在初始化分析');
        return;
    }
    
    // Update global status to sync with backend
    if (status === 'extracting' || status === 'parsing') {
        currentAnalysisStatus = 'extracting';
    } else if (status === 'analyzing') {
        currentAnalysisStatus = 'analyzing';
    } else if (status === 'searching') {
        currentAnalysisStatus = 'searching';
    } else if (status === 'deep-analysis') {
        currentAnalysisStatus = 'deep-analysis';
    }
    
    // Ignore late extraction/parsing updates if we already moved on to analysis phase
    if ((status === 'extracting' || status === 'parsing') && currentAnalysisStatus !== 'initializing' && currentAnalysisStatus !== 'extracting') return;

    const summaryDescText = document.getElementById('summaryDescText');
    
    const applyMessage = (msg) => {
        const toastMsgEl = document.getElementById('toastMessage');
        // Check if message is actually different or toast is hidden
        if (summaryDescText && summaryDescText.textContent !== msg) {
            summaryDescText.textContent = msg;
        }
        
        // Only show toast if in input mode (detection running) or if explicit request
        if (currentMode === 'input' || detectBtn?.classList.contains('is-stop')) {
            if (toastMsgEl && toastMsgEl.textContent === msg && document.getElementById('loadingToast')?.classList.contains('active')) {
                return; // Skip repeated calls for same message
            }
            showLoadingToast(msg);
        }
    };

    let message = '';
    switch(status) {
        case 'extracting':
        case 'parsing':
            message = '正在解析网页';
            applyMessage(message);
            break;
        case 'analyzing':
            message = (analysisStageStartTime && (Date.now() - analysisStageStartTime) < STAGE_MIN_DISPLAY_MS)
                ? '正在初始化分析'
                : '进行初步分析中';
            applyMessage(message);
            break;
        case 'searching':
            if (mobileStatusTimeout) {
                clearTimeout(mobileStatusTimeout);
                mobileStatusTimeout = null;
            }
            searchStartTime = Date.now();
            let searchQuery = '';
            // Try effectively to find the search query in various possible locations
            if (data) {
                if (typeof data === 'string') {
                    searchQuery = data;
                } else {
                    searchQuery = String(
                        data.query ||
                        data.keyword ||
                        data.searchQuery ||
                        data.searchTerm ||
                        data.search_query ||  // Explicitly check snake_case which backend sends
                        (Array.isArray(data.keywords) ? data.keywords.join('、') : '') ||
                        ''
                    );
                }
            }
            searchQuery = searchQuery.trim();
            
            message = (searchQuery && searchQuery !== '...' && searchQuery !== 'undefined') ? `联网搜索：${searchQuery}` : '联网搜索中';
            applyMessage(message);
            break;
        case 'search-failed':
            message = '联网搜索失败，进行离线分析';
            applyMessage(message);
            break;
        case 'deep-analysis':
            message = '深度分析中';
            const elapsedSearchMs = Date.now() - (searchStartTime || 0);
            if (searchStartTime && elapsedSearchMs < STAGE_MIN_DISPLAY_MS) {
                if (mobileStatusTimeout) {
                    clearTimeout(mobileStatusTimeout);
                }
                const delay = STAGE_MIN_DISPLAY_MS - elapsedSearchMs;
                mobileStatusTimeout = setTimeout(() => {
                    mobileStatusTimeout = null;
                    if (!document.body.classList.contains('is-detecting')) return;
                    applyMessage(message);
                }, delay);
            } else {
                applyMessage(message);
            }
            break;
        default:
            message = '正在分析中';
            applyMessage(message);
    }
}

// Global helper to update Toast with "Dynamic Island" transition
let toastShowTime = 0;
let toastHideTimeout = null;
let toastMeasureEl = null;
const TOAST_CHINESE_CHAR_LIMIT = 17;

function getToastMeasureElement() {
    if (toastMeasureEl && document.body.contains(toastMeasureEl)) return toastMeasureEl;
    const el = document.createElement('span');
    el.style.position = 'fixed';
    el.style.left = '-99999px';
    el.style.top = '-99999px';
    el.style.visibility = 'hidden';
    el.style.whiteSpace = 'nowrap';
    el.style.pointerEvents = 'none';
    document.body.appendChild(el);
    toastMeasureEl = el;
    return el;
}

function applyMeasureFont(measureEl, referenceEl) {
    const fallback = window.getComputedStyle(document.body);
    const refStyle = referenceEl ? window.getComputedStyle(referenceEl) : fallback;
    measureEl.style.fontSize = refStyle.fontSize || fallback.fontSize;
    measureEl.style.fontWeight = refStyle.fontWeight || fallback.fontWeight;
    measureEl.style.fontFamily = refStyle.fontFamily || fallback.fontFamily;
    measureEl.style.letterSpacing = refStyle.letterSpacing || 'normal';
}

function measureTextWidth(text, referenceEl) {
    const measureEl = getToastMeasureElement();
    applyMeasureFont(measureEl, referenceEl);
    measureEl.textContent = text;
    return measureEl.getBoundingClientRect().width;
}

function truncateToastMessage(message, referenceEl = null, chineseChars = TOAST_CHINESE_CHAR_LIMIT) {
    const text = String(message || '');
    if (!text) return '';

    const visualLimit = measureTextWidth('测'.repeat(chineseChars), referenceEl);
    if (measureTextWidth(text, referenceEl) <= visualLimit) return text;

    const ellipsis = '...';
    const ellipsisWidth = measureTextWidth(ellipsis, referenceEl);
    if (ellipsisWidth >= visualLimit) return ellipsis;

    const chars = Array.from(text);
    let low = 0;
    let high = chars.length;
    let best = 0;

    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const candidate = chars.slice(0, mid).join('');
        const candidateWidth = measureTextWidth(candidate, referenceEl) + ellipsisWidth;

        if (candidateWidth <= visualLimit) {
            best = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    return chars.slice(0, best).join('') + ellipsis;
}

function setLoadingToastVisible(visible) {
    const toast = document.getElementById('loadingToast');
    if (!toast) return null;

    if (visible) {
        toast.style.visibility = 'visible';
        toast.style.transform = '';
        toast.style.opacity = '';
        toast.classList.add('active');
    } else {
        // 保持可见直到位移动画结束，避免“瞬间消失”
        toast.style.visibility = 'visible';
        toast.style.transform = '';
        toast.style.opacity = '';
        toast.classList.remove('active');
    }

    return toast;
}

function showLoadingToast(message) {
    if (toastHideTimeout) {
        clearTimeout(toastHideTimeout);
        toastHideTimeout = null;
    }

    const toast = document.getElementById('loadingToast');
    if (!toast) return;

    if (toast.classList.contains('active')) {
        setToastText(message);
    } else {
        // 入场初始化
        toast.style.transition = 'none'; 
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(-150%)';
        toast.style.visibility = 'visible';
        
        setToastText(message);
        
        // 测量并锁定宽度以防入场时跳变
        toast.style.width = 'auto';
        const targetWidth = toast.offsetWidth;
        toast.style.width = targetWidth + 'px';
        
        // 强制重绘
        toast.offsetHeight;
        
        // 恢复过渡并激活
        toast.style.transition = '';
        setLoadingToastVisible(true);
        
        // 清除内联样式，让 CSS class 控制动画
        toast.style.visibility = '';
    }
    toastShowTime = Date.now();
}

function hideLoadingToast() {
    const loadingToast = document.getElementById('loadingToast');
    if (mobileStatusTimeout) {
        clearTimeout(mobileStatusTimeout);
        mobileStatusTimeout = null;
    }
    if (!loadingToast) return;
    
    const minTime = 500;
    const elapsed = Date.now() - toastShowTime;
    const remaining = Math.max(0, minTime - elapsed);
    
    if (toastHideTimeout) clearTimeout(toastHideTimeout);
    
    toastHideTimeout = setTimeout(() => {
        setLoadingToastVisible(false);
        
        setTimeout(() => {
            if (!loadingToast.classList.contains('active')) {
                loadingToast.style.width = 'auto';
                loadingToast.style.visibility = '';
                toastHideTimeout = null;
            }
        }, 600); // 对应 CSS 0.6s 动画
    }, remaining);
}

function setToastText(message) {
    const toastMessage = document.getElementById('toastMessage');
    const loadingToast = document.getElementById('loadingToast');
    if (!toastMessage || !loadingToast) return;
    
    // 如果正在转换中且目标内容一致，或者内容已一致且没有处于隐藏状态，则跳过
    const normalizedMessage = truncateToastMessage(message, toastMessage, TOAST_CHINESE_CHAR_LIMIT);
    const isChanging = toastMessage.dataset.pendingMessage;
    if (isChanging === normalizedMessage) return;
    if (toastMessage.textContent === normalizedMessage && toastMessage.style.opacity !== '0') return;

    if (!loadingToast.classList.contains('active')) {
        toastMessage.textContent = normalizedMessage;
        toastMessage.dataset.pendingMessage = '';
        loadingToast.style.width = 'auto';
        return;
    }

    toastMessage.dataset.pendingMessage = normalizedMessage;
    const oldWidth = loadingToast.offsetWidth;
    toastMessage.style.opacity = '0';
    toastMessage.style.transform = 'translateY(4px)';

    setTimeout(() => {
        // 再次检查此时的目标消息是否依然是自己设置的，防止竞争
        if (toastMessage.dataset.pendingMessage !== normalizedMessage) return;

        toastMessage.textContent = normalizedMessage;
        toastMessage.dataset.pendingMessage = '';
        
        loadingToast.style.transition = 'none';
        loadingToast.style.width = 'auto';
        const newWidth = loadingToast.offsetWidth;

        loadingToast.style.width = oldWidth + 'px';
        loadingToast.offsetHeight;
        loadingToast.style.transition = '';

        requestAnimationFrame(() => {
            loadingToast.style.width = `${newWidth}px`;
        });

        toastMessage.style.opacity = '1';
        toastMessage.style.transform = 'translateY(0)';
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
function enterFullscreenInput(noPush = false) {
    if (window.currentMode === 'result') return;
    
    isInputFullscreen = true;
    inputCard.classList.add('fullscreen');
    
    // 状态管理
    if (!noPush) {
        window._pushHybridHash('edit');
    }

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
    if (bottomArea) {
        inputCard.appendChild(bottomArea);
        bottomArea.style.display = 'block';
        bottomArea.style.marginTop = 'auto';
    }
}

function exitFullscreenInput(noPush = false) {
    isInputFullscreen = false;
    inputCard.classList.remove('fullscreen');

    // 如果是通过手动点击（非 Popstate）返回，则尝试回到 Home 态
    if (!noPush && window.location.pathname.includes('/edit')) {
        window.history.back();
    }
    
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
    if (bottomArea) {
        document.getElementById('inputView').appendChild(bottomArea);
    }
}

function showResultView(noPush = false, replace = false) {
    window.currentMode = 'result';
    document.getElementById('inputView').classList.remove('active');
    document.getElementById('resultView').classList.add('active');
    
    // 状态管理
    if (!noPush) {
        if (replace) {
            window.history.replaceState({ page: 'home', initialized: true }, '', '/Mobile/result');
        } else {
            window._pushHybridHash('result');
        }
    }

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
    
    if (isInputFullscreen) exitFullscreenInput(true);
}

function showInputView(noPush = false) {
    window.currentMode = 'input';
    document.getElementById('resultView').classList.remove('active');
    document.getElementById('inputView').classList.add('active');
    
    // 状态管理：显式切回 Home
    if (!noPush) {
        if (window.location.pathname !== '/Mobile') {
            window.history.pushState({ page: 'home', initialized: true }, '', '/Mobile');
        }
    }

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
async function performRealExtraction(progressCallback, startVal = 0) {
    if (!currentExtractedData || !currentExtractedData.pendingExtraction) return true;
    
    // Check global lock
    if (window._isExtractingNow) return true;
    window._isExtractingNow = true;

    const url = currentExtractedData.url;
    let extInterval = null;
    
    try {
        // Start extraction progress simulation if callback provided
        let extProgress = startVal;
        extInterval = setInterval(() => {
            if (extProgress < 40) {
                 extProgress += 0.5; // Slower extraction progress simulation
                 if (progressCallback) progressCallback(extProgress, '正在解析网页内容');
            }
        }, 150);

        const result = await window.api.invoke('extract-content-sync', url, _abortController?.signal);
        
        if (extInterval) clearInterval(extInterval);
        window._isExtractingNow = false;

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
        if (extInterval) clearInterval(extInterval);
        window._isExtractingNow = false;
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
            setToastText('正在停止');
            _abortController.abort();
        }
        window.api.invoke('cancel-extraction').catch((err) => {
            console.warn('Cancel extraction request failed:', err);
        });
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
    if (detectBtnLabel) {
        detectBtnLabel.textContent = '停止检测';
    } else {
        detectBtn.textContent = '停止检测';
    }
    document.body.classList.add('is-detecting');
    
    _abortController = new AbortController();
    currentAnalysisStatus = 'initializing';
    analysisStageStartTime = Date.now();
    searchStartTime = 0;
    
    const progressBar = document.getElementById('progressBar');
    const progressContainer = document.getElementById('progressBarContainer');
    const setDetectProgress = (value) => {
        const safeVal = Math.max(0, Math.min(100, Number(value) || 0));
        if (progressBar) progressBar.style.width = safeVal + '%';
        if (detectBtn) detectBtn.style.setProperty('--detect-progress', safeVal + '%');
    };
    const animateProgressTo = (target, durationMs = 1000) => new Promise((resolve) => {
        const start = performance.now();
        const from = Math.max(0, Math.min(100, progress));
        const to = Math.max(from, Math.min(100, target));

        const step = (now) => {
            const t = Math.min(1, (now - start) / durationMs);
            const eased = 1 - Math.pow(1 - t, 2);
            progress = from + (to - from) * eased;
            setDetectProgress(progress);
            if (t < 1) {
                requestAnimationFrame(step);
            } else {
                progress = to;
                setDetectProgress(progress);
                resolve();
            }
        };

        requestAnimationFrame(step);
    });

    showLoadingToast('正在初始化分析');
    if (progressContainer) progressContainer.style.display = 'block';
    
    // --- Progress Bar Logic ---
    let progress = 0;
    setDetectProgress(0);
    const stageTargets = {
        initializing: 50,
        analyzing: 50,
        searching: 92,
        'deep-analysis': 92
    };
    const stageSpeedPerSecond = {
        initializing: 1.2,
        analyzing: 1.2,
        searching: 0.72,
        'deep-analysis': 0.72
    };
    const fallbackTimeline = {
        toAnalyzing: STAGE_MIN_DISPLAY_MS
    };
    const detectionStartAt = Date.now();
    let lastTickAt = Date.now();

    const progressInterval = setInterval(() => {
        if (isExtracting) {
            lastTickAt = Date.now();
            return;
        }

        const now = Date.now();
        const elapsedMs = now - detectionStartAt;
        const deltaSeconds = Math.max(0, (now - lastTickAt) / 1000);
        lastTickAt = now;

        // Fallback only when backend status hasn't advanced yet
        if (currentAnalysisStatus === 'initializing' && elapsedMs >= fallbackTimeline.toAnalyzing) {
            updateStatusUI('analyzing');
        }

        const targetMax = stageTargets[currentAnalysisStatus] || stageTargets.initializing;
        const speed = stageSpeedPerSecond[currentAnalysisStatus] || stageSpeedPerSecond.initializing;

        if (progress < targetMax) {
            const remaining = targetMax - progress;
            const step = Math.min(remaining, speed * deltaSeconds);
            progress += step;
            setDetectProgress(Math.min(progress, 91));
        } else if (currentAnalysisStatus === 'analyzing' && progress >= stageTargets.analyzing) {
            const lowSpeedCap = 56;
            if (progress < lowSpeedCap) {
                const lowSpeedStep = Math.min(lowSpeedCap - progress, 0.08 * deltaSeconds);
                progress += lowSpeedStep;
                setDetectProgress(Math.min(progress, 91));
            }
        }
    }, 120);

    try {
        // 1. Check if we need to extract content FIRST
        if (currentExtractedData && currentExtractedData.pendingExtraction) {
             isExtracting = true;
             // Manually drive progress for extraction phase (starting from current progress)
             await performRealExtraction((val, msg) => {
                 progress = val;
                 setDetectProgress(progress);
                 setToastText(msg);
             }, progress);
             isExtracting = false;
             
             currentAnalysisStatus = 'analyzing';
             setToastText('正在分析中');
        }

        if (_abortController.signal.aborted) throw new Error('Aborted');

        // 2. Run Analysis
        const analysisText = (currentExtractedData && currentExtractedData.content) ? currentExtractedData.content : text;
        
        // 合并用户上传图片与网页提取图片
        const finalImages = [...images];
        if (currentExtractedData && currentExtractedData.images) {
             currentExtractedData.images.forEach(img => {
                 const imgUrl = typeof img === 'string' ? img : img.url;
                 if (imgUrl && !finalImages.includes(imgUrl)) finalImages.push(imgUrl);
             });
        }

        const data = await window.api.invoke('analyze-content', { 
            text: analysisText, 
            imageUrls: finalImages,
            url: url
        }, _abortController?.signal);

        if (_abortController.signal.aborted) throw new Error('Aborted');
        
        // Finish
        clearInterval(progressInterval);
        setToastText('分析完成');
        await animateProgressTo(100, 1000);

        // Save history
        const historyItem = {
             id: Date.now().toString(),
             timestamp: new Date().toISOString(),
             content: analysisText || (url ? currentExtractedData.title : (finalImages.length > 0 ? '[图片分析]' : '未知内容')),
             images: finalImages,
             result: data,
             url: url,
             originalInput: url || text 
        };
        await window.api.invoke('save-history', historyItem);
        loadHistory();
        
        showResult(data, analysisText, finalImages, url);
        showResultView();
        
    } catch (e) {
        clearInterval(progressInterval);
        if (e.message === 'Aborted') {
            showToast('检测已停止', 'info');
        } else {
            console.error(e);
            showToast('检测失败: ' + e.message, 'error');
        }
    } finally {
        clearInterval(progressInterval);
        if (mobileStatusTimeout) {
            clearTimeout(mobileStatusTimeout);
            mobileStatusTimeout = null;
        }
        isExtracting = false;
        window._isExtractingNow = false;
        
        detectBtn.classList.remove('is-stop');
        detectBtn.disabled = false;
        if (detectBtnLabel) {
            detectBtnLabel.textContent = originalText;
        } else {
            detectBtn.textContent = originalText;
        }
        document.body.classList.remove('is-detecting');
        
        hideLoadingToast();
        if (progressContainer) {
            setTimeout(() => {
                progressContainer.style.display = 'none';
                setDetectProgress(0);
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
    if (type === 'error' || type === 'fail' || type === 'success') {
        hideLoadingToast();
    }
    const existing = document.querySelectorAll('.custom-toast:not(.is-loading)');
    existing.forEach(t => t.remove());

    const toast = document.createElement('div');
    toast.className = 'custom-toast';
    toast.style.position = 'fixed';
    toast.style.bottom = '120px';
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
    toast.textContent = truncateToastMessage(message, toast, TOAST_CHINESE_CHAR_LIMIT);
    
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
        showPlusActionSheet();
    });

    if (exportBtn) {
        exportBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showExportActionSheet();
        });
    }

    // Bind Export Options (these are static in Mobile.html)
    document.querySelectorAll('.export-option').forEach(btn => {
        btn.addEventListener('click', async () => {
            const format = btn.getAttribute('data-format');
            // Close by going back
            window.history.back();
            
            try {
                const exportManager = await getExportManager();
                if (exportManager) {
                    await exportManager.exportResult(format);
                }
            } catch (e) {
                console.error('Failed to load export manager:', e);
                showToast('导出模块加载失败', 'error');
            }
        });
    });

    document.getElementById('closeActionSheetBtn')?.addEventListener('click', () => window.history.back());
    document.getElementById('closeExportActionSheetBtn')?.addEventListener('click', () => window.history.back());
}

function showPlusActionSheet(noPush = false) {
    if (!noPush) {
        window._pushHybridHash(window.currentMode, 'plus-menu');
    }

    const actionSheet = document.getElementById('actionSheet');
    const backdrop = document.getElementById('actionSheetBackdrop');
    const content = document.getElementById('actionSheetContent');

    content.innerHTML = `
        <div style="padding:20px; text-align:center; border-bottom:1px solid var(--bg-tertiary); font-size:16px;" id="uploadImageBtn">添加图片</div>
        <div style="padding:20px; text-align:center; border-bottom:1px solid var(--bg-tertiary); font-size:16px;" id="uploadDocBtn">上传文档</div>
    `;

    document.getElementById('uploadImageBtn').addEventListener('click', triggerImageUpload);
    document.getElementById('uploadDocBtn').addEventListener('click', triggerFileUpload);

    backdrop.classList.add('active');
    actionSheet.classList.add('active');
    actionSheet.style.transform = 'translateY(0)';
}

function showExportActionSheet(noPush = false) {
    if (!noPush) {
        window._pushHybridHash(window.currentMode, 'export-menu');
    }

    const exportSheet = document.getElementById('exportActionSheet');
    const backdrop = document.getElementById('actionSheetBackdrop');

    backdrop.classList.add('active');
    exportSheet.classList.add('active');
    exportSheet.style.transform = 'translateY(0)';
}

function closeActionSheet(noPush = false) {
    const backdrop = document.getElementById('actionSheetBackdrop');
    const actionSheet = document.getElementById('actionSheet');
    const exportSheet = document.getElementById('exportActionSheet');

    if (!noPush) {
        const path = window.location.pathname;
        if (path.includes('plus-menu') || path.includes('user-menu') || path.includes('export-menu')) {
            window.history.back();
        }
    }

    backdrop.classList.remove('active');
    if (actionSheet) {
        actionSheet.classList.remove('active');
        actionSheet.style.transform = 'translateY(100%)';
    }
    if (exportSheet) {
        exportSheet.classList.remove('active');
        exportSheet.style.transform = 'translateY(100%)';
    }
    hideTooltip(noPush);
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
        div.addEventListener('click', (e) => {
            previewImage(img.url, e.currentTarget);
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

function previewImage(url, sourceEl) {
    openImageModal(url, sourceEl);
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

function toggleHistory(show, noPush = false) {
    const backdrop = document.getElementById('historyDrawerBackdrop');
    const drawer = document.getElementById('historyDrawer');
    if (show) {
        if (!noPush) {
            window._pushHybridHash(window.currentMode, 'history');
        }
        backdrop.style.display = 'block';
        setTimeout(() => {
            backdrop.classList.add('active');
            drawer.classList.add('active');
        }, 10);
    } else {
        if (!noPush && (window.location.pathname.includes('history'))) {
            window.history.back();
        }
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
    showResultView(false, true); // Use replace to allow one-back to home
    closeActionSheet(true);
    toggleHistory(false, true);
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
                item.onclick = (e) => openImageModal(displaySrc, e.currentTarget);
                container.appendChild(item);
            });
            parsedImages.appendChild(container);
        }
    }
}

function initImageTouchHandlers() {
    const modal = document.getElementById('imageModal');
    const modalImg = document.getElementById('modalImage');
    if (!modal || !modalImg) return;

    let initialDist = 0;
    let initialAngle = 0;
    let isPinching = false;
    let isDragging = false;
    let baseScale = 1;
    let baseRotation = 0;
    let lastTouchX = 0;
    let lastTouchY = 0;
    let initialMidX = 0;
    let initialMidY = 0;
    let baseImageX = 0;
    let baseImageY = 0;
    let lastPinchAngle = 0;
    let accumulatedAngleDiff = 0;

    const normalizeAngleDelta = (delta) => {
        let next = delta;
        while (next > 180) next -= 360;
        while (next < -180) next += 360;
        return next;
    };

    const normalizeAbsoluteAngle = (angle) => {
        let next = angle;
        while (next > 180) next -= 360;
        while (next < -180) next += 360;
        return next;
    };

    const getImageRenderMetrics = () => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        
        // 核心改进：直接使用当前锁定的基础像素尺寸，不再内部重复计算 fitScale
        const baseW = modalImg.offsetWidth || vw;
        const baseH = modalImg.offsetHeight || vh;
        
        let transformedW = baseW * imageScale;
        let transformedH = baseH * imageScale;

        // 核心修复：平滑边界计算 (基于旋转包围盒)
        const rad = Math.abs(imageRotation) * Math.PI / 180;
        const cos = Math.abs(Math.cos(rad));
        const sin = Math.abs(Math.sin(rad));
        
        const boundingW = transformedW * cos + transformedH * sin;
        const boundingH = transformedW * sin + transformedH * cos;

        return { vw, vh, transformedW: boundingW, transformedH: boundingH };
    };

    const clampImagePosition = (animate = false) => {
        const { vw, vh, transformedW, transformedH } = getImageRenderMetrics();
        const maxX = Math.max(0, (transformedW - vw) / 2);
        const maxY = Math.max(0, (transformedH - vh) / 2);

        let changed = false;
        
        const nextX = Math.min(maxX, Math.max(-maxX, imageX));
        if (nextX !== imageX) {
            imageX = nextX;
            changed = true;
        }

        const nextY = Math.min(maxY, Math.max(-maxY, imageY));
        if (nextY !== imageY) {
            imageY = nextY;
            changed = true;
        }

        if (maxX === 0 && imageX !== 0) {
            imageX = 0;
            changed = true;
        }
        
        if (maxY === 0 && imageY !== 0) {
            imageY = 0;
            changed = true;
        }

        if (changed) {
            if (animate) {
                modalImg.style.transition = 'transform 0.35s cubic-bezier(0.2, 0, 0.2, 1)';
            }
            updateImageTransform();
            if (animate) {
                setTimeout(() => {
                    modalImg.style.transition = 'transform 0.1s ease-out';
                }, 350);
            }
        }

        return { maxX, maxY };
    };

    const getDist = (t1, t2) => Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    const getAngle = (t1, t2) => Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX) * 180 / Math.PI;

    modal.addEventListener('touchstart', (e) => {
        if (!modal.classList.contains('active')) return;
        if (e.touches.length === 2) {
            isPinching = true;
            isDragging = false; // Disable dragging when pinching
            initialDist = getDist(e.touches[0], e.touches[1]);
            initialAngle = getAngle(e.touches[0], e.touches[1]);
            lastPinchAngle = initialAngle;
            accumulatedAngleDiff = 0;
            baseScale = imageScale;
            baseRotation = imageRotation;
            modalImg.style.transition = 'none';
            
            // 记录捏合中心点相对于屏幕中心的初始坐标
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            initialMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - vw / 2;
            initialMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - vh / 2;
            baseImageX = imageX;
            baseImageY = imageY;
            
            e.preventDefault();
        } else if (e.touches.length === 1) {
            isDragging = true;
            isPinching = false;
            lastTouchX = e.touches[0].clientX;
            lastTouchY = e.touches[0].clientY;
        }
    }, { passive: false });

    modal.addEventListener('touchmove', (e) => {
        if (!modal.classList.contains('active')) return;
        if (isPinching && e.touches.length === 2) {
            e.preventDefault();
            const dist = getDist(e.touches[0], e.touches[1]);
            const angle = getAngle(e.touches[0], e.touches[1]);
            
            // 灵敏度设置
            const sensitivity = 1.25;
            const distRatio = initialDist > 0 ? (dist / initialDist) : 1;
            const newScale = Math.min(Math.max(0.2, baseScale * Math.pow(distRatio, sensitivity)), 12);
            
            // 旋转增量解包：跨越 ±180° 时避免出现大幅突跳导致的多次旋转
            const stepAngleDiff = normalizeAngleDelta(angle - lastPinchAngle);
            accumulatedAngleDiff += stepAngleDiff;
            lastPinchAngle = angle;

            let newRotation = baseRotation + (accumulatedAngleDiff * sensitivity);
            // 保持角度在稳定区间，避免长时间旋转后数值过大造成精度抖动
            newRotation = normalizeAbsoluteAngle(newRotation);
            
            // 计算当前捏合中心点
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const currentMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - vw / 2;
            const currentMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - vh / 2;

            // 以手指为中心点进行缩放与旋转的位移补偿
            // 1. 计算初始中心点相对于图片偏移的向量
            const dx = initialMidX - baseImageX;
            const dy = initialMidY - baseImageY;
            
            // 2. 根据缩放比例和角度变化量旋转该向量
            const scaleRatio = newScale / baseScale;
            const deltaRotRad = (newRotation - baseRotation) * Math.PI / 180;
            const cos = Math.cos(deltaRotRad);
            const sin = Math.sin(deltaRotRad);
            
            const shiftedDx = (dx * cos - dy * sin) * scaleRatio;
            const shiftedDy = (dx * sin + dy * cos) * scaleRatio;
            
            // 3. 更新图片位置，使得图片上的同一点依然在当前捏合中心下方
            imageX = currentMidX - shiftedDx;
            imageY = currentMidY - shiftedDy;
            imageScale = newScale;
            imageRotation = newRotation;
            
            updateImageTransform();
            // 旋转/缩放过程中不做硬性边界夹取，避免高频重排导致卡顿与“卡住”
        } else if (isDragging && e.touches.length === 1) {
            const touch = e.touches[0];
            const { vw, vh, transformedW, transformedH } = getImageRenderMetrics();
            const maxX = Math.max(0, (transformedW - vw) / 2);
            const maxY = Math.max(0, (transformedH - vh) / 2);

            // 跟手系数：默认 1:1，越过边界时设为 0.3 阻尼
            let resistX = 1;
            let resistY = 1;
            
            if (Math.abs(imageX) > maxX) resistX = 0.3;
            if (Math.abs(imageY) > maxY) resistY = 0.3;

            const deltaX = (touch.clientX - lastTouchX) * resistX;
            const deltaY = (touch.clientY - lastTouchY) * resistY;
            
            imageX += deltaX;
            imageY += deltaY;

            // 1. 向下滑动增加额外缩小逻辑 (保持跟手，用于关闭提示)
            // 只有当图片高度方向没有超出屏幕（即 maxY=0）或者是已经拉到顶端还往下拉时触发
            if (imageY > maxY && imageScale <= 1.2) {
                const pullDistance = imageY - maxY;
                // 增加缩小幅度：0.8 -> 1.2
                const shrinkFactor = Math.max(0.6, 1 - (pullDistance / vh) * 1.2);
                imageScale = 1 * shrinkFactor;
            }
            
            lastTouchX = touch.clientX;
            lastTouchY = touch.clientY;
            
            updateImageTransform();
            e.preventDefault();
        }
    }, { passive: false });

    modal.addEventListener('touchend', (e) => {
        if (!modal.classList.contains('active')) return;
        const winH = window.innerHeight;
        const winW = window.innerWidth;

        if (e.touches.length < 2) {
            if (isPinching) {
                isPinching = false;
                // 手动缩放极其小时直接关闭
                if (imageScale < 0.45) return window.history.back();

                // 统一弹性回正逻辑
                const snappedRotation = Math.round(imageRotation / 90) * 90;
                const rotationDelta = Math.abs(snappedRotation - imageRotation);
                const shouldSnapRotation = rotationDelta >= ROTATION_INTENT_THRESHOLD;

                if (imageScale < 1) {
                    settleImageToNaturalSize(snappedRotation, 420);
                } else if (shouldSnapRotation) {
                    settleImageToNaturalSize(snappedRotation, 420);
                } else {
                    // 未发生有效旋转时，保持当前缩放级别，避免放大后松手被自动缩小
                    imageRotation = snappedRotation;
                    clampImagePosition(true);
                }
            }
        }

        if (e.touches.length === 0) {
            if (isDragging) {
                isDragging = false;
                const { vh, transformedH, transformedW, vw } = getImageRenderMetrics();
                const maxY = Math.max(0, (transformedH - vh) / 2);
                const maxX = Math.max(0, (transformedW - vw) / 2);

                const heavyMoveDown = imageY > winH * 0.12;
                const outOfBounds = Math.abs(imageX) > maxX || Math.abs(imageY) > maxY || imageScale < 1;
                const heavyMoveOut = Math.abs(imageX) > winW * 0.4 || Math.abs(imageY) > winH * 0.4;

                // 下滑退出判定
                if (heavyMoveDown && (imageScale <= 1.05 || (imageScale <= 2.2 && imageY > winH * 0.2))) {
                    return window.history.back();
                }

                // 强制回弹判定
                if (heavyMoveOut || outOfBounds) {
                    imageScale = Math.max(1, imageScale);
                    imageY = maxY === 0 ? 0 : Math.min(maxY, Math.max(-maxY, imageY));
                    imageX = maxX === 0 ? 0 : Math.min(maxX, Math.max(-maxX, imageX));

                    const currentSnapped = Math.round(imageRotation / 90) * 90;
                    const dragRotationDelta = Math.abs(currentSnapped - imageRotation);
                    const dragShouldSnapRotation = dragRotationDelta >= ROTATION_INTENT_THRESHOLD;

                    if (dragShouldSnapRotation) {
                        settleImageToNaturalSize(currentSnapped, 420);
                    } else {
                        imageRotation = currentSnapped;
                        modalImg.style.transition = 'transform 0.4s cubic-bezier(0.2, 0, 0.2, 1)';
                        updateImageTransform();
                        setTimeout(() => {
                            if (!modal.classList.contains('active')) return;
                            modalImg.style.transition = 'transform 0.1s ease-out';
                        }, 400);
                    }
                } else {
                    clampImagePosition(true); // 仅微调 X 轴对齐
                }
            }
        }
    });

    modal.addEventListener('touchcancel', () => {
        if (!modal.classList.contains('active')) return;
        isPinching = false;
        isDragging = false;
        imageRotation = normalizeAbsoluteAngle(imageRotation);
        clampImagePosition(true);
    }, { passive: true });

    // Handle mouse wheel for desktop preview testing if needed
    modal.addEventListener('wheel', (e) => {
        if (modal.classList.contains('active')) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            imageScale *= delta;
            imageScale = Math.min(Math.max(0.1, imageScale), 10);
            updateImageTransform();
        }
    }, { passive: false });
}

function updateImageTransform() {
    const modalImg = document.getElementById('modalImage');
    if (!modalImg) return;
    // 基础 transform 更新。不再在此处动态更改 maxWidth/maxHeight 以避免旋转时的布局跳动。
    // 布局尺寸已在 openImageModal 中锁定。
    modalImg.style.transform = `translate(${imageX}px, ${imageY}px) scale(${imageScale}) rotate(${imageRotation}deg)`;
}

function getThumbnailTransform(thumbEl) {
    if (!thumbEl) return { x: 0, y: 0, scale: 0.3, clip: 'inset(0%)' };
    const rect = thumbEl.getBoundingClientRect();
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    
    // 计算缩放比例：尝试获取大图的实际渲染尺寸
    const modalImg = document.getElementById('modalImage');
    const imgW = (modalImg && modalImg.naturalWidth > 0) ? modalImg.naturalWidth : (modalImg ? modalImg.offsetWidth : winW);
    const imgH = (modalImg && modalImg.naturalHeight > 0) ? modalImg.naturalHeight : (modalImg ? modalImg.offsetHeight : winH);
    
    // 我们希望大图缩放到能恰好“覆盖”缩略图的尺寸（类似 object-fit: cover）
    const scaleX = rect.width / imgW;
    const scaleY = rect.height / imgH;
    const scale = Math.max(scaleX, scaleY);
    
    // 计算裁剪区域，使大图展示的比例与缩略图一致
    const actualW = imgW * scale;
    const actualH = imgH * scale;
    const clipW = (actualW - rect.width) / 2 / actualW * 100;
    const clipH = (actualH - rect.height) / 2 / actualH * 100;

    // 计算缩略图中心点相对于屏幕中心的偏移
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const translateX = centerX - winW / 2;
    const translateY = centerY - winH / 2;
    
    // 获取缩略图的圆角设置，尝试从自身或子元素获取
    let radius = parseFloat(window.getComputedStyle(thumbEl).borderRadius);
    if (!radius) {
        const childImg = thumbEl.querySelector('img');
        if (childImg) radius = parseFloat(window.getComputedStyle(childImg).borderRadius);
    }
    radius = radius || 12;
    
    return { 
        x: translateX, 
        y: translateY, 
        scale: scale, 
        clip: `inset(${clipH.toFixed(2)}% ${clipW.toFixed(2)}% ${clipH.toFixed(2)}% ${clipW.toFixed(2)}% round ${radius / scale}px)`
    };
}

function lockImageDimension(rotation = 0) {
    const modalImg = document.getElementById('modalImage');
    if (!modalImg) return;
    
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const nw = modalImg.naturalWidth || vw;
    const nh = modalImg.naturalHeight || vh;
    
    // 计算当前旋转角度下的“有效”宽高 (90/270度时交换)
    const isRotated = Math.abs(Math.round(rotation / 90) % 2) === 1;
    const testW = isRotated ? nh : nw;
    const testH = isRotated ? nw : nh;
    
    // 计算在当前视口下能容纳该方向图片的缩放比例
    const fitScale = Math.min(1, (vw * 0.95) / testW, (vh * 0.85) / testH);
    
    // 锁定物理尺寸（注意：width/height 始终对应 0度时的方向）
    modalImg.style.width = (nw * fitScale) + 'px';
    modalImg.style.height = (nh * fitScale) + 'px';
    modalImg.style.maxWidth = 'none';
    modalImg.style.maxHeight = 'none';
}

function settleImageToNaturalSize(targetRotation = 0, duration = 420) {
    const modal = document.getElementById('imageModal');
    const modalImg = document.getElementById('modalImage');
    if (!modal || !modalImg || !modal.classList.contains('active')) return;

    imageRotation = targetRotation;
    imageScale = 1;

    modalImg.style.transition = `transform ${duration}ms cubic-bezier(0.22, 0.61, 0.36, 1), width ${duration}ms cubic-bezier(0.22, 0.61, 0.36, 1), height ${duration}ms cubic-bezier(0.22, 0.61, 0.36, 1)`;

    lockImageDimension(targetRotation);

    // 关键修复：旋转完成后自动恢复必须回到屏幕中心，避免沿用放大拖拽时的历史偏移
    imageX = 0;
    imageY = 0;

    updateImageTransform();

    setTimeout(() => {
        if (!modal.classList.contains('active')) return;
        modalImg.style.transition = 'transform 0.1s ease-out';
    }, duration + 20);
}

function openImageModal(src, sourceEl) {
    const modal = document.getElementById('imageModal');
    const modalImg = document.getElementById('modalImage');
    if (!modal || !modalImg) return;

    window._lastImageThumbEl = sourceEl;
    window._pushHybridHash(window.currentMode, 'image');

    // Reset interaction state
    imageScale = 1;
    imageRotation = 0;
    imageX = 0;
    imageY = 0;
    
    // 重置尺寸防止残留
    modalImg.style.width = '';
    modalImg.style.height = '';
    modalImg.style.maxWidth = '';
    modalImg.style.maxHeight = '';

    let displayUrl = src;
    if (displayUrl && !displayUrl.startsWith('data:') && !displayUrl.startsWith('blob:') && displayUrl.startsWith('http')) {
        displayUrl = `/api/proxy-image?url=${encodeURIComponent(displayUrl)}`;
    }

    modalImg.src = displayUrl;
    
    // 尽早锁定 0 度时的比例
    if (modalImg.complete) lockImageDimension(0);
    else modalImg.onload = () => lockImageDimension(0);

    modal.style.display = 'flex';
    
    if (sourceEl) {
        modal.style.display = 'flex';
        modalImg.style.transition = 'none';
        modalImg.style.opacity = '1';

        // 设置到缩略图状态（裁剪并位移）
        const t = getThumbnailTransform(sourceEl);
        modalImg.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.scale}) rotate(0deg)`;
        modalImg.style.clipPath = t.clip;
        modalImg.style.webkitClipPath = t.clip;
        
        // 强制重绘
        modalImg.offsetHeight;

        requestAnimationFrame(() => {
            modal.classList.add('active');
            // 使用流畅的贝赛尔曲线过渡到全屏
            modalImg.style.transition = 'transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1), clip-path 0.4s cubic-bezier(0.2, 0.8, 0.2, 1), -webkit-clip-path 0.4s cubic-bezier(0.2, 0.8, 0.2, 1)';
            modalImg.style.transform = 'translate(0, 0) scale(1) rotate(0deg)';
            modalImg.style.clipPath = 'inset(0% 0% 0% 0% round 0px)';
            modalImg.style.webkitClipPath = 'inset(0% 0% 0% 0% round 0px)';
        });
    } else {
        modal.style.display = 'flex';
        modalImg.style.transition = 'none';
        modalImg.style.opacity = '1';
        modalImg.style.transform = 'scale(1) rotate(0deg)';
        modalImg.style.clipPath = 'none';
        modalImg.style.webkitClipPath = 'none';
        modalImg.offsetHeight;
        requestAnimationFrame(() => {
            modal.classList.add('active');
        });
    }
}

// --- Tooltip ---
function showReasonTooltip(element) {
    const tooltip = document.getElementById('customTooltip');
    const reasonAttr = element.getAttribute('data-reason');
    if (!reasonAttr) return;
    
    window._pushHybridHash(window.currentMode, 'tooltip');

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
            <span class="close-circle-btn" style="width: 32px; height: 32px;" id="closeTooltipBtn">
                ${UI_CLOSE_SVG}
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
    
    // Ensure the close button is bound
    const cbtn = document.getElementById('closeTooltipBtn');
    if (cbtn) {
        cbtn.onclick = (e) => {
            e.stopPropagation();
            window.history.back();
        };
    }
    
    tooltip.classList.add('active');
}

function hideTooltip(noPush = false) {
    const tooltip = document.getElementById('customTooltip');
    const backdrop = document.getElementById('actionSheetBackdrop');
    if (tooltip) tooltip.classList.remove('active');
    
    // If we're closing via back button (noPush=true), backdrop will be handled by closeAllOverlays
    // If we're closing via direct call (eg clicking a button inside without history), we handle backdrop
    if (backdrop && !getOverlayActive()) {
        backdrop.classList.remove('active');
    }

    if (!noPush && window.location.pathname.includes('tooltip')) {
        window.history.back();
    }
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

function showUserActionSheet(noPush = false) {
    const user = currentUser;
    if (!user) return;

    if (!noPush) {
        window._pushHybridHash(window.currentMode, 'user-menu');
    }

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
    // 视觉上先关闭菜单，不触发 back() 以免干扰 editor 的 pushState
    closeActionSheet(true);

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
