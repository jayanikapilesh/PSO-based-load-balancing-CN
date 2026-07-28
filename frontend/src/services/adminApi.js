const API_BASE = 'http://localhost:5001/admin';

let storedToken = localStorage.getItem('admin_jwt') || '';

export function getAdminToken() {
  return storedToken;
}

export function setAdminToken(token) {
  storedToken = token;
  if (token) {
    localStorage.setItem('admin_jwt', token);
  } else {
    localStorage.removeItem('admin_jwt');
  }
}

async function fetchWithAuth(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (storedToken) {
    headers['Authorization'] = `Bearer ${storedToken}`;
  }

  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || data.error || 'API Request failed');
  }
  return data;
}

export async function adminLogin(username, password) {
  const data = await fetchWithAuth('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
  if (data.token) {
    setAdminToken(data.token);
  }
  return data;
}

export async function getIntegrityStatus() {
  return fetchWithAuth('/integrity/status');
}

export async function getIntegrityReport() {
  return fetchWithAuth('/integrity/report');
}

export async function triggerIntegrityScan() {
  return fetchWithAuth('/integrity/verify', { method: 'POST' });
}

export async function getAuditLogs(params = {}) {
  const query = new URLSearchParams(params).toString();
  return fetchWithAuth(`/audit/logs${query ? '?' + query : ''}`);
}

export async function recertifyComponent(assetId) {
  return fetchWithAuth('/integrity/recertify', {
    method: 'POST',
    body: JSON.stringify({ assetId })
  });
}

export async function updateConfig(type, payload) {
  const endpointMap = {
    thresholds: '/config/thresholds',
    trustScore: '/config/trust-score',
    riskClassification: '/config/risk-classification',
    emergencyPolicy: '/config/emergency-policy',
    temporaryLimits: '/config/temporary-limits',
    driftMonitoring: '/config/drift-monitoring'
  };
  const endpoint = endpointMap[type] || '/config/thresholds';
  return fetchWithAuth(endpoint, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function injectFailure(target, type) {
  return fetchWithAuth('/test/inject-failure', {
    method: 'POST',
    body: JSON.stringify({ target, type })
  });
}

export async function restoreBaselines() {
  return fetchWithAuth('/test/restore-baselines', { method: 'POST' });
}

export async function testPrediction(amount, anomalyScore) {
  return fetchWithAuth('/test/predict', {
    method: 'POST',
    body: JSON.stringify({ amount, anomalyScore })
  });
}

export async function testBiometric(userId, factor) {
  return fetchWithAuth('/test/biometric-stub', {
    method: 'POST',
    body: JSON.stringify({ userId, factor })
  });
}
