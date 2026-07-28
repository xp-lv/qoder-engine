#!/usr/bin/env node
'use strict';

/**
 * Qoder Monitor Collector - background collection process.
 *
 * Quality principles followed:
 *   P3 - setInterval based periodic collection; SIGTERM clears the timer.
 *   P4 - collect REAL system-level metrics (no hardcoding / no Math.random).
 *   P5 - REST POST to /api/reports with exponential backoff retry + timeout.
 *   P6 - config.json driven; instanceId persisted (stable across restarts).
 *   P7 - zero intrusion: no IDE config mutation, no UI, no event interception.
 *
 * Zero external dependencies: Node.js built-in modules only.
 * API contract: unified-interface-doc §2.1 (CreateReportDTO), backend port 3000.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { execSync } = require('child_process');

// ===================== Config loading (P6) =====================
const PLUGIN_ROOT = process.env.QODER_PLUGIN_ROOT || path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(PLUGIN_ROOT, 'config.json');
const DEFAULT_CONFIG = {
  serverUrl: 'http://localhost:3000',
  collectIntervalSec: 30,
  instanceId: ''
};

function loadConfig() {
  let cfg = Object.assign({}, DEFAULT_CONFIG);
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      Object.assign(cfg, JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')));
    }
  } catch (e) {
    console.error('[collector] config.json parse failed, using defaults:', e.message);
  }
  // instanceId persistence: first run -> generate UUID and write back.
  if (!cfg.instanceId) {
    cfg.instanceId = crypto.randomUUID();
    try {
      fs.writeFileSync(
        CONFIG_PATH,
        JSON.stringify(Object.assign({}, DEFAULT_CONFIG, cfg), null, 2) + '\n',
        'utf8'
      );
    } catch (e) {
      console.error('[collector] instanceId write-back failed:', e.message);
    }
  }
  // Frequency floor: < 5s is forbidden (quality red line) -> reset to 30s.
  if (typeof cfg.collectIntervalSec !== 'number' || cfg.collectIntervalSec < 5) {
    cfg.collectIntervalSec = 30;
  }
  if (typeof cfg.serverUrl !== 'string' || !cfg.serverUrl) {
    cfg.serverUrl = DEFAULT_CONFIG.serverUrl;
  }
  cfg.serverUrl = String(cfg.serverUrl).replace(/\/+$/, '');
  return cfg;
}

const CONFIG = loadConfig();

// ===================== Real metric collection (P4) =====================
function readHostname() {
  try { return os.hostname() || 'unknown'; } catch { return 'unknown'; }
}

// qoderVersion: read from candidate product.json locations.
function readQoderVersion() {
  const home = os.homedir();
  const candidates = [
    path.join(home, '.qoder', 'product.json'),
    path.join(home, '.config', 'Qoder', 'product.json'),
    '/usr/share/qoder/resources/app/product.json',
    '/usr/share/qoder/product.json',
    '/opt/Qoder/resources/app/product.json'
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const j = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (j && typeof j.version === 'string') return j.version;
        if (j && typeof j.qoderVersion === 'string') return j.qoderVersion;
      }
    } catch { /* try next candidate */ }
  }
  return 'unknown';
}

// status: detect a live Qoder process (exclude the collector itself).
function detectStatus() {
  try {
    let out = '';
    try {
      // pgrep -af lists "pid cmd"; filter out our own collector process.
      out = execSync("pgrep -af '[Qq]oder' | grep -vi 'collector' || true",
        { encoding: 'utf8', timeout: 2000 });
    } catch { /* pgrep missing or no match */ }
    const lines = out.split('\n').map(s => s.trim()).filter(Boolean);
    return lines.length > 0 ? 'running' : 'error';
  } catch {
    return 'error';
  }
}

// uptime: on Linux compute Qoder main process uptime from /proc.
function readUptime() {
  if (process.platform !== 'linux') return null;
  try {
    const sysUptime = parseFloat(fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0]);
    if (!isFinite(sysUptime)) return null;
    const CLK_TCK = 100;
    let minStartSec = Infinity;
    const pids = fs.readdirSync('/proc').filter(d => /^\d+$/.test(d));
    for (const pid of pids) {
      if (pid === String(process.pid)) continue;
      let cmdline = '';
      try {
        cmdline = fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8').replace(/\0/g, ' ').trim();
      } catch { continue; }
      if (!/[Qq]oder/.test(cmdline)) continue;
      if (/collector/i.test(cmdline)) continue;
      try {
        const stat = fs.readFileSync('/proc/' + pid + '/stat', 'utf8');
        // Parse robustly: comm is in parens and may contain spaces.
        const lp = stat.lastIndexOf(')');
        const rest = stat.slice(lp + 2).split(' ');
        const starttime = parseInt(rest[19], 10); // field 22 (0-based 19 after comm)
        if (isFinite(starttime)) {
          const up = sysUptime - starttime / CLK_TCK;
          if (up >= 0 && up < minStartSec) minStartSec = up;
        }
      } catch { /* skip this pid */ }
    }
    return isFinite(minStartSec) ? Math.floor(minStartSec) : null;
  } catch {
    return null;
  }
}

// cpuUsage: 1-min load average normalized by core count, clamped 0-100.
function readCpuUsage() {
  try {
    const cores = os.cpus().length || 1;
    const load = os.loadavg()[0];
    if (!isFinite(load)) return null;
    const pct = (load / cores) * 100;
    return Math.max(0, Math.min(100, Number(pct.toFixed(2))));
  } catch {
    return null;
  }
}

// memUsage: system memory utilization, clamped 0-100.
function readMemUsage() {
  try {
    const total = os.totalmem();
    if (!total) return null;
    const pct = (1 - os.freemem() / total) * 100;
    return Math.max(0, Math.min(100, Number(pct.toFixed(2))));
  } catch {
    return null;
  }
}

// workspaceCount: count entries in candidate workspace storage dirs.
function readWorkspaceCount() {
  const home = os.homedir();
  const candidates = [
    path.join(home, '.qoder', 'workspaceStorage'),
    path.join(home, '.config', 'Qoder', 'User', 'workspaceStorage'),
    path.join(home, '.config', 'Qoder', 'workspaceStorage')
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
        return fs.readdirSync(p).filter(n => {
          try { return fs.statSync(path.join(p, n)).isDirectory(); } catch { return false; }
        }).length;
      }
    } catch { /* try next candidate */ }
  }
  return null;
}

function collect() {
  return {
    hostname: readHostname(),
    qoderVersion: readQoderVersion(),
    status: detectStatus(),
    uptime: readUptime(),
    cpuUsage: readCpuUsage(),
    memUsage: readMemUsage(),
    workspaceCount: readWorkspaceCount()
  };
}

// ===================== Reporting (P5) =====================
// Exponential backoff: immediate, then 1s/2s/4s/8s, then give up this round.
const BACKOFF_MS = [0, 1000, 2000, 4000, 8000];
const REQUEST_TIMEOUT_MS = 5000;

function postReport(payload) {
  return new Promise(resolve => {
    let url;
    try { url = new URL(CONFIG.serverUrl + '/api/reports'); }
    catch { resolve(false); return; }
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const lib = url.protocol === 'https:' ? https : http;
    const opts = {
      method: 'POST',
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + (url.search || ''),
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: REQUEST_TIMEOUT_MS
    };
    const req = lib.request(opts, res => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 300);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => { resolve(false); });
    req.write(body);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function reportOnce() {
  const metrics = collect();
  const payload = {
    instanceId: CONFIG.instanceId,
    hostname: metrics.hostname,
    qoderVersion: metrics.qoderVersion,
    status: metrics.status,
    uptime: metrics.uptime,
    cpuUsage: metrics.cpuUsage,
    memUsage: metrics.memUsage,
    workspaceCount: metrics.workspaceCount,
    reportedAt: new Date().toISOString()
  };
  for (let i = 0; i < BACKOFF_MS.length; i++) {
    if (shuttingDown) return;
    if (BACKOFF_MS[i] > 0) {
      await sleep(BACKOFF_MS[i]);
      if (shuttingDown) return;
    }
    const ok = await postReport(payload);
    if (ok) {
      console.log('[collector] report ok @ ' + payload.reportedAt);
      return;
    }
    console.error('[collector] report failed (attempt ' + (i + 1) + '/' + BACKOFF_MS.length + ')');
  }
  console.error('[collector] report round abandoned (backoff exhausted); next tick recollects.');
}

// ===================== Periodic loop + graceful shutdown (P3) =====================
let intervalHandle = null;
let runningTick = false;
let shuttingDown = false;

async function tick() {
  if (runningTick || shuttingDown) return; // re-entrancy guard
  runningTick = true;
  try { await reportOnce(); }
  catch (e) { console.error('[collector] tick error:', e.message); }
  finally { runningTick = false; }
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[collector] received ' + signal + ', clearing setInterval and exiting.');
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
  // Allow in-flight I/O a brief moment before forced exit.
  setTimeout(() => process.exit(0), 500);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Boot: one immediate collection, then periodic.
console.log('[collector] starting instanceId=' + CONFIG.instanceId +
  ' interval=' + CONFIG.collectIntervalSec + 's' +
  ' target=' + CONFIG.serverUrl + '/api/reports');
tick();
intervalHandle = setInterval(tick, CONFIG.collectIntervalSec * 1000);
