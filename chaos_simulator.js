const axios = require('axios');
const fs = require('fs');
const csv = require('csv-parser');
const { exec } = require("child_process");

const LOAD_BALANCER_URL = "http://localhost:4000/transaction";
const DATASET_PATH = 'creditcard.csv';
const REQUEST_DELAY_MS = 200; // Time between processing each row
const CRASH_INTERVAL_MS = 30000; // Crash a container every 30 seconds

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Global array to store the CSV in memory for continuous looping
let datasetBuffer = [];

function loadDataset() {
    return new Promise((resolve, reject) => {
        fs.createReadStream(DATASET_PATH)
            .pipe(csv())
            .on('data', (row) => datasetBuffer.push(row))
            .on('end', () => resolve())
            .on('error', (err) => reject(err));
    });
}

async function streamContinuousTraffic() {
    console.log("🚀 Loading Dataset...");
    await loadDataset();
    console.log(`✅ Loaded ${datasetBuffer.length} transactions. Starting continuous traffic stream...`);

    let i = 0;
    while (true) {
        const row = datasetBuffer[i];
        
        try {
            const payload = [
                parseFloat(row.Time || 0),
                parseFloat(row.V1 || row.v1 || 0), parseFloat(row.V2 || row.v2 || 0), parseFloat(row.V3 || 0), parseFloat(row.V4 || 0),
                parseFloat(row.V5 || 0), parseFloat(row.V6 || 0), parseFloat(row.V7 || 0), parseFloat(row.V8 || 0),
                parseFloat(row.V9 || 0), parseFloat(row.V10 || 0), parseFloat(row.V11 || 0), parseFloat(row.V12 || 0),
                parseFloat(row.V13 || 0), parseFloat(row.V14 || 0), parseFloat(row.V15 || 0), parseFloat(row.V16 || 0),
                parseFloat(row.V17 || 0), parseFloat(row.V18 || 0), parseFloat(row.V19 || 0), parseFloat(row.V20 || 0),
                parseFloat(row.V21 || 0), parseFloat(row.V22 || 0), parseFloat(row.V23 || 0), parseFloat(row.V24 || 0),
                parseFloat(row.V25 || 0), parseFloat(row.V26 || 0), parseFloat(row.V27 || 0), parseFloat(row.V28 || 0),
                parseFloat(row.Amount || 0)
            ];

            const res = await axios.post(LOAD_BALANCER_URL, payload);
            console.log(`[DATASET TRAFFIC] Label: ${row.Class} | ML Prediction: ${res.data.status} | Routed to: ${res.data.instance}`);
            
        } catch (err) {
            console.log(`[TRAFFIC ERROR] ${err.message}`);
        }

        i++;
        if (i >= datasetBuffer.length) {
            i = 0; // Loop back to the beginning of the dataset forever
        }

        await sleep(REQUEST_DELAY_MS); 
    }
}

function injectChaos() {
    setInterval(() => {
        const target = Math.floor(Math.random() * 3) + 1;
        const containerName = `api${target}`;
        
        console.log(`\n🔥 [CHAOS] Injecting random failure! Stopping container: ${containerName}...`);
        exec(`docker stop ${containerName}`);
    }, CRASH_INTERVAL_MS);
}

// Start Simulator
streamContinuousTraffic();
injectChaos();
