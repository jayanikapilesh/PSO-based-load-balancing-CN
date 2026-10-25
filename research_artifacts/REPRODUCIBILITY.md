# Complete Step-by-Step Reproduction Guide (REPRODUCIBILITY.md)

This guide documents the exact commands and prerequisites required to reproduce all experimental measurements, test executions, statistical summaries, and publication figures from scratch.

---

## 1. Prerequisites & Environment Setup

1. **Operating System**: Windows 10/11, macOS, or Linux.
2. **Container Engine**: Docker Desktop running with Compose v2.
3. **Runtime Environments**:
   - Node.js v18+ (`node -v`)
   - Python v3.10+ with `scipy`, `pandas`, `numpy`, `matplotlib`, `scikit-learn`, `joblib`, `xgboost`.

```bash
# Verify Docker is running
docker compose version
docker ps
```

---

## 2. Boot the Containerized System

Navigate to the project directory:
```bash
cd PSO-based-load-balancing-CN-main
```

Launch all 9 networked services in detached mode:
```bash
docker compose up --build -d
```

Verify service status:
```bash
# Verify all 9 containers are running
docker ps

# Verify Load Balancer health & status
curl http://localhost:4000/status

# Verify ML inference endpoint
curl http://localhost:8000/health
```

---

## 3. Execute Automated Test Suites

### 3.1 Load Balancer & PSO Unit Tests
```bash
node load-balancer/tests/pso.test.js
```
*Expected Result*: 30 passed, 0 failed.

### 3.2 End-to-End System Validation Tests
```bash
node load-balancer/tests/system_validation.test.js
```
*Expected Result*: 23 passed, 0 failed.

### 3.3 Fraud Detection Model Inference Tests
```bash
python -m unittest ml-service/tests/test_fraud_model.py
```
*Expected Result*: 6 tests passed in ~2.3 seconds (reproduces ROC-AUC = 0.972342 and F1 = 0.842640).

---

## 4. Execute Full Experimental Suite

To run all experiments automatically:
```bash
node experiments/run_all_v2.js
```

Or execute individual target experiments:

### 4.1 PSO Steady-State ($N=10$ Seeds)
```bash
for seed in 42 43 44 45 46 47 48 49 50 51; do
  node experiments/run_experiment.js --algorithm PSO --duration 30 --rps 5 --seed $seed \
    --output experiments/raw_v2/pso_seed${seed}.json
done
```

### 4.2 Baselines
```bash
node experiments/run_experiment.js --algorithm ROUND_ROBIN --duration 30 --rps 5 --seed 42 \
  --output experiments/raw_v2/round_robin.json

node experiments/run_experiment.js --algorithm LEAST_CONNECTIONS --duration 30 --rps 5 --seed 42 \
  --output experiments/raw_v2/least_connections.json

node experiments/run_experiment.js --algorithm FIXED_HEALTH --duration 30 --rps 5 --seed 42 \
  --output experiments/raw_v2/fixed_health.json
```

### 4.3 Self-Healing (Healing ON vs Healing OFF)
```bash
# Healing ON
docker start healer
node experiments/run_experiment.js --algorithm PSO --duration 35 --rps 5 --seed 42 \
  --chaos-target api2 --chaos-time 5 --experiment-type healing_on \
  --output experiments/raw_v2/healing_on.json

# Healing OFF
docker stop healer
node experiments/run_experiment.js --algorithm PSO --duration 35 --rps 5 --seed 42 \
  --chaos-target api2 --chaos-time 5 --experiment-type healing_off \
  --output experiments/raw_v2/healing_off.json
docker start healer
```

### 4.4 Measure Computational Overhead
```bash
node experiments/measure_overhead.js --lb-url http://localhost:4000 \
  --output experiments/processed/overhead.json
```

---

## 5. Generate Statistical Summaries & Figures

### 5.1 Generate Statistical Analysis Report
```bash
python experiments/generate_statistical_report.py
```
*Generates*:
- `research_artifacts/STATISTICAL_ANALYSIS/statistical_summary.md`
- `research_artifacts/STATISTICAL_ANALYSIS/descriptive_statistics.csv`
- `research_artifacts/STATISTICAL_ANALYSIS/hypothesis_tests.csv`

### 5.2 Generate Publication-Quality Figures (300 DPI)
```bash
python experiments/generate_publication_figures.py
```
*Generates 10 figures in `research_artifacts/PLOTS/`*:
1. `1_baseline_comparison.png`
2. `2_pso_repeatability.png`
3. `3_increasing_workload.png`
4. `4_self_healing_timeline.png`
5. `5_error_rate_healing_comparison.png`
6. `6_pso_convergence.png`
7. `7_fraud_roc_pr_curves.png`
8. `8_fraud_confusion_matrix.png`
9. `9_ablation_comparison.png`
10. `10_computational_overhead.png`

---

## 6. Verification of Deliverables

Verify that the `research_artifacts/` directory contains all required items:
```bash
Get-ChildItem -Path research_artifacts -Recurse
```
