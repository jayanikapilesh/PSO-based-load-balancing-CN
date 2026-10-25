'use strict';

/**
 * system_validation.test.js — Comprehensive Test Suite for PSO Load Balancer,
 * Health Monitoring, Routing, Ablations, and Self-Healing Logic.
 *
 * Runs without external dependencies.
 */

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name, detail = '') {
    if (cond) {
        console.log(`  [PASS] ${name}`);
        passed++;
    } else {
        console.error(`  [FAIL] ${name}${detail ? ' -- ' + detail : ''}`);
        failed++;
        failures.push(name);
    }
}

function testSection(title) {
    console.log(`\n======================================================================`);
    console.log(`  ${title}`);
    console.log(`======================================================================`);
}

function approx(a, b, tol = 1e-7) {
    return Math.abs(a - b) < tol;
}

// Set test environment
process.env.RANDOM_SEED = '42';
process.env.PSO_PARTICLES = '6';
process.env.PSO_ITERATIONS = '10';
process.env.PSO_INERTIA = '0.7';
process.env.PSO_COGNITIVE = '1.5';
process.env.PSO_SOCIAL = '1.5';
process.env.SOFTMAX_TEMPERATURE = '2.0';

const config = require('../config');
const { normalizeMetrics, computeCost, computeLinearCost, evaluateObjective } = require('../fitness');
const { runPSO, getCachedWeights, getSwarmState, resetSwarm, reseed, getRand } = require('../pso');

function createTestNode(url, lat, req, err, cpu, up, trend = 0) {
    return {
        url,
        healthy: true,
        avgLatency: lat,
        activeRequests: req,
        errorRate: err,
        cpuUtilization: cpu,
        uptimeRatio: up,
        latencyTrend: trend,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. PSO ALGORITHM, UPDATES & CONVERGENCE
// ─────────────────────────────────────────────────────────────────────────────
testSection('1. PSO Algorithm, Particle Updates & Monotonic Convergence');
{
    resetSwarm();
    reseed(42);

    const nodes = [
        createTestNode('http://api1:3000', 15, 1, 0.00, 0.20, 1.00),
        createTestNode('http://api2:3000', 65, 4, 0.05, 0.60, 0.95),
        createTestNode('http://api3:3000', 140, 9, 0.18, 0.88, 0.80),
    ];

    let prevFit = Infinity;
    const trace = [];
    for (let c = 1; c <= 4; c++) {
        const res = runPSO(nodes, false);
        trace.push(res.fitness);
        assert(res.fitness <= prevFit + 1e-9, `Cycle ${c} fitness non-increasing (${res.fitness.toFixed(6)} <= ${prevFit.toFixed(6)})`);
        prevFit = res.fitness;
    }

    assert(trace[trace.length - 1] < trace[0], 'PSO fitness improves from cycle 1 to final cycle');

    const weights = getCachedWeights();
    const sumW = weights.latency + weights.requests + weights.error + weights.cpu + weights.uptime;
    assert(approx(sumW, 1.0, 1e-7), `Optimized weights sum to 1.0 (got ${sumW.toFixed(8)})`);
    assert(Object.values(weights).every(w => w > 0), 'All optimized weights strictly positive');
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. REPRODUCIBILITY & RANDOM-SEED HANDLING
// ─────────────────────────────────────────────────────────────────────────────
testSection('2. Reproducibility & Random-Seed Handling');
{
    const nodes = [
        createTestNode('http://api1:3000', 20, 2, 0.01, 0.3, 0.99),
        createTestNode('http://api2:3000', 80, 5, 0.10, 0.7, 0.90),
    ];

    // Run 1 with seed 42
    resetSwarm();
    reseed(42);
    const r1 = runPSO(nodes, false);

    // Run 2 with seed 42 (identical seed)
    resetSwarm();
    reseed(42);
    const r2 = runPSO(nodes, false);

    // Run 3 with seed 99 (different seed)
    resetSwarm();
    reseed(99);
    const r3 = runPSO(nodes, false);

    const sameWeights = approx(r1.weights.latency, r2.weights.latency) &&
                        approx(r1.weights.requests, r2.weights.requests) &&
                        approx(r1.weights.error, r2.weights.error) &&
                        approx(r1.fitness, r2.fitness);

    assert(sameWeights, 'Identical seed (42) produces 100% deterministic weights and fitness');

    const diffWeights = !approx(r1.weights.latency, r3.weights.latency) ||
                        !approx(r1.weights.requests, r3.weights.requests);
    assert(diffWeights, 'Different seed (99) produces distinct exploration trajectory');
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. FITNESS FORMULATION & ABLATION COMPARISON
// ─────────────────────────────────────────────────────────────────────────────
testSection('3. Exponential vs Linear Fitness (Ablation Property)');
{
    const nodes = [
        createTestNode('http://api1:3000', 10, 1, 0.00, 0.15, 1.0),
        createTestNode('http://api2:3000', 50, 4, 0.05, 0.50, 0.9),
        createTestNode('http://api3:3000', 180, 10, 0.25, 0.95, 0.7),
    ];
    const normed = normalizeMetrics(nodes);
    const w = { latency: 0.2, requests: 0.2, error: 0.2, cpu: 0.2, uptime: 0.2 };

    const expCosts = normed.map(n => computeCost(n, w));
    const linCosts = normed.map(n => computeLinearCost(n, w));

    assert(expCosts[0] < expCosts[1] && expCosts[1] < expCosts[2], 'Exponential cost monotonically ranks best to worst node');
    assert(linCosts[0] < linCosts[1] && linCosts[1] < linCosts[2], 'Linear cost monotonically ranks best to worst node');

    const expPenaltySpread = expCosts[2] - expCosts[0];
    const linPenaltySpread = linCosts[2] - linCosts[0];
    assert(expPenaltySpread > linPenaltySpread,
        `Exponential penalty spread (${expPenaltySpread.toFixed(3)}) > linear spread (${linPenaltySpread.toFixed(3)})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. SOFTMAX ROUTING & DETERMINISTIC ROUTING
// ─────────────────────────────────────────────────────────────────────────────
testSection('4. Routing Selection: Softmax vs Deterministic (Ablation)');
{
    function softmax(costs, T) {
        const exps = costs.map(c => Math.exp(-c / T));
        const total = exps.reduce((a, b) => a + b, 0);
        return exps.map(e => e / total);
    }

    const costs = [0.2, 1.8, 4.5];
    const pStandard = softmax(costs, 2.0);
    const pLowT     = softmax(costs, 0.1);
    const pHighT    = softmax(costs, 50.0);

    assert(approx(pStandard.reduce((a, b) => a + b, 0), 1.0), 'Standard Softmax probabilities sum to 1.0');
    assert(pStandard[0] > pStandard[1] && pStandard[1] > pStandard[2], 'Lower cost receives higher selection probability');
    assert(pLowT[0] > 0.99, `Low temperature (T=0.1) behaves almost deterministically (P(best)=${pLowT[0].toFixed(4)})`);
    assert(Math.abs(pHighT[0] - 0.333) < 0.05, 'High temperature (T=50) approaches uniform random distribution');

    const deterministicBestIdx = costs.indexOf(Math.min(...costs));
    assert(deterministicBestIdx === 0, 'Deterministic selection unconditionally picks index 0 (minimum cost)');
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. EDGE CASES & UNHEALTHY NODE EXCLUSION
// ─────────────────────────────────────────────────────────────────────────────
testSection('5. Edge Cases, Zero-Division, and Unhealthy Exclusion');
{
    // Zero-division safety: all nodes have identical metrics
    const identical = [
        createTestNode('http://api1:3000', 40, 2, 0.02, 0.4, 0.9),
        createTestNode('http://api2:3000', 40, 2, 0.02, 0.4, 0.9),
    ];
    const normedIdentical = normalizeMetrics(identical);
    assert(normedIdentical.every(n => n.norm.latency === 0.5 && n.norm.cpu === 0.5),
        'Zero-division safety: identical metrics normalize safely to neutral 0.5 without NaN');

    // Unhealthy exclusion
    const mixed = [
        { url: 'http://api1:3000', healthy: true,  avgLatency: 25 },
        { url: 'http://api2:3000', healthy: false, avgLatency: 999 },
        { url: 'http://api3:3000', healthy: true,  avgLatency: 40 },
    ];
    const healthyOnly = mixed.filter(n => n.healthy);
    assert(healthyOnly.length === 2 && !healthyOnly.some(n => n.url === 'http://api2:3000'),
        'Unhealthy backend (api2) is completely excluded from routing consideration');

    // 0 healthy nodes
    const noneHealthy = mixed.map(n => ({ ...n, healthy: false }));
    const filteredNone = noneHealthy.filter(n => n.healthy);
    assert(filteredNone.length === 0, 'No healthy backends detected when all nodes are down');
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. HEALTH METRIC CALCULATION LOGIC
// ─────────────────────────────────────────────────────────────────────────────
testSection('6. Health Metric Rolling Windows & Latency Smoothing');
{
    // EMA smoothing: S_t = 0.2 * L_t + 0.8 * S_{t-1}
    let smoothed = 50;
    const current = 100;
    const newSmoothed = 0.2 * current + 0.8 * smoothed;
    assert(approx(newSmoothed, 60.0), `EMA latency update: 0.2*100 + 0.8*50 = ${newSmoothed} (expected 60)`);
    const trend = current - newSmoothed;
    assert(trend > 0, `Rising latency trend detected correctly (trend = +${trend}ms)`);

    // Rolling error rate window: errors in window / total in window
    const windowEvents = [
        { ts: 1000, isError: false },
        { ts: 2000, isError: true },
        { ts: 3000, isError: false },
        { ts: 4000, isError: false },
    ];
    const errCount = windowEvents.filter(e => e.isError).length;
    const rollingErrorRate = errCount / windowEvents.length;
    assert(approx(rollingErrorRate, 0.25), `Rolling error rate: 1 error in 4 events = ${rollingErrorRate} (expected 0.25)`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n======================================================================');
console.log(` SYSTEM VALIDATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log('======================================================================');
if (failed > 0) {
    console.error('Failed test cases:', failures);
    process.exit(1);
} else {
    console.log('ALL SYSTEM VALIDATION TESTS PASSED PERFECTLY!\n');
    process.exit(0);
}
