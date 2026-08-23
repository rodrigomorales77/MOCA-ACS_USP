'use strict';

// Simple in-memory rate limit per API key (pattern from backend/src/routes/auth.js).
// No external deps. Window is fixed.

const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS = 60; // per key per window

const buckets = new Map(); // keyId -> { count, windowStart }

function rateLimit(req, res, next) {
  const key = req.apiKey ? String(req.apiKey.id) : req.ip;
  const now = Date.now();
  let entry = buckets.get(key);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    entry = { count: 1, windowStart: now };
    buckets.set(key, entry);
    // Opportunistic cleanup to avoid unbounded growth
    if (buckets.size > 10000) {
      for (const [k, v] of buckets) {
        if (now - v.windowStart > WINDOW_MS) buckets.delete(k);
      }
    }
    return next();
  }

  if (entry.count >= MAX_REQUESTS) {
    const retryAfter = Math.ceil((entry.windowStart + WINDOW_MS - now) / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'Rate limit excedido. Reintentá en unos segundos.' });
  }

  entry.count++;
  next();
}

module.exports = { rateLimit, WINDOW_MS, MAX_REQUESTS };
