'use strict';
/**
 * Vercel Serverless Function entry point
 * Handles all /api/* requests and /api/cron/* triggers.
 */

const handler = require('../server.js');

module.exports = async (req, res) => {
  return await handler(req, res);
};
