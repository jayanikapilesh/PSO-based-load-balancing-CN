const express = require("express");
const axios = require("axios");
const client = require("prom-client");
const { selectBest } = require("./pso");

const app = express();
app.use(express.json());

// Prometheus Metrics Setup
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const routingCounter = new client.Counter({
  name: "pso_routing_decisions_total",
  help: "Total number of times the PSO algorithm routed traffic to a specific node",
  labelNames: ["target"],
});

register.registerMetric(routingCounter);

const instances = [
    "http://api1:3000",
    "http://api2:3000",
    "http://api3:3000"
];

/**
 * Polls the health endpoints of all API instances to collect real-time metrics
 */
async function getHealthScores() {
    const scores = [];
    for (const url of instances) {
        try {
            const r = await axios.get(`${url}/health`, { timeout: 600 });
            if (r.status === 200) {
                scores.push({ 
                    url, 
                    healthy: true,
                    activeRequests: r.data.activeRequests || 0,
                    avgLatency: r.data.avgLatency || 0
                });
            } else {
                scores.push({ url, healthy: false });
            }
        } catch {
            scores.push({ url, healthy: false });
        }
    }
    return scores;
}

app.get("/", (req, res) => {
    res.send("Fraud Detection Load Balancer Running (Advanced PSO Mode with Metrics)");
});

// Prometheus Scraper Endpoint
app.get("/metrics", async (req, res) => {
  res.setHeader("Content-Type", register.contentType);
  res.send(await register.metrics());
});

app.post("/transaction", async (req, res) => {
    try {
        const nodes = await getHealthScores();
        const target = selectBest(nodes);

        if (!target) {
            throw new Error("No healthy nodes available");
        }

        console.log(`[PSO] Routing to: ${target}`);
        
        // Track the routing decision for Prometheus/Grafana charts
        routingCounter.inc({ target });

        const response = await axios.post(`${target}/transaction`, req.body);
        res.json(response.data);

    } catch (err) {
        console.error("Routing error:", err.message);
        res.status(500).send({ error: "Routing failed", details: err.message });
    }
});

app.listen(4000, () => {
    console.log("Load Balancer running on port 4000 (Advanced PSO with Metrics)");
});