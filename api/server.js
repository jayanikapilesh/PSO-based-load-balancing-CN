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

// ── Core tracking state ────────────────────────────────────────────────────────
let activeRequests = 0;
let errorCount = 0;
let totalLatency = 0;
let requestCount = 0;

// ── Rolling-window error rate tracking ────────────────────────────────────────
// Maintains a sliding window of { ts, isError } events to compute a
// recent error rate. Window size is configurable via ERROR_RATE_WINDOW_S env.
//
// error_rate = errors_in_window / requests_in_window
//
// This is consumed by the load balancer's health.js to get a meaningful
// short-term error signal rather than a cumulative counter.

const ERROR_RATE_WINDOW_MS = parseInt(process.env.ERROR_RATE_WINDOW_S || '60', 10) * 1000;
const eventWindow = []; // { ts: epochMs, isError: boolean }

function recordEvent(isError) {
    const now = Date.now();
    eventWindow.push({ ts: now, isError });
    // Prune old entries outside the window
    const cutoff = now - ERROR_RATE_WINDOW_MS;
    while (eventWindow.length > 0 && eventWindow[0].ts < cutoff) {
        eventWindow.shift();
    }
}

function computeRecentErrorRate() {
    if (eventWindow.length === 0) return 0;
    const errors = eventWindow.filter(e => e.isError).length;
    return errors / eventWindow.length;
}

// ── ML Fraud Detection ────────────────────────────────────────────────────────
async function checkFraud(features) {
  const res = await axios.post("http://ml-api:8000/predict", features);
  return res.data;
}

// ── Transaction endpoint ──────────────────────────────────────────────────────
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

        recordEvent(false); // successful request

        return res.json({
            status,
            probability: result.fraud_probability,
            instance: process.env.INSTANCE_NAME || os.hostname()
        });

    } catch (err) {
        console.error(err.message);
        errorCount++;
        recordEvent(true); // error event
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

// ── Health endpoint ────────────────────────────────────────────────────────────
// Exposes:
//   - status          : "OK"
//   - activeRequests  : current in-flight request count
//   - errorCount      : cumulative error count (for compatibility)
//   - requestCount    : cumulative request count (for compatibility)
//   - avgLatency      : cumulative average latency (ms)
//   - recentErrorRate : rolling-window error rate (preferred by load balancer)
//
// The load balancer's health.js will preferentially use recentErrorRate
// over the cumulative errorCount for the fitness function.
app.get("/health", (req, res) => {
    const avgLatency = requestCount > 0 ? totalLatency / requestCount : 0;
    const recentErrorRate = computeRecentErrorRate();

    res.status(200).json({
        status: "OK",
        activeRequests: activeRequests,
        errorCount: errorCount,
        requestCount: requestCount,
        avgLatency: avgLatency,
        recentErrorRate: recentErrorRate,
        instance: process.env.INSTANCE_NAME || os.hostname()
    });
});

// ── Crash endpoint (chaos simulation) ─────────────────────────────────────────
app.get("/crash", (req, res) => {
    console.log("CRASH ENDPOINT HIT. Terminating process to simulate failure.");
    res.status(500).send("Crashing");
    setTimeout(() => {
        process.exit(1);
    }, 100);
});

app.listen(3000, () => {
    console.log(`Fraud API running on port 3000 (instance: ${process.env.INSTANCE_NAME || os.hostname()})`);
});