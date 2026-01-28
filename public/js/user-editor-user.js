class UserEditorUser extends UserEditorCore {
    constructor() {
        super();
    }

    getAvatarEndpoint() {
        return '/api/user/avatar';
    }

    getUpdateEndpoint() {
        return '/api/user/update';
    }

    augmentPayload(payload) {
        // No extra fields for normal users
    }
}

window.userEditor._instance = new UserEditorUser();
if (window.userEditor._pendingOpen) {
    const args = window.userEditor._pendingOpen;
    window.userEditor._pendingOpen = null;
    window.userEditor._instance.open(args);
}
