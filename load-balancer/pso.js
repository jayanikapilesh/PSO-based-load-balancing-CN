function calculateFitness(node){

 const failureRate = node.failures/(node.requests+1);

 const load = node.requests;

 const uptimeScore = 1/(node.uptime+1);

 const fitness =
 0.5*failureRate +
 0.3*load +
 0.2*uptimeScore;

 return fitness;
}

function selectBest(nodes){

 let bestNode = nodes[0];
 let bestFitness = calculateFitness(nodes[0]);

 for(const node of nodes){

  const fitness = calculateFitness(node);

  if(fitness < bestFitness){
   bestFitness = fitness;
   bestNode = node;
  }

 }

 return bestNode.url;

}

module.exports = {selectBest};