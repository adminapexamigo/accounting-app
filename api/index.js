'use strict';
/**
 * Vercel Serverless Function entry point
 * Handles all /api/* requests and /api/cron/* triggers.
 */

const handler = require('../server.js');

module.exports = async (req, res) => {
  // 1. Check if Vercel set x-matched-path or x-vercel-matched-path or x-forwarded-uri
  const matched = req.headers['x-matched-path'] ||
                  req.headers['x-vercel-matched-path'] ||
                  req.headers['x-forwarded-uri'] ||
                  req.headers['x-original-url'];

  if (matched && matched.startsWith('/api/')) {
    req.url = matched;
  } else if (req.query && req.query.path) {
    // 2. Vercel passes :path* in req.query.path
    const sub = Array.isArray(req.query.path) ? req.query.path.join('/') : req.query.path;
    req.url = '/api/' + sub;
  } else if (req.url && (req.url.startsWith('/api/index.js') || req.url.startsWith('/api/index') || req.url.startsWith('/api/[...path]'))) {
    // 3. Fallback: Parse query parameter from req.url
    try {
      const u = new URL(req.url, 'http://localhost');
      const p = u.searchParams.get('path');
      if (p) req.url = '/api/' + p;
    } catch {}
  }

  return await handler(req, res);
};
