import fetch from 'node-fetch';

async function run() {
    try {
        // We assume the backend is running at http://localhost:3000
        // Try both "Ambos" and "M"
        const payloadAmbos = { segmentations: [{ id: 'gender', params: {} }] };
        const payloadM = { segmentations: [{ id: 'gender', params: { gender: 'M' } }] };

        console.log('Testing "Ambos"...');
        // We don't have authentication here easily, so we might get 401. 
        // Let's call the service directly via NestJS context or similar?
        // Let's just create a mock request. But we need JWT.
        // Ok, writing a NestJS script is harder. Let's just directly call the service.
    } catch (error) {
        console.error(error);
    }
}
run();
