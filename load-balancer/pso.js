'use strict';

/**
 * pso.js — Genuine Particle Swarm Optimization for health-metric weight tuning.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ARCHITECTURE
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *   PSO optimizes a WEIGHT VECTOR — not a routing decision.
 *   The optimized weights are fed into the exponential fitness function,
 *   which in turn feeds the Softmax routing selector.
 *
 *   Weight vector W = [w_latency, w_requests, w_error, w_cpu, w_uptime]
 *   ∑ W = 1,  each w_i ≥ PSO_MIN_WEIGHT
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * PSO ALGORITHM (standard formulation)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *   For each particle i at time t:
 *
 *     v_i(t+1) = w * v_i(t)
 *              + c1 * r1 * (pbest_i - x_i(t))
 *              + c2 * r2 * (gbest   - x_i(t))
 *
 *     x_i(t+1) = x_i(t) + v_i(t+1)
 *
 *   Then:
 *     - Clamp each dimension to [PSO_MIN_WEIGHT, PSO_MAX_WEIGHT]
 *     - Normalize so ∑ w_j = 1
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * REPRODUCIBILITY
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *   Uses a seeded Mulberry32 PRNG instead of Math.random().
 *   Set RANDOM_SEED env var to reproduce any run exactly.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * CONVERGENCE LOGGING
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *   Every PSO iteration records:
 *     { timestamp, cycle, iteration, bestFitness, gbest }
 *   Written to PSO_CONVERGENCE_LOG (JSONL format) for later analysis.
 */

const fs   = require('fs');
const path = require('path');
const config = require('./config');
const { normalizeMetrics, evaluateObjective } = require('./fitness');

// ── Seeded PRNG (Mulberry32) ──────────────────────────────────────────────────
/**
 * Creates a seeded pseudo-random number generator (Mulberry32).
 * Returns a function that generates uniform [0, 1) values.
 *
 * @param {number} seed — integer seed
 * @returns {function(): number}
 */
function createPRNG(seed) {
    let s = seed >>> 0;
    return function () {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Effective seed: if RANDOM_SEED == 0, use time-based seed (non-reproducible).
const effectiveSeed = config.RANDOM_SEED === 0 ? Date.now() : config.RANDOM_SEED;
let rand = createPRNG(effectiveSeed);

/**
 * Re-seeds the PRNG. Useful for running multiple independent experiments.
 * @param {number} seed
 */
function reseed(seed) {
    rand = createPRNG(seed === 0 ? Date.now() : seed);
}

// ── Weight vector helpers ──────────────────────────────────────────────────────
const DIM = 5; // [latency, requests, error, cpu, uptime]
const DIMS = ['latency', 'requests', 'error', 'cpu', 'uptime'];

/**
 * Converts a raw position array [5] to a named weight object.
 */
function posToWeights(pos) {
    return {
        latency:  pos[0],
        requests: pos[1],
        error:    pos[2],
        cpu:      pos[3],
        uptime:   pos[4],
    };
}

/**
 * Converts a named weight object to a position array [5].
 */
function weightsToPOS(w) {
    return [w.latency, w.requests, w.error, w.cpu, w.uptime];
}

/**
 * Clamps each dimension to [min, max], then normalizes so values sum to 1.
 * Ensures all weights are non-negative.
 *
 * @param {number[]} pos
 * @returns {number[]} clamped + normalized position
 */
function clampAndNormalize(pos) {
    const min = config.PSO_MIN_WEIGHT;
    const max = config.PSO_MAX_WEIGHT;

    // Step 1: clamp
    const clamped = pos.map(v => Math.max(min, Math.min(max, v)));

    // Step 2: ensure all non-negative (already guaranteed by clamp with min > 0)
    const sum = clamped.reduce((a, b) => a + b, 0);

    // Step 3: normalize
    if (sum === 0) {
        // Fallback: uniform weights
        return clamped.map(() => 1 / DIM);
    }
    return clamped.map(v => v / sum);
}

/**
 * Generates a random initial position (normalized weight vector).
 */
function randomPosition() {
    const raw = Array.from({ length: DIM }, () => rand() * config.PSO_MAX_WEIGHT);
    return clampAndNormalize(raw);
}

/**
 * Generates a random initial velocity (small perturbation).
 */
function randomVelocity() {
    const range = config.PSO_MAX_WEIGHT - config.PSO_MIN_WEIGHT;
    return Array.from({ length: DIM }, () => (rand() - 0.5) * range * 0.2);
}

// ── Particle factory ───────────────────────────────────────────────────────────
/**
 * Creates a single particle.
 */
function createParticle() {
    const position = randomPosition();
    return {
        position:     [...position],
        velocity:     randomVelocity(),
        pbest:        [...position],     // personal best position
        pbestFitness: Infinity,          // personal best fitness (lower = better)
    };
}

// ── Swarm state ───────────────────────────────────────────────────────────────
let swarm        = [];
let gbest        = null;   // global best position (array)
let gbestFitness = Infinity;
let gbestWeights = null;   // named weight object derived from gbest

// Default initial weights (equal distribution — used until first PSO cycle)
const DEFAULT_WEIGHTS = {
    latency:  0.2,
    requests: 0.2,
    error:    0.2,
    cpu:      0.2,
    uptime:   0.2,
};

let cachedWeights = { ...DEFAULT_WEIGHTS };
let optimizationCycle = 0;

// ── Convergence log ───────────────────────────────────────────────────────────
function logConvergence(cycle, iteration, bestFitness, gbestPos) {
    const entry = {
        timestamp:   new Date().toISOString(),
        cycle,
        iteration,
        bestFitness,
        gbest: {
            latency:  gbestPos[0],
            requests: gbestPos[1],
            error:    gbestPos[2],
            cpu:      gbestPos[3],
            uptime:   gbestPos[4],
        },
    };
    try {
        const logPath = config.PSO_CONVERGENCE_LOG;
        const dir = path.dirname(logPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
    } catch {
        // Non-fatal: convergence logging should not crash the balancer
    }
}

// ── PSO Core ───────────────────────────────────────────────────────────────────
/**
 * Initializes the swarm from scratch.
 * Called on first optimization cycle or after a full reset.
 */
function initSwarm() {
    swarm        = Array.from({ length: config.PSO_PARTICLES }, createParticle);
    gbest        = null;
    gbestFitness = Infinity;
    gbestWeights = null;
}

/**
 * Runs one full PSO optimization cycle.
 *
 * @param {Array} healthNodes — output of getHealthState() filtered to healthy nodes
 * @param {boolean} useLinear — if true, use linear fitness (ablation mode)
 * @returns {{ weights: Object, fitness: number, convergence: Array }}
 */
function runPSO(healthNodes, useLinear = false) {
    if (!healthNodes || healthNodes.length === 0) {
        return { weights: cachedWeights, fitness: Infinity, convergence: [] };
    }

    // Normalize metrics across healthy nodes
    const nodesNorm = normalizeMetrics(healthNodes);

    // Reinitialize swarm for each current health-state cycle to prevent stale pbest/gbest state
    initSwarm();

    optimizationCycle++;
    const cycle = optimizationCycle;
    const convergenceLog = [];

    const { PSO_INERTIA, PSO_COGNITIVE, PSO_SOCIAL, PSO_ITERATIONS } = config;

    // ── Main PSO loop ─────────────────────────────────────────────────────────
    for (let iter = 1; iter <= PSO_ITERATIONS; iter++) {

        // Step 1: Evaluate each particle
        for (const particle of swarm) {
            const weights = posToWeights(particle.position);
            const fitness = evaluateObjective(nodesNorm, weights, useLinear);

            // Step 2: Update personal best
            if (fitness < particle.pbestFitness) {
                particle.pbestFitness = fitness;
                particle.pbest = [...particle.position];
            }

            // Step 3: Update global best
            if (fitness < gbestFitness) {
                gbestFitness = fitness;
                gbest = [...particle.position];
                gbestWeights = posToWeights(gbest);
            }
        }

        // Step 4: Update velocity and position for each particle
        for (const particle of swarm) {
            const r1 = rand();
            const r2 = rand();

            const newVelocity = particle.velocity.map((v, d) =>
                PSO_INERTIA    * v
                + PSO_COGNITIVE * r1 * (particle.pbest[d] - particle.position[d])
                + PSO_SOCIAL    * r2 * ((gbest || particle.pbest)[d] - particle.position[d])
            );

            const newPosition = clampAndNormalize(
                particle.position.map((x, d) => x + newVelocity[d])
            );

            particle.velocity = newVelocity;
            particle.position = newPosition;
        }

        // Step 5: Log convergence for this iteration
        const iterEntry = {
            cycle,
            iteration: iter,
            bestFitness: gbestFitness,
            gbest: gbest ? [...gbest] : null,
        };
        convergenceLog.push(iterEntry);

        if (gbest) {
            logConvergence(cycle, iter, gbestFitness, gbest);
        }
    }

    // Cache optimized weights
    if (gbestWeights) {
        cachedWeights = { ...gbestWeights };
    }

    console.log(
        `[PSO] Cycle ${cycle} complete. ` +
        `Fitness=${gbestFitness.toFixed(6)} ` +
        `Weights: lat=${cachedWeights.latency.toFixed(3)} ` +
        `req=${cachedWeights.requests.toFixed(3)} ` +
        `err=${cachedWeights.error.toFixed(3)} ` +
        `cpu=${cachedWeights.cpu.toFixed(3)} ` +
        `up=${cachedWeights.uptime.toFixed(3)}`
    );

    return {
        weights:     { ...cachedWeights },
        fitness:     gbestFitness,
        convergence: convergenceLog,
    };
}

/**
 * Returns the currently cached (most recently optimized) weight vector.
 * Falls back to equal weights before the first optimization cycle completes.
 *
 * @returns {Object} { latency, requests, error, cpu, uptime } — sums to 1
 */
function getCachedWeights() {
    return { ...cachedWeights };
}

/**
 * Returns a snapshot of the current swarm state for the /status endpoint.
 */
function getSwarmState() {
    return {
        particles:       swarm.length,
        cycle:           optimizationCycle,
        gbestFitness,
        gbestWeights:    gbestWeights ? { ...gbestWeights } : DEFAULT_WEIGHTS,
        cachedWeights:   { ...cachedWeights },
    };
}

/**
 * Resets the swarm (useful when switching algorithms or re-seeding).
 */
function resetSwarm() {
    swarm = [];
    gbest = null;
    gbestFitness = Infinity;
    gbestWeights = null;
    cachedWeights = { ...DEFAULT_WEIGHTS };
    optimizationCycle = 0;
}

function getRand() {
    return rand();
}

module.exports = { runPSO, getCachedWeights, getSwarmState, resetSwarm, reseed, getRand };