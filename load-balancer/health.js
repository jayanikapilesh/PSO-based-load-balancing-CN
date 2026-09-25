'use strict';

/**
 * health.js — Collects and maintains health metrics for all API backend nodes.
 *
 * Implements five health metrics per node:
 *   1. Latency (ms)          — from /health endpoint, EMA-smoothed
 *   2. Active requests        — from /health endpoint
 *   3. Error rate             — rolling window (errors/requests in last N seconds)
 *   4. CPU utilization (%)    — queried from Prometheus/cAdvisor per-container
 *   5. Uptime/reliability     — rolling ratio of healthy health-check polls
 *
 * CPU metric note:
 *   Per-container CPU is obtained via PromQL against cAdvisor metrics.
 *   If Prometheus is unreachable or the container label is not found,
 *   CPU falls back to 0.5 (neutral mid-range value) so routing still works.
 *   This fallback is logged and reported via the health state object.
 *
 * Latency trend (preserved from original implementation):
 *   smoothedLatency = 0.2 * currentLatency + 0.8 * prevSmoothedLatency
 *   trend = currentLatency - smoothedLatency
 */

const axios = require('axios');
const config = require('./config');

// ── Per-node state ────────────────────────────────────────────────────────────
// Keyed by node URL.
const nodeState = {};

/**
 * Returns a fresh per-node state object.
 */
function initNodeState(url) {
    return {
        url,
        // Latency EMA (original smoothing preserved)
        smoothedLatency: 0,
        // Error rate rolling window: array of { ts: epochMs, isError: bool }
        errorWindow: [],
        // Uptime rolling window: array of { ts: epochMs, healthy: bool }
        uptimeWindow: [],
        // CPU cache (updated separately via Prometheus)
        cpuPercent: 0.5,    // neutral fallback
        cpuAvailable: false, // true once first Prometheus query succeeds
        // Last raw health response
        lastHealth: null,
        // Consecutive failure count (used for uptime window)
        consecutiveFailures: 0,
    };
}

function getState(url) {
    if (!nodeState[url]) nodeState[url] = initNodeState(url);
    return nodeState[url];
}

// ── Prometheus CPU fetch ───────────────────────────────────────────────────────
/**
 * Queries Prometheus for per-container CPU utilization.
 *
 * Uses cAdvisor metric:
 *   rate(container_cpu_usage_seconds_total{name="<containerName>"}[1m])
 *
 * The container name is derived from the URL hostname (api1, api2, api3).
 *
 * Returns a value in [0, 1] representing fractional CPU usage, or null on error.
 */
async function fetchCpuFromPrometheus(containerName) {
    try {
        const query = `rate(container_cpu_usage_seconds_total{name="${containerName}"}[1m])`;
        const url = `${config.PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(query)}`;
        const res = await axios.get(url, { timeout: 2000 });
        if (res.data && res.data.data && res.data.data.result && res.data.data.result.length > 0) {
            const val = parseFloat(res.data.data.result[0].value[1]);
            return isNaN(val) ? null : val; // val is CPU seconds/second (fractional core usage)
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Background CPU refresh — polls Prometheus for all nodes.
 */
async function refreshCpuMetrics(instances) {
    for (const url of instances) {
        const hostname = new URL(url).hostname; // e.g. "api1"
        const cpuRaw = await fetchCpuFromPrometheus(hostname);
        const state = getState(url);
        if (cpuRaw !== null) {
            // Convert fractional core usage to a 0-1 percentage
            // Assume single-core containers (1 core = 100%).
            // Clamp to [0, 1] since containers can use < 1 core.
            state.cpuPercent = Math.min(1.0, Math.max(0.0, cpuRaw));
            state.cpuAvailable = true;
        } else if (!state.cpuAvailable) {
            // Keep neutral fallback; log once per node if first attempt
            state.cpuPercent = 0.5;
        }
        // If cpuRaw is null but we previously had data, keep the last known value.
    }
}

// ── Health endpoint polling ────────────────────────────────────────────────────
/**
 * Polls a single node's /health endpoint and updates state.
 * Returns { healthy, rawData } or { healthy: false, rawData: null }.
 */
async function pollNode(url) {
    const state = getState(url);
    const now = Date.now();

    try {
        const r = await axios.get(`${url}/health`, { timeout: 600 });
        if (r.status !== 200) throw new Error(`HTTP ${r.status}`);

        const data = r.data;
        state.lastHealth = data;

        // ── Latency trend (EMA — preserved from original) ──────────────────
        const currentLatency = data.avgLatency || 0;
        if (state.smoothedLatency === 0) {
            state.smoothedLatency = currentLatency; // bootstrap
        } else {
            state.smoothedLatency = 0.2 * currentLatency + 0.8 * state.smoothedLatency;
        }
        const latencyTrend = currentLatency - state.smoothedLatency;

        // ── Error rate window ──────────────────────────────────────────────
        // The API server now reports recentErrorRate (rolling window).
        // We also maintain a fallback using the raw errorCount delta approach.
        const windowMs = config.ERROR_RATE_WINDOW_S * 1000;
        const cutoff = now - windowMs;

        // Push current observation
        state.errorWindow.push({
            ts: now,
            errorCount: data.errorCount || 0,
            requestCount: data.requestCount || 0,
        });
        // Prune old entries
        while (state.errorWindow.length > 1 && state.errorWindow[0].ts < cutoff) {
            state.errorWindow.shift();
        }

        let errorRate = 0;
        if (data.recentErrorRate !== undefined) {
            // Use API-reported rolling error rate (preferred)
            errorRate = data.recentErrorRate;
        } else if (state.errorWindow.length >= 2) {
            // Fallback: compute from cumulative counter delta
            const oldest = state.errorWindow[0];
            const newest = state.errorWindow[state.errorWindow.length - 1];
            const errDelta = Math.max(0, newest.errorCount - oldest.errorCount);
            const reqDelta = Math.max(1, newest.requestCount - oldest.requestCount);
            errorRate = errDelta / reqDelta;
        }
        errorRate = Math.min(1.0, Math.max(0.0, errorRate));

        // ── Uptime window ──────────────────────────────────────────────────
        state.uptimeWindow.push({ ts: now, healthy: true });
        while (state.uptimeWindow.length > config.UPTIME_WINDOW_POLLS) {
            state.uptimeWindow.shift();
        }
        const healthyPolls = state.uptimeWindow.filter(p => p.healthy).length;
        const uptimeRatio = state.uptimeWindow.length > 0
            ? healthyPolls / state.uptimeWindow.length
            : 1.0;

        return {
            url,
            healthy: true,
            activeRequests: data.activeRequests || 0,
            avgLatency: currentLatency,
            smoothedLatency: state.smoothedLatency,
            latencyTrend,
            errorRate,
            cpuUtilization: state.cpuPercent,
            cpuAvailable: state.cpuAvailable,
            uptimeRatio,
        };
    } catch {
        // Record failure in uptime window
        state.uptimeWindow.push({ ts: now, healthy: false });
        while (state.uptimeWindow.length > config.UPTIME_WINDOW_POLLS) {
            state.uptimeWindow.shift();
        }

        return { url, healthy: false };
    }
}

// ── Public API ─────────────────────────────────────────────────────────────────
/**
 * Collects health state for all instances.
 * Returns array of per-node health objects (may include unhealthy nodes).
 *
 * @param {string[]} instances — array of base URLs, e.g. ["http://api1:3000"]
 * @returns {Promise<Array>}
 */
async function getHealthState(instances) {
    return Promise.all(instances.map(url => pollNode(url)));
}

/**
 * Starts a background CPU refresh loop.
 * Should be called once at startup.
 */
function startCpuRefresh(instances) {
    const refresh = () => refreshCpuMetrics(instances).catch(() => {});
    refresh(); // immediate first poll
    setInterval(refresh, config.CPU_REFRESH_MS);
}

module.exports = { getHealthState, startCpuRefresh, getState };
