window.userEditor = {
    _instance: null,
    _loading: false,
    _pendingOpen: null,

    async _load(isAdmin = false) {
        if (this._instance) return;
        if (this._loading) return;
        this._loading = true;

        try {
            // First load core class if not present
            if (!window.UserEditorCore) {
                await this._loadScript('/js/user-editor-core.js');
            }

            // Load implementation based on context
            const scriptPath = isAdmin ? '/js/user-editor-admin.js' : '/js/user-editor-user.js';
            await this._loadScript(scriptPath);
        } catch (error) {
            console.error('Failed to load user editor:', error);
            this._loading = false;
        }
    },

    _loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    },

    async open(options = {}) {
        if (this._instance) {
            this._instance.open(options);
            return;
        }

        this._pendingOpen = options;
        const isAdmin = options.isAdminContext || (options.role !== undefined);
        await this._load(isAdmin);
    },

    close() {
        if (this._instance) this._instance.close();
    },

    save() {
        if (this._instance) this._instance.save();
    },

    handleAvatarDelete() {
        if (this._instance) this._instance.handleAvatarDelete();
    },

    handleAvatarChange(e) {
        if (this._instance) this._instance.handleAvatarChange(e);
    }
};
