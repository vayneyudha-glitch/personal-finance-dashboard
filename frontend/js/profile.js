/* ============================================================
   PROFILE.JS — Profile Page Logic
   ============================================================ */

requireAuth();
renderSidebar('profile');
initSidebarMobile();
initThemeToggle();

// Load profile
async function loadProfile() {
    var result = await AuthAPI.getMe();
    if (!result.ok) {
        showToast('Failed to load profile', 'error');
        return;
    }

    var user = result.data.data;
    var infoContainer = document.getElementById('profileInfo');

    var html = '<div class="profile-grid">' +
        '<div class="profile-item"><span class="profile-label">Name</span><span class="profile-value">' + escapeHtml(user.name) + '</span></div>' +
        '<div class="profile-item"><span class="profile-label">Email</span><span class="profile-value">' + escapeHtml(user.email) + '</span></div>' +
        '<div class="profile-item"><span class="profile-label">Phone</span><span class="profile-value">' + escapeHtml(user.phone || '-') + '</span></div>' +
        '<div class="profile-item"><span class="profile-label">Role</span><span class="profile-value"><span class="badge ' + (user.role === 'ADMIN' ? 'badge-expense' : 'badge-income') + '">' + user.role + '</span></span></div>' +
        '<div class="profile-item"><span class="profile-label">Status</span><span class="profile-value"><span class="badge ' + (user.status === 'ACTIVE' ? 'badge-income' : 'badge-expense') + '">' + user.status + '</span></span></div>' +
        '<div class="profile-item"><span class="profile-label">Member Since</span><span class="profile-value">' + formatDate(user.createdAt) + '</span></div>' +
        '</div>';

    infoContainer.innerHTML = html;

    // Populate edit form
    document.getElementById('profileName').value = user.name || '';
    document.getElementById('profileEmail').value = user.email || '';
    document.getElementById('profilePhone').value = user.phone || '';
    document.getElementById('profileRole').value = user.role || '';
}

// Edit profile
document.getElementById('profileForm').addEventListener('submit', async function(e) {
    e.preventDefault();

    var data = {
        name: document.getElementById('profileName').value.trim(),
        phone: document.getElementById('profilePhone').value.trim()
    };

    var btn = this.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Saving...';

    var result = await AuthAPI.updateProfile(data);
    btn.disabled = false; btn.textContent = 'Save Changes';

    if (!result.ok) {
        showToast(result.data.message || 'Failed to update', 'error');
        return;
    }

    // Update session
    var session = getSession();
    if (session) {
        session.name = data.name;
        session.phone = data.phone;
        localStorage.setItem(AUTH_KEYS.SESSION, JSON.stringify(session));
    }

    showToast('Profile updated!', 'success');
    renderSidebar('profile');
    loadProfile();
});

// Change password
document.getElementById('changePasswordForm').addEventListener('submit', async function(e) {
    e.preventDefault();

    var currentPassword = document.getElementById('currentPassword').value;
    var newPassword = document.getElementById('newPassword').value;
    var confirmNewPassword = document.getElementById('confirmNewPassword').value;

    if (!currentPassword || !newPassword) {
        showToast('All fields are required', 'error');
        return;
    }
    if (newPassword.length < 8) {
        showToast('New password must be at least 8 characters', 'error');
        return;
    }
    if (newPassword !== confirmNewPassword) {
        showToast('Passwords do not match', 'error');
        return;
    }

    var btn = this.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Saving...';

    var result = await AuthAPI.changePassword(currentPassword, newPassword);
    btn.disabled = false; btn.textContent = 'Change Password';

    if (!result.ok) {
        showToast(result.data.message || 'Failed to change password', 'error');
        return;
    }

    showToast('Password changed successfully!', 'success');
    this.reset();
});

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    loadProfile();
});
