# Experiments

This directory contains the experiment infrastructure for the PSO-based adaptive load balancer research.

## Directory Structure

```
experiments/
  raw/           ← Raw JSON results from each experiment run
  processed/     ← Aggregated CSV summaries and statistics
  baseline/      ← Round-robin, least-connections, fixed-health results
  pso/           ← Full PSO results (multiple seeds/runs)
  ablation/      ← Linear-fitness and no-Softmax ablation results
  self-healing/  ← Self-healing ON vs OFF comparison
  scalability/   ← Increasing load / node count experiments
```

## Running Experiments

### Prerequisites
1. Start the full Docker stack: `docker compose up --build -d`
2. Verify load balancer is running: `curl http://localhost:4000`
3. Install Node.js dependencies: `npm install axios` in project root

### Experiment 2: Baseline Comparison

```bash
# Round Robin
docker compose exec lb sh -c "ROUTING_ALGORITHM=ROUND_ROBIN node balancer.js &"
node experiments/run_experiment.js --algorithm ROUND_ROBIN --duration 60 --rps 5

# Least Connections
node experiments/run_experiment.js --algorithm LEAST_CONNECTIONS --duration 60 --rps 5

# Fixed Health (static weights)
node experiments/run_experiment.js --algorithm FIXED_HEALTH --duration 60 --rps 5

# PSO (proposed)
node experiments/run_experiment.js --algorithm PSO --duration 60 --rps 5
```

To change algorithm without rebuilding, set ROUTING_ALGORITHM in docker-compose.yml
and run: `docker compose up -d --no-deps lb`

### Experiment 3: Linear vs Exponential Fitness

```bash
# PSO with linear fitness
ROUTING_ALGORITHM=PSO_LINEAR_FITNESS → set in docker-compose.yml
node experiments/run_experiment.js --algorithm PSO_LINEAR_FITNESS --duration 60 --rps 5

# PSO with exponential fitness (default)
node experiments/run_experiment.js --algorithm PSO --duration 60 --rps 5
```

### Experiment 4: Softmax Ablation

```bash
# Deterministic (no Softmax)
ROUTING_ALGORITHM=PSO_WITHOUT_SOFTMAX → set in docker-compose.yml
node experiments/run_experiment.js --algorithm PSO_WITHOUT_SOFTMAX --duration 60 --rps 5

# With Softmax (default)
node experiments/run_experiment.js --algorithm PSO --duration 60 --rps 5
```

### Experiment 5: Self-Healing

```bash
# Run with self-healing ON (default — healer container running)
node experiments/run_experiment.js --algorithm PSO --duration 120 --rps 5 \
  --output experiments/self-healing/pso_healing_on.json

# Inject chaos (in another terminal)
node chaos_simulator.js

# For healing OFF: stop the healer container
docker compose stop healer
node experiments/run_experiment.js --algorithm PSO --duration 120 --rps 5 \
  --output experiments/self-healing/pso_healing_off.json
docker compose start healer
```

### Experiment 6: PSO Convergence

Convergence data is automatically written to `logs/pso_convergence.jsonl` during any PSO run.
Each line is: `{ timestamp, cycle, iteration, bestFitness, gbest: { latency, requests, error, cpu, uptime } }`

### Collecting Results

After running experiments:

```bash
node experiments/collect_results.js \
  --input experiments/raw \
  --output experiments/processed/summary.csv
```

## Statistical Repeatability

For important experiments, run 10 independent seeds:

```bash
for seed in 42 43 44 45 46 47 48 49 50 51; do
  node experiments/run_experiment.js --algorithm PSO --seed $seed --duration 60 --rps 5
done
node experiments/collect_results.js
```

## Important Notes

- **Do NOT fabricate results.** All data must come from actual execution.
- If an experiment cannot run due to hardware limits, document that clearly.
- Record the exact PSO_PARTICLES, PSO_ITERATIONS, and all alpha/beta values used.
- The FRAUD_THRESHOLD=0.3 must match the notebook value for Experiment 1.
