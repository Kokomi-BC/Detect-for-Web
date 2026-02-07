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
        if (document.getElementById('user-edit-modal')) return;

        const modalHtml = `
            <div id="user-edit-modal" class="modal">
                <div class="modal-content">
                    <h3 id="user-edit-title">修改用户信息</h3>
                    <input type="hidden" id="user-edit-id">
                    
                    <div class="avatar-preview-container">
                        <div class="avatar-wrapper">
                            <img id="user-edit-avatar-preview" src="" alt="头像预览" class="avatar-circle">
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

                    <div class="form-group">
                        <label>用户名</label>
                        <input type="text" id="user-edit-username" minlength="3" maxlength="20">
                    </div>
                    
                    <div class="form-group" id="user-edit-role-container">
                        <!-- Role select injected here for admins -->
                    </div>

                    <div class="form-group">
                        <label>新密码 (留空不修改)</label>
                        <input type="password" id="user-edit-password" placeholder="输入新密码" minlength="6" maxlength="32">
                    </div>
                    
                    <div class="form-group" id="user-edit-confirm-group">
                        <label>确认新密码</label>
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

        // Bind events
        document.getElementById('user-edit-avatar-upload-btn').onclick = () => document.getElementById('user-edit-avatar-input').click();
        document.getElementById('user-edit-avatar-delete-btn').onclick = () => this.handleAvatarDelete();
        document.getElementById('user-edit-avatar-input').onchange = (e) => this.handleAvatarChange(e);
        document.getElementById('user-edit-cancel').onclick = () => this.close();
        document.getElementById('user-edit-save').onclick = () => this.save();
    }

    open(options) {
        const { userId, username, isAdminContext = false, onSuccess = null } = options;
        this.userId = userId;
        this.isAdmin = isAdminContext;
        this.onSuccess = onSuccess;
        this.pendingAvatarFile = null;
        this.pendingAvatarAction = null;
        
        this.render();

        document.getElementById('user-edit-id').value = userId;
        document.getElementById('user-edit-username').value = username || '';
        document.getElementById('user-edit-password').value = '';
        document.getElementById('user-edit-password-confirm').value = '';
        
        const preview = document.getElementById('user-edit-avatar-preview');
        preview.src = `/api/public/avatar/${userId}?t=${this.avatarTimestamp}`;
        
        this.modal.style.display = 'flex';
    }

    close() {
        this.modal.style.display = 'none';
    }

    async handleAvatarChange(e) {
        if (!e.target.files || !e.target.files[0]) return;
        let file = e.target.files[0];
        
        const isHEIC = file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif');
        if (isHEIC) {
            try {
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
            }
        }

        this.pendingAvatarFile = file;
        this.pendingAvatarAction = 'upload';
        
        const preview = document.getElementById('user-edit-avatar-preview');
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
            // 1. Handle Avatar
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

            // 2. Handle Info
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
            if (this.onSuccess) this.onSuccess({ 
                userId: this.userId, 
                username, 
                avatarTimestamp: this.avatarTimestamp 
            });
        } catch (error) {
            console.error('Update failed:', error);
            alert('错误: ' + error.message);
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerText = '保存';
        }
    }
}

window.UserEditorCore = UserEditorCore;
