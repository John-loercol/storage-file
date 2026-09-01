const menuBtn = document.getElementById('menu-btn');
const closeSidebar = document.getElementById('close-sidebar');
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const loginStatus = document.getElementById('login-status');
const dashboardStatus = document.getElementById('dashboard-status');
const discordLogin = document.getElementById('discord-login');
const logoutBtn = document.getElementById('logout-btn');
const navLoginText = document.getElementById('nav-login-text');
const avatarImg = document.getElementById('avatar-img');
const loginAvatarImg = document.getElementById('login-avatar-img');

function openSidebar() {
    if (sidebar) sidebar.classList.remove('-translate-x-full');
    if (sidebarOverlay) sidebarOverlay.classList.remove('hidden');
}

function closeSidebarMenu() {
    if (sidebar) sidebar.classList.add('-translate-x-full');
    if (sidebarOverlay) sidebarOverlay.classList.add('hidden');
}

function toggleSidebar() {
    if (sidebar && sidebar.classList.contains('-translate-x-full')) {
        openSidebar();
    } else {
        closeSidebarMenu();
    }
}

if (menuBtn) menuBtn.addEventListener('click', toggleSidebar);
if (closeSidebar) closeSidebar.addEventListener('click', closeSidebarMenu);
if (sidebarOverlay) sidebarOverlay.addEventListener('click', closeSidebarMenu);

function switchTab(tabName) {
    ['dashboard', 'notification', 'login', 'about'].forEach(t => {
        const el = document.getElementById('tab-' + t);
        if (el) el.classList.add('hidden');

        const navEl = document.getElementById('nav-' + t);
        if (navEl) {
            navEl.classList.remove('bg-gray-800', 'text-white', 'font-semibold');
            navEl.classList.add('text-gray-300');
        }
    });

    const targetTab = document.getElementById('tab-' + tabName);
    if (targetTab) targetTab.classList.remove('hidden');

    const targetNav = document.getElementById('nav-' + tabName);
    if (targetNav) {
        targetNav.classList.remove('text-gray-300');
        targetNav.classList.add('bg-gray-800', 'text-white', 'font-semibold');
    }

    closeSidebarMenu();
}

function setLoggedOut() {
    if (navLoginText) navLoginText.textContent = 'Login with Discord';
    if (loginStatus) loginStatus.textContent = 'เข้าสู่ระบบด้วยบัญชี Discord ของคุณ';
    if (discordLogin) discordLogin.classList.remove('hidden');
    if (logoutBtn) logoutBtn.classList.add('hidden');
    if (dashboardStatus) dashboardStatus.textContent = 'ยังไม่ได้เข้าสู่ระบบ';
    const defaultImg = './assets/image/icon-profile-No-found1.png';
    if (avatarImg) avatarImg.src = defaultImg;
    if (loginAvatarImg) loginAvatarImg.src = defaultImg;
}

function setLoggedIn(user) {
    const displayName = user.username || ('User_' + user.discord_id);
    if (navLoginText) navLoginText.textContent = 'บัญชี Discord: ' + displayName;
    if (loginStatus) loginStatus.textContent = 'เข้าสู่ระบบแล้ว: ' + displayName;
    if (discordLogin) discordLogin.classList.add('hidden');
    if (logoutBtn) logoutBtn.classList.remove('hidden');
    if (dashboardStatus) dashboardStatus.textContent = 'เข้าสู่ระบบแล้วในชื่อ ' + displayName;
}

async function checkSession() {
    try {
        const response = await fetch('/api/me', {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store'
        });

        if (!response.ok) {
            setLoggedOut();
            return;
        }

        const result = await response.json();
        if (result.authenticated && result.user) {
            setLoggedIn(result.user);
        } else {
            setLoggedOut();
        }
    } catch (error) {
        console.error('Session check failed:', error);
        if (dashboardStatus) dashboardStatus.textContent = 'ไม่สามารถเชื่อมต่อ Backend เพื่อตรวจสอบ Session ได้';
        setLoggedOut();
    }
}

if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
        logoutBtn.disabled = true;
        try {
            await fetch('/auth/logout', {
                method: 'POST',
                credentials: 'include'
            });
        } catch (error) {
            console.error('Logout failed:', error);
        } finally {
            setLoggedOut();
            logoutBtn.disabled = false;
            switchTab('dashboard');
        }
    });
}

const params = new URLSearchParams(window.location.search);
if (params.get('login') === 'success') {
    window.history.replaceState({}, document.title, window.location.pathname);
}

// เริ่มต้นเรียกทำงานหน้าแรก
switchTab('dashboard');
checkSession();
