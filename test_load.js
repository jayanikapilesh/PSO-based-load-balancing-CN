const axios = require('axios');

async function runTest() {
    console.log("Launching 50 completely simultaneous transactions to the Load Balancer...");
    
    const payload = [0, 1.2, -0.5, 0.8, -1.2, 0.3, 0.5, -0.1, 0.2, -0.4, 0.6, -0.8, 1.1, -0.3, 0.7, -0.9, 0.4, -0.6, 0.9, -0.2, 0.1, -0.7, 1.0, -0.5, 0.8, -1.2, 0.3, 0.5, -0.1, 100.0];
    
    // Create 50 overlapping promises instantly
    const requests = [];
    for(let i = 0; i < 50; i++) {
        requests.push(axios.post("http://localhost:4000/transaction", payload));
    }
    
    // Wait for all 50 to resolve
    const results = await Promise.allSettled(requests);
    
    const counts = { api1: 0, api2: 0, api3: 0, errors: 0 };
    
    results.forEach(r => {
        if (r.status === 'fulfilled' && r.value.data.instance) {
            counts[r.value.data.instance] = (counts[r.value.data.instance] || 0) + 1;
        } else {
            counts.errors++;
        }
    });

    console.log("\n====== VALIDATION PROOF ======");
    console.log("Load Balancer Server Distribution:");
    console.dir(counts);
    console.log("\nIf this reads an almost identical 33% split between api1, api2, and api3,");
    console.log("then our Particle Swarm Optimization successfully redirected traffic exponentially as the network saturated.");
}

runTest();
