/* ============================================================
   AUTH.JS — Authentication & Authorization Module
   ============================================================ */

// Get current session
function getSession() {
    try {
        var raw = localStorage.getItem(AUTH_KEYS.SESSION);
        if (!raw) return null;
        var s = JSON.parse(raw);
        if (!s || !s.email || !s.role) return null;
        return s;
    } catch (e) { return null; }
}

function setSession(user) {
    localStorage.setItem(AUTH_KEYS.SESSION, JSON.stringify(user));
}

function isLoggedIn() {
    return getSession() !== null && getToken() !== null;
}

function isAdmin() {
    var s = getSession();
    return s && s.role === 'ADMIN';
}

function isUser() {
    var s = getSession();
    return s && s.role === 'USER';
}

// Route guard — redirect to login if not authenticated
function requireAuth() {
    if (!isLoggedIn()) {
        window.location.href = 'login.html';
        return false;
    }
    return true;
}

// Route guard — admin only
function requireAdmin() {
    if (!isLoggedIn()) {
        window.location.href = 'login.html';
        return false;
    }
    if (!isAdmin()) {
        window.location.href = 'dashboard.html';
        return false;
    }
    return true;
}

// Logout
async function doLogout() {
    await AuthAPI.logout();
    window.location.href = 'login.html';
}
