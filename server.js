const http = require('http');
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const { exec } = require('child_process');

const POLL_INTERVAL_MS = 3000;
const previousCpu = new Map();
const reverseDnsCache = new Map();

let latestData = [];
let lastRefresh = null;
let refreshInProgress = false;

function run(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error((stderr || err.message).trim()));
        return;
      }
      resolve(stdout);
    });
  });
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  const KB = 1024;
  const MB = KB * 1024;
  const GB = MB * 1024;
  const TB = GB * 1024;

  if (n >= TB) return `${(n / TB).toFixed(1)} TB`;
  if (n >= GB) return `${(n / GB).toFixed(1)} GB`;
  if (n >= MB) return `${(n / MB).toFixed(1)} MB`;
  if (n >= KB) return `${(n / KB).toFixed(1)} KB`;
  return `${n} B`;
}

function normalizeStatus(status) {
  const s = String(status || '').trim().toLowerCase();
  if (!s) return 'Unknown';
  if (s === 'running') return 'Running';
  if (s === 'stopped') return 'Stopped';
  if (s === 'frozen') return 'Frozen';
  return String(status);
}

function pickIpAndMac(state) {
  const net = state?.network || {};
  const preferredIfNames = ['eth0', 'ens3', 'enp0s3', 'enp5s0', 'enp6s0'];
  const candidates = [];

  for (const [ifname, iface] of Object.entries(net)) {
    if (!iface || ifname === 'lo') continue;

    const addresses = Array.isArray(iface.addresses) ? iface.addresses : [];
    const ipv4 = addresses.find(
      a => a?.family === 'inet' && a.address && !a.address.startsWith('127.')
    );

    if (!ipv4) continue;

    candidates.push({
      ifname,
      ip: ipv4.address,
      mac: iface.hwaddr || ''
    });
  }

  if (candidates.length === 0) return { ip: '', mac: '' };

  for (const ifname of preferredIfNames) {
    const found = candidates.find(c => c.ifname === ifname);
    if (found) return { ip: found.ip, mac: found.mac };
  }

  return { ip: candidates[0].ip, mac: candidates[0].mac };
}

function getDiskDisplay(container) {
  const rootDisk = container?.state?.disk?.root;
  if (!rootDisk) return 'N/A';

  const usage = Number(rootDisk.usage || 0);
  const total = Number(rootDisk.total || 0);

  if (total > 0) return `${formatBytes(usage)} / ${formatBytes(total)}`;
  if (usage > 0) return formatBytes(usage);
  return 'N/A';
}

function parseMemoryLimit(limitValue) {
  if (limitValue === undefined || limitValue === null || limitValue === '') {
    return 0;
  }

  if (typeof limitValue === 'number') {
    return limitValue;
  }

  const text = String(limitValue).trim().toLowerCase();
  if (!text || text === '0') return 0;

  const match = text.match(/^([\d.]+)\s*([kmgt]?ib|[kmgt]?b)?$/i);
  if (!match) return 0;

  const num = parseFloat(match[1]);
  const unit = (match[2] || 'b').toLowerCase();

  const factors = {
    b: 1,
    kb: 1000,
    mb: 1000 ** 2,
    gb: 1000 ** 3,
    tb: 1000 ** 4,
    kib: 1024,
    mib: 1024 ** 2,
    gib: 1024 ** 3,
    tib: 1024 ** 4
  };

  return Math.round(num * (factors[unit] || 1));
}

function getMemoryDisplay(container) {
  const used = Number(container?.state?.memory?.usage || 0);
  const limit = parseMemoryLimit(container?.config?.['limits.memory']);

  if (limit > 0) {
    return `${formatBytes(used)} / ${formatBytes(limit)}`;
  }

  if (used > 0) {
    return formatBytes(used);
  }

  return 'N/A';
}

function getCpuPercentDisplay(key, container) {
  const usageNs = Number(container?.state?.cpu?.usage || 0);
  const nowMs = Date.now();

  if (usageNs <= 0) {
    previousCpu.set(key, { usageNs, tsMs: nowMs });
    return 'N/A';
  }

  const prev = previousCpu.get(key);
  previousCpu.set(key, { usageNs, tsMs: nowMs });

  if (!prev) return 'N/A';

  const deltaUsageNs = usageNs - prev.usageNs;
  const deltaTimeMs = nowMs - prev.tsMs;

  if (deltaUsageNs < 0 || deltaTimeMs <= 0) return 'N/A';

  // 1 full host CPU core over the interval = 100.0
  const cpuPercent = deltaUsageNs / (deltaTimeMs * 1e4);

  if (!Number.isFinite(cpuPercent) || cpuPercent < 0) return 'N/A';

  return cpuPercent.toFixed(1);
}

async function reverseLookup(ip) {
  if (!ip) return '';

  const cached = reverseDnsCache.get(ip);
  const now = Date.now();

  if (cached && now - cached.ts < 5 * 60 * 1000) {
    return cached.name;
  }

  try {
    const names = await dns.reverse(ip);
    const name = Array.isArray(names) && names.length ? names[0] : '';
    reverseDnsCache.set(ip, { name, ts: now });
    return name;
  } catch {
    reverseDnsCache.set(ip, { name: '', ts: now });
    return '';
  }
}

async function discoverRemotes() {
  const stdout = await run('incus remote list --format=csv');
  const lines = stdout.split('\n').map(x => x.trim()).filter(Boolean);
  const remotes = [];

  for (const line of lines) {
    const parts = line.split(',');
    const name = (parts[0] || '').replace(/\s+\(current\)$/i, '').trim();
    const protocol = (parts[2] || '').trim().toLowerCase();
    const isPublic = (parts[4] || '').trim().toUpperCase() === 'YES';

    if (!name) continue;
    if (name === 'local') continue;
    if (isPublic) continue;
    if (protocol !== 'incus') continue;

    remotes.push(`${name}:`);
  }

  return remotes;
}

async function fetchRemoteContainers(remote) {
  try {
    const stdout = await run(`incus list ${remote} --format=json`);
    const items = JSON.parse(stdout);
    const host = remote.replace(/:$/, '');

    const base = items.map(c => {
      const net = pickIpAndMac(c.state || {});
      const key = `${host}:${c.name || ''}`;

      return {
        host,
        name: c.name || '',
        status: normalizeStatus(c.status),
        ip: net.ip,
        mac: net.mac,
        cpu: getCpuPercentDisplay(key, c),
        memory: getMemoryDisplay(c),
        disk: getDiskDisplay(c),
        type: c.type || ''
      };
    });

    return await Promise.all(
      base.map(async item => ({
        ...item,
        dns_name: await reverseLookup(item.ip)
      }))
    );
  } catch {
    return [];
  }
}

async function refreshData() {
  if (refreshInProgress) return;
  refreshInProgress = true;

  try {
    const remotes = await discoverRemotes();
    const arrays = await Promise.all(remotes.map(fetchRemoteContainers));

    latestData = arrays.flat().sort((a, b) => {
      if (a.host !== b.host) return a.host.localeCompare(b.host);
      return a.name.localeCompare(b.name);
    });

    lastRefresh = new Date().toISOString();
  } finally {
    refreshInProgress = false;
  }
}

refreshData();
setInterval(refreshData, POLL_INTERVAL_MS);

const server = http.createServer((req, res) => {
  const pathname = req.url.split('?')[0];

  if (pathname === '/api/containers') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      refreshedAt: lastRefresh,
      intervalMs: POLL_INTERVAL_MS,
      containers: latestData
    }));
    return;
  }

  if (pathname === '/api/config') {
    const filePath = path.join(__dirname, 'config.json');

    fs.readFile(filePath, 'utf8', (err, data) => {
      if (err) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          appName: 'ScottiBYTE Incus Dashboard',
          version: 'unknown',
          githubReleasesUrl: 'https://github.com/ScottiBYTE/incus-dashboard/releases',
          donateUrl: 'https://www.paypal.com/paypalme/ScottiBYTE'
        }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(data);
    });
    return;
  }

  if (pathname === '/' || pathname === '/index.html') {
    const filePath = path.join(__dirname, 'index.html');
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Failed to load index.html');
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

const PORT = 80;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Dashboard running on port ${PORT}`);
});

