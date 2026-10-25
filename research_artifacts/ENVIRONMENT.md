# Deployment Environment & System Configuration (ENVIRONMENT.md)

## 1. Host System Environment
- **Operating System**: Microsoft Windows 11 Enterprise / Pro (64-bit, x86_64)
- **Host Shell**: PowerShell 5.1 / 7+
- **Container Engine**: Docker Desktop on Windows (WSL 2 backend)
- **Docker Engine Version**: 27.x+
- **Docker Compose Version**: v2.x+
- **Primary Runtime Engines**:
  - Node.js: v20.x+ (Load Balancer, API Backends, Test harnesses)
  - Python: v3.12.x (FastAPI ML Service, Scikit-Learn, XGBoost, Statistical tools)
  - Go: v1.21+ (Self-Healing Supervisor daemon)

---

## 2. Containerized Microservices Stack

The system is deployed via Docker Compose with 9 networked microservices on an isolated bridge network:

| Service Name | Container Name | Base Image / Build Context | Exposed Ports | Primary Responsibilities |
|---|---|---|---|---|
| `lb` | `lb` | `./load-balancer` (Node.js 20 Alpine) | `4000:4000` | PSO optimization, health tracking, Softmax routing |
| `api1` | `api1` | `./api` (Node.js 20 Alpine) | Internal (3000) | Express backend instance #1, error tracking |
| `api2` | `api2` | `./api` (Node.js 20 Alpine) | Internal (3000) | Express backend instance #2, chaos injection target |
| `api3` | `api3` | `./api` (Node.js 20 Alpine) | Internal (3000) | Express backend instance #3 |
| `ml-api` | `ml-api` | `./ml-service` (Python 3.12 Slim) | `8000:8000` | LR, RF, XGB ensemble inference engine |
| `healer` | `healer` | `./healer` (Golang Alpine) | Internal | Health polling daemon & container restart manager |
| `cadvisor` | `cadvisor`| `gcr.io/cadvisor/cadvisor:latest` | `8080:8080` | Real-time container resource telemetry |
| `prometheus`| `prometheus`| `prom/prometheus:latest` | `9090:9090` | Time-series metrics aggregation & PromQL queries |
| `grafana` | `grafana` | `grafana/grafana:latest` | `3001:3000` | Observability dashboards & live monitoring |

---

## 3. Storage Volumes & Sockets

1. **Docker Socket Mount**:
   `/var/run/docker.sock:/var/run/docker.sock` mounted into `healer` container, enabling direct invocation of `docker restart <container>` without external agents.
2. **Convergence Logs**:
   `./logs:/app/logs` mounted into `lb` container to persist `pso_convergence.jsonl`.
3. **Prometheus Configuration**:
   `./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml` mounted read-only into `prometheus` container.
4. **cAdvisor Host Mounts**:
   Mounted `/rootfs`, `/var/run`, `/sys`, `/var/lib/docker/`, `/dev/disk` read-only to monitor container CPU and memory usage accurately.

---

## 4. Distinction Between Local Container Testing vs Cloud Deployment

### Current Local Deployment (Verified in this Audit)
- All services execute within isolated containers on Docker Desktop via WSL 2 on a single Windows physical host.
- Network communication utilizes Docker's internal virtual bridge network (`172.x.x.x`).
- Inter-container latency is sub-millisecond ($0.1\text{ms} - 0.5\text{ms}$).
- Computational contention exists between containers when the host CPU experiences peak load.

### Target Cloud / Kubernetes Deployment Topology
- In a production cloud environment (e.g., AWS EKS, Google GKE, Azure AKS):
  - `api1`, `api2`, `api3` operate as Kubernetes Pods across distinct worker nodes / Availability Zones.
  - The load balancer operates as an Ingress Controller or Envoy-based custom filter.
  - The `healer` daemon corresponds to the Kubernetes Kubelet / ReplicaSet controller with automated liveness and readiness probes.
  - Observability integrates via Prometheus Operator and Grafana Cloud.
  - Realistic WAN/VPC cross-zone latencies ($2\text{ms} - 15\text{ms}$) replace localhost bridge networking.
