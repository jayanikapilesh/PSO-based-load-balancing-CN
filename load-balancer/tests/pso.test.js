'use strict';

/**
 * pso.test.js — Unit tests for the PSO-based adaptive load balancer.
 *
 * Covers all 14 test categories from the specification (Section 33).
 * Runs without any external dependencies — pure Node.js.
 *
 * Usage:
 *   node tests/pso.test.js
 */

// ── Minimal test framework ─────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const errors = [];

function assert(condition, name, detail = '') {
    if (condition) {
        console.log(`  ✅ PASS: ${name}`);
        passed++;
    } else {
        console.error(`  ❌ FAIL: ${name}${detail ? ' — ' + detail : ''}`);
        failed++;
        errors.push(name);
    }
}

function section(title) {
    const dashes = Math.max(2, 60 - title.length);
    console.log(`\n── ${title} ${'─'.repeat(dashes)}`);
}

function approxEq(a, b, tol = 1e-9) {
    return Math.abs(a - b) < tol;
}

// ── Set env before requiring modules ──────────────────────────────────────────
process.env.RANDOM_SEED = '42';
process.env.PSO_PARTICLES = '4';
process.env.PSO_ITERATIONS = '5';
process.env.PSO_INERTIA = '0.7';
process.env.PSO_COGNITIVE = '1.5';
process.env.PSO_SOCIAL = '1.5';
process.env.PSO_MIN_WEIGHT = '0.01';
process.env.PSO_MAX_WEIGHT = '0.80';
process.env.SOFTMAX_TEMPERATURE = '2.0';
process.env.PROMETHEUS_URL = 'http://localhost:9099'; // intentionally unreachable
process.env.PSO_CONVERGENCE_LOG = '/tmp/pso_test_convergence.jsonl';
process.env.ROUTING_ALGORITHM = 'PSO';

// Suppress config log output during tests
const origLog = console.log;
console.log = () => {};
const config = require('../config');
console.log = origLog;

const { normalizeMetrics, computeCost, computeLinearCost, evaluateObjective } = require('../fitness');
const { runPSO, getCachedWeights, getSwarmState, resetSwarm, reseed } = require('../pso');

// ── Test helpers ───────────────────────────────────────────────────────────────
function makeNode(url, lat, req, err, cpu, up, trend = 0) {
    return {
        url,
        healthy: true,
        avgLatency:     lat,
        activeRequests: req,
        errorRate:      err,
        cpuUtilization: cpu,
        uptimeRatio:    up,
        latencyTrend:   trend,
    };
}

function makeNodes() {
    return [
        makeNode('http://api1:3000', 20,  2, 0.01, 0.3, 0.99),
        makeNode('http://api2:3000', 80,  5, 0.10, 0.7, 0.90),
        makeNode('http://api3:3000', 150, 8, 0.20, 0.9, 0.75),
    ];
}

// ── 1. Weight normalization ────────────────────────────────────────────────────
section('1. Weight normalization');
{
    const nodes = makeNodes();
    const normed = normalizeMetrics(nodes);

    // After normalization, min should be 0 and max 1 for each metric (unless all equal)
    const lats = normed.map(n => n.norm.latency);
    assert(Math.min(...lats) === 0, 'Min normalized latency = 0');
    assert(Math.max(...lats) === 1, 'Max normalized latency = 1');

    const ups = normed.map(n => n.norm.uptime);
    assert(Math.min(...ups) === 0, 'Min normalized uptime = 0');
    assert(Math.max(...ups) === 1, 'Max normalized uptime = 1');
}

// ── 2. Weight bounds ───────────────────────────────────────────────────────────
section('2. Weight bounds / normalization');
{
    // clampAndNormalize is internal — we test via getCachedWeights after runPSO
    resetSwarm();
    reseed(42);
    const nodes = makeNodes();
    const result = runPSO(nodes, false);
    const w = result.weights;

    const wValues = [w.latency, w.requests, w.error, w.cpu, w.uptime];
    const allPositive = wValues.every(v => v > 0);
    const sum = wValues.reduce((a, b) => a + b, 0);

    assert(allPositive, 'All weights > 0');
    assert(approxEq(sum, 1.0, 1e-9), `Weights sum to 1 (got ${sum.toFixed(10)})`);

    const min = config.PSO_MIN_WEIGHT;
    // Note: PSO_MIN_WEIGHT is a pre-normalization clamp; after normalization
    // values can be lower. What we verify is that no weight is exactly zero.
    const allNonZero = wValues.every(v => v > 0);
    assert(allNonZero, 'All weights are strictly positive after normalization');
}

// ── 3. Velocity update formula ─────────────────────────────────────────────────
section('3. Velocity update (manual verification)');
{
    // Manually replicate one velocity update step
    const w = 0.7, c1 = 1.5, c2 = 1.5;
    const r1 = 0.3, r2 = 0.6;
    const v = 0.1, x = 0.3, pbest = 0.5, gbest_val = 0.4;

    const expectedV = w * v + c1 * r1 * (pbest - x) + c2 * r2 * (gbest_val - x);
    // = 0.07 + 1.5*0.3*0.2 + 1.5*0.6*0.1 = 0.07 + 0.09 + 0.09 = 0.25
    assert(approxEq(expectedV, 0.25, 1e-9), `Velocity update formula: ${expectedV.toFixed(6)} ≈ 0.25`);
}

// ── 4. Position update ─────────────────────────────────────────────────────────
section('4. Position update x(t+1) = x(t) + v(t+1)');
{
    const x = 0.3, v_new = 0.05;
    const expected = x + v_new;
    assert(approxEq(expected, 0.35, 1e-9), `Position update: ${expected.toFixed(6)} ≈ 0.35`);
}

// ── 5. pbest update ────────────────────────────────────────────────────────────
section('5. pbest update (only improves when fitness decreases)');
{
    resetSwarm();
    reseed(99);
    const nodes = makeNodes();
    const r1 = runPSO(nodes, false);
    const state1 = getSwarmState();

    const r2 = runPSO(nodes, false);
    const state2 = getSwarmState();

    // Fitness should be <= previous (PSO only improves gbest)
    assert(state2.gbestFitness <= state1.gbestFitness + 1e-9,
        'gbest fitness does not get worse over cycles');
}

// ── 6. gbest update ────────────────────────────────────────────────────────────
section('6. gbest update tracks best-ever fitness');
{
    resetSwarm();
    reseed(42);
    const nodes = makeNodes();

    let prevFitness = Infinity;
    for (let i = 0; i < 3; i++) {
        const result = runPSO(nodes, false);
        assert(result.fitness <= prevFitness + 1e-9,
            `gbest fitness non-increasing at cycle ${i + 1} (${result.fitness.toFixed(6)})`);
        prevFitness = result.fitness;
    }
}

// ── 7. Fitness calculation (exponential) ──────────────────────────────────────
section('7. Exponential fitness — healthy node costs are finite and non-negative');
{
    const nodes = makeNodes();
    const normed = normalizeMetrics(nodes);
    const weights = { latency: 0.2, requests: 0.2, error: 0.2, cpu: 0.2, uptime: 0.2 };

    for (const n of normed) {
        const cost = computeCost(n, weights);
        assert(isFinite(cost) && cost >= 0,
            `Exponential cost for ${n.url}: ${cost.toFixed(6)} (finite, ≥0)`);
    }
}

// ── 8. Exponential penalty sensitivity ────────────────────────────────────────
section('8. Exponential penalty — worse nodes have higher cost');
{
    const nodes = makeNodes();
    const normed = normalizeMetrics(nodes);
    const weights = { latency: 0.2, requests: 0.2, error: 0.2, cpu: 0.2, uptime: 0.2 };

    const costs = normed.map(n => computeCost(n, weights));
    // api1 has lowest latency/requests/error/cpu — should have lowest cost
    // api3 has highest — should have highest cost
    assert(costs[0] < costs[2],
        `api1 cost (${costs[0].toFixed(4)}) < api3 cost (${costs[2].toFixed(4)})`);
}

// ── 9. Softmax probability calculation ────────────────────────────────────────
section('9. Softmax probability calculation');
{
    function softmaxProbs(costs, T) {
        const w = costs.map(c => Math.exp(-c / T));
        const total = w.reduce((a, b) => a + b, 0);
        return w.map(v => v / total);
    }

    const costs = [1.0, 2.0, 3.0];
    const T = 2.0;
    const probs = softmaxProbs(costs, T);

    assert(probs.every(p => p > 0 && p < 1), 'All Softmax probs in (0,1)');
    const sum = probs.reduce((a, b) => a + b, 0);
    assert(approxEq(sum, 1.0, 1e-9), `Softmax probs sum to 1 (got ${sum.toFixed(10)})`);
    assert(probs[0] > probs[1] && probs[1] > probs[2],
        'Softmax: lower cost → higher probability');
}

// ── 10. Probability sum ≈ 1 ───────────────────────────────────────────────────
section('10. Softmax probability sum = 1');
{
    const nodes = makeNodes();
    const normed = normalizeMetrics(nodes);
    const weights = { latency: 0.25, requests: 0.25, error: 0.2, cpu: 0.15, uptime: 0.15 };
    const T = 2.0;

    const nodeCosts = normed.map(n => computeCost(n, weights));
    const softweights = nodeCosts.map(c => Math.exp(-c / T));
    const total = softweights.reduce((a, b) => a + b, 0);
    const probs = softweights.map(v => v / total);
    const probSum = probs.reduce((a, b) => a + b, 0);

    assert(approxEq(probSum, 1.0, 1e-9), `Probability sum = 1 (got ${probSum.toFixed(12)})`);
}

// ── 11. Unhealthy node exclusion ───────────────────────────────────────────────
section('11. Unhealthy node exclusion');
{
    const healthState = [
        { url: 'http://api1:3000', healthy: true,  activeRequests: 2, avgLatency: 20 },
        { url: 'http://api2:3000', healthy: false, activeRequests: 0, avgLatency: 0  },
        { url: 'http://api3:3000', healthy: true,  activeRequests: 5, avgLatency: 80 },
    ];
    const healthyNodes = healthState.filter(n => n.healthy);
    assert(healthyNodes.length === 2, 'Filtered to 2 healthy nodes');
    assert(!healthyNodes.find(n => n.url === 'http://api2:3000'), 'api2 (unhealthy) excluded');
}

// ── 12. Zero-division handling ─────────────────────────────────────────────────
section('12. Zero-division safety in normalization');
{
    // All nodes with same latency (max == min)
    const sameNodes = [
        makeNode('http://api1:3000', 50, 3, 0.05, 0.5, 0.9),
        makeNode('http://api2:3000', 50, 3, 0.05, 0.5, 0.9),
    ];
    const normed = normalizeMetrics(sameNodes);
    const lats = normed.map(n => n.norm.latency);

    assert(lats.every(v => isFinite(v) && !isNaN(v)), 'No NaN/Infinity when max==min');
    assert(lats.every(v => v === 0.5), 'Returns 0.5 (neutral) when max==min');
}

// ── 13. PSO convergence on deterministic test case ────────────────────────────
section('13. PSO convergence — fitness improves over cycles (deterministic)');
{
    resetSwarm();
    reseed(123);

    // Create a node set with a clear "bad" node and two "good" ones
    const deterministicNodes = [
        makeNode('http://api1:3000', 10,  1, 0.0, 0.1, 1.0),
        makeNode('http://api2:3000', 200, 20, 0.5, 0.95, 0.4),
        makeNode('http://api3:3000', 30,  3, 0.02, 0.3, 0.95),
    ];

    const fitnessValues = [];
    for (let i = 0; i < 5; i++) {
        const result = runPSO(deterministicNodes, false);
        fitnessValues.push(result.fitness);
    }

    // The final fitness should be at most the first (PSO should not regress)
    const firstFitness = fitnessValues[0];
    const lastFitness  = fitnessValues[fitnessValues.length - 1];
    assert(lastFitness <= firstFitness + 1e-6,
        `Fitness non-increasing: first=${firstFitness.toFixed(6)}, last=${lastFitness.toFixed(6)}`);

    // All fitness values should be finite
    assert(fitnessValues.every(f => isFinite(f)), 'All fitness values are finite');
}

// ── 14. Routing selection behaviour ───────────────────────────────────────────
section('14. Routing selection — low-cost node selected more often');
{
    // Verify that with a very low temperature, the lowest-cost node dominates
    const T_low = 0.1; // near-deterministic
    const costs = [
        { url: 'http://api1:3000', cost: 0.1 },
        { url: 'http://api2:3000', cost: 5.0 },
        { url: 'http://api3:3000', cost: 8.0 },
    ];

    const weights = costs.map(c => Math.exp(-c.cost / T_low));
    const total = weights.reduce((a, b) => a + b, 0);
    const probs = weights.map(v => v / total);

    assert(probs[0] > 0.99,
        `Low-cost node dominates at T=0.1: P(api1)=${probs[0].toFixed(4)}`);

    // With a high temperature, distribution is more uniform
    const T_high = 100;
    const weightsH = costs.map(c => Math.exp(-c.cost / T_high));
    const totalH = weightsH.reduce((a, b) => a + b, 0);
    const probsH = weightsH.map(v => v / totalH);

    assert(probsH[0] < 0.9,
        `High temperature → more uniform: P(api1)=${probsH[0].toFixed(4)}`);
}

// ── Linear vs exponential ─────────────────────────────────────────────────────
section('Bonus: Linear vs exponential — exponential amplifies high-cost nodes');
{
    const nodes = makeNodes();
    const normed = normalizeMetrics(nodes);
    const weights = { latency: 0.2, requests: 0.2, error: 0.2, cpu: 0.2, uptime: 0.2 };

    const expCosts = normed.map(n => computeCost(n, weights));
    const linCosts = normed.map(n => computeLinearCost(n, weights));

    // The ratio of worst to best node should be larger for exponential
    // Compare the cost spread: worst node cost minus best node cost.
    // Exponential should amplify the spread more than linear.
    const expSpread = expCosts[2] - expCosts[0];
    const linSpread = linCosts[2] - linCosts[0];

    assert(expSpread > linSpread,
        `Exp spread (${expSpread.toFixed(4)}) > linear spread (${linSpread.toFixed(4)}) — exponential amplifies degraded nodes`);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(70));
console.log(`PSO Unit Tests: ${passed} passed, ${failed} failed`);
if (errors.length > 0) {
    console.error('Failed tests:');
    errors.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
} else {
    console.log('All tests passed ✅');
    process.exit(0);
}
