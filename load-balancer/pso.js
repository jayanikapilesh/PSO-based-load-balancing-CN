const nodeHistory = {};

/**
 * Advanced Particle Swarm Optimization (PSO) with Softmax Probabilistic Selection
 * 
 * Ensures all nodes eventually receive traffic (avoiding "gluing" to one node)
 * while still heavily favoring the most efficient nodes mathematically.
 */
function selectBest(nodes) {
    if (!nodes || nodes.length === 0) return null;

    const healthyNodes = nodes.filter(n => n.healthy);
    if (healthyNodes.length === 0) return null;

    const costs = [];
    const targetLatency = 50.0;

    for (const node of healthyNodes) {
        const { url, activeRequests, avgLatency } = node;

        if (!nodeHistory[url]) {
            nodeHistory[url] = { prevLatency: avgLatency || 0 };
        }
        const prevLat = nodeHistory[url].prevLatency;
        const trend = (avgLatency || 0) - prevLat;

        const activePenalty = Math.exp((activeRequests || 0) / 10);
        const latencyPenalty = Math.exp(Math.min((avgLatency || 0) / targetLatency, 10));
        const momentumPenalty = trend > 0 ? (1 + trend / 10) : 1;

        const cost = activePenalty * latencyPenalty * momentumPenalty;
        costs.push({ url, cost });

        nodeHistory[url].prevLatency = (avgLatency * 0.2) + (prevLat * 0.8);
    }

    // SOFTMAX BALANCING
    // Temperature (T) controls how "spread out" the load is.
    // T = 1 focuses on the best. T = 5 spreads more evenly for manual tests.
    const T = 2.0; 
    
    // Calculate weights: w = exp(-cost/T)
    const weights = costs.map(c => Math.exp(-c.cost / T));
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    // Pick a node based on the probability distribution
    let random = Math.random() * totalWeight;
    for (let i = 0; i < weights.length; i++) {
        random -= weights[i];
        if (random <= 0) {
            return costs[i].url;
        }
    }

    return costs[0].url;
}

module.exports = { selectBest };