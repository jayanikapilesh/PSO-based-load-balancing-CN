'use strict';

/**
 * fitness.js — Nonlinear exponential fitness function for node health evaluation.
 *
 * Implements the weighted exponential cost formula:
 *
 *   Cost(node) =
 *       w_lat  * (exp(α_lat  * L) - 1)
 *     + w_req  * (exp(α_req  * R) - 1)
 *     + w_err  * (exp(α_err  * E) - 1)
 *     + w_cpu  * (exp(α_cpu  * C) - 1)
 *     - w_up   * log(1 + β_up * U)
 *     + trend_penalty
 *
 * Where L, R, E, C, U are normalized [0, 1]:
 *   L = normalized latency          (higher → more costly)
 *   R = normalized active requests  (higher → more costly)
 *   E = normalized error rate       (higher → more costly)
 *   C = normalized CPU utilization  (higher → more costly)
 *   U = normalized uptime ratio     (higher → less costly — reward term)
 *
 * The exponential terms make severe degradation disproportionately expensive
 * compared with mild degradation (non-linear penalty).
 *
 * Latency trend (preserved from original implementation):
 *   trend = currentLatency - smoothedLatency
 *   If trend > 0 (latency rising), add a positive penalty term.
 *
 * Also provides:
 *   - computeLinearCost() — linear ablation baseline (replaces exp with linear)
 *   - normalizeMetrics()  — robust min-max normalization across nodes
 */

const config = require('./config');

// ── Normalization ──────────────────────────────────────────────────────────────
/**
 * Robust min-max normalization.
 * If max == min (all nodes have the same value), returns 0.5 (neutral).
 *
 * @param {number} x
 * @param {number} min
 * @param {number} max
 * @returns {number} value in [0, 1]
 */
function minMaxNorm(x, min, max) {
    if (max === min) return 0.5;
    const norm = (x - min) / (max - min);
    return Math.max(0, Math.min(1, norm));
}

/**
 * Normalizes all five health metrics across a set of nodes.
 *
 * For metrics where HIGHER is WORSE (latency, requests, error, CPU):
 *   normalized value in [0,1] — 1 = worst, 0 = best
 *
 * For uptime where HIGHER is BETTER:
 *   normalized value in [0,1] — 1 = best, 0 = worst
 *   (uptime is NOT inverted here; the fitness function handles the sign)
 *
 * @param {Array} healthNodes — array of health state objects (healthy nodes only)
 * @returns {Array} same array with added `norm` property per node
 */
function normalizeMetrics(healthNodes) {
    if (!healthNodes || healthNodes.length === 0) return [];

    const get = (nodes, key) => nodes.map(n => n[key] || 0);

    const latencies   = get(healthNodes, 'avgLatency');
    const requests    = get(healthNodes, 'activeRequests');
    const errorRates  = get(healthNodes, 'errorRate');
    const cpuValues   = get(healthNodes, 'cpuUtilization');
    const uptimes     = get(healthNodes, 'uptimeRatio');

    const minLat = Math.min(...latencies),  maxLat = Math.max(...latencies);
    const minReq = Math.min(...requests),   maxReq = Math.max(...requests);
    const minErr = Math.min(...errorRates), maxErr = Math.max(...errorRates);
    const minCpu = Math.min(...cpuValues),  maxCpu = Math.max(...cpuValues);
    const minUp  = Math.min(...uptimes),    maxUp  = Math.max(...uptimes);

    return healthNodes.map(n => ({
        ...n,
        norm: {
            latency:  minMaxNorm(n.avgLatency      || 0, minLat, maxLat),
            requests: minMaxNorm(n.activeRequests  || 0, minReq, maxReq),
            error:    minMaxNorm(n.errorRate       || 0, minErr, maxErr),
            cpu:      minMaxNorm(n.cpuUtilization  || 0, minCpu, maxCpu),
            uptime:   minMaxNorm(n.uptimeRatio     || 1, minUp,  maxUp),
        }
    }));
}

// ── Exponential Fitness ────────────────────────────────────────────────────────
/**
 * Computes the exponential health cost for a single node given a weight vector.
 *
 * weights: { latency, requests, error, cpu, uptime }  — must sum to 1
 * norm:    { latency, requests, error, cpu, uptime }  — normalized [0,1]
 *
 * @param {Object} node — health node with `.norm` from normalizeMetrics()
 * @param {Object} weights — PSO weight vector
 * @returns {number} cost (lower = healthier node)
 */
function computeCost(node, weights) {
    const { norm, latencyTrend } = node;
    const { ALPHA_LATENCY, ALPHA_REQUESTS, ALPHA_ERROR, ALPHA_CPU, BETA_UPTIME } = config;

    const latencyCost  = weights.latency  * (Math.exp(ALPHA_LATENCY  * norm.latency)  - 1);
    const requestsCost = weights.requests * (Math.exp(ALPHA_REQUESTS * norm.requests) - 1);
    const errorCost    = weights.error    * (Math.exp(ALPHA_ERROR    * norm.error)    - 1);
    const cpuCost      = weights.cpu      * (Math.exp(ALPHA_CPU      * norm.cpu)      - 1);
    const uptimeReward = weights.uptime   * Math.log(1 + BETA_UPTIME * norm.uptime);

    // ── Latency trend penalty (preserved from original implementation) ────────
    // If latency is rising (trend > 0), add a small additional penalty
    // proportional to the magnitude of the rise.
    // Trend penalty: (1 + trend/10) factor, multiplicative — same as original.
    const trend = latencyTrend || 0;
    const trendPenalty = trend > 0 ? weights.latency * (trend / 10) : 0;

    const cost = latencyCost + requestsCost + errorCost + cpuCost - uptimeReward + trendPenalty;
    return Math.max(0, cost); // ensure non-negative
}

// ── Linear Fitness (ablation baseline) ────────────────────────────────────────
/**
 * Linear fitness function — replaces exponential terms with linear terms.
 * Used for ablation experiment (Section 24 of spec).
 *
 * Linear cost contribution ≈ weight * normalized_metric
 * (minus uptime reward same as above)
 *
 * @param {Object} node
 * @param {Object} weights
 * @returns {number}
 */
function computeLinearCost(node, weights) {
    const { norm, latencyTrend } = node;

    const latencyCost  = weights.latency  * norm.latency;
    const requestsCost = weights.requests * norm.requests;
    const errorCost    = weights.error    * norm.error;
    const cpuCost      = weights.cpu      * norm.cpu;
    const uptimeReward = weights.uptime   * norm.uptime;

    const trend = latencyTrend || 0;
    const trendPenalty = trend > 0 ? weights.latency * (trend / 10) : 0;

    return Math.max(0, latencyCost + requestsCost + errorCost + cpuCost - uptimeReward + trendPenalty);
}

// ── PSO Objective (Swarm Fitness) ──────────────────────────────────────────────
/**
 * Evaluates the quality of a candidate weight vector across all healthy nodes.
 *
 * Objective considers:
 *   1. Mean node cost       — average health-aware cost (lower = better)
 *   2. Load imbalance       — variance of active-request counts (lower = better)
 *   3. Max latency penalty  — penalizes the worst node's latency
 *   4. Max error penalty    — penalizes the worst node's error rate
 *
 * Lower objective = better weight vector.
 *
 * @param {Array} nodesWithNorm — output of normalizeMetrics()
 * @param {Object} weights — candidate weight vector
 * @param {boolean} useLinear — if true, use linear instead of exponential cost
 * @returns {number} objective value (lower = better)
 */
function evaluateObjective(nodesWithNorm, weights, useLinear = false) {
    if (!nodesWithNorm || nodesWithNorm.length === 0) return Infinity;

    const costFn = useLinear ? computeLinearCost : computeCost;
    const costs = nodesWithNorm.map(n => costFn(n, weights));
    const meanCost = costs.reduce((a, b) => a + b, 0) / costs.length;

    // Softmax routing probabilities for nodes under candidate weights
    const T = config.SOFTMAX_TEMPERATURE;
    const expNegCost = costs.map(c => Math.exp(-c / T));
    const totalExp = expNegCost.reduce((a, b) => a + b, 0);
    const probs = expNegCost.map(e => (totalExp > 0 ? e / totalExp : 1 / nodesWithNorm.length));

    // Load imbalance: variance of Softmax node allocation probabilities under candidate weights
    const meanProb = 1 / nodesWithNorm.length;
    const loadVariance = probs.reduce((s, p) => s + Math.pow(p - meanProb, 2), 0) / nodesWithNorm.length;

    // Expected system latency and error rate weighted by routing probabilities under candidate weights
    const expectedLatency = probs.reduce((s, p, i) => s + p * nodesWithNorm[i].norm.latency, 0);
    const expectedError   = probs.reduce((s, p, i) => s + p * nodesWithNorm[i].norm.error, 0);

    // Composite objective (all terms depend directly on candidate weight vector)
    const objective = meanCost + 0.5 * loadVariance + 0.2 * expectedLatency + 0.3 * expectedError;
    return objective;
}

module.exports = { normalizeMetrics, computeCost, computeLinearCost, evaluateObjective };
