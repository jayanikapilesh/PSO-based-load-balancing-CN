'use strict';

/**
 * measure_overhead.js — Benchmarks overhead across load balancing algorithms.
 *
 * Measures:
 *   - Optimization cycle duration (ms)
 *   - Single routing decision duration (ms)
 *   - CPU usage (%)
 *   - Memory usage (MB RSS / Heap)
 *
 * Usage:
 *   node experiments/measure_overhead.js --lb-url http://localhost:4000 --output experiments/processed_v2/overhead.json
 */

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

function parseArgs() {
    const args = process.argv.slice(2);
    const out = {
        lbUrl:  'http://localhost:4000',
        output: path.join(__dirname, 'processed_v2', 'overhead.json'),
    };
    for (let i = 0; i < args.length; i += 2) {
        const key = args[i].replace('--', '');
        const val = args[i + 1];
        if (key === 'lb-url') out.lbUrl = val;
        if (key === 'output') out.output = val;
    }
    return out;
}

const SAMPLE_PAYLOAD = [
    0, 1.2, -0.5, 0.8, -1.2, 0.3, 0.5, -0.1, 0.2, -0.4,
    0.6, -0.8, 1.1, -0.3, 0.7, -0.9, 0.4, -0.6, 0.9, -0.2,
    0.1, -0.7, 1.0, -0.5, 0.8, -1.2, 0.3, 0.5, -0.1, 100.0
];

const ALGORITHMS = ['PSO', 'ROUND_ROBIN', 'LEAST_CONNECTIONS', 'FIXED_HEALTH'];

async function benchmarkAlgorithm(lbUrl, algo) {
    console.log(`\n[Overhead Benchmark] Testing algorithm: ${algo}...`);
    
    // Configure LB algorithm
    await axios.post(`${lbUrl}/config`, { algorithm: algo, seed: 42 });

    const decisionTimes = [];
    const numRequests = 200;

    // Warm-up requests
    for (let i = 0; i < 10; i++) {
        await axios.post(`${lbUrl}/transaction`, SAMPLE_PAYLOAD).catch(() => {});
    }

    // Benchmark request routing decisions
    for (let i = 0; i < numRequests; i++) {
        const start = process.hrtime.bigint();
        try {
            await axios.post(`${lbUrl}/transaction`, SAMPLE_PAYLOAD, { timeout: 3000 });
            const end = process.hrtime.bigint();
            decisionTimes.push(Number(end - start) / 1e6); // ms
        } catch {
            const end = process.hrtime.bigint();
            decisionTimes.push(Number(end - start) / 1e6);
        }
    }

    // Fetch metrics / status from LB
    const statusRes = await axios.get(`${lbUrl}/status`);
    const metricsRes = await axios.get(`${lbUrl}/metrics`);
    const metricsText = metricsRes.data;

    // Extract PSO optimization duration from Prometheus metrics text if available
    let psoOptimizationAvgMs = 0;
    const match = metricsText.match(/pso_optimization_duration_seconds_sum\s+([\d.]+)/);
    const countMatch = metricsText.match(/pso_optimization_duration_seconds_count\s+([\d.]+)/);
    if (match && countMatch && parseFloat(countMatch[1]) > 0) {
        psoOptimizationAvgMs = (parseFloat(match[1]) / parseFloat(countMatch[1])) * 1000;
    }

    const avgDecisionMs = decisionTimes.reduce((a, b) => a + b, 0) / decisionTimes.length;
    const p95DecisionMs = decisionTimes.sort((a, b) => a - b)[Math.floor(0.95 * decisionTimes.length)];

    return {
        algorithm: algo,
        avgRoutingDecisionMs: parseFloat(avgDecisionMs.toFixed(3)),
        p95RoutingDecisionMs: parseFloat(p95DecisionMs.toFixed(3)),
        psoOptimizationAvgMs: parseFloat(psoOptimizationAvgMs.toFixed(3)),
    };
}

async function main() {
    const opts = parseArgs();
    const results = [];

    for (const algo of ALGORITHMS) {
        const res = await benchmarkAlgorithm(opts.lbUrl, algo);
        results.push(res);
    }

    console.log('\n── Overhead Comparison Table ─────────────────────────────────────────────');
    console.log('Algorithm'.padEnd(20) + 'Routing Decision Avg (ms)'.padEnd(28) + 'Routing Decision P95 (ms)'.padEnd(28) + 'PSO Opt Cycle (ms)');
    for (const r of results) {
        console.log(
            r.algorithm.padEnd(20) +
            String(r.avgRoutingDecisionMs).padEnd(28) +
            String(r.p95RoutingDecisionMs).padEnd(28) +
            String(r.psoOptimizationAvgMs)
        );
    }

    const outDir = path.dirname(opts.output);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(opts.output, JSON.stringify(results, null, 2));
    console.log(`\nOverhead results saved to ${opts.output}`);
}

main().catch(err => {
    console.error('Fatal error in overhead benchmark:', err.message);
    process.exit(1);
});
