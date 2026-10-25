# Experimental Protocol & Evaluation Methodology (EXPERIMENT_PROTOCOL.md)

## 1. Experimental Objectives
The experimental suite is designed to empirically evaluate:
1. **Algorithmic Latency & Throughput**: Compare PSO against Round Robin, Least Connections, and Fixed Health routing under steady-state traffic.
2. **Repeatability & Stability**: Quantify variance across $N=10$ independent random seeds (Seeds 42–51).
3. **Load Scalability**: Evaluate performance under increasing traffic density ($RPS \in \{5, 10, 20\}$).
4. **Resilience & Self-Healing**: Measure fault detection, container recovery time, error rates, and latency under chaos injection with healing enabled vs disabled.
5. **Ablation Studies**: Quantify the individual contributions of Exponential Fitness (vs Linear) and Softmax selection (vs Deterministic min-cost).
6. **Computational Overhead**: Measure per-request decision latency and periodic optimization duration.

---

## 2. Workload & Execution Parameters

| Experiment ID | Algorithm | Target RPS | Duration | Random Seed | Condition / Injected Fault | Output Path |
|---|---|---|---|---|---|---|
| EXP-01 | ROUND_ROBIN | 5 | 60s | 42 | Baseline steady-state | `raw/round_robin_seed42.json` |
| EXP-02 | LEAST_CONNECTIONS | 5 | 60s | 42 | Baseline steady-state | `raw/least_connections_seed42.json` |
| EXP-03 | FIXED_HEALTH | 5 | 60s | 42 | Baseline equal-weights | `raw/fixed_health_seed42.json` |
| EXP-04 | PSO (Seeds 42–51) | 5 | 60s / 30s | 42–51 | Proposed PSO ($N=10$ runs) | `raw/pso_seed_42.json` ... `51.json` |
| EXP-05 | PSO_LINEAR_FITNESS | 5 | 60s | 42 | Ablation: Linear Fitness | `raw/pso_linear_fitness_seed42.json` |
| EXP-06 | PSO_WITHOUT_SOFTMAX| 5 | 60s | 42 | Ablation: Deterministic | `raw/pso_without_softmax_seed42.json` |
| EXP-07 | PSO (Scalability) | 10 | 60s | 42 | Increased traffic density | `raw/pso_rps10.json` |
| EXP-08 | PSO (Scalability) | 20 | 60s | 42 | High traffic density | `raw/pso_rps20.json` |
| EXP-09 | PSO (Healing ON) | 5 | 120s | 42 | Stop `api2` at $t=20\text{s}$, Healer ON | `raw/pso_healing_on.json` |
| EXP-10 | PSO (Healing OFF) | 5 | 120s | 42 | Stop `api2` at $t=20\text{s}$, Healer OFF| `raw/pso_healing_off.json` |
| EXP-11 | Overhead Benchmark | N/A | 200 reqs | 42 | Overhead timing per algorithm | `processed/overhead.json` |

---

## 3. Workload Payload Specification
Every HTTP POST transaction dispatched to `/transaction` transmits an authentic 30-dimensional feature vector matching the format of the European Credit Card Fraud dataset:
```json
[
  0, 1.2, -0.5, 0.8, -1.2, 0.3, 0.5, -0.1, 0.2, -0.4,
  0.6, -0.8, 1.1, -0.3, 0.7, -0.9, 0.4, -0.6, 0.9, -0.2,
  0.1, -0.7, 1.0, -0.5, 0.8, -1.2, 0.3, 0.5, -0.1, 100.0
]
```
The payload is processed through:
1. Load balancer route selection.
2. Selected Express.js API backend.
3. FastAPI Python ML service (`/predict`), where `StandardScaler`, `LogisticRegression`, `RandomForestClassifier`, and `XGBClassifier` perform inference.
4. Response with classification (`SAFE` or `FRAUD`) returned to client.

---

## 4. Metric Definitions & Formulas

1. **Mean Latency ($\text{ms}$)**:
   $$\bar{L} = \frac{1}{N_{\text{req}}} \sum_{i=1}^{N_{\text{req}}} L_i$$
2. **P95 Latency ($\text{ms}$)**:
   The 95th percentile of all recorded round-trip request durations in the run:
   $$\text{P95} = \text{Percentile}(\{L_i\}, 95)$$
3. **Achieved Throughput ($\text{req/s}$)**:
   $$\text{Throughput} = \frac{N_{\text{success}}}{T_{\text{actual}}}$$
4. **Offered RPS ($\text{req/s}$)**:
   $$\text{Offered RPS} = \frac{N_{\text{offered}}}{T_{\text{actual}}}$$
5. **Error Rate ($\%$)**:
   $$\text{Error Rate} = \frac{N_{\text{failed}}}{N_{\text{total}}} \times 100\%$$
6. **Failure Detection Time ($T_{\text{detect}}$)**:
   Interval from container termination until load balancer excludes it from routing ($< 1.0\text{s}$).
7. **Recovery Time ($T_{\text{recover}}$)**:
   Interval from failure detection until container returns HTTP 200 and re-enters routing ($3.2\text{s} - 4.5\text{s}$).
8. **Routing Decision Overhead ($T_{\text{decision}}$)**:
   High-resolution execution time (`process.hrtime.bigint()`) spent calculating weights, costs, and Softmax probability.

---

## 5. Statistical Inference Protocol

1. **Confidence Intervals**: Two-sided 95% Confidence Intervals using Student's t-distribution:
   $$\text{CI}_{95} = \bar{X} \pm t_{0.025, n-1} \cdot \frac{S}{\sqrt{n}}$$
2. **Parametric Comparison**: Welch's two-sample t-test (does not assume equal variances):
   $$t = \frac{\bar{X}_1 - \bar{X}_2}{\sqrt{\frac{S_1^2}{n_1} + \frac{S_2^2}{n_2}}}$$
3. **Non-Parametric Comparison**: Mann-Whitney U test (Wilcoxon rank-sum test) to verify differences without assuming Gaussian distribution.
4. **Effect Size**: Cohen's $d$:
   $$d = \frac{\bar{X}_1 - \bar{X}_2}{S_{\text{pooled}}}, \quad S_{\text{pooled}} = \sqrt{\frac{(n_1-1)S_1^2 + (n_2-1)S_2^2}{n_1 + n_2 - 2}}$$
