class UserEditorAdmin extends UserEditorCore {
    constructor() {
        super();
    }

    render() {
        super.render();
        // Since we are overriding the HTML in render, we can just inject into role container
        const roleContainer = document.getElementById('user-edit-role-container');
        if (roleContainer) {
            roleContainer.innerHTML = `
                <label>用户角色</label>
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
        if (this.isAdmin) {
            const roleSelect = document.getElementById('user-edit-role');
            if (roleSelect) roleSelect.value = options.role || 'user';
        }
    }

    getAvatarEndpoint() {
        return `/api/admin/user/avatar/${this.userId}`;
    }

    getUpdateEndpoint() {
        return `/api/admin/user/update`;
    }

    augmentPayload(payload) {
        payload.userId = this.userId;
        const roleSelect = document.getElementById('user-edit-role');
        if (roleSelect) payload.role = roleSelect.value;
    }
}

window.userEditor._instance = new UserEditorAdmin();
if (window.userEditor._pendingOpen) {
    const args = window.userEditor._pendingOpen;
    window.userEditor._pendingOpen = null;
    window.userEditor._instance.open(args);
}
