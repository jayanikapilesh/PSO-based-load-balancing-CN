'use strict';

/**
 * run_experiment.js — Orchestrates a single load-balancing experiment run.
 *
 * Usage:
 *   node experiments/run_experiment.js \
 *     --algorithm PSO \
 *     --duration 60 \
 *     --rps 5 \
 *     --seed 42 \
 *     --output experiments/raw/pso_run1.json
 *
 * Arguments:
 *   --algorithm   : Routing algorithm name (PSO, ROUND_ROBIN, etc.)
 *   --duration    : Experiment duration in seconds (default: 60)
 *   --rps         : Target requests per second (default: 5)
 *   --seed        : Random seed for reproducibility (default: 42)
 *   --output      : Output JSON file path
 *   --lb-url      : Load balancer URL (default: http://localhost:4000)
 *
 * Output format:
 *   {
 *     "meta": { timestamp, algorithm, config, duration, rps, seed },
 *     "summary": { throughput, avgLatency, p95Latency, errorRate, totalRequests },
 *     "perSecond": [ { second, requests, errors, latencies } ]
 *   }
 *
 * IMPORTANT: All results are from actual execution.
 * Do NOT fabricate or post-process results.
 */

const axios  = require('axios');
const fs     = require('fs');
const path   = require('path');

// ── Parse CLI args ─────────────────────────────────────────────────────────────
function parseArgs() {
    const args = process.argv.slice(2);
    const out = {
        algorithm: 'PSO',
        duration:  60,
        rps:       5,
        seed:      42,
        output:    null,
        lbUrl:     'http://localhost:4000',
    };

    for (let i = 0; i < args.length; i += 2) {
        const key = args[i].replace('--', '');
        const val = args[i + 1];
        switch (key) {
            case 'algorithm': out.algorithm = val; break;
            case 'duration':  out.duration  = parseInt(val, 10); break;
            case 'rps':       out.rps       = parseFloat(val); break;
            case 'seed':      out.seed      = parseInt(val, 10); break;
            case 'output':    out.output    = val; break;
            case 'lb-url':    out.lbUrl     = val; break;
        }
    }

    if (!out.output) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        out.output = path.join(__dirname, 'raw', `${out.algorithm.toLowerCase()}_${ts}.json`);
    }

    return out;
}

// ── Sample transaction payload ─────────────────────────────────────────────────
// Uses a realistic 30-feature vector (Time + V1-V28 + Amount)
const SAMPLE_PAYLOAD = [
    0, 1.2, -0.5, 0.8, -1.2, 0.3, 0.5, -0.1, 0.2, -0.4,
    0.6, -0.8, 1.1, -0.3, 0.7, -0.9, 0.4, -0.6, 0.9, -0.2,
    0.1, -0.7, 1.0, -0.5, 0.8, -1.2, 0.3, 0.5, -0.1, 100.0
];

// ── Main experiment loop ───────────────────────────────────────────────────────
async function runExperiment(opts) {
    console.log(`\n[Experiment] Starting: algorithm=${opts.algorithm} duration=${opts.duration}s rps=${opts.rps} seed=${opts.seed}`);
    console.log(`[Experiment] Load balancer: ${opts.lbUrl}`);
    console.log(`[Experiment] Output: ${opts.output}`);

    // Check LB is reachable and configure algorithm & seed on LB container
    try {
        const configRes = await axios.post(`${opts.lbUrl}/config`, {
            algorithm: opts.algorithm,
            seed: opts.seed,
        }, { timeout: 3000 });
        console.log(`[Experiment] LB configured: algorithm=${configRes.data.algorithm}, seed=${configRes.data.seed}`);

        const statusRes = await axios.get(`${opts.lbUrl}/status`, { timeout: 3000 });
        const state = statusRes.data;
        
        if (state && state.lastHealthState) {
            const healthyNodes = state.lastHealthState.filter(n => n.healthy);
            if (healthyNodes.length > 0) {
                // Ensure at least one healthy node has actual CPU metrics from Prometheus
                const hasCpu = healthyNodes.some(n => n.cpuAvailable);
                if (!hasCpu) {
                    console.error('[Experiment] ERROR: CPU metrics (Prometheus/cAdvisor) are unavailable.');
                    console.error('[Experiment] Experimental integrity requires real CPU data, not the 0.5 fallback.');
                    console.error('[Experiment] Ensure Prometheus and cAdvisor containers are running properly.');
                    process.exit(1);
                }
            }
        }
    } catch (e) {
        console.error('[Experiment] ERROR: Load balancer not reachable or config update failed:', e.message);
        console.error('[Experiment] Ensure docker compose is running and try again.');
        process.exit(1);
    }

    const intervalMs       = Math.round(1000 / opts.rps);
    const durationMs       = opts.duration * 1000;
    const startTime        = Date.now();
    const inFlightPromises = [];
    const allLatencies     = [];

    let offeredRequests    = 0;
    let successfulRequests = 0;
    let failedRequests     = 0;

    const perSecond        = [];
    let currentSecond      = 0;
    let secRequests        = 0;
    let secErrors          = 0;
    let secLatencies       = [];

    function flushSecond() {
        if (secRequests > 0 || currentSecond > 0) {
            perSecond.push({
                second:     currentSecond,
                requests:   secRequests,
                errors:     secErrors,
                avgLatency: secLatencies.length > 0
                    ? secLatencies.reduce((a, b) => a + b, 0) / secLatencies.length
                    : 0,
                p95Latency: percentile(secLatencies, 95),
            });
        }
        secRequests  = 0;
        secErrors    = 0;
        secLatencies = [];
        currentSecond++;
    }

    const secondTick = setInterval(() => {
        flushSecond();
    }, 1000);

    // Controlled request dispatch loop
    await new Promise((resolve) => {
        const dispatchTick = setInterval(() => {
            const elapsed = Date.now() - startTime;
            if (elapsed >= durationMs) {
                clearInterval(dispatchTick);
                resolve();
                return;
            }

            offeredRequests++;
            const reqStart = Date.now();
            const p = axios.post(`${opts.lbUrl}/transaction`, SAMPLE_PAYLOAD, { timeout: 5000 })
                .then(() => {
                    const lat = Date.now() - reqStart;
                    successfulRequests++;
                    secRequests++;
                    secLatencies.push(lat);
                    allLatencies.push(lat);
                })
                .catch(() => {
                    const lat = Date.now() - reqStart;
                    failedRequests++;
                    secRequests++;
                    secErrors++;
                    secLatencies.push(lat);
                    allLatencies.push(lat);
                });

            inFlightPromises.push(p);
        }, intervalMs);
    });

    // Wait for ALL in-flight requests to complete before flushes & summary calculations
    console.log(`[Experiment] Awaiting ${inFlightPromises.length} in-flight requests...`);
    await Promise.allSettled(inFlightPromises);

    clearInterval(secondTick);
    flushSecond();

    const actualDurationSec = (Date.now() - startTime) / 1000;
    const completedRequests = successfulRequests + failedRequests;
    const offeredRps        = offeredRequests / actualDurationSec;
    const throughput        = successfulRequests / actualDurationSec;
    const errorRate         = completedRequests > 0 ? failedRequests / completedRequests : 0;

    const avgLatency = allLatencies.length > 0
        ? allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length
        : 0;
    const p95 = percentile(allLatencies, 95);

    const result = {
        meta: {
            timestamp:          new Date().toISOString(),
            algorithm:          opts.algorithm,
            duration:           opts.duration,
            targetRps:          opts.rps,
            seed:               opts.seed,
            lbUrl:              opts.lbUrl,
            actualDurationSec:  parseFloat(actualDurationSec.toFixed(3)),
        },
        summary: {
            offeredRequests,
            completedRequests,
            successfulRequests,
            failedRequests,
            totalRequests:      completedRequests,
            totalErrors:        failedRequests,
            offeredRps:         parseFloat(offeredRps.toFixed(3)),
            throughput:         parseFloat(throughput.toFixed(3)),
            avgLatency:         parseFloat(avgLatency.toFixed(2)),
            p95Latency:         parseFloat(p95.toFixed(2)),
            errorRate:          parseFloat(errorRate.toFixed(6)),
        },
        perSecond,
    };

    // Save result
    const outDir = path.dirname(opts.output);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(opts.output, JSON.stringify(result, null, 2));

    console.log('\n[Experiment] Complete!');
    console.log(`  Offered requests    : ${offeredRequests}`);
    console.log(`  Completed requests  : ${completedRequests}`);
    console.log(`  Successful requests : ${successfulRequests}`);
    console.log(`  Failed requests     : ${failedRequests}`);
    console.log(`  Target / Offered RPS: ${opts.rps} / ${offeredRps.toFixed(2)} req/s`);
    console.log(`  Achieved Throughput : ${throughput.toFixed(2)} req/s`);
    console.log(`  Avg latency         : ${avgLatency.toFixed(2)} ms`);
    console.log(`  P95 latency         : ${p95.toFixed(2)} ms`);
    console.log(`  Error rate          : ${(errorRate * 100).toFixed(2)}%`);
    console.log(`  Result saved        : ${opts.output}`);

    return result;
}

function percentile(arr, p) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
}

// ── Entry point ────────────────────────────────────────────────────────────────
const opts = parseArgs();
runExperiment(opts).catch(err => {
    console.error('[Experiment] Fatal error:', err.message);
    process.exit(1);
});
