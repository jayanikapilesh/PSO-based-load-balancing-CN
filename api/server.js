const express = require("express");
const os = require("os");

const app = express();
app.use(express.json());

const startTime = Date.now();

let activeRequests = 0;
let errorCount = 0;
let totalLatency = 0;
let requestCount = 0;

app.post("/fraud-check", async (req, res) => {

    const start = Date.now();
    activeRequests++;

    try {

        // simulate processing
        await new Promise(r => setTimeout(r, 50));

        res.json({
            decision: "ALLOW",
            instance: process.env.INSTANCE_NAME || os.hostname()
        });

    } catch (err) {

        errorCount++;
        res.status(500).send("error");

    } finally {

        const latency = Date.now() - start;
        totalLatency += latency;
        requestCount++;
        activeRequests--;

    }

});


app.get("/health", (req, res) => {
    res.status(200).send("OK");
});

app.listen(3000, () => {
    console.log("Fraud API running on port 3000");
});