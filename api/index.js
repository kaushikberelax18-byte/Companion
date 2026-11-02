'use strict';
/* Vercel serverless entry point.

   The companion app is a single self-contained Node module (server.js) that
   works as both a plain HTTP server locally and a Vercel function remotely.
   This file just re-exports its request handler.
*/
const { handler } = require('../server.js');

module.exports = handler;
module.exports.config = { runtime: 'nodejs20.x', maxDuration: 55 };