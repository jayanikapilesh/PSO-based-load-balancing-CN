'use strict';

/**
 * collect_results.js — Aggregates raw experiment JSON files into a CSV summary.
 *
 * Usage:
 *   node experiments/collect_results.js \
 *     --input experiments/raw \
 *     --output experiments/processed/summary.csv
 *
 * Reads all *.json files in the input directory, extracts the summary fields,
 * and writes a CSV file with one row per experiment run.
 *
 * Also performs basic statistical analysis (mean, std, confidence intervals)
 * when multiple runs of the same algorithm are found.
 */

const fs   = require('fs');
const path = require('path');

function parseArgs() {
    const args = process.argv.slice(2);
    const out = {
        input:  path.join(__dirname, 'raw'),
        output: path.join(__dirname, 'processed', 'summary.csv'),
    };
    for (let i = 0; i < args.length; i += 2) {
        const key = args[i].replace('--', '');
        const val = args[i + 1];
        if (key === 'input')  out.input  = val;
        if (key === 'output') out.output = val;
    }
    return out;
}

function mean(arr) {
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr) {
    const m = mean(arr);
    const variance = arr.reduce((s, v) => s + Math.pow(v - m, 2), 0) / arr.length;
    return Math.sqrt(variance);
}

function ci95(arr) {
    // 95% CI using t-distribution approximation for small samples
    // t-value for 95% CI, df = n-1
    const tTable = { 1: 12.71, 2: 4.30, 3: 3.18, 4: 2.78, 5: 2.57, 6: 2.45, 7: 2.36, 8: 2.31, 9: 2.26, 10: 2.23 };
    const n = arr.length;
    if (n < 2) return NaN;
    const t = tTable[Math.min(n - 1, 10)] || 1.96;
    const se = stddev(arr) / Math.sqrt(n);
    return t * se;
}

function main() {
    const opts = parseArgs();
    console.log(`[collect_results] Reading from: ${opts.input}`);

    if (!fs.existsSync(opts.input)) {
        console.error(`Input directory not found: ${opts.input}`);
        process.exit(1);
    }

    const files = fs.readdirSync(opts.input)
        .filter(f => f.endsWith('.json'))
        .map(f => path.join(opts.input, f));

    if (files.length === 0) {
        console.error('No JSON files found. Run experiments first.');
        process.exit(1);
    }

    const rows = [];
    for (const file of files) {
        try {
            const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
            const { meta, summary } = data;
            rows.push({
                file:         path.basename(file),
                timestamp:    meta.timestamp,
                algorithm:    meta.algorithm,
                duration:     meta.duration,
                rps:          meta.rps,
                seed:         meta.seed,
                totalRequests: summary.totalRequests,
                totalErrors:   summary.totalErrors,
                throughput:    summary.throughput,
                avgLatency:    summary.avgLatency,
                p95Latency:    summary.p95Latency,
                errorRate:     summary.errorRate,
            });
        } catch (e) {
            console.warn(`Skipping ${file}: ${e.message}`);
        }
    }

    // ── Write per-run CSV ────────────────────────────────────────────────────────
    const headers = Object.keys(rows[0]).join(',');
    const lines   = rows.map(r => Object.values(r).join(','));
    const csv     = [headers, ...lines].join('\n');

    const outDir = path.dirname(opts.output);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(opts.output, csv);
    console.log(`[collect_results] Per-run CSV: ${opts.output} (${rows.length} runs)`);

    // ── Statistical summary per algorithm ─────────────────────────────────────
    const byAlgo = {};
    for (const row of rows) {
        if (!byAlgo[row.algorithm]) byAlgo[row.algorithm] = [];
        byAlgo[row.algorithm].push(row);
    }

    const statFile = opts.output.replace('.csv', '_stats.csv');
    const statHeaders = [
        'algorithm', 'runs',
        'throughput_mean', 'throughput_std', 'throughput_ci95',
        'avgLatency_mean', 'avgLatency_std', 'avgLatency_ci95',
        'p95Latency_mean', 'p95Latency_std', 'p95Latency_ci95',
        'errorRate_mean',  'errorRate_std',  'errorRate_ci95',
    ].join(',');

    const statLines = Object.entries(byAlgo).map(([algo, algoRows]) => {
        const tps  = algoRows.map(r => r.throughput);
        const lats = algoRows.map(r => r.avgLatency);
        const p95s = algoRows.map(r => r.p95Latency);
        const errs = algoRows.map(r => r.errorRate);

        return [
            algo,
            algoRows.length,
            mean(tps).toFixed(3),   stddev(tps).toFixed(3),   isNaN(ci95(tps))  ? 'N/A' : ci95(tps).toFixed(3),
            mean(lats).toFixed(3),  stddev(lats).toFixed(3),  isNaN(ci95(lats)) ? 'N/A' : ci95(lats).toFixed(3),
            mean(p95s).toFixed(3),  stddev(p95s).toFixed(3),  isNaN(ci95(p95s)) ? 'N/A' : ci95(p95s).toFixed(3),
            mean(errs).toFixed(6),  stddev(errs).toFixed(6),  isNaN(ci95(errs)) ? 'N/A' : ci95(errs).toFixed(6),
        ].join(',');
    });

    fs.writeFileSync(statFile, [statHeaders, ...statLines].join('\n'));
    console.log(`[collect_results] Statistical summary: ${statFile}`);

    // ── Print table to console ────────────────────────────────────────────────
    console.log('\n── Algorithm Summary ────────────────────────────────────────────────────');
    console.log('Algorithm'.padEnd(25) + 'Runs  Throughput  Avg Lat   P95 Lat   Err Rate');
    for (const [algo, algoRows] of Object.entries(byAlgo)) {
        const tps  = algoRows.map(r => r.throughput);
        const lats = algoRows.map(r => r.avgLatency);
        const p95s = algoRows.map(r => r.p95Latency);
        const errs = algoRows.map(r => r.errorRate);
        console.log(
            algo.padEnd(25) +
            String(algoRows.length).padEnd(6) +
            mean(tps).toFixed(2).padEnd(12) +
            mean(lats).toFixed(2).padEnd(10) +
            mean(p95s).toFixed(2).padEnd(10) +
            (mean(errs) * 100).toFixed(2) + '%'
        );
    }
}

main();
