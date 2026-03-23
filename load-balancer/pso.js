function calculateFitness(node){

 const failureRate = node.errorRate || 0;
 const load = node.load || 0;
 const uptimeScore = 1/(node.uptime+1);
 const latency = node.latency || 0;

 const randomness = Math.random()*0.05;

 return 0.4*failureRate +
        0.2*load +
        0.2*uptimeScore +
        0.2*latency +
        randomness;
}
function calculateFitness(node){

    const failureRate = node.errorRate || 0;
    const load = node.load || 0;
    const latency = node.latency || 0;
    const uptimeScore = 1 / (node.uptime + 1);

    // small randomness to avoid always picking same node
    const randomness = Math.random() * 0.05;

    const fitness =
        0.4 * failureRate +
        0.2 * load +
        0.2 * latency +
        0.2 * uptimeScore +
        randomness;

    return fitness;
}


function selectBest(nodes){

    if (!nodes || nodes.length === 0) return null;

    let bestNode = nodes[0];
    let bestFitness = calculateFitness(nodes[0]);

    for (const node of nodes){

        const fitness = calculateFitness(node);

        if (fitness < bestFitness){
            bestFitness = fitness;
            bestNode = node;
        }
    }

    return bestNode.url;
}



module.exports = {selectBest};