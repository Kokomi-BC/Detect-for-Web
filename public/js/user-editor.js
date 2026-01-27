class UserEditor {
    constructor() {
        this.userId = null;
        this.isAdmin = false;
        this.onSuccess = null;
        this.pendingAvatarFile = null;
        this.pendingAvatarAction = null; // 'upload', 'delete', null
        this.avatarTimestamp = Date.now();
        
        this.init();
    }

    init() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.render());
        } else {
            this.render();
        }
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
                                <button class="icon-btn secondary" id="user-edit-avatar-upload-btn" title="修改图片">
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
                                </button>
                                <button class="icon-btn danger" id="user-edit-avatar-delete-btn" title="删除图片">
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                                </button>
                            </div>
                            <input type="file" id="user-edit-avatar-input" hidden accept="image/*">
                        </div>
                    </div>

                    <div class="form-group">
                        <label>用户名</label>
                        <input type="text" id="user-edit-username" minlength="3" maxlength="20">
                    </div>
                    
                    <div class="form-group" id="user-edit-role-group" style="display:none;">
                        <label>角色</label>
                        <select id="user-edit-role">
                            <option value="user">普通用户</option>
                            <option value="admin">管理员</option>
                        </select>
                    </div>

                    <div class="form-group">
                        <label>密码 (留空不修改)</label>
                        <input type="password" id="user-edit-password" placeholder="输入新密码" minlength="6" maxlength="32">
                    </div>
                    
                    <div class="modal-actions">
                        <button class="filled-btn secondary" id="user-edit-cancel">取消</button>
                        <button class="filled-btn" id="user-edit-save">保存</button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // Bind events
        document.getElementById('user-edit-avatar-upload-btn').onclick = () => document.getElementById('user-edit-avatar-input').click();
        document.getElementById('user-edit-avatar-delete-btn').onclick = () => this.handleAvatarDelete();
        document.getElementById('user-edit-avatar-input').onchange = (e) => this.handleAvatarChange(e);
        document.getElementById('user-edit-cancel').onclick = () => this.close();
        document.getElementById('user-edit-save').onclick = () => this.save();
    }

    open({ userId, username, role, isAdminContext = false, onSuccess = null }) {
        this.userId = userId;
        this.isAdmin = isAdminContext;
        this.onSuccess = onSuccess;
        this.pendingAvatarFile = null;
        this.pendingAvatarAction = null;
        
        // Ensure rendered
        this.render();

        document.getElementById('user-edit-id').value = userId;
        document.getElementById('user-edit-username').value = username || '';
        document.getElementById('user-edit-password').value = '';
        
        const roleGroup = document.getElementById('user-edit-role-group');
        if (this.isAdmin) {
            roleGroup.style.display = 'block';
            document.getElementById('user-edit-role').value = role || 'user';
        } else {
            roleGroup.style.display = 'none';
        }

        const preview = document.getElementById('user-edit-avatar-preview');
        preview.src = `/api/public/avatar/${userId}?t=${this.avatarTimestamp}`;
        
        document.getElementById('user-edit-modal').style.display = 'flex';
    }

    close() {
        document.getElementById('user-edit-modal').style.display = 'none';
    }

    handleAvatarChange(e) {
        if (!e.target.files || !e.target.files[0]) return;
        this.pendingAvatarFile = e.target.files[0];
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

    async save() {
        const username = document.getElementById('user-edit-username').value;
        const password = document.getElementById('user-edit-password').value;
        // Strict Role Logic: Only fetch role value if it's actually visible/admin context
        const role = this.isAdmin ? document.getElementById('user-edit-role').value : null;

        if (username.length < 3 || username.length > 20) return alert('用户名长度需在3-20之间');
        if (password && (password.length < 6 || password.length > 32)) return alert('密码长度需在6-32位之间');

        try {
            // 1. Handle Avatar
            if (this.pendingAvatarAction) {
                const avatarEndpoint = this.isAdmin ? `/api/admin/user/avatar/${this.userId}` : `/api/user/avatar`;
                if (this.pendingAvatarAction === 'delete') {
                    await fetch(avatarEndpoint, { method: 'DELETE' });
                } else if (this.pendingAvatarAction === 'upload' && this.pendingAvatarFile) {
                    const formData = new FormData();
                    formData.append('avatar', this.pendingAvatarFile);
                    const res = await fetch(avatarEndpoint, { method: 'POST', body: formData });
                    const json = await res.json();
                    if (!json.success) throw new Error(json.error || '头像上传失败');
                }
                this.avatarTimestamp = Date.now();
            }

            // 2. Handle Info
            const infoEndpoint = this.isAdmin ? `/api/admin/user/update` : `/api/user/update`;
            const payload = { username };
            if (this.isAdmin) {
                payload.userId = this.userId;
                if (role) payload.role = role;
            }
          
            
            if (password) payload.password = await this.sha256(password);

            const res = await fetch(infoEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || '更新失败');

            if (this.onSuccess) this.onSuccess({ 
                userId: this.userId, 
                username, 
                avatarTimestamp: this.avatarTimestamp 
            });
            
            this.close();
            if(!this.isAdmin) {

                // If it's the main page, onSuccess will handle it.
            }
        } catch (e) {
            alert(e.message);
        }
    }
}

// Global instance
window.userEditor = new UserEditor();
