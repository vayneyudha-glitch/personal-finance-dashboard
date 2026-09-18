// Quick API test script
const BASE = 'http://localhost:3000/api';

async function test() {
    console.log('=== Testing API Endpoints ===\n');

    // 1. Login as admin
    const loginResp = await fetch(BASE + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'vayneyudha@gmail.com', password: 'Admin@2025Secure' })
    });
    const loginData = await loginResp.json();
    console.log('[1] Login:', loginResp.status, loginData.success ? 'PASS' : 'FAIL', '- Role:', loginData.data?.user?.role);
    
    if (!loginData.success) {
        console.log('    Login failed, stopping tests.');
        return;
    }

    const token = loginData.data.token;
    const authHeader = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };

    // 2. Get /auth/me
    const meResp = await fetch(BASE + '/auth/me', { headers: authHeader });
    const meData = await meResp.json();
    console.log('[2] Auth/me:', meResp.status, meData.success ? 'PASS' : 'FAIL', '- Name:', meData.data?.name);

    // 3. Get categories
    const catResp = await fetch(BASE + '/categories', { headers: authHeader });
    const catData = await catResp.json();
    console.log('[3] Categories:', catResp.status, catData.success ? 'PASS' : 'FAIL', '- Count:', catData.data?.categories?.length);

    // 4. Get dashboard
    const dashResp = await fetch(BASE + '/dashboard', { headers: authHeader });
    const dashData = await dashResp.json();
    console.log('[4] Dashboard:', dashResp.status, dashData.success ? 'PASS' : 'FAIL', '- Balance:', dashData.data?.totalBalance);

    // 5. Get transactions
    const trxResp = await fetch(BASE + '/transactions', { headers: authHeader });
    const trxData = await trxResp.json();
    console.log('[5] Transactions:', trxResp.status, trxData.success ? 'PASS' : 'FAIL', '- Total:', trxData.data?.pagination?.total);

    // 6. Get admin dashboard
    const adminDashResp = await fetch(BASE + '/admin/dashboard', { headers: authHeader });
    const adminDashData = await adminDashResp.json();
    console.log('[6] Admin Dashboard:', adminDashResp.status, adminDashData.success ? 'PASS' : 'FAIL');

    // 7. Get admin users
    const usersResp = await fetch(BASE + '/admin/users', { headers: authHeader });
    const usersData = await usersResp.json();
    console.log('[7] Admin Users:', usersResp.status, usersData.success ? 'PASS' : 'FAIL', '- Users:', usersData.data?.items?.length || usersData.data?.users?.length);

    // 8. Get admin activity logs
    const logsResp = await fetch(BASE + '/admin/activity-logs', { headers: authHeader });
    const logsData = await logsResp.json();
    console.log('[8] Admin Activity Logs:', logsResp.status, logsData.success ? 'PASS' : 'FAIL');

    // 9. Create a transaction
    const createResp = await fetch(BASE + '/transactions', {
        method: 'POST',
        headers: authHeader,
        body: JSON.stringify({
            type: 'Income',
            amount: 5000000,
            categoryId: 1,
            description: 'Gaji Test September',
            transactionDate: '2026-09-18'
        })
    });
    const createData = await createResp.json();
    console.log('[9] Create Transaction:', createResp.status, createData.success ? 'PASS' : 'FAIL', '- ID:', createData.data?.id);

    // 10. Get budgets
    const budgetResp = await fetch(BASE + '/budgets', { headers: authHeader });
    const budgetData = await budgetResp.json();
    console.log('[10] Budgets:', budgetResp.status, budgetData.success ? 'PASS' : 'FAIL');

    console.log('\n=== API Tests Complete ===');
}

test().catch(err => console.error('Test error:', err.message));
