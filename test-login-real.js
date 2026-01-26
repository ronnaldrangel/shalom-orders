const SERVER_URL = 'http://127.0.0.1:3000';

async function runTest() {
    try {
        console.log('1. Creating instance...');
        const createRes = await fetch(`${SERVER_URL}/instances`, { method: 'POST' });
        const createData = await createRes.json();
        
        if (!createRes.ok) {
            throw new Error(`Failed to create instance: ${JSON.stringify(createData)}`);
        }
        
        console.log('Instance created:', createData);
        const { apiKey } = createData;

        // Give some time for the page to load visually
        console.log('Waiting 5 seconds for page load...');
        await new Promise(resolve => setTimeout(resolve, 5000));

        console.log('2. Attempting login...');
        const loginRes = await fetch(`${SERVER_URL}/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey
            },
            body: JSON.stringify({
                username: 'gamersx8@gmail.com',
                password: '8812Jesus@'
            })
        });
        
        const loginData = await loginRes.json();
        console.log('Login response:', loginData);

        if (!loginRes.ok) {
            console.error('Login failed via API');
        } else {
            console.log('Login command sent successfully. Watch the browser window.');
        }

        // Keep it open for a while to observe manually
        console.log('Waiting 30 seconds before closing to observe result...');
        await new Promise(resolve => setTimeout(resolve, 30000));

        console.log('3. Closing instance...');
        await fetch(`${SERVER_URL}/instances`, {
            method: 'DELETE',
            headers: { 'x-api-key': apiKey }
        });
        console.log('Instance closed.');

    } catch (error) {
        console.error('Test failed:', error);
    }
}

runTest();
