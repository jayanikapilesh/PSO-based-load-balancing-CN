const express = require("express");
const os = require("os");
const axios = require("axios");
const client = require("prom-client");

const app = express();
app.use(express.json());

// Prometheus Metrics Setup
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const requestsCounter = new client.Counter({
  name: "fraud_api_requests_total",
  help: "Total number of transaction requests received",
});

const outcomesCounter = new client.Counter({
  name: "fraud_api_outcomes_total",
  help: "Total outcomes split by status (SAFE or FRAUD)",
  labelNames: ["status"],
});

const latencyHistogram = new client.Histogram({
  name: "fraud_api_latency_seconds",
  help: "Histogram of processing latency in seconds",
  buckets: [0.1, 0.5, 1, 2, 5],
});

register.registerMetric(requestsCounter);
register.registerMetric(outcomesCounter);
register.registerMetric(latencyHistogram);

let activeRequests = 0;
let errorCount = 0;
let totalLatency = 0;
let requestCount = 0;

async function checkFraud(features) {
  const res = await axios.post("http://ml-api:8000/predict", features);
  return res.data;
}

app.post("/transaction", async (req, res) => {
    const end = latencyHistogram.startTimer();
    const start = Date.now();
    activeRequests++;
    requestsCounter.inc();

    try {
        const features = req.body;
        const result = await checkFraud(features);

        let status = result.prediction === 1 ? "FRAUD" : "SAFE";
        outcomesCounter.inc({ status });

        return res.json({
            status,
            probability: result.fraud_probability,
            instance: process.env.INSTANCE_NAME || os.hostname()
        });

    } catch (err) {
        console.error(err.message);
        errorCount++;
        res.status(500).send("error");
    } finally {
        const latency = Date.now() - start;
        totalLatency += latency;
        requestCount++;
        activeRequests--;
        end();
    }
});

// Prometheus Scraper Endpoint
app.get("/metrics", async (req, res) => {
  res.setHeader("Content-Type", register.contentType);
  res.send(await register.metrics());
});

app.get("/health", (req, res) => {
    const avgLatency = requestCount > 0 ? totalLatency / requestCount : 0;
    res.status(200).json({
        status: "OK",
        activeRequests: activeRequests,
        errorCount: errorCount,
        avgLatency: avgLatency
    });
});

app.get("/crash", (req, res) => {
    console.log("CRASH ENDPOINT HIT. Terminating process to simulate failure.");
    res.status(500).send("Crashing");
    setTimeout(() => {
        process.exit(1);
    }, 100);
});

app.listen(3000, () => {
    console.log("Fraud API running on port 3000");
});