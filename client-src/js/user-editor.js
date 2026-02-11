
class UserEditorCore {
    constructor() {
        this.userId = null;
        this.isAdmin = false;
        this.onSuccess = null;
        this.pendingAvatarFile = null;
        this.pendingAvatarAction = null; // 'upload', 'delete', null
        this.avatarTimestamp = Date.now();
        this.modal = null;
    }

    render() {
        if (document.getElementById('user-edit-modal')) {
            this.modal = document.getElementById('user-edit-modal');
            // 确保标题根据上下文更新
            const titleEl = document.getElementById('user-edit-title');
            if (titleEl) titleEl.innerText = this.isAdmin ? '编辑用户信息' : '修改个人信息';
        } else {
            const modalHtml = `
                <div id="user-edit-modal" class="modal">
                    <div class="modal-content">
                        <h3 id="user-edit-title">${this.isAdmin ? '编辑用户信息' : '修改个人信息'}</h3>
                        <input type="hidden" id="user-edit-id">
                        
                        <div class="avatar-preview-container">
                            <div class="avatar-wrapper">
                                <div style="position: relative; width: 120px; height: 120px;">
                                    <img id="user-edit-avatar-preview" src="" alt="头像预览" class="avatar-circle">
                                    <div id="user-edit-avatar-loader" class="avatar-loader">
                                        <div class="spinner"></div>
                                    </div>
                                </div>
                                <div class="avatar-edit-actions">
                                    <button class="icon-btn" id="user-edit-avatar-upload-btn" title="修改图片">
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
                                    </button>
                                    <button class="icon-btn danger" id="user-edit-avatar-delete-btn" title="删除图片">
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                                    </button>
                                </div>
                                <input type="file" id="user-edit-avatar-input" hidden accept="image/*,.heic,.heif">
                            </div>
                        </div>

                        <div id="user-edit-status-display" style="display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 20px; font-size: 14px; color: var(--text-muted);">
                            <span id="user-edit-status-dot" style="width: 8px; height: 8px; border-radius: 50%;"></span>
                            <span id="user-edit-status-text"></span>
                            <span style="color: var(--border-color);">|</span>
                            <span id="user-edit-role-text"></span>
                        </div>

                        <div class="form-group">
                            <label for="user-edit-username">用户名</label>
                            <input type="text" id="user-edit-username" minlength="3" maxlength="20">
                        </div>
                        
                        <div class="form-group" id="user-edit-role-container">
                            <!-- Role select injected here for admins -->
                        </div>

                        <div class="form-group">
                            <label for="user-edit-password">新密码 (留空不修改)</label>
                            <input type="password" id="user-edit-password" placeholder="输入新密码" minlength="6" maxlength="32">
                        </div>
                        
                        <div class="form-group" id="user-edit-confirm-group">
                            <label for="user-edit-password-confirm">确认新密码</label>
                            <input type="password" id="user-edit-password-confirm" placeholder="请再次输入新密码">
                        </div>
                        
                        <div class="modal-actions">
                            <button class="filled-btn secondary" id="user-edit-cancel">取消</button>
                            <button class="filled-btn" id="user-edit-save">保存</button>
                        </div>
                    </div>
                </div>
            `;
            document.body.insertAdjacentHTML('beforeend', modalHtml);
            this.modal = document.getElementById('user-edit-modal');
        }
        this.bindEvents();
    }

    bindEvents() {
        if (!this.modal) return;
        const preview = this.modal.querySelector('#user-edit-avatar-preview');
        const loader = this.modal.querySelector('#user-edit-avatar-loader');
        
        if (preview && loader) {
            preview.onload = () => loader.classList.remove('active');
            preview.onerror = () => loader.classList.remove('active');
        }

        this.modal.querySelector('#user-edit-avatar-upload-btn').onclick = () => this.modal.querySelector('#user-edit-avatar-input').click();
        this.modal.querySelector('#user-edit-avatar-delete-btn').onclick = () => this.handleAvatarDelete();
        this.modal.querySelector('#user-edit-avatar-input').onchange = (e) => this.handleAvatarChange(e);
        this.modal.querySelector('#user-edit-cancel').onclick = () => this.close();
        this.modal.querySelector('#user-edit-save').onclick = () => this.save();
    }

    open(options) {
        const { userId, username, role, is_online = false, isAdminContext = false, isSelf = false, onSuccess = null } = options;
        this.userId = userId;
        this.isAdmin = isAdminContext;
        this.onSuccess = onSuccess;
        this.pendingAvatarFile = null;
        this.pendingAvatarAction = null;
        
        this.render();
        // 重新绑定事件，确保 this 指向当前的编辑器实例
        this.bindEvents();

        document.getElementById('user-edit-id').value = userId;
        document.getElementById('user-edit-username').value = username || '';
        document.getElementById('user-edit-password').value = '';
        document.getElementById('user-edit-password-confirm').value = '';

        // Update status display
        const statusDot = document.getElementById('user-edit-status-dot');
        const statusText = document.getElementById('user-edit-status-text');
        const roleTextEl = document.getElementById('user-edit-role-text');
        
        if (statusDot) statusDot.style.background = (is_online || isSelf) ? 'var(--success-color)' : '#9ca3af';
        if (statusText) statusText.textContent = (is_online || isSelf) ? '在线' : '离线';
        if (roleTextEl) roleTextEl.textContent = role === 'admin' ? '管理员' : '普通用户';
        
        const preview = document.getElementById('user-edit-avatar-preview');
        const loader = document.getElementById('user-edit-avatar-loader');
        if (loader) loader.classList.add('active');
        preview.src = `/api/public/avatar/${userId}?t=${this.avatarTimestamp}`;
        
        this.modal.style.display = 'flex';
        // 强制重绘以触发动画
        this.modal.offsetHeight;
        this.modal.classList.add('active');
    }

    close() { 
        if (!this.modal) return;
        this.modal.classList.remove('active');
        setTimeout(() => {
            if (!this.modal.classList.contains('active')) {
                this.modal.style.display = 'none';
            }
        }, 300);
    }

    async handleAvatarChange(e) {
        if (!e.target.files || !e.target.files[0]) return;
        let file = e.target.files[0];
        
        const isHEIC = file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif');
        if (isHEIC) {
            // Show conversion toast
            if (window.showLoadingToast) window.showLoadingToast('正在转换 HEIC 图片...');
            else if (window.showToast) window.showToast('正在转换 HEIC 图片...', 'info');

            try {
                if (typeof heic2any !== 'function') {
                    // 动态加载 heic2any
                    await new Promise((resolve, reject) => {
                        const script = document.createElement('script');
                        // 确保在生产环境和开发环境下都能正确加载
                        script.src = window.location.origin + '/js/heic2any.min.js';
                        script.onload = () => {
                            if (typeof heic2any !== 'undefined') resolve();
                            else reject(new Error('heic2any still undefined'));
                        };
                        script.onerror = reject;
                        document.head.appendChild(script);
                    });
                }

                if (typeof heic2any === 'function') {
                    const blob = await heic2any({
                        blob: file,
                        toType: 'image/jpeg',
                        quality: 0.7
                    });
                    const finalBlob = Array.isArray(blob) ? blob[0] : blob;
                    file = new File([finalBlob], file.name.replace(/\.(heic|heif)$/i, '.jpg'), { type: 'image/jpeg' });
                }
            } catch (err) { 
                console.error('Avatar HEIC conversion failed', err); 
                if (window.showToast) window.showToast('HEIC 转换失败', 'error');
            } finally {
                if (window.hideLoadingToast) window.hideLoadingToast();
            }
        }

        this.pendingAvatarFile = file;
        this.pendingAvatarAction = 'upload';
        
        const preview = document.getElementById('user-edit-avatar-preview');
        const loader = document.getElementById('user-edit-avatar-loader');
        if (loader) loader.classList.add('active');
        preview.src = URL.createObjectURL(this.pendingAvatarFile);
    }

    handleAvatarDelete() {
        this.pendingAvatarFile = null;
        this.pendingAvatarAction = 'delete';
        document.getElementById('user-edit-avatar-preview').src = `/api/public/avatar/0`;
    }

    async sha256(str) {
        const msgBuffer = new TextEncoder().encode(str);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    getAvatarEndpoint() { return '/api/user/avatar'; }
    getUpdateEndpoint() { return '/api/user/update'; }
    augmentPayload(payload) {}

    async save() {
        const username = document.getElementById('user-edit-username').value;
        const password = document.getElementById('user-edit-password').value;
        const confirmPassword = document.getElementById('user-edit-password-confirm').value;
        const saveBtn = document.getElementById('user-edit-save');

        if (username.length < 3 || username.length > 20) return alert('用户名长度需在3-20之间');
        if (password) {
            if (password.length < 6 || password.length > 32) return alert('密码长度需在6-32位之间');
            if (password !== confirmPassword) return alert('两次输入的密码不一致');
        }

        saveBtn.disabled = true;
        saveBtn.innerText = '保存中...';

        try {
            if (this.pendingAvatarAction) {
                const avatarEndpoint = this.getAvatarEndpoint();
                if (this.pendingAvatarAction === 'delete') {
                    await fetch(avatarEndpoint, { method: 'DELETE' });
                } else if (this.pendingAvatarAction === 'upload' && this.pendingAvatarFile) {
                    const formData = new FormData();
                    formData.append('avatar', this.pendingAvatarFile);
                    const res = await fetch(avatarEndpoint, { method: 'POST', body: formData });
                    const json = await res.json();
                    if (json.status === "fail") throw new Error(json.message || json.error || '头像上传失败');
                }
                this.avatarTimestamp = Date.now();
            }

            const infoEndpoint = this.getUpdateEndpoint();
            const payload = { username };
            this.augmentPayload(payload);
            
            if (password) payload.password = await this.sha256(password);

            const res = await fetch(infoEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const json = await res.json();
            if (json.status === "fail") throw new Error(json.message || json.error || '更新失败');

            alert('修改成功！');
            this.close();
            if (this.onSuccess) this.onSuccess({ userId: this.userId, username, avatarTimestamp: this.avatarTimestamp });
        } catch (error) {
            console.error('Update failed:', error);
            alert('错误: ' + error.message);
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerText = '保存';
        }
    }
}

class UserEditorUser extends UserEditorCore {
    constructor() { super(); }
}

class UserEditorAdmin extends UserEditorCore {
    constructor() { super(); }
    render() {
        super.render();
        const roleContainer = document.getElementById('user-edit-role-container');
        if (roleContainer) {
            roleContainer.innerHTML = `
                <label for="user-edit-role">用户角色</label>
                <select id="user-edit-role">
                    <option value="user">普通用户</option>
                    <option value="admin">管理员</option>
                </select>
            `;
            roleContainer.style.display = 'block';
        }
    }
    open(options) {
        super.open(options);
        const roleContainer = document.getElementById('user-edit-role-container');
        if (roleContainer) {
            if (options.isSelf) {
                roleContainer.style.display = 'none';
            } else {
                roleContainer.style.display = 'block';
                const roleSelect = document.getElementById('user-edit-role');
                if (roleSelect) roleSelect.value = options.role || 'user';
            }
        }
    }
    getAvatarEndpoint() { return `/api/admin/user/avatar/${this.userId}`; }
    getUpdateEndpoint() { return `/api/admin/user/update`; }
    augmentPayload(payload) {
        payload.userId = this.userId;
        const roleContainer = document.getElementById('user-edit-role-container');
        const roleSelect = document.getElementById('user-edit-role');
        if (roleSelect && roleContainer && roleContainer.style.display !== 'none') {
            payload.role = roleSelect.value;
        }
    }
}

const userEditor = {
    _instance: null,
    open(options = {}) {
        const isAdmin = options.isAdminContext === true;
        if (isAdmin && !(this._instance instanceof UserEditorAdmin)) {
            this._instance = new UserEditorAdmin();
        } else if (!isAdmin && !(this._instance instanceof UserEditorUser)) {
            this._instance = new UserEditorUser();
        }
        this._instance.open(options);
    },
    close() { if (this._instance) this._instance.close(); },
    save() { if (this._instance) this._instance.save(); },
    handleAvatarDelete() { if (this._instance) this._instance.handleAvatarDelete(); },
    handleAvatarChange(e) { if (this._instance) this._instance.handleAvatarChange(e); }
};

// 后向兼容
window.userEditor = userEditor;

export default userEditor;
export { userEditor, UserEditorCore, UserEditorUser, UserEditorAdmin };
