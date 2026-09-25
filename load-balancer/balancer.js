'use strict';

/**
 * balancer.js — PSO-Based Adaptive Load Balancer
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ROUTING FLOW
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *   Background (every PSO_INTERVAL_MS):
 *     getHealthState() → PSO optimizer → cached weight vector
 *
 *   Per-request (fast path):
 *     getHealthState() → exponential fitness() → Softmax → node selection
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * SUPPORTED ROUTING ALGORITHMS (ROUTING_ALGORITHM env var)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *   PSO                — Full PSO + Exponential Fitness + Softmax  (proposed)
 *   PSO_WITHOUT_SOFTMAX— PSO + Exponential Fitness + Deterministic (min-cost)
 *   PSO_LINEAR_FITNESS — PSO + Linear Fitness + Softmax
 *   FIXED_HEALTH       — Static equal weights + Exponential Fitness + Softmax
 *   ROUND_ROBIN        — Simple round-robin (no health awareness)
 *   LEAST_CONNECTIONS  — Route to node with fewest active requests
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * UNHEALTHY NODE HANDLING
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *   Unhealthy nodes are EXCLUDED from all routing decisions.
 *   If all nodes are unhealthy, a 503 is returned immediately.
 *   Self-healing will restart failed containers; once /health returns 200,
 *   the node is automatically re-admitted to the healthy pool.
 */

const express = require('express');
const axios   = require('axios');
const config  = require('./config');
const metrics = require('./metrics');
const { getHealthState, startCpuRefresh } = require('./health');
const { normalizeMetrics, computeCost, computeLinearCost } = require('./fitness');
const { runPSO, getCachedWeights, getSwarmState } = require('./pso');

const app = express();
app.use(express.json());

// ── Backend instances ──────────────────────────────────────────────────────────
const instances = [
    'http://api1:3000',
    'http://api2:3000',
    'http://api3:3000',
];

// Start background CPU metric refresh from Prometheus/cAdvisor
startCpuRefresh(instances);

// ── Round-robin state ──────────────────────────────────────────────────────────
let rrIndex = 0;

// ── Fixed-health weights (static baseline) ─────────────────────────────────────
// Equal weights for all five metrics — used as the FIXED_HEALTH baseline.
const FIXED_WEIGHTS = {
    latency:  0.2,
    requests: 0.2,
    error:    0.2,
    cpu:      0.2,
    uptime:   0.2,
};

// ── Softmax selection ──────────────────────────────────────────────────────────
/**
 * Performs Softmax probabilistic node selection.
 *
 *   P_i = exp(-Cost_i / T) / Σ exp(-Cost_j / T)
 *
 * @param {Array} nodeCosts — [{ url, cost }]
 * @returns {string} selected node URL
 */
function softmaxSelect(nodeCosts) {
    const T = config.SOFTMAX_TEMPERATURE;
    const weights = nodeCosts.map(nc => Math.exp(-nc.cost / T));
    const total   = weights.reduce((a, b) => a + b, 0);

    let random = Math.random() * total;
    for (let i = 0; i < weights.length; i++) {
        random -= weights[i];
        if (random <= 0) return nodeCosts[i].url;
    }
    return nodeCosts[0].url;
}

/**
 * Deterministic selection — returns the node with minimum cost (no Softmax).
 * Used for PSO_WITHOUT_SOFTMAX ablation.
 *
 * @param {Array} nodeCosts — [{ url, cost }]
 * @returns {string} selected node URL
 */
function deterministicSelect(nodeCosts) {
    return nodeCosts.reduce((best, nc) => nc.cost < best.cost ? nc : best).url;
}

// ── Core routing function ──────────────────────────────────────────────────────
/**
 * Selects a backend node URL based on the configured routing algorithm.
 *
 * @param {Array} healthState — output of getHealthState()
 * @returns {string|null} selected URL or null if no healthy nodes
 */
function selectNode(healthState) {
    const healthyNodes = healthState.filter(n => n.healthy);
    if (healthyNodes.length === 0) return null;

    const algo = config.ROUTING_ALGORITHM;

    // ── ROUND_ROBIN ───────────────────────────────────────────────────────────
    if (algo === 'ROUND_ROBIN') {
        const url = healthyNodes[rrIndex % healthyNodes.length].url;
        rrIndex++;
        return url;
    }

    // ── LEAST_CONNECTIONS ─────────────────────────────────────────────────────
    if (algo === 'LEAST_CONNECTIONS') {
        return healthyNodes.reduce((best, n) =>
            (n.activeRequests || 0) < (best.activeRequests || 0) ? n : best
        ).url;
    }

    // ── Health-aware algorithms (need normalized metrics + weights) ───────────
    const nodesNorm = normalizeMetrics(healthyNodes);

    let weights;
    let useLinear = false;

    if (algo === 'FIXED_HEALTH') {
        weights = FIXED_WEIGHTS;
    } else if (algo === 'PSO_LINEAR_FITNESS') {
        weights = getCachedWeights();
        useLinear = true;
    } else {
        // PSO, PSO_WITHOUT_SOFTMAX — use cached PSO weights
        weights = getCachedWeights();
    }

    const costFn = useLinear ? computeLinearCost : computeCost;
    const nodeCosts = nodesNorm.map(n => ({ url: n.url, cost: costFn(n, weights) }));

    if (algo === 'PSO_WITHOUT_SOFTMAX') {
        return deterministicSelect(nodeCosts);
    }

    return softmaxSelect(nodeCosts);
}

// ── Periodic PSO optimization ──────────────────────────────────────────────────
// PSO does NOT run on every request. It runs periodically and caches results.
let lastHealthState = [];

async function runOptimizationCycle() {
    const startTime = Date.now();
    try {
        lastHealthState = await getHealthState(instances);
        const healthyNodes = lastHealthState.filter(n => n.healthy);

        const algo = config.ROUTING_ALGORITHM;
        const useLinear = algo === 'PSO_LINEAR_FITNESS';

        // PSO runs for PSO, PSO_WITHOUT_SOFTMAX, PSO_LINEAR_FITNESS
        if (['PSO', 'PSO_WITHOUT_SOFTMAX', 'PSO_LINEAR_FITNESS'].includes(algo)) {
            const endTimer = metrics.psoOptimizationDuration.startTimer();
            const result = runPSO(healthyNodes, useLinear);
            endTimer();

            metrics.psoBestFitness.set(result.fitness === Infinity ? -1 : result.fitness);
            metrics.psoOptimizationCycles.inc();
            metrics.psoIterationsTotal.inc(config.PSO_ITERATIONS);

            // Update weight gauges
            const w = result.weights;
            metrics.psoWeightLatency.set(w.latency);
            metrics.psoWeightRequests.set(w.requests);
            metrics.psoWeightError.set(w.error);
            metrics.psoWeightCpu.set(w.cpu);
            metrics.psoWeightUptime.set(w.uptime);
        }
    } catch (err) {
        console.error('[PSO Cycle] Error:', err.message);
    }
}

// Start optimization on boot, then repeat
runOptimizationCycle();
setInterval(runOptimizationCycle, config.PSO_INTERVAL_MS);

// ── Routes ─────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
    res.send('PSO-Based Adaptive Load Balancer (Genuine PSO + Exponential Fitness + Softmax)');
});

// Prometheus scrape endpoint
app.get('/metrics', async (req, res) => {
    res.setHeader('Content-Type', metrics.register.contentType);
    res.send(await metrics.register.metrics());
});

// Status endpoint — exposes current PSO state for debugging/monitoring
app.get('/status', (req, res) => {
    res.json({
        algorithm:    config.ROUTING_ALGORITHM,
        psoState:     getSwarmState(),
        config: {
            particles:      config.PSO_PARTICLES,
            iterations:     config.PSO_ITERATIONS,
            inertia:        config.PSO_INERTIA,
            cognitive:      config.PSO_COGNITIVE,
            social:         config.PSO_SOCIAL,
            intervalMs:     config.PSO_INTERVAL_MS,
            temperature:    config.SOFTMAX_TEMPERATURE,
            seed:           config.RANDOM_SEED,
        },
        instances,
        lastHealthState: lastHealthState.map(n => ({
            url:            n.url,
            healthy:        n.healthy,
            activeRequests: n.activeRequests,
            avgLatency:     n.avgLatency,
            errorRate:      n.errorRate,
            cpuUtilization: n.cpuUtilization,
            cpuAvailable:   n.cpuAvailable,
            uptimeRatio:    n.uptimeRatio,
        })),
    });
});

// Main transaction routing endpoint
app.post('/transaction', async (req, res) => {
    const decisionStart = Date.now();
    const endDecisionTimer = metrics.routingDecisionDuration.startTimer();

    try {
        // Use cached health state from last optimization cycle for speed,
        // but re-fetch to get the very latest state for accurate routing.
        const healthState = await getHealthState(instances);
        const target = selectNode(healthState);
        endDecisionTimer();

        if (!target) {
            return res.status(503).json({
                error: 'No healthy nodes available',
                algorithm: config.ROUTING_ALGORITHM,
            });
        }

        console.log(`[${config.ROUTING_ALGORITHM}] Routing to: ${target} (decision: ${Date.now() - decisionStart}ms)`);
        metrics.routingCounter.inc({ target, algorithm: config.ROUTING_ALGORITHM });

        const response = await axios.post(`${target}/transaction`, req.body, { timeout: 5000 });
        res.json(response.data);

    } catch (err) {
        endDecisionTimer();
        console.error('Routing error:', err.message);
        res.status(500).json({ error: 'Routing failed', details: err.message });
    }
});

app.listen(4000, () => {
    console.log('[Load Balancer] Running on port 4000');
    console.log(`[Load Balancer] Algorithm: ${config.ROUTING_ALGORITHM}`);
    console.log(`[Load Balancer] PSO particles: ${config.PSO_PARTICLES}, iterations: ${config.PSO_ITERATIONS}`);
    console.log(`[Load Balancer] Optimization interval: ${config.PSO_INTERVAL_MS}ms`);
});