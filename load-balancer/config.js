'use strict';

/**
 * config.js — Centralized PSO and routing configuration.
 *
 * All parameters are loaded from environment variables so that experiments
 * can be reproduced and compared without code changes.
 *
 * To override any parameter, set the environment variable before starting
 * the load-balancer container, e.g.:
 *   PSO_PARTICLES=12 PSO_ITERATIONS=50 node balancer.js
 */

function parseFloat_(key, defaultVal) {
    const v = process.env[key];
    if (v === undefined || v === '') return defaultVal;
    const n = parseFloat(v);
    return isNaN(n) ? defaultVal : n;
}

function parseInt_(key, defaultVal) {
    const v = process.env[key];
    if (v === undefined || v === '') return defaultVal;
    const n = parseInt(v, 10);
    return isNaN(n) ? defaultVal : n;
}

function parseStr_(key, defaultVal) {
    const v = process.env[key];
    return (v === undefined || v === '') ? defaultVal : v.trim().toUpperCase();
}

const config = {
    // ── PSO Core Parameters ──────────────────────────────────────────────────
    /** Number of particles in the swarm (paper uses 8). */
    PSO_PARTICLES: parseInt_('PSO_PARTICLES', 8),

    /** Number of PSO iterations per optimization cycle. */
    PSO_ITERATIONS: parseInt_('PSO_ITERATIONS', 30),

    /** Inertia weight w — controls momentum of particle velocity. */
    PSO_INERTIA: parseFloat_('PSO_INERTIA', 0.7),

    /** Cognitive coefficient c1 — pull toward particle's personal best. */
    PSO_COGNITIVE: parseFloat_('PSO_COGNITIVE', 1.5),

    /** Social coefficient c2 — pull toward swarm's global best. */
    PSO_SOCIAL: parseFloat_('PSO_SOCIAL', 1.5),

    /** Minimum value for any weight component (before normalization). */
    PSO_MIN_WEIGHT: parseFloat_('PSO_MIN_WEIGHT', 0.01),

    /** Maximum value for any weight component (before normalization). */
    PSO_MAX_WEIGHT: parseFloat_('PSO_MAX_WEIGHT', 0.80),

    /**
     * How often (ms) the PSO optimization cycle runs.
     * PSO does NOT run per-request; weights are cached between cycles.
     */
    PSO_INTERVAL_MS: parseInt_('PSO_INTERVAL_MS', 5000),

    // ── Softmax ───────────────────────────────────────────────────────────────
    /**
     * Softmax temperature T.
     * Lower T → more deterministic; higher T → more uniform distribution.
     * Current manuscript value: 2.0
     */
    SOFTMAX_TEMPERATURE: parseFloat_('SOFTMAX_TEMPERATURE', 2.0),

    // ── Reproducibility ───────────────────────────────────────────────────────
    /**
     * Random seed for PSO. Set to a fixed integer for reproducible runs.
     * Set RANDOM_SEED=0 to use a time-based seed (non-reproducible).
     */
    RANDOM_SEED: parseInt_('RANDOM_SEED', 42),

    // ── Routing Algorithm ─────────────────────────────────────────────────────
    /**
     * Selects the routing algorithm:
     *   PSO                — Full PSO + Exponential Fitness + Softmax  (proposed)
     *   PSO_WITHOUT_SOFTMAX— PSO + Exponential Fitness + Deterministic min-cost
     *   PSO_LINEAR_FITNESS — PSO + Linear Fitness + Softmax
     *   FIXED_HEALTH       — Static weights + Exponential Fitness + Softmax
     *   ROUND_ROBIN        — Simple round-robin
     *   LEAST_CONNECTIONS  — Route to node with fewest active requests
     */
    ROUTING_ALGORITHM: parseStr_('ROUTING_ALGORITHM', 'PSO'),

    // ── Fitness Function Parameters ───────────────────────────────────────────
    /**
     * Exponential scaling for latency term: exp(alpha_latency * L_norm) - 1
     * Higher value → more sensitive to latency spikes.
     */
    ALPHA_LATENCY: parseFloat_('ALPHA_LATENCY', 3.0),

    /** Exponential scaling for active-requests term. */
    ALPHA_REQUESTS: parseFloat_('ALPHA_REQUESTS', 2.0),

    /** Exponential scaling for error-rate term. */
    ALPHA_ERROR: parseFloat_('ALPHA_ERROR', 4.0),

    /** Exponential scaling for CPU-utilization term. */
    ALPHA_CPU: parseFloat_('ALPHA_CPU', 2.5),

    /**
     * Log scaling for uptime reward: log(1 + beta_uptime * U_norm)
     * Higher value → stronger reward for high uptime nodes.
     */
    BETA_UPTIME: parseFloat_('BETA_UPTIME', 5.0),

    /**
     * Target/reference latency (ms) used for legacy latency-trend penalty.
     * Preserved from original implementation (was 50.0).
     */
    TARGET_LATENCY: parseFloat_('TARGET_LATENCY', 50.0),

    // ── Health Metric Windows ─────────────────────────────────────────────────
    /**
     * Rolling window (seconds) for error-rate calculation.
     * Error rate = errors in window / requests in window.
     */
    ERROR_RATE_WINDOW_S: parseInt_('ERROR_RATE_WINDOW_S', 60),

    /**
     * Number of health-check polls to keep for uptime/reliability ratio.
     */
    UPTIME_WINDOW_POLLS: parseInt_('UPTIME_WINDOW_POLLS', 60),

    // ── Prometheus / Prometheus CPU query ─────────────────────────────────────
    /** URL of the Prometheus server (for CPU metric queries via PromQL). */
    PROMETHEUS_URL: process.env.PROMETHEUS_URL || 'http://prometheus:9090',

    /**
     * How often (ms) to refresh CPU metrics from Prometheus.
     * Defaults to same as PSO interval.
     */
    CPU_REFRESH_MS: parseInt_('CPU_REFRESH_MS', 5000),

    // ── Fraud Detection ───────────────────────────────────────────────────────
    /**
     * Fraud probability threshold. Preserved from original implementation.
     * Do NOT change without updating the notebook and manuscript.
     */
    FRAUD_THRESHOLD: parseFloat_('FRAUD_THRESHOLD', 0.3),

    // ── Logging ───────────────────────────────────────────────────────────────
    /** Path for PSO convergence JSONL log (mounted volume). */
    PSO_CONVERGENCE_LOG: process.env.PSO_CONVERGENCE_LOG || '/app/logs/pso_convergence.jsonl',

    /** Path for experiment result JSON files. */
    EXPERIMENT_LOG: process.env.EXPERIMENT_LOG || '/app/logs/experiment_results.jsonl',
};

// Validate algorithm
const VALID_ALGORITHMS = [
    'PSO', 'PSO_WITHOUT_SOFTMAX', 'PSO_LINEAR_FITNESS',
    'FIXED_HEALTH', 'ROUND_ROBIN', 'LEAST_CONNECTIONS'
];
if (!VALID_ALGORITHMS.includes(config.ROUTING_ALGORITHM)) {
    console.warn(
        `[CONFIG] Unknown ROUTING_ALGORITHM="${config.ROUTING_ALGORITHM}". Defaulting to PSO.`
    );
    config.ROUTING_ALGORITHM = 'PSO';
}

console.log('[CONFIG] Loaded configuration:', JSON.stringify(config, null, 2));

module.exports = config;
