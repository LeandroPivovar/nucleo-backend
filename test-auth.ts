import axios from 'axios';

async function test() {
    let token = '';
    const testEmail = `test${Date.now()}@example.com`;
    try {
        const regRes = await axios.post('https://nucleocrm.com.br/api/auth/register', {
            email: testEmail,
            password: 'password123',
            firstName: 'Test',
            lastName: 'User'
        });
        console.log("REGISTER SUCCESS", regRes.data);

        const loginRes = await axios.post('https://nucleocrm.com.br/api/auth/login', {
            email: testEmail,
            password: 'password123'
        });
        console.log("LOGIN SUCCESS", loginRes.data.user.email);
        token = loginRes.data.token;
    } catch (err: any) {
        if (err.response) {
            console.log("AUTH FAILED:", err.response.status, err.response.data);
        } else {
            console.log("AUTH ERROR:", err.message);
        }
    }

    if (token) {
        try {
            const statsRes = await axios.get('https://nucleocrm.com.br/api/sales/dashboard/stats?period=15', {
                headers: { Authorization: `Bearer ${token}` }
            });
            console.log("STATS SUCCESS:", statsRes.data);
        } catch (err: any) {
            if (err.response) {
                console.log("STATS FAILED:", err.response.status, err.response.data);
            } else {
                console.log("STATS ERROR:", err.message);
            }
        }
    }
}
test();
