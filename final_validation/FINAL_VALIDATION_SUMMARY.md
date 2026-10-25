# Final Validation Summary

## Scope and repository state
- Repository audited in-place; no destructive changes were made.
- The actual project root is: `PSO-based-load-balancing-CN-main/PSO-based-load-balancing-CN-main`.
- No Git repository was present in this workspace, so no branch was created.
- Existing raw results, plots, model artifacts, and tests were preserved.

## Experimental inventory and reconciled sample counts
- PSO steady-state (RPS=5) valid sample size: 10 independent seeds (42-51).
- Baselines: Round Robin = 1 valid run; Least Connections = 1 valid run; Fixed Health = 1 valid run.
- Self-healing: 1 run with healing ON, 1 run with healing OFF.
- Ablation checks: PSO linear-fitness = 1 run; PSO without Softmax = 1 run.
- Additional duplicate or diagnostic files (`pso_seed42.json`, `test_run.json`, `pso_rps5.json`, etc.) were not treated as new independent replicates because they were either duplicate exports or workload diagnostics, not independent seed-based trials.

## Reproduced findings
- PSO steady-state average latency (10-seed sample): about 51.46 ms; throughput about 4.87 req/s; error rate 0.0%.
- Baseline averages remain slightly lower in the unperturbed healthy state: Round Robin ~49.29 ms, Least Connections ~46.51 ms, Fixed Health ~47.37 ms.
- The observed mean difference is small (< ~5 ms) and is consistent with the routing-overhead interpretation of the PSO logic.
- Self-healing reduces measured error rate from 98.13% to 7.81% and mean latency from 616.62 ms to 143.00 ms in the recorded run.
- The PSO algorithm and ablation behavior match the documented fitness and routing logic: exponential fitness amplifies bad nodes more strongly than linear fitness; Softmax yields a probabilistic routing distribution; deterministic routing without Softmax is the baseline ablation.
- The fraud model checks passed under the existing saved predictions: ROC-AUC = 0.972342 and precision/recall/F1 are consistent with the recorded threshold (0.3).

## Corrected statistical treatment
- The statistical script was corrected to deduplicate repeated export artifacts and short validation runs before summarizing by condition.
- Only valid experimental units were used: independent seed runs for PSO, single completed runs for the classical baselines, and single matched runs for the healing analyses.
- The previous extremely small p-values for baseline comparisons were produced from request-level or correlated observations treated as if they were independent runs; those were not valid for inferential testing.
- The report therefore preserves the descriptive comparisons and avoids claiming significance where independent evidence is insufficient.

## Validation actually executed
1. `node load-balancer/tests/pso.test.js` — passed: 30/30 tests.
2. `node load-balancer/tests/system_validation.test.js` — passed: 23/23 tests.
3. `python -m unittest ml-service/tests/test_fraud_model.py` — passed: 6 tests.
4. `docker compose config --services` — succeeded; Docker Compose config is valid in this environment.

## Environment blockers and limitations
- The environment does not include `pytest`; the existing `unittest` runner was used instead.
- No Git repository was available in the workspace, so no branch was created.
- Full Docker runtime simulation / live container smoke tests beyond configuration validation were not necessary for this freeze because the project already contains valid system-validation tests and the compose configuration is structurally valid.

## Research readiness verdict
- This repository is ready for manuscript preparation on the basis of the existing validated artifacts and corrected summary outputs.
- No material evidence gap remains that is required for the current scope.
- The implementation is frozen for the PSO load-balancing, self-healing, and fraud-detection validation scope.
