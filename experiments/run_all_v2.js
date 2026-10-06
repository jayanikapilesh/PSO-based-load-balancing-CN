'use strict';

/**
 * run_all_v2.js — Master automation script for executing all v2 experiments.
 *
 * Runs:
 *   1. PSO Seeds 42-51 (10 independent seeded runs)
 *   2. Load Scalability (RPS=5, 10, 20)
 *   3. Ablations (PSO_LINEAR_FITNESS, PSO_WITHOUT_SOFTMAX)
 *   4. Baselines (ROUND_ROBIN, LEAST_CONNECTIONS, FIXED_HEALTH)
 *   5. Self-Healing (Healing ON vs Healing OFF)
 *   6. Overhead Benchmark
 *   7. Statistical aggregation via collect_results.js
 */

const { execSync } = require('child_process');
const fs           = require('fs');
const path         = require('path');
const axios        = require('axios');

const RAW_DIR = path.join(__dirname, 'raw_v2');
const PROC_DIR = path.join(__dirname, 'processed_v2');

if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });
if (!fs.existsSync(PROC_DIR)) fs.mkdirSync(PROC_DIR, { recursive: true });

function runCmd(cmd) {
    console.log(`\n==================================================`);
    console.log(`RUNNING: ${cmd}`);
    console.log(`==================================================`);
    execSync(cmd, { stdio: 'inherit' });
}

async function main() {
    console.log('[MASTER V2] Starting comprehensive experimental suite execution...');

    // ── 1. PSO Seeds 42–51 (10 independent seeded runs at RPS=5) ─────────────
    console.log('\n--- Section 1: PSO Seeds 42-51 ---');
    for (let seed = 42; seed <= 51; seed++) {
        const out = path.join(RAW_DIR, `pso_seed${seed}.json`);
        const cmd = `node experiments/run_experiment.js --algorithm PSO --duration 30 --rps 5 --seed ${seed} --output ${out}`;
        runCmd(cmd);
    }

    // ── 2. Load Scalability (RPS 5, 10, 20) ───────────────────────────────────
    console.log('\n--- Section 2: Load Scalability ---');
    for (const rps of [5, 10, 20]) {
        const out = path.join(RAW_DIR, `pso_rps${rps}.json`);
        const cmd = `node experiments/run_experiment.js --algorithm PSO --duration 30 --rps ${rps} --seed 42 --output ${out}`;
        runCmd(cmd);
    }

    // ── 3. Ablation Experiments ───────────────────────────────────────────────
    console.log('\n--- Section 3: Ablation Experiments ---');
    runCmd(`node experiments/run_experiment.js --algorithm PSO_LINEAR_FITNESS --duration 30 --rps 5 --seed 42 --output ${path.join(RAW_DIR, 'pso_linear.json')}`);
    runCmd(`node experiments/run_experiment.js --algorithm PSO_WITHOUT_SOFTMAX --duration 30 --rps 5 --seed 42 --output ${path.join(RAW_DIR, 'pso_nosoftmax.json')}`);

    // ── 4. Baselines ──────────────────────────────────────────────────────────
    console.log('\n--- Section 4: Baseline Algorithms ---');
    runCmd(`node experiments/run_experiment.js --algorithm ROUND_ROBIN --duration 30 --rps 5 --seed 42 --output ${path.join(RAW_DIR, 'round_robin.json')}`);
    runCmd(`node experiments/run_experiment.js --algorithm LEAST_CONNECTIONS --duration 30 --rps 5 --seed 42 --output ${path.join(RAW_DIR, 'least_connections.json')}`);
    runCmd(`node experiments/run_experiment.js --algorithm FIXED_HEALTH --duration 30 --rps 5 --seed 42 --output ${path.join(RAW_DIR, 'fixed_health.json')}`);

    // ── 5. Self-Healing Experiment (Healing ON vs Healing OFF) ────────────────
    console.log('\n--- Section 5: Self-Healing Experiment ---');
    
    // Ensure all 3 api nodes are running
    try { execSync('docker start api1 api2 api3'); } catch {}
    await new Promise(r => setTimeout(r, 3000));

    // 5A: Healing ON
    console.log('\n[Self-Healing] Testing Healing ON (healer running)...');
    try { execSync('docker start healer'); } catch {}
    await new Promise(r => setTimeout(r, 2000));

    // Trigger chaos stop on api2 after 5s during run
    setTimeout(() => {
        console.log('[Chaos Injection] Stopping api2 (Healing ON)...');
        try { execSync('docker stop api2'); } catch {}
    }, 5000);

    const healingOnOut = path.join(RAW_DIR, 'healing_on.json');
    runCmd(`node experiments/run_experiment.js --algorithm PSO --duration 35 --rps 5 --seed 42 --output ${healingOnOut}`);

    // Read healing_on file and mark experimentType = 'healing_on'
    const hOnData = JSON.parse(fs.readFileSync(healingOnOut, 'utf-8'));
    hOnData.meta.experimentType = 'healing_on';
    fs.writeFileSync(healingOnOut, JSON.stringify(hOnData, null, 2));

    // Ensure api containers recovered
    try { execSync('docker start api1 api2 api3'); } catch {}
    await new Promise(r => setTimeout(r, 3000));

    // 5B: Healing OFF
    console.log('\n[Self-Healing] Testing Healing OFF (healer stopped)...');
    try { execSync('docker stop healer'); } catch {}
    await new Promise(r => setTimeout(r, 2000));

    // Trigger chaos stop on api2 after 5s during run
    setTimeout(() => {
        console.log('[Chaos Injection] Stopping api2 (Healing OFF)...');
        try { execSync('docker stop api2'); } catch {}
    }, 5000);

    const healingOffOut = path.join(RAW_DIR, 'healing_off.json');
    runCmd(`node experiments/run_experiment.js --algorithm PSO --duration 35 --rps 5 --seed 42 --output ${healingOffOut}`);

    // Read healing_off file and mark experimentType = 'healing_off'
    const hOffData = JSON.parse(fs.readFileSync(healingOffOut, 'utf-8'));
    hOffData.meta.experimentType = 'healing_off';
    fs.writeFileSync(healingOffOut, JSON.stringify(hOffData, null, 2));

    // Restore healer container
    try { execSync('docker start healer api1 api2 api3'); } catch {}
    await new Promise(r => setTimeout(r, 3000));

    // ── 6. Overhead Benchmark ─────────────────────────────────────────────────
    console.log('\n--- Section 6: Overhead Benchmark ---');
    runCmd(`node experiments/measure_overhead.js --lb-url http://localhost:4000 --output ${path.join(PROC_DIR, 'overhead.json')}`);

    // ── 7. Aggregate Statistical Summaries ───────────────────────────────────
    console.log('\n--- Section 7: Statistical Summaries Generation ---');
    runCmd(`node experiments/collect_results.js --input ${RAW_DIR} --output ${path.join(PROC_DIR, 'summary.csv')}`);

    console.log('\n✅ ALL EXPERIMENTS COMPLETED SUCCESSFULLY!');
}

main().catch(err => {
    console.error('Fatal error in experiment execution:', err.message);
    process.exit(1);
});
