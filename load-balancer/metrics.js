'use strict';

/**
 * metrics.js — Centralized Prometheus metric registration for the load balancer.
 *
 * All metrics are registered here and exported for use by balancer.js and pso.js.
 * This prevents duplicate-metric registration errors and keeps observability in one place.
 */

const client = require('prom-client');

const register = new client.Registry();
client.collectDefaultMetrics({ register });

// ── Existing metric (preserved from original implementation) ──────────────────
const routingCounter = new client.Counter({
    name: 'pso_routing_decisions_total',
    help: 'Total number of routing decisions made to each backend node',
    labelNames: ['target', 'algorithm'],
});

// ── PSO Optimization Metrics ──────────────────────────────────────────────────
const psoOptimizationDuration = new client.Histogram({
    name: 'pso_optimization_duration_seconds',
    help: 'Time taken to complete one full PSO optimization cycle (seconds)',
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5],
});

const psoBestFitness = new client.Gauge({
    name: 'pso_best_fitness',
    help: 'Global best fitness value from the most recent PSO optimization cycle',
});

const psoOptimizationCycles = new client.Counter({
    name: 'pso_optimization_cycles_total',
    help: 'Total number of PSO optimization cycles completed',
});

const psoIterationsTotal = new client.Counter({
    name: 'pso_iterations_total',
    help: 'Total number of PSO iterations executed across all cycles',
});

// ── Optimized Weight Gauges ───────────────────────────────────────────────────
const psoWeightLatency = new client.Gauge({
    name: 'pso_weight_latency',
    help: 'Current PSO-optimized weight for latency metric',
});

const psoWeightRequests = new client.Gauge({
    name: 'pso_weight_requests',
    help: 'Current PSO-optimized weight for active-requests metric',
});

const psoWeightError = new client.Gauge({
    name: 'pso_weight_error',
    help: 'Current PSO-optimized weight for error-rate metric',
});

const psoWeightCpu = new client.Gauge({
    name: 'pso_weight_cpu',
    help: 'Current PSO-optimized weight for CPU-utilization metric',
});

const psoWeightUptime = new client.Gauge({
    name: 'pso_weight_uptime',
    help: 'Current PSO-optimized weight for uptime/reliability metric',
});

// ── Routing Decision Overhead ──────────────────────────────────────────────────
const routingDecisionDuration = new client.Histogram({
    name: 'routing_decision_duration_seconds',
    help: 'Time taken to make a single routing decision (fitness + Softmax, ms)',
    buckets: [0.0001, 0.0005, 0.001, 0.005, 0.01, 0.025, 0.05],
});

// Register all metrics
[
    routingCounter,
    psoOptimizationDuration,
    psoBestFitness,
    psoOptimizationCycles,
    psoIterationsTotal,
    psoWeightLatency,
    psoWeightRequests,
    psoWeightError,
    psoWeightCpu,
    psoWeightUptime,
    routingDecisionDuration,
].forEach(m => register.registerMetric(m));

module.exports = {
    register,
    routingCounter,
    psoOptimizationDuration,
    psoBestFitness,
    psoOptimizationCycles,
    psoIterationsTotal,
    psoWeightLatency,
    psoWeightRequests,
    psoWeightError,
    psoWeightCpu,
    psoWeightUptime,
    routingDecisionDuration,
};
