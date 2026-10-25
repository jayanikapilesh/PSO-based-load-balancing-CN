# Final Implementation Changelog (CHANGELOG_FINAL.md)

## Summary of Changes
This changelog details all technical modifications, mathematical corrections, test additions, and pipeline enhancements implemented across the project.

---

### 1. Load Balancer Subsystem (`load-balancer/`)

#### 1.1 Dynamic Runtime Configuration (`load-balancer/balancer.js`)
- **Modification**: Added `POST /config` endpoint.
- **Rationale**: Allowed runtime reconfiguration of `ROUTING_ALGORITHM` and `RANDOM_SEED` without restarting or rebuilding containers, enabling automated comparative benchmarking across algorithms.
- **Affected Endpoints**: Added `POST /config` with payload `{ algorithm, seed }`.

#### 1.2 PSO Objective Function Formulation (`load-balancer/fitness.js`)
- **Modification**: Upgraded `evaluateObjective` function.
- **Rationale**: Originally, candidate particles only evaluated the static node costs. The upgraded formulation models the candidate weight vector's direct impact on Softmax load distribution variance ($\text{Var}(P)$) and expected network latency/error rate under those weights.
- **Lines Affected**: Lines 170–195 in `fitness.js`.

#### 1.3 Asynchronous CPU Metrics Refresh Loop (`load-balancer/health.js`)
- **Modification**: Introduced `startCpuRefresh(instances)` background loop polling Prometheus every `CPU_REFRESH_MS = 5000` ms.
- **Rationale**: Prevents indefinite retention of the neutral 0.5 CPU fallback when Prometheus / cAdvisor takes several seconds to register container cgroup metrics after startup.
- **Lines Affected**: Lines 58–105 and 208–216 in `health.js`.

#### 1.4 Seeded Deterministic PRNG (`load-balancer/pso.js`)
- **Modification**: Implemented Mulberry32 32-bit generator with `reseed()` support.
- **Rationale**: Replaced non-deterministic `Math.random()` to ensure 100% bit-level reproducibility of PSO particle trajectories when given a specific seed (`RANDOM_SEED=42`).
- **Lines Affected**: Lines 54–82 in `pso.js`.

---

### 2. Self-Healing Mechanism (`healer/`)

#### 2.1 Restart Storm Mitigation (`healer/main.go`)
- **Modification**: Added 5-second cooldown timer check `if !lastRestart.IsZero() && time.Since(lastRestart) < cooldown { continue }`.
- **Rationale**: Prevents issuing rapid duplicate `docker restart` commands while a container is in the process of booting up.
- **Lines Affected**: Lines 15–42 in `main.go`.

#### 2.2 Recovery Metric Logging (`healer/main.go`)
- **Modification**: Added recovery duration measurement `time.Since(lastRestart).Seconds()` upon HTTP 200 detection.
- **Rationale**: Quantifies exact mean time to recovery (MTTR) under container failure events.
- **Lines Affected**: Lines 28–34 in `main.go`.

---

### 3. Machine Learning Service & Test Verification (`ml-service/`)

#### 3.1 Model Inference Test Suite (`ml-service/tests/test_fraud_model.py`)
- **Modification**: Created automated unit test suite verifying model artifact loading, input dimensions (30 features), probability boundedness, threshold monotonicity, and metric reproduction.
- **Rationale**: Guarantees inference pipeline consistency and reproduces the manuscript's ROC-AUC = 0.972342 and F1-score = 0.842640 on the 56,962 test set.
- **Lines Affected**: Complete file (102 lines).

---

### 4. Experimental & Statistical Infrastructure (`experiments/`)

#### 4.1 Master Automation Harness (`experiments/run_all_v2.js`)
- **Modification**: Created comprehensive script orchestrating 10 independent seeded PSO runs (seeds 42–51), load scalability tests (RPS 5, 10, 20), ablations (linear fitness, without Softmax), baselines (round robin, least connections, fixed health), self-healing ON vs OFF, and overhead benchmarks.
- **Rationale**: Enables single-command reproduction of all empirical evidence.

#### 4.2 Publication Figure Generator (`experiments/generate_publication_figures.py`)
- **Modification**: Implemented high-resolution (300 DPI) plotting script generating 10 figures directly from experimental JSON runs.
- **Rationale**: Ensures all visual figures match raw recorded data without hardcoding.

#### 4.3 Statistical Analysis & Hypothesis Testing (`experiments/generate_statistical_report.py`)
- **Modification**: Implemented parametric and non-parametric statistical testing (Welch's t-test, Mann-Whitney U, Cohen's d, Student's t 95% CI) comparing PSO with baselines.
- **Rationale**: Provides inferential verification of experimental data.

---

### 5. Research Artifacts Directory (`research_artifacts/`)
- Created standardized deliverables structure containing all raw JSON traces, aggregated CSV summaries, 300 DPI figures, statistical analyses, and reproducibility documentation.
