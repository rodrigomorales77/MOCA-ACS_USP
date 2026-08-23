'use strict';

const { getEnv } = require('../config/env');

const TIMEOUT_MS = 10000;

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

function buildUrl(path, params) {
  const { nbiUrl } = getEnv();
  const base = nbiUrl.replace(/\/+$/, '');
  const url = new URL(base + path);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') {
        url.searchParams.set(k, String(v));
      }
    }
  }
  return url.toString();
}

async function handleResponse(res) {
  if (res.status === 404) {
    const err = new Error('No encontrado en NBI');
    err.status = 404;
    throw err;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`NBI error ${res.status}: ${text.slice(0, 500)}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  return data;
}

/**
 * GET /devices?query=...&projection=...
 * query is JSON string (e.g. {"_id":"..."})
 */
async function getDevices(query, projection, limit, skip) {
  const params = {};
  if (query !== undefined && query !== null) {
    params.query = typeof query === 'string' ? query : JSON.stringify(query);
  }
  if (projection) params.projection = projection;
  if (limit !== undefined) params.limit = limit;
  if (skip !== undefined) params.skip = skip;

  const url = buildUrl('/devices', params);
  const res = await fetchWithTimeout(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  return handleResponse(res);
}

/**
 * GET single device by _id using query param (PRODUCTCLASS may contain dots).
 * Projection is comma-separated TR-069 paths (wildcards allowed).
 */
async function getDevice(deviceId, projection) {
  const query = JSON.stringify({ _id: deviceId });
  const params = { query };
  if (projection) params.projection = projection;

  const url = buildUrl('/devices', params);
  const res = await fetchWithTimeout(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  const data = await handleResponse(res);
  if (!Array.isArray(data) || data.length === 0) {
    const err = new Error(`Device ${deviceId} no encontrado en NBI`);
    err.status = 404;
    throw err;
  }
  return data[0];
}

module.exports = { getDevices, getDevice, TIMEOUT_MS };
