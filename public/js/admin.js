
        // --- Global State ---
        let currentAdminId = null;
        let avatarTimestamp = Date.now();
        const getAvatarUrl = (id, thumb = false) => `/api/public/avatar/${id}?t=${avatarTimestamp}${thumb ? '&thumbnail=1' : ''}`;

        // --- Theme Logic ---
        function applyTheme(theme) {
            document.documentElement.setAttribute('data-theme', theme);
            localStorage.setItem('theme', theme);
            const sunIcon = document.getElementById('sun-icon');
            const moonIcon = document.getElementById('moon-icon');
            if (sunIcon && moonIcon) {
                if (theme === 'dark') {
                    sunIcon.style.display = 'block';
                    moonIcon.style.display = 'none';
                } else {
                    sunIcon.style.display = 'none';
                    moonIcon.style.display = 'block';
                }
            }
            // Re-apply dynamic custom colors for the new mode
            if (typeof applyDynamicTheme === 'function') {
                applyDynamicTheme();
            }
            // 额外触发管理页面的预览刷新
            previewTheme();
        }

        function toggleTheme() {
            const current = localStorage.getItem('theme') || 'light';
            const next = current === 'light' ? 'dark' : 'light';
            applyTheme(next);
        }

        // Init Theme
        applyTheme(localStorage.getItem('theme') || 'light');

        // Centralized fetch with 401 handling
        async function safeFetch(url, options = {}) {
            try {
                const res = await fetch(url, options);
                if (res.status === 401) {
                    window.location.href = '/Login';
                    return null;
                }
                return await res.json();
            } catch (e) {
                console.error(`Fetch error (${url}):`, e);
                return {
            "status": "fail",
            "code": 400,
            "message": e.message,
            "data": {},
            "error": {}
        };
            }
        }

        async function fetchAdminInfo() {
            const data = await safeFetch('/auth/me');
            if (data && data.status !== 'fail') {
                const u = data.user;
                currentAdminId = u.id; // 保存当前管理员ID
                
                // 更新顶部用户信息
                document.getElementById('user-display-name').innerText = u.username;
                document.getElementById('user-role-label').innerText = u.role === 'admin' ? '超级管理员' : '普通用户';
                
                const avatarImg = document.getElementById('user-avatar');
                avatarImg.src = getAvatarUrl(u.id, true);
                avatarImg.onerror = null;

                document.getElementById('user-ip-display').innerText = `登录 IP: ${u.last_login_ip || '未知'}`;

                document.getElementById('admin-info').innerHTML = `
                    <div class="user-stats">
                        <span>管理员: <strong>${u.username}</strong></span>
                        <span>角色: <strong>${u.role}</strong></span>
                        <span>登录IP: <strong>${u.last_login_ip || 'N/A'}</strong></span>
                        <span>登录时间: <strong>${u.last_login_at ? new Date(u.last_login_at).toLocaleString() : 'N/A'}</strong></span>
                    </div>
                `;
            }
        }

        function toggleUserMenu() {
            document.getElementById('user-dropdown').classList.toggle('show');
        }

        // --- Sidebar Collapse Logic ---
        function toggleSidebar(customState = null, persist = true) {
            const sidebar = document.querySelector('.sidebar');
            const toggleIcon = document.querySelector('#sidebar-toggle svg');
            const overlay = document.getElementById('sidebar-overlay');
            
            const shouldBeCollapsed = customState !== null ? !customState : !sidebar.classList.contains('collapsed');
            
            if (!shouldBeCollapsed) {
                sidebar.classList.remove('collapsed');
                if (toggleIcon) toggleIcon.style.transform = 'rotate(0deg)';
                if (persist) localStorage.setItem('sidebar_collapsed', 'false');
                
                // 仅在窄屏展开时显示遮罩
                if (overlay && window.innerWidth < 1024) {
                    overlay.style.display = 'block';
                }
            } else {
                sidebar.classList.add('collapsed');
                if (toggleIcon) toggleIcon.style.transform = 'rotate(180deg)';
                if (persist) localStorage.setItem('sidebar_collapsed', 'true');
                if (overlay) overlay.style.display = 'none';
            }
        }

        // Init Sidebar state
        document.addEventListener('DOMContentLoaded', () => {
            const sidebarToggle = document.getElementById('sidebar-toggle');
            if (sidebarToggle) {
                sidebarToggle.addEventListener('click', () => toggleSidebar());
            }

            // Restore state
            const savedState = localStorage.getItem('sidebar_collapsed');
            if (savedState === 'true') {
                toggleSidebar(false, true);
            }

            const overlay = document.getElementById('sidebar-overlay');
            if (overlay) {
                overlay.addEventListener('click', () => toggleSidebar(false));
            }

            // Auto-collapse on small screens
            const handleResize = () => {
                const sidebar = document.querySelector('.sidebar');
                if (window.innerWidth < 1024) {
                    if (!sidebar.classList.contains('collapsed')) {
                        toggleSidebar(false, false);
                    }
                } else {
                    const savedState = localStorage.getItem('sidebar_collapsed');
                    if (savedState === 'false' && sidebar.classList.contains('collapsed')) {
                        toggleSidebar(true, false);
                    }
                }
            };
            window.addEventListener('resize', handleResize);
            handleResize(); // Check on init
        });

        // 全局点击监听，用于关闭用户菜单
        window.addEventListener('click', function(e) {
            if (!e.target.closest('.user-menu-container')) {
                const dropdown = document.getElementById('user-dropdown');
                if (dropdown) dropdown.classList.remove('show');
            }
        });

        async function fetchUsers(page = 1) {
            const json = await safeFetch(`/api/admin/users?page=${page}&limit=10`);
            if (json && json.status !== 'fail') {
                renderTable(json.data);
                const statUsers = document.getElementById('stat-total-users');
                if (statUsers) statUsers.innerText = json.total;
                renderPagination('users', json.total, json.page, json.limit, 'fetchUsers');
            }
        }

        function renderTable(users) {
            const tbody = document.querySelector('#users-table tbody');
            tbody.innerHTML = '';
            
            // 更新统计卡片 (Moved to fetchUsers)

            users.forEach(u => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${u.id}</td>
                    <td style="font-weight:600; color:var(--text-main);">
                        <div style="display:flex; align-items:center;">
                            <img src="${getAvatarUrl(u.id, true)}" class="user-table-avatar">
                            ${u.username}
                        </div>
                    </td>
                    <td><code style="background:var(--bg-color); padding:2px 6px; border-radius:4px;">${u.role}</code></td>
                    <td><span class="status-${u.status}">${u.status === 'active' ? '正常' : '待审核'}</span></td>
                    <td style="font-size:12px; font-family:monospace;">${u.last_login_ip || '-'}</td>
                    <td style="font-size:11px; color:var(--text-muted)">${u.last_login_at ? new Date(u.last_login_at).toLocaleString() : '-'}</td>
                    <td>
                        <div style="display:flex; gap:6px;">
                            ${u.status === 'pending' ? `<button class="icon-btn primary" onclick="approveUser(${u.id})" title="批准用户"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></button>` : ''}
                            <button class="icon-btn" onclick="openEdit(${u.id}, '${u.username}', '${u.role}')" title="编辑">
                                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M21.03 2.97a3.578 3.578 0 0 1 0 5.06L9.062 20a2.25 2.25 0 0 1-.999.58l-5.116 1.395a.75.75 0 0 1-.92-.921l1.395-5.116a2.25 2.25 0 0 1 .58-.999L15.97 2.97a3.578 3.578 0 0 1 5.06 0ZM15 6.06 5.062 16a.75.75 0 0 0-.193.333l-1.05 3.85 3.85-1.05A.75.75 0 0 0 8 18.938L17.94 9 15 6.06Zm2.03-2.03-.97.97L19 7.94l.97-.97a2.079 2.079 0 0 0-2.94-2.94Z"/></svg>
                            </button>
                            ${u.id !== currentAdminId ? `
                                <button class="icon-btn danger" onclick="deleteUser(${u.id})" title="删除"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" ><path d="M12 1.75a3.25 3.25 0 0 1 3.245 3.066L15.25 5h5.25a.75.75 0 0 1 .102 1.493L20.5 6.5h-.796l-1.28 13.02a2.75 2.75 0 0 1-2.561 2.474l-.176.006H8.313a2.75 2.75 0 0 1-2.714-2.307l-.023-.174L4.295 6.5H3.5a.75.75 0 0 1-.743-.648L2.75 5.75a.75.75 0 0 1 .648-.743L3.5 5h5.25A3.25 3.25 0 0 1 12 1.75Zm6.197 4.75H5.802l1.267 12.872a1.25 1.25 0 0 0 1.117 1.122l.127.006h7.374c.6 0 1.109-.425 1.225-1.002l.02-.126L18.196 6.5ZM13.75 9.25a.75.75 0 0 1 .743.648L14.5 10v7a.75.75 0 0 1-1.493.102L13 17v-7a.75.75 0 0 1 .75-.75Zm-3.5 0a.75.75 0 0 1 .743.648L11 10v7a.75.75 0 0 1-1.493.102L9.5 17v-7a.75.75 0 0 1 .75-.75Zm1.75-6a1.75 1.75 0 0 0-1.744 1.606L10.25 5h3.5A1.75 1.75 0 0 0 12 3.25Z" /></svg></button>
                            ` : ''}
                        </div>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }

        async function approveUser(id) {
            if (!confirm('确认批准该用户?')) return;
            await post('/api/admin/user/approve', { userId: id });
            fetchUsers();
        }

        async function deleteUser(id) {
            if (!confirm('确认删除该用户? 这是一个不可逆操作。')) return;
            await post('/api/admin/user/delete', { userId: id });
            fetchUsers();
        }

        function openEdit(id, username, role) {
            window.userEditor.open({
                userId: id,
                username: username,
                role: role,
                isAdminContext: true,
                onSuccess: (data) => {
                    if (data && data.avatarTimestamp) avatarTimestamp = data.avatarTimestamp;
                    fetchUsers();
                    // If editing self, also update top bar
                    if (id == currentAdminId) fetchAdminInfo();
                }
            });
        }

        function openAddModal() {
            document.getElementById('add-username').value = '';
            document.getElementById('add-password').value = '';
            document.getElementById('add-role').value = 'user';
            document.getElementById('add-status').value = 'active';
            document.getElementById('add-modal').style.display = 'flex';
        }

        function closeModal() {
            document.getElementById('add-modal').style.display = 'none';
            document.getElementById('blacklist-modal').style.display = 'none';
        }

        async function sha256(str) {
            const msgBuffer = new TextEncoder().encode(str);
            const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        }

        async function createUser() {
            const username = document.getElementById('add-username').value;
            const password = document.getElementById('add-password').value;
            const role = document.getElementById('add-role').value;
            const status = document.getElementById('add-status').value;

            if (!username || !password) return alert('请完整填写信息');
            if (username.length < 3 || username.length > 20) return alert('用户名长度需在3-20位之间');
            if (password.length < 6 || password.length > 32) return alert('密码长度需在6-32位之间');

            const hashedPassword = await sha256(password);
            const res = await post('/api/admin/user/add', { 
                username, 
                password: hashedPassword, 
                role, 
                status 
            });

            if (res && res.status !== 'fail') {
                alert('用户创建成功');
                closeModal();
                fetchUsers();
            }
        }

        async function post(url, data) {
            const json = await safeFetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            if (json && json.status === 'fail') alert(json.message || json.error);
            return json;
        }

        function goToWelcome() {
            window.location.href = '/Welcome';
        }

        async function logout() {
            await fetch('/auth/logout', { method: 'POST' });
            window.location.href = '/Login';
        }

        // --- 异常处理界面逻辑 (网页采集异常) ---
        async function fetchAnomalies(page = 1) {
            const json = await safeFetch(`/api/admin/anomalies?page=${page}&limit=10`);
            if (json && json.status !== 'fail') {
                renderAnomalies(json.data);
                
                // 更新侧边栏标签
                const tabSpan = document.querySelector('#tab-anomalies span');
                if (tabSpan) {
                    tabSpan.innerText = json.total > 0 ? `采集异常日志 (${json.total})` : '采集异常日志';
                }
                
                // 注意：旧的 stat-today-anomalies 已更名为 stat-today-blocked (显示在工作台)
                // 此后的统计更新将通过 fetchTodayStats 统一处理

                renderPagination('anomalies', json.total, json.page, json.limit, 'fetchAnomalies');
            }
        }

        function renderAnomalies(anomalies) {
            const tbody = document.querySelector('#anomalies-table tbody');
            tbody.innerHTML = '';

            // 更新统计卡片 (Moved to fetchAnomalies)

            [...anomalies].reverse().forEach(a => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="font-size:11px; color:var(--text-muted)">${a.time}</td>
                    <td><span style="color:var(--danger-color); font-weight:600; font-size:13px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path></svg>${a.reason}</span></td>
                    <td style="max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px;" title="${a.title}">${a.title}</td>
                    <td style="max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                        <a href="${a.url}" target="_blank" style="color:var(--primary-color); font-size:11px; text-decoration:none;">${a.url}</a>
                    </td>
                    <td>
                        <div style="display:flex; gap:6px;">
                            <button class="icon-btn" onclick="viewSnapshot('${a.id}')" title="查看快照"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M21 6.25A3.25 3.25 0 0 0 17.75 3H6.25A3.25 3.25 0 0 0 3 6.25v11.5A3.25 3.25 0 0 0 6.25 21h5.772a6.471 6.471 0 0 1-.709-1.5H6.25a1.75 1.75 0 0 1-1.75-1.75V8.5h15v2.813a6.471 6.471 0 0 1 1.5.709V6.25ZM6.25 4.5h11.5c.966 0 1.75.784 1.75 1.75V7h-15v-.75c0-.966.784-1.75 1.75-1.75Z" /><path d="M23 17.5a5.5 5.5 0 1 0-11 0 5.5 5.5 0 0 0 11 0Zm-5.5 0h2a.5.5 0 0 1 0 1H17a.5.5 0 0 1-.5-.491v-3.01a.5.5 0 0 1 1 0V17.5Z" /></svg></button>
                            <button class="icon-btn" onclick="openProxy('${a.url}')" title="在线代理"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" ><path d="M12 2.001c5.524 0 10 4.477 10 10s-4.476 10-10 10c-5.522 0-10-4.477-10-10s4.478-10 10-10Zm0 1.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Zm-.352 4.053.072-.084a.75.75 0 0 1 .977-.073l.084.073 4 4a.75.75 0 0 1 .073.977l-.072.085-4.002 4a.75.75 0 0 1-1.133-.977l.073-.084 2.722-2.721H7.75a.75.75 0 0 1-.743-.648L7 12a.75.75 0 0 1 .648-.743l.102-.007h6.69l-2.72-2.72a.75.75 0 0 1-.072-.976l.072-.084-.072.084Z" /></svg></button>
                            <button class="icon-btn danger" onclick="deleteAnomaly('${a.id}')" title="删除"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" ><path d="M12 1.75a3.25 3.25 0 0 1 3.245 3.066L15.25 5h5.25a.75.75 0 0 1 .102 1.493L20.5 6.5h-.796l-1.28 13.02a2.75 2.75 0 0 1-2.561 2.474l-.176.006H8.313a2.75 2.75 0 0 1-2.714-2.307l-.023-.174L4.295 6.5H3.5a.75.75 0 0 1-.743-.648L2.75 5.75a.75.75 0 0 1 .648-.743L3.5 5h5.25A3.25 3.25 0 0 1 12 1.75Zm6.197 4.75H5.802l1.267 12.872a1.25 1.25 0 0 0 1.117 1.122l.127.006h7.374c.6 0 1.109-.425 1.225-1.002l.02-.126L18.196 6.5ZM13.75 9.25a.75.75 0 0 1 .743.648L14.5 10v7a.75.75 0 0 1-1.493.102L13 17v-7a.75.75 0 0 1 .75-.75Zm-3.5 0a.75.75 0 0 1 .743.648L11 10v7a.75.75 0 0 1-1.493.102L9.5 17v-7a.75.75 0 0 1 .75-.75Zm1.75-6a1.75 1.75 0 0 0-1.744 1.606L10.25 5h3.5A1.75 1.75 0 0 0 12 3.25Z" /></svg></button>
                        </div>
                    </td>
                `;
                tbody.appendChild(tr);
            });
            if (anomalies.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:30px; color:var(--text-muted);">暂无拦截记录</td></tr>';
            }
        }

        async function clearAnomalies() {
            if (!confirm('确定清空所有异常记录及现场快照?')) return;
            await post('/api/admin/anomalies/clear', {});
            fetchAnomalies();
        }

        async function deleteAnomaly(id) {
            if (!confirm('确定删除该条记录及现场文件?')) return;
            await post('/api/admin/anomalies/delete', { id });
            fetchAnomalies();
        }

        function viewSnapshot(id) {
            window.open(`/api/admin/anomalies/view?id=${id}`, '_blank');
        }

        function openProxy(url) {
            window.open(`/api/admin/proxy?url=${encodeURIComponent(url)}`, '_blank');
        }

        // --- IP 访问日志逻辑 ---
        const ipLogsState = { h: 1, t: 1 };
        async function fetchIPLogs(hPage = null, tPage = null) {
            if (hPage !== null) ipLogsState.h = hPage;
            if (tPage !== null) ipLogsState.t = tPage;

            const q = document.getElementById('ip-history-search')?.value || '';
            const json = await safeFetch(`/api/admin/ip-logs?page=${ipLogsState.h}&tpage=${ipLogsState.t}&limit=10&q=${encodeURIComponent(q)}`);
            if (json && json.status !== 'fail') {
                renderIPLogs(json.history, json.today, json.ttotal);
                renderPagination('ip-logs', json.total, json.page, json.limit, 'fetchHistoryLogPage');
                renderPagination('ip-today', json.ttotal, json.tpage, json.limit, 'fetchTodayLogPage');
            }
        }

        function fetchHistoryLogPage(p) { fetchIPLogs(p, null); }
        function fetchTodayLogPage(p) { fetchIPLogs(null, p); }

        function renderIPLogs(history, today, ttotal) {
            // Render Today Stats
            const todayBody = document.querySelector('#ip-today-table tbody');
            todayBody.innerHTML = '';
            today.forEach(item => {
                const tr = document.createElement('tr');
                const statusHtml = item.is_banned ? 
                    '<span style="font-size:11px; color:var(--danger-color); background:var(--danger-light); padding:2px 6px; border-radius:4px; margin-left:8px;">已封禁</span>' : '';
                tr.innerHTML = `
                    <td style="font-family:monospace; font-weight:600;">${item.ip}${statusHtml}</td>
                    <td style="font-size:13px; color:var(--text-muted)">${item.region || '-'}</td>
                    <td><strong style="color:var(--primary-color); font-size:16px;">${item.hit_count}</strong></td>
                    <td style="font-size:11px; color:var(--text-muted)">${item.last_access ? new Date(item.last_access).toLocaleString() : '-'}</td>
                `;
                todayBody.appendChild(tr);
            });
            if (today.length === 0) {
                todayBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--text-muted);">今日暂无访问</td></tr>';
            }

            // Render History
            const historyBody = document.querySelector('#ip-history-table tbody');
            historyBody.innerHTML = '';
            history.forEach(item => {
                const tr = document.createElement('tr');
                const actions = item.is_banned ? 
                    '<span style="color:var(--danger-color); font-size:12px; font-weight:600;">已封禁</span>' : 
                    `<button class="icon-btn danger" onclick="quickBan('${item.ip}')" title="封禁 IP">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>
                    </button>`;

                tr.innerHTML = `
                    <td style="font-family:monospace; font-weight:600;">${item.ip}</td>
                    <td style="font-size:13px; color:var(--text-muted)">${item.region || '-'}</td>
                    <td style="font-size:11px; color:var(--text-muted); max-width:300px; word-break:break-all; font-family:monospace;">${item.ua}</td>
                    <td style="font-size:11px; color:var(--text-muted)">${new Date(item.last_access).toLocaleString()}</td>
                    <td>${actions}</td>
                `;
                historyBody.appendChild(tr);
            });
            if (history.length === 0) {
                historyBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--text-muted);">暂无记录</td></tr>';
            }
        }

        async function clearIPLogs() {
            if (!confirm('确定清空所有 IP 访问历史和今日统计记录吗?')) return;
            await post('/api/admin/ip-logs/clear', {});
            fetchIPLogs();
        }

        // --- Blacklist Logic ---
        async function fetchBlacklist(page = 1) {
            const json = await safeFetch(`/api/admin/blacklist?page=${page}&limit=10`);
            if (json && json.status !== 'fail') {
                renderBlacklist(json.data);
                renderPagination('blacklist', json.total, json.page, json.limit, 'fetchBlacklist');
            }
        }

        function renderBlacklist(data) {
            const tbody = document.querySelector('#blacklist-table tbody');
            tbody.innerHTML = '';
            data.forEach(item => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="font-family:monospace; font-weight:600;">${item.ip}</td>
                    <td style="font-size:13px;">${item.reason}</td>
                    <td style="font-size:11px; color:var(--text-muted)">${new Date(item.created_at).toLocaleString()}</td>
                    <td>
                        <button class="icon-btn success" onclick="removeBlacklist('${item.id}')" title="解封">
                           <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" ><path d="M12 2.004c1.875 0 3.334 1.206 3.928 3.003a.75.75 0 1 1-1.425.47C14.102 4.262 13.185 3.504 12 3.504c-1.407 0-2.42.958-2.496 2.551l-.005.195v1.749h8.251a2.25 2.25 0 0 1 2.245 2.097l.005.154v9.496a2.25 2.25 0 0 1-2.096 2.245l-.154.005H6.25A2.25 2.25 0 0 1 4.005 19.9L4 19.746V10.25a2.25 2.25 0 0 1 2.096-2.245L6.25 8l1.749-.001v-1.75C8 3.712 9.71 2.005 12 2.005ZM17.75 9.5H6.25a.75.75 0 0 0-.743.648l-.007.102v9.496c0 .38.282.693.648.743l.102.007h11.5a.75.75 0 0 0 .743-.648l.007-.102V10.25a.75.75 0 0 0-.648-.744L17.75 9.5Zm-5.75 4a1.499 1.499 0 1 1 0 2.996 1.499 1.499 0 0 1 0-2.997Z"></svg>
                        </button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
            if (data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--text-muted);">黑名单为空</td></tr>';
            }
        }

        function openAddBlacklistModal() {
            document.getElementById('blacklist-ip').value = '';
            document.getElementById('blacklist-reason').value = '';
            document.getElementById('blacklist-modal').style.display = 'flex';
        }

        async function addBlacklist() {
            const ip = document.getElementById('blacklist-ip').value;
            const reason = document.getElementById('blacklist-reason').value;
            if (!ip) return alert('请输入 IP');
            
            await post('/api/admin/blacklist/add', { ip, reason });
            closeModal();
            fetchBlacklist();
        }

        async function removeBlacklist(id) {
            if (!confirm('确定移除该 IP 的封禁状态?')) return;
            await post('/api/admin/blacklist/remove', { id });
            fetchBlacklist();
        }

        async function quickBan(ip) {
            if (!confirm(`确定封禁 IP: ${ip} 吗?`)) return;
            await post('/api/admin/blacklist/add', { ip, reason: '管理员从日志封禁' });
            alert('IP 已封禁');
            fetchIPLogs();
        }

        // --- Crawler Defense Logic ---
        async function fetchCrawlerSettings() {
            const data = await safeFetch('/api/admin/crawler/settings');
            if (data && data.status !== 'fail') {
                document.getElementById('crawler-ua-min').value = data.data.ua_min_length || 10;
                document.getElementById('crawler-ua-keywords').value = data.data.ua_keywords || '';
            }
        }

        async function saveCrawlerSettings() {
            const min = document.getElementById('crawler-ua-min').value;
            const keywords = document.getElementById('crawler-ua-keywords').value;
            const res = await post('/api/admin/crawler/settings', {
                ua_min_length: min,
                ua_keywords: keywords
            });
            if (res && res.status !== 'fail') {
                alert('爬虫防御配置已更新');
            }
        }

        async function fetchCrawlerLogs(page = 1) {
            const q = document.getElementById('crawler-log-search').value;
            const json = await safeFetch(`/api/admin/crawler/logs?page=${page}&limit=10&q=${encodeURIComponent(q)}`);
            if (json && json.status !== 'fail') {
                renderCrawlerLogs(json.data);
                renderPagination('crawler-logs', json.total, json.page, json.limit, 'fetchCrawlerLogs');
            }
        }

        function renderCrawlerLogs(logs) {
            const tbody = document.querySelector('#crawler-logs-table tbody');
            tbody.innerHTML = '';
            logs.forEach(l => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="font-family:monospace; font-weight:600;">${l.ip}</td>
                    <td style="font-size:13px; color:var(--text-muted)">${l.region || '-'}</td>
                    <td style="font-size:11px; color:var(--text-muted)">${new Date(l.last_blocked_at).toLocaleString()}</td>
                    <td><span style="color:var(--danger-color); font-size:13px; font-weight:600;">${l.reason}</span></td>
                    <td><strong style="color:var(--primary-color)">${l.block_count}</strong></td>
                    <td style="max-width:250px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:11px; color:var(--text-muted)" title="${l.ua}">${l.ua}</td>
                `;
                tbody.appendChild(tr);
            });
            if (logs.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:30px; color:var(--text-muted);">暂无拦截记录</td></tr>';
            }
        }

        async function clearCrawlerLogs() {
            if (!confirm('确定清空所有拦截日志?')) return;
            await post('/api/admin/crawler/logs/clear', {});
            fetchCrawlerLogs();
        }

        // --- History Logic ---
        async function fetchHistory(page = 1) {
            const q = document.getElementById('history-search').value;
            const url = `/api/admin/histories?page=${page}&limit=10${q ? '&q=' + encodeURIComponent(q) : ''}`;
            const json = await safeFetch(url);
            if (json && json.status !== 'fail') {
                renderHistory(json.data);
                renderPagination('history', json.total, json.page, json.limit, 'fetchHistory');
            }
        }

        function renderHistory(data) {
            const tbody = document.querySelector('#history-table tbody');
            tbody.innerHTML = '';
            data.forEach(item => {
                const tr = document.createElement('tr');
                const displayInput = (item.originalInput || '-');
                const truncatedInput = displayInput.length > 100 ? displayInput.substring(0, 100) + '...' : displayInput;
                const link = item.url ? 
                    `<a href="${item.url}" target="_blank" style="color:var(--primary-color); text-decoration:none; font-size:11px;">${item.url}</a>` : 
                    `<span style="color:var(--text-muted); font-size:12px; line-height: 1.4; display: block; max-height: 50px; overflow: hidden;">${truncatedInput}</span>`;
                tr.innerHTML = `
                    <td>
                        <div style="display:flex; flex-direction:column;">
                            <span style="font-weight:600; font-size:13px; color:var(--text-main)">${item.username}</span>
                            <span style="font-size:11px; color:var(--text-muted)">ID: ${item.userId}</span>
                        </div>
                    </td>
                    <td style="max-width:250px; overflow:hidden; text-overflow:ellipsis; font-size:13px; font-weight:500;">${item.title}</td>
                    <td style="max-width:300px; overflow:hidden;">${link}</td>
                    <td><div style="font-weight:700; color:var(--primary-color)">${item.score}</div></td>
                    <td style="font-size:11px; color:var(--text-muted)">${new Date(item.timestamp).toLocaleString()}</td>
                    <td>
                        <button class="icon-btn danger" onclick="deleteHistoryItem('${item.userId}', '${item.timestamp}')" title="删除">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" ><path d="M12 1.75a3.25 3.25 0 0 1 3.245 3.066L15.25 5h5.25a.75.75 0 0 1 .102 1.493L20.5 6.5h-.796l-1.28 13.02a2.75 2.75 0 0 1-2.561 2.474l-.176.006H8.313a2.75 2.75 0 0 1-2.714-2.307l-.023-.174L4.295 6.5H3.5a.75.75 0 0 1-.743-.648L2.75 5.75a.75.75 0 0 1 .648-.743L3.5 5h5.25A3.25 3.25 0 0 1 12 1.75Zm6.197 4.75H5.802l1.267 12.872a1.25 1.25 0 0 0 1.117 1.122l.127.006h7.374c.6 0 1.109-.425 1.225-1.002l.02-.126L18.196 6.5ZM13.75 9.25a.75.75 0 0 1 .743.648L14.5 10v7a.75.75 0 0 1-1.493.102L13 17v-7a.75.75 0 0 1 .75-.75Zm-3.5 0a.75.75 0 0 1 .743.648L11 10v7a.75.75 0 0 1-1.493.102L9.5 17v-7a.75.75 0 0 1 .75-.75Zm1.75-6a1.75 1.75 0 0 0-1.744 1.606L10.25 5h3.5A1.75 1.75 0 0 0 12 3.25Z" /></svg>
                        </button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
            if (data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:30px; color:var(--text-muted);">无相关历史记录</td></tr>';
            }
        }

        async function deleteHistoryItem(userId, timestamp) {
            if (!confirm('确定删除该条历史记录 (及其图片缓存)?')) return;
            await post('/api/admin/history/delete', { userId, timestamp });
            fetchHistory();
            if (document.getElementById('system-section').style.display !== 'none') fetchCacheStats();
        }

        // --- Today Stats Logic ---
        async function fetchTodayStats() {
            const json = await safeFetch('/api/admin/stats/today');
            if (json && json.status !== 'fail') {
                const stats = json.data;
                const yesterday = json.yesterday || {};
                const blockedEl = document.getElementById('stat-blocked-count');
                const visitorEl = document.getElementById('stat-today-visitors');
                const loginEl = document.getElementById('stat-login-users-count');
                const loginFailEl = document.getElementById('stat-login-fail-count');
                const anomalyEl = document.getElementById('stat-anomaly-count');
                const totalUsersEl = document.getElementById('stat-total-users');

                if (totalUsersEl) totalUsersEl.innerText = json.totalUsers || 0;
                if (blockedEl) blockedEl.innerText = stats.blocked_count || 0;
                if (visitorEl) visitorEl.innerText = stats.unique_visitor_count || 0;
                if (loginEl) loginEl.innerText = stats.login_user_count || 0;
                if (loginFailEl) loginFailEl.innerText = stats.login_fail_count || 0;
                // 解决采集异常显示为0的问题：改用累计异常数
                if (anomalyEl) anomalyEl.innerText = json.totalAnomalies || 0;

                // 更新较昨日趋势
                const updateTrend = (trendId, today, yesterday, isBetterLower = false) => {
                    const el = document.getElementById(trendId);
                    if (!el) return;
                    const diff = (today || 0) - (yesterday || 0);
                    let trendHtml = '';
                    if (diff > 0) {
                        const color = isBetterLower ? 'var(--danger-color)' : 'var(--success-color)';
                        trendHtml = `<span style="color:${color}; font-weight: 700;">↑ ${diff}</span>`;
                    } else if (diff < 0) {
                        const color = isBetterLower ? 'var(--success-color)' : 'var(--danger-color)';
                        trendHtml = `<span style="color:${color}; font-weight: 700;">↓ ${Math.abs(diff)}</span>`;
                    } else {
                        trendHtml = `<span style="color:var(--text-muted); font-weight: 600;">持平</span>`;
                    }
                    el.innerHTML = `<span style="color:var(--text-muted); font-size: 11px; margin-right: 2px;">较昨日</span>${trendHtml}`;
                };

                updateTrend('stat-login-trend', stats.login_user_count, yesterday.login_user_count);
                updateTrend('stat-visitor-trend', stats.unique_visitor_count, yesterday.unique_visitor_count);
                updateTrend('stat-blocked-trend', stats.blocked_count, yesterday.blocked_count);
                updateTrend('stat-login-fail-trend', stats.login_fail_count, yesterday.login_fail_count, true);
                updateTrend('stat-total-users-trend', stats.new_user_count, yesterday.new_user_count);
                
                // 采集异常恢复默认显示，不显示较昨日趋势
                const anomalyTrendEl = document.getElementById('stat-anomaly-trend');
                if (anomalyTrendEl) anomalyTrendEl.innerHTML = '<span style="color:var(--text-muted)">采集过程触发异常</span>';

                // Update system real-time stats
                if (json.system) {
                    const cpuUsage = json.system.cpuUsage;
                    const memUsage = json.system.memUsage;
                    
                    // Update CPU Ring
                    const cpuEl = document.getElementById('stat-cpu-usage');
                    const cpuPath = document.getElementById('cpu-circle-path');
                    if (cpuEl) cpuEl.textContent = Math.round(cpuUsage) + ' %';
                    if (cpuPath) {
                        cpuPath.setAttribute('stroke-dasharray', `${cpuUsage}, 100`);
                        // Color color based on usage
                        if (cpuUsage > 80) cpuPath.style.stroke = 'var(--danger-color)';
                        else if (cpuUsage > 50) cpuPath.style.stroke = 'var(--warning-color)';
                        else cpuPath.style.stroke = '#6366f1';
                    }

                    // Update Memory Progress Bar
                    const memEl = document.getElementById('stat-mem-usage');
                    const memProgress = document.getElementById('mem-progress-fill');
                    const memUsedVal = document.getElementById('mem-used-val');
                    const memTotalVal = document.getElementById('mem-total-val');

                    if (memEl) memEl.innerText = memUsage + ' %';
                    if (memProgress) {
                        memProgress.style.width = memUsage + '%';
                        if (memUsage > 90) memProgress.style.background = 'var(--danger-color)';
                        else if (memUsage > 75) memProgress.style.background = 'var(--warning-color)';
                        else memProgress.style.background = 'var(--success-color)';
                    }
                    if (memUsedVal) memUsedVal.innerText = formatBytes(json.system.usedMem, 1);
                    if (memTotalVal) memTotalVal.innerText = formatBytes(json.system.totalMem, 1);
                }
            }
        }

        // --- System/Cache Logic ---
        async function fetchCacheStats() {
            const json = await safeFetch('/api/admin/cache/stats');
            if (json && json.status !== 'fail') {
                const cacheSizeEl = document.getElementById('cache-size');
                const cacheCountEl = document.getElementById('cache-count');
                if (cacheSizeEl) cacheSizeEl.innerText = formatBytes(json.size);
                if (cacheCountEl) cacheCountEl.innerText = `${json.count} 个文件`;

                if (json.disk) {
                    const free = json.disk.free;
                    const total = json.disk.total;
                    const used = total - free;
                    const usedPercent = ((used / total) * 100).toFixed(1);
                    
                    const diskFreeEl = document.getElementById('disk-free');
                    const diskTotalEl = document.getElementById('disk-total');
                    const diskPercentEl = document.getElementById('disk-percent');
                    const diskBarEl = document.getElementById('disk-bar');

                    if (diskFreeEl) diskFreeEl.innerText = formatBytes(free);
                    if (diskTotalEl) diskTotalEl.innerText = `总容量: ${formatBytes(total)}`;
                    if (diskPercentEl) diskPercentEl.innerText = `${usedPercent}% 已用`;
                    
                    // 更新统计卡片
                    const statDiskUsage = document.getElementById('stat-disk-usage');
                    const statDiskUsed = document.getElementById('stat-disk-used');
                    const statDiskTotal = document.getElementById('stat-disk-total');
                    const statDiskProgress = document.getElementById('stat-disk-progress');
                    
                    if (statDiskUsage) statDiskUsage.innerText = `${usedPercent}%`;
                    if (statDiskUsed) statDiskUsed.innerText = formatBytes(used, 1);
                    if (statDiskTotal) statDiskTotal.innerText = formatBytes(total, 1);

                    if (statDiskProgress) {
                        statDiskProgress.style.width = usedPercent + '%';
                        if (usedPercent > 90) statDiskProgress.style.background = 'var(--danger-color)';
                        else if (usedPercent > 70) statDiskProgress.style.background = 'var(--warning-color)';
                        else statDiskProgress.style.background = 'var(--primary-color)';
                    }
                    
                    if (diskBarEl) {
                        diskBarEl.style.width = `${usedPercent}%`;
                        if (usedPercent > 90) diskBarEl.style.background = 'var(--danger-color)';
                        else if (usedPercent > 70) diskBarEl.style.background = 'var(--warning-color)';
                        else diskBarEl.style.background = 'var(--primary-color)';
                    }
                }
            }
        }

        async function clearCache() {
            if (!confirm('确定清空所有图片缓存? 这将导致历史记录中的图片需要重新代理加载。')) return;
            await post('/api/admin/cache/clear', {});
            fetchCacheStats();
        }

        function formatBytes(bytes, decimals = 2) {
            if (!+bytes) return '0 Bytes';
            const k = 1024;
            const dm = decimals < 0 ? 0 : decimals;
            const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
        }

        function switchTab(tab) {
            localStorage.setItem('admin_last_tab', tab);
            
            // Auto close sidebar on narrow screens when switching tabs
            if (window.innerWidth < 1024) {
                toggleSidebar(false, false);
            }
            
            const tabs = ['workbench', 'users', 'anomalies', 'ip-logs', 'blacklist', 'crawler-defense', 'history', 'system', 'config', 'appearance'];
            const titles = {
                'workbench': '工作台',
                'users': '用户管理',
                'anomalies': '网页拦截日志',
                'ip-logs': 'IP 访问日志',
                'blacklist': 'IP 黑名单',
                'crawler-defense': '防火墙',
                'history': '历史记录',
                'system': '资源管理',
                'config': 'API 配置',
                'appearance': '外观设置'
            };
            const groups = {
                'workbench': '仪表盘', 'users': '仪表盘',
                'history': '内容监控', 'anomalies': '内容监控',
                'ip-logs': '安全中心', 'blacklist': '安全中心', 'crawler-defense': '安全中心',
                'system': '系统运维', 'config': '系统运维',
                'appearance': '界面定制'
            };

            // 管理员卡片仅在工作台显示
            const infoCard = document.getElementById('admin-info');
            if (infoCard) infoCard.style.display = (tab === 'workbench' ? 'block' : 'none');

            tabs.forEach(t => {
                const navItem = document.getElementById(`tab-${t}`);
                const sec = document.getElementById(`${t}-section`);
                if (t === tab) {
                    if (navItem) navItem.classList.add('active');
                    if (sec) {
                        // 懒加载水合：如果该区块还没被加载，则从模板实例化
                        if (sec.classList.contains('lazy-section')) {
                            const template = sec.querySelector('template');
                            if (template) {
                                sec.appendChild(template.content.cloneNode(true));
                                template.remove(); // 移除模板以标记已加载
                                
                                // 处理水合后的特殊逻辑 (如外观设置的预设渲染)
                                if (t === 'appearance') {
                                    renderPresets();
                                    initColorSyncs();
                                }
                            }
                        }
                        sec.style.display = 'block';
                    }
                    document.getElementById('breadcrumb-parent').innerText = groups[t] || '仪表盘';
                    document.getElementById('current-tab-title').innerText = titles[t] || t;
                } else {
                    if (navItem) navItem.classList.remove('active');
                    if (sec) sec.style.display = 'none';
                }
            });

            if (tab === 'workbench') {
                fetchCacheStats();
                fetchTodayStats();
            }
            if (tab === 'users') fetchUsers();
            if (tab === 'anomalies') fetchAnomalies();
            if (tab === 'ip-logs') fetchIPLogs();
            if (tab === 'blacklist') fetchBlacklist();
            if (tab === 'crawler-defense') {
                fetchCrawlerSettings();
                fetchCrawlerLogs();
            }
            if (tab === 'history') fetchHistory();
            if (tab === 'system') fetchCacheStats();
            if (tab === 'config') fetchConfig();
            if (tab === 'appearance') fetchAppearanceSettings();
        }

        async function fetchAppearanceSettings() {
            const data = await safeFetch('/api/admin/config');
            if (data && data.status !== 'fail') {
                const theme = data.data.theme || {};
                
                applyFullPreset(
                    theme.lightPrimary || theme.primary || '#4361ee',
                    theme.lightBackground || theme.background || '#f3f4f6',
                    theme.darkPrimary || '#4cc9f0',
                    theme.darkBackground || '#0f172a',
                    theme.lightSecondary || '#3f37c9',
                    theme.darkSecondary || '#4895ef',
                    theme.lightCard || '#ffffff',
                    theme.darkCard || '#1e293b',
                    theme.lightBgSec || '#f8f9fa',
                    theme.darkBgSec || '#1a1d20',
                    theme.lightBorder || '#e9ecef',
                    theme.darkBorder || '#343333',
                    theme.lightGlassBorder || 'rgba(255, 255, 255, 0.8)',
                    theme.darkGlassBorder || 'rgba(255, 255, 255, 0.15)',
                    theme.lightTextMain || '#111827',
                    theme.darkTextMain || '#f8fafc',
                    theme.lightTextMuted || '#6b7280',
                    theme.darkTextMuted || '#94a3b8',
                    theme.lightBgTertiary || '#f1f3f5',
                    theme.darkBgTertiary || '#212529',
                    theme.lightBgMenu || 'rgba(255, 255, 255, 0.95)',
                    theme.darkBgMenu || 'rgba(25, 25, 26, 0.95)'
                );
            }
        }

        // --- 主题预设 ---
        let allPresets = [];

        async function loadPresets() {
            const data = await safeFetch('/api/admin/presets');
            if (data && data.status !== 'fail') {
                allPresets = data.data;
                renderPresets();
            }
        }

        function renderPresets() {
            const container = document.getElementById('theme-presets');
            if (!container) return;
            container.innerHTML = allPresets.map(p => `
                <div class="preset-item" 
                     title="${p.title}"
                     onclick="applyPreset(${p.id})"
                     style="background: linear-gradient(135deg, ${p.colors[0]} 50%, ${p.colors[1]} 50%); 
                            width:100%; aspect-ratio:1; border-radius:12px; cursor:pointer; 
                            border:1px solid var(--border-color); 
                            position: relative; transition: all 0.2s; overflow: visible;">
                    
                    <!-- 覆盖保存按钮 -->
                    <div class="preset-save-btn" 
                         onclick="event.stopPropagation(); updatePresetItem(${p.id})"
                         title="将当前配置保存到此预设"
                         style="position:absolute; bottom:-5px; right:-5px; background:var(--bg-card); color:var(--text-main); 
                                border:1px solid var(--border-color); border-radius:6px; width:22px; height:22px; 
                                display:flex; align-items:center; justify-content:center; font-size:12px; 
                                box-shadow: 0 2px 5px rgba(0,0,0,0.1); z-index:10;">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                            <polyline points="17 21 17 13 7 13 7 21"></polyline>
                            <polyline points="7 3 7 8 15 8"></polyline>
                        </svg>
                    </div>
                </div>
            `).join('');
        }

        function applyPreset(id) {
            const p = allPresets.find(x => x.id === id);
            if (p) {
                applyFullPreset(...p.colors);
            }
        }

        async function updatePresetItem(id) {
            const p = allPresets.find(x => x.id === id);
            if (!p) return;
            
            if (!confirm(`确定要将当前所有调色板的颜色覆盖保存到预设 "${p.title}" 吗？`)) return;

            const lp = document.getElementById('light-primary-text').value;
            const lb = document.getElementById('light-bg-text').value;
            const dp = document.getElementById('dark-primary-text').value;
            const db = document.getElementById('dark-bg-text').value;
            const ls = document.getElementById('light-secondary-text').value;
            const ds = document.getElementById('dark-secondary-text').value;
            const lc = document.getElementById('light-card-text').value;
            const dc = document.getElementById('dark-card-text').value;
            const lbs = document.getElementById('light-bg-sec-text').value;
            const dbs = document.getElementById('dark-bg-sec-text').value;
            const lbdr = document.getElementById('light-border-text').value;
            const dbdr = document.getElementById('dark-border-text').value;
            const lgb = document.getElementById('light-glass-border-text').value;
            const dgb = document.getElementById('dark-glass-border-text').value;
            const ltm = document.getElementById('light-text-main-text').value;
            const dtm = document.getElementById('dark-text-main-text').value;
            const ltm_muted = document.getElementById('light-text-muted-text').value;
            const dtm_muted = document.getElementById('dark-text-muted-text').value;
            const lbt = document.getElementById('light-bg-tertiary-text').value;
            const dbt = document.getElementById('dark-bg-tertiary-text').value;
            const lbm = document.getElementById('light-bg-menu-text').value;
            const dbm = document.getElementById('dark-bg-menu-text').value;

            p.colors = [lp, lb, dp, db, ls, ds, lc, dc, lbs, dbs, lbdr, dbdr, lgb, dgb, ltm, dtm, ltm_muted, dtm_muted, lbt, dbt, lbm, dbm];
            
            const res = await post('/api/admin/presets', allPresets);
            if (res && res.status !== 'fail') {
                alert('预设已更新');
                renderPresets();
            }
        }

        function applyFullPreset(lp, lb, dp, db, ls, ds, lc, dc, lbs, dbs, lbdr, dbdr, lgb, dgb, ltm, dtm, ltm_muted, dtm_muted, lbt, dbt, lbm, dbm) {
            // Apply defaults for missing arguments (backward compatibility with 10-color or 18-color presets)
            lp = lp || '#4361ee';
            lb = lb || '#f3f4f6';
            dp = dp || '#4cc9f0';
            db = db || '#0f172a';
            ls = ls || '#3f37c9';
            ds = ds || '#4895ef';
            lc = lc || '#ffffff';
            dc = dc || '#1e293b';
            lbs = lbs || '#f8f9fa';
            dbs = dbs || '#1a1d20';
            lbdr = lbdr || '#e9ecef';
            dbdr = dbdr || '#343333';
            lgb = lgb || 'rgba(255, 255, 255, 0.8)';
            dgb = dgb || 'rgba(255, 255, 255, 0.15)';
            ltm = ltm || '#111827';
            dtm = dtm || '#f8fafc';
            ltm_muted = ltm_muted || '#6b7280';
            dtm_muted = dtm_muted || '#94a3b8';
            lbt = lbt || '#f1f3f5';
            dbt = dbt || '#212529';
            lbm = lbm || 'rgba(255, 255, 255, 0.95)';
            dbm = dbm || 'rgba(25, 25, 26, 0.95)';

            const setVal = (colorId, textId, val) => {
                const cEl = document.getElementById(colorId);
                const tEl = document.getElementById(textId);
                if (tEl) tEl.value = val;
                if (cEl) {
                    if (/^#[0-9A-F]{6}$/i.test(val)) {
                        cEl.value = val;
                    } else if (val.startsWith('rgba')) {
                        const hex = rgbaToHex(val);
                        if (hex) cEl.value = hex;
                    }
                }
            };

            setVal('light-primary', 'light-primary-text', lp);
            setVal('light-bg', 'light-bg-text', lb);
            setVal('dark-primary', 'dark-primary-text', dp);
            setVal('dark-bg', 'dark-bg-text', db);
            
            setVal('light-secondary', 'light-secondary-text', ls);
            setVal('dark-secondary', 'dark-secondary-text', ds);
            setVal('light-card', 'light-card-text', lc);
            setVal('dark-card', 'dark-card-text', dc);
            setVal('light-bg-sec', 'light-bg-sec-text', lbs);
            setVal('dark-bg-sec', 'dark-bg-sec-text', dbs);
            setVal('light-border', 'light-border-text', lbdr);
            setVal('dark-border', 'dark-border-text', dbdr);
            setVal('light-glass-border', 'light-glass-border-text', lgb);
            setVal('dark-glass-border', 'dark-glass-border-text', dgb);
            setVal('light-text-main', 'light-text-main-text', ltm);
            setVal('dark-text-main', 'dark-text-main-text', dtm);
            setVal('light-text-muted', 'light-text-muted-text', ltm_muted);
            setVal('dark-text-muted', 'dark-text-muted-text', dtm_muted);
            setVal('light-bg-tertiary', 'light-bg-tertiary-text', lbt);
            setVal('dark-bg-tertiary', 'dark-bg-tertiary-text', dbt);
            setVal('light-bg-menu', 'light-bg-menu-text', lbm);
            setVal('dark-bg-menu', 'dark-bg-menu-text', dbm);

            // 自动触发表格/背景的预览更新
            if (typeof previewTheme === 'function') {
                previewTheme();
            }
        }

        function previewTheme() {
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            const prefix = isDark ? 'dark' : 'light';
            
            const root = document.documentElement;
            const primaryEl = document.getElementById(`${prefix}-primary-text`);
            const secondaryEl = document.getElementById(`${prefix}-secondary-text`);
            const backgroundEl = document.getElementById(`${prefix}-bg-text`);
            const bgSecEl = document.getElementById(`${prefix}-bg-sec-text`);
            const cardEl = document.getElementById(`${prefix}-card-text`);
            const borderEl = document.getElementById(`${prefix}-border-text`);
            const glassBorderEl = document.getElementById(`${prefix}-glass-border-text`);
            const textMainEl = document.getElementById(`${prefix}-text-main-text`);
            const textMutedEl = document.getElementById(`${prefix}-text-muted-text`);
            const bgTertiaryEl = document.getElementById(`${prefix}-bg-tertiary-text`);
            const bgMenuEl = document.getElementById(`${prefix}-bg-menu-text`);

            const primary = primaryEl ? primaryEl.value : null;
            const secondary = secondaryEl ? secondaryEl.value : null;
            const background = backgroundEl ? backgroundEl.value : null;
            const bgSec = bgSecEl ? bgSecEl.value : null;
            const card = cardEl ? cardEl.value : null;
            const border = borderEl ? borderEl.value : null;
            const glassBorder = glassBorderEl ? glassBorderEl.value : null;
            const textMain = textMainEl ? textMainEl.value : null;
            const textMuted = textMutedEl ? textMutedEl.value : null;
            const bgTertiary = bgTertiaryEl ? bgTertiaryEl.value : null;
            const bgMenu = bgMenuEl ? bgMenuEl.value : null;

            if (primary) {
                root.style.setProperty('--primary-color', primary);
                root.style.setProperty('--accent-color', primary);
                
                // Technical Derived Colors
                const rgb = window.hexToRgb(primary);
                if (rgb) {
                    root.style.setProperty('--accent-light', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15)`);
                    root.style.setProperty('--accent-hover', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.25)`);
                    root.style.setProperty('--shadow-accent', `0 4px 12px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.25)`);
                    root.style.setProperty('--divider-color', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${isDark ? 0.2 : 0.15})`);
                }
                if (window.adjustColor) {
                    root.style.setProperty('--primary-hover', adjustColor(primary, isDark ? 20 : -20));
                }
            }

            if (secondary) {
                root.style.setProperty('--secondary-color', secondary);
                const rgb = window.hexToRgb(secondary);
                if (rgb) {
                    root.style.setProperty('--secondary-light', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15)`);
                    root.style.setProperty('--secondary-hover', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.25)`);
                }
            }

            if (background) {
                root.style.setProperty('--bg-main', background);
                root.style.setProperty('--bg-color', background);
                const rgb = window.hexToRgb(background);
                if (rgb) {
                    root.style.setProperty('--bg-glass', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${isDark ? 0.6 : 0.45})`);
                }
            }

            if (bgSec) root.style.setProperty('--bg-secondary', bgSec);
            if (border) root.style.setProperty('--border-color', border);
            if (glassBorder) root.style.setProperty('--glass-border', glassBorder);
            if (textMain) root.style.setProperty('--text-main', textMain);
            if (textMuted) root.style.setProperty('--text-muted', textMuted);
            if (bgTertiary) root.style.setProperty('--bg-tertiary', bgTertiary);
            if (bgMenu) root.style.setProperty('--bg-menu', bgMenu);

            if (card) {
                root.style.setProperty('--bg-card', card);
                root.style.setProperty('--card-bg', card);
                root.style.setProperty('--bg-card-solid', card);
                root.style.setProperty('--bg-primary', card);
            }
        }

        async function saveTheme() {
            const lp = document.getElementById('light-primary-text').value;
            const ls = document.getElementById('light-secondary-text').value;
            const lb = document.getElementById('light-bg-text').value;
            const lbs = document.getElementById('light-bg-sec-text').value;
            const lc = document.getElementById('light-card-text').value;
            const lbdr = document.getElementById('light-border-text').value;
            const lgb = document.getElementById('light-glass-border-text').value;
            const ltm = document.getElementById('light-text-main-text').value;
            const ltm_muted = document.getElementById('light-text-muted-text').value;
            const lbt = document.getElementById('light-bg-tertiary-text').value;
            const lbm = document.getElementById('light-bg-menu-text').value;
            
            const dp = document.getElementById('dark-primary-text').value;
            const ds = document.getElementById('dark-secondary-text').value;
            const db = document.getElementById('dark-bg-text').value;
            const dbs = document.getElementById('dark-bg-sec-text').value;
            const dc = document.getElementById('dark-card-text').value;
            const dbdr = document.getElementById('dark-border-text').value;
            const dgb = document.getElementById('dark-glass-border-text').value;
            const dtm = document.getElementById('dark-text-main-text').value;
            const dtm_muted = document.getElementById('dark-text-muted-text').value;
            const dbt = document.getElementById('dark-bg-tertiary-text').value;
            const dbm = document.getElementById('dark-bg-menu-text').value;

            const configData = await safeFetch('/api/admin/config');
            if (configData && configData.status !== 'fail') {
                const config = configData.data;
                config.theme = { 
                    lightPrimary: lp, 
                    lightSecondary: ls,
                    lightBackground: lb,
                    lightBgSec: lbs,
                    lightCard: lc,
                    lightBorder: lbdr,
                    lightGlassBorder: lgb,
                    lightTextMain: ltm,
                    lightTextMuted: ltm_muted,
                    lightBgTertiary: lbt,
                    lightBgMenu: lbm,
                    darkPrimary: dp,
                    darkSecondary: ds,
                    darkBackground: db,
                    darkBgSec: dbs,
                    darkCard: dc,
                    darkBorder: dbdr,
                    darkGlassBorder: dgb,
                    darkTextMain: dtm,
                    darkTextMuted: dtm_muted,
                    darkBgTertiary: dbt,
                    darkBgMenu: dbm,
                    primary: lp,
                    background: lb
                };
                
                const res = await post('/api/admin/config', config);
                if (res && res.status !== 'fail') {
                    // 同步将当前管理员的主题设置为 0 
                    await post('/api/user/preferences', { themeId: 0 });
                    alert('全站主题配置已保存并应用。');
                    location.reload();
                } else {
                    alert('保存配置失败，请重试。');
                }
            } else {
                alert('获取系统配置失败，请检查网络。');
            }
        }

        async function resetTheme() {
            if (!confirm('确定恢复默认配色吗？')) return;
            // Apply default 22-color values
            applyFullPreset(
                '#4361ee', '#f3f4f6', '#4cc9f0', '#0f172a',
                '#3f37c9', '#4895ef',
                '#ffffff', '#1e293b',
                '#f8f9fa', '#1a1d20',
                '#e9ecef', '#343333',
                'rgba(255, 255, 255, 0.8)', 'rgba(255, 255, 255, 0.15)',
                '#111827', '#f8fafc',
                '#6b7280', '#94a3b8',
                '#f1f3f5', '#212529',
                'rgba(255, 255, 255, 0.95)', 'rgba(25, 25, 26, 0.95)'
            );
            await saveTheme();
        }

        function refreshCurrentTab() {
            const tab = localStorage.getItem('admin_last_tab') || 'workbench';
            switchTab(tab);
        }

        // --- 同步颜色选择器和文本框 ---
        function rgbaToHex(rgba) {
            if (!rgba || typeof rgba !== 'string') return null;
            const match = rgba.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)$/);
            if (match) {
                const r = Math.min(255, parseInt(match[1])).toString(16).padStart(2, '0');
                const g = Math.min(255, parseInt(match[2])).toString(16).padStart(2, '0');
                const b = Math.min(255, parseInt(match[3])).toString(16).padStart(2, '0');
                return `#${r}${g}${b}`;
            }
            return null;
        }

        const syncColor = (colorId, textId) => {
            const colorEl = document.getElementById(colorId);
            const textEl = document.getElementById(textId);
            if (!colorEl || !textEl) return;
            
            // 移除旧监听器以防止重复 (由于 cloneNode 不会复制监听器，且我们只水合一次，这里其实没必要，但为了严谨)
            colorEl.oninput = (e) => { 
                textEl.value = e.target.value; 
                previewTheme(); 
            };
            textEl.oninput = (e) => {
                const val = e.target.value;
                if (/^#[0-9A-F]{6}$/i.test(val)) {
                    colorEl.value = val;
                } else if (val.startsWith('rgba')) {
                    const hex = rgbaToHex(val);
                    if (hex) colorEl.value = hex;
                }
                previewTheme(); 
            };
        };

        function initColorSyncs() {
            syncColor('light-primary', 'light-primary-text');
            syncColor('light-secondary', 'light-secondary-text');
            syncColor('light-bg', 'light-bg-text');
            syncColor('light-bg-sec', 'light-bg-sec-text');
            syncColor('light-card', 'light-card-text');
            syncColor('light-border', 'light-border-text');
            syncColor('light-glass-border', 'light-glass-border-text');
            syncColor('light-text-main', 'light-text-main-text');
            syncColor('light-text-muted', 'light-text-muted-text');
            syncColor('light-bg-tertiary', 'light-bg-tertiary-text');
            syncColor('light-bg-menu', 'light-bg-menu-text');
            
            syncColor('dark-primary', 'dark-primary-text');
            syncColor('dark-secondary', 'dark-secondary-text');
            syncColor('dark-bg', 'dark-bg-text');
            syncColor('dark-bg-sec', 'dark-bg-sec-text');
            syncColor('dark-card', 'dark-card-text');
            syncColor('dark-border', 'dark-border-text');
            syncColor('dark-glass-border', 'dark-glass-border-text');
            syncColor('dark-text-main', 'dark-text-main-text');
            syncColor('dark-text-muted', 'dark-text-muted-text');
            syncColor('dark-bg-tertiary', 'dark-bg-tertiary-text');
            syncColor('dark-bg-menu', 'dark-bg-menu-text');
        }

        function setLlmMethod(method) {
            document.getElementById('config-llm-method').value = method;
            document.getElementById('tab-sdk').classList.toggle('active', method === 'sdk');
            document.getElementById('tab-curl').classList.toggle('active', method === 'curl');

            const slider = document.getElementById('method-slider');
            const target = document.getElementById(method === 'sdk' ? 'tab-sdk' : 'tab-curl');
            if (slider && target) {
                // 延迟执行以确保元素渲染完成计算宽度
                setTimeout(() => {
                    slider.style.width = target.offsetWidth + 'px';
                    slider.style.left = target.offsetLeft + 'px';
                }, 20);
            }
        }

        async function fetchConfig() {
            const data = await safeFetch('/api/admin/config');
            if (data && data.status !== 'fail') {
                const c = data.data;
                document.getElementById('config-llm-key').value = c.llm?.apiKey || '';
                document.getElementById('config-llm-url').value = c.llm?.baseURL || '';
                document.getElementById('config-llm-model').value = c.llm?.model || '';
                
                const method = c.llm?.method || 'sdk';
                setLlmMethod(method);
                
                document.getElementById('config-llm-thinking').checked = !!c.llm?.thinking;

                document.getElementById('config-search-key').value = c.search?.apiKey || '';
                document.getElementById('config-search-url').value = c.search?.baseURL || '';
            }
        }

        async function saveConfig() {
            const btn = document.getElementById('save-config-btn');
            const status = document.getElementById('save-status');
            
            btn.disabled = true;
            
            const config = {
                llm: {
                    apiKey: document.getElementById('config-llm-key').value.trim(),
                    baseURL: document.getElementById('config-llm-url').value.trim(),
                    model: document.getElementById('config-llm-model').value.trim(),
                    method: document.getElementById('config-llm-method').value,
                    thinking: document.getElementById('config-llm-thinking').checked
                },
                search: {
                    apiKey: document.getElementById('config-search-key').value.trim(),
                    baseURL: document.getElementById('config-search-url').value.trim()
                }
            };

            const data = await post('/api/admin/config', config);
            btn.disabled = false;

            if (data && data.status !== 'fail') {
                status.classList.add('show');
                setTimeout(() => { status.classList.remove('show'); }, 3000);
            } else {
                alert('保存失败: ' + (data.message || data.error || '未知错误'));
            }
        }

        // --- Pagination Logic ---
        const pageState = {
            users: 1,
            anomalies: 1,
            'ip-logs': 1,
            blacklist: 1,
            history: 1
        };

        function renderPagination(tab, total, page, limit, fetchFunc) {
            const container = document.getElementById(`${tab}-pagination`);
            if (!container) return;
            
            const totalPages = Math.ceil(total / limit);
            if (totalPages <= 1 && total <= limit) {
                container.innerHTML = `<div class="pagination-info">共 <b>${total}</b> 条记录</div>`;
                return;
            }

            let html = `
                <div class="pagination-info">第 <b>${page}</b> / ${totalPages} 页 (共 ${total} 条)</div>
                <div class="pagination-btns">
                    <button class="pagination-btn" ${page <= 1 ? 'disabled' : ''} onclick="${fetchFunc}(${page - 1})">
                        &laquo;
                    </button>
            `;

            let start = Math.max(1, page - 2);
            let end = Math.min(totalPages, start + 4);
            if (end - start < 4) start = Math.max(1, end - 4);
            start = Math.max(1, start);

            for (let i = start; i <= end; i++) {
                html += `<button class="pagination-btn ${i === page ? 'active' : ''}" onclick="${fetchFunc}(${i})">${i}</button>`;
            }

            html += `
                    <button class="pagination-btn" ${page >= totalPages ? 'disabled' : ''} onclick="${fetchFunc}(${page + 1})">
                        &raquo;
                    </button>
                </div>
            `;
            container.innerHTML = html;
        }

        // Search Input Handlers
        function handleSearchInput(input) {
            const clearIcon = input.nextElementSibling;
            if (input.value.length > 0) {
                clearIcon.style.display = 'flex';
            } else {
                clearIcon.style.display = 'none';
            }
        }

        function clearSearchInput(icon, inputId, refreshFunc) {
            const input = document.getElementById(inputId);
            input.value = '';
            icon.style.display = 'none';
            input.focus();
            if (refreshFunc) {
                // Determine if it's fetchIPLogs which needs two params
                if (refreshFunc.name === 'fetchIPLogs') {
                    refreshFunc(1, null);
                } else {
                    refreshFunc(1);
                }
            }
        }

        // Init
        fetchAdminInfo();
        loadPresets();
        const lastTab = localStorage.getItem('admin_last_tab') || 'workbench';
        switchTab(lastTab);

        // 自动刷新工作台核心负载 (3秒一次)
        setInterval(() => {
            const currentTab = localStorage.getItem('admin_last_tab') || 'workbench';
            if (!document.hidden && currentTab === 'workbench') {
                fetchTodayStats();
            }
        }, 3000);

// Expose functions to window for HTML onclick handlers (Webpack entry point scoping)
Object.assign(window, {
    switchTab,
    toggleSidebar,
    refreshCurrentTab,
    toggleTheme,
    toggleUserMenu,
    logout,
    openAddModal,
    closeModal,
    createUser,
    deleteUser,
    approveUser,
    openEdit,
    fetchUsers,
    deleteHistoryItem,
    fetchHistory,
    fetchAnomalies,
    viewSnapshot,
    openProxy,
    deleteAnomaly,
    handleSearchInput,
    clearSearchInput,
    clearCache,
    clearAnomalies,
    clearIPLogs,
    fetchIPLogs,
    fetchHistoryLogPage,
    fetchTodayLogPage,
    quickBan,
    openAddBlacklistModal,
    addBlacklist,
    removeBlacklist,
    fetchBlacklist,
    saveCrawlerSettings,
    fetchCrawlerLogs,
    clearCrawlerLogs,
    saveConfig,
    setLlmMethod,
    saveTheme,
    resetTheme,
    applyPreset,
    getAvatarUrl // Also expose this for consistency if needed by other components
});
