
import http from 'http';

const TEST_EMAIL = `reco_test_${Date.now()}@example.com`;
const TEST_PASSWORD = 'password123';

function request(method: string, path: string, data?: any, token?: string): Promise<any> {
    return new Promise((resolve, reject) => {
        const options: http.RequestOptions = {
            hostname: 'localhost',
            port: 8005, // Temp server 5
            path: `/api/v1${path}`,
            method: method,
            headers: {
                'Content-Type': 'application/json',
            },
        };

        if (token) {
            (options.headers as any)['Authorization'] = `Bearer ${token}`;
        }

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    resolve({ status: res.statusCode, data: parsed });
                } catch (e) {
                    resolve({ status: res.statusCode, data: body });
                }
            });
        });

        req.on('error', (e) => reject(e));

        if (data) {
            req.write(JSON.stringify(data));
        }
        req.end();
    });
}

async function runVerification() {
    try {
        console.log('1. Signup/Login...');
        let token = '';
        let res = await request('POST', '/auth/signup', { email: TEST_EMAIL, password: TEST_PASSWORD });
        if (res.status === 201) {
            token = res.data.data.token;
        } else {
            console.log('Auth failed details:', res.status, JSON.stringify(res.data, null, 2));
            throw new Error('Auth failed');
        }

        console.log('\n2. Updating Profile with Interest: MUSIC...');
        res = await request('PATCH', '/auth/profile', { interests: ['MUSIC'] }, token);
        if (res.status === 200 && res.data.data.interests.includes('MUSIC')) {
            console.log('   PASSED: Profile updated with interest');
        } else {
            console.error('   FAILED: Update Profile', res.data);
            return;
        }

        console.log('\n3. Seeding Events...');
        await request('POST', '/events', {
            title: "Jazz Night", category: "MUSIC", privacy: "PUBLIC",
            description: "Music event", location: { type: "PHYSICAL", city: "Lagos" },
            schedule: { startDate: new Date().toISOString(), endDate: new Date().toISOString(), startTime: "09:00", endTime: "10:00", timezone: "UTC" },
            media: { coverImage: "http://example.com" }, tickets: []
        }, token);

        await request('POST', '/events', {
            title: "Tech Meetup", category: "TECH", privacy: "PUBLIC",
            description: "Tech event", location: { type: "PHYSICAL", city: "Lagos" },
            schedule: { startDate: new Date().toISOString(), endDate: new Date().toISOString(), startTime: "09:00", endTime: "10:00", timezone: "UTC" },
            media: { coverImage: "http://example.com" }, tickets: []
        }, token);

        console.log('\n4. Testing Recommendations (Should get MUSIC)...');
        res = await request('GET', '/events/recommendations', undefined, token);

        const recommendations = res.data.data;
        if (res.status === 200 && recommendations.length > 0) {
            const hasMusic = recommendations.some((e: any) => e.category === 'MUSIC');
            if (hasMusic) {
                console.log('   PASSED: Recommendations contain MUSIC event');
            } else {
                console.error('   FAILED: No MUSIC event found', recommendations.map((e: any) => e.category));
            }
        } else {
            console.error('   FAILED: Fetch recommendations', res.data);
        }

        console.log('\n5. Testing Fallback (Remove Interest)...');
        await request('PATCH', '/auth/profile', { interests: [] }, token);

        res = await request('GET', '/events/recommendations', undefined, token);
        if (res.status === 200 && res.data.data.length > 0) {
            console.log('   PASSED: Fallback recommendations returned events');
        } else {
            console.error('   FAILED: Fallback empty', res.data);
        }

    } catch (error: any) {
        console.error('Fatal error:', error.message || error);
    }
}

runVerification();
