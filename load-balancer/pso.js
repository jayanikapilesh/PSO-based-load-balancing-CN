function selectBest(nodes) {
    if (!nodes || nodes.length === 0) return null;

    const healthyNodes = nodes.filter(n => n.healthy);
    if (healthyNodes.length === 0) return null;

    // Random selection among healthy nodes
    const randomIndex = Math.floor(Math.random() * healthyNodes.length);
    return healthyNodes[randomIndex].url;
}

module.exports = { selectBest };