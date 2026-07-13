'use strict';

const axios = require('axios');

const nbi = axios.create({
  baseURL: process.env.MOCAACS_GENIEACS_NBI_URL || 'http://moca-genieacs:7557',
  timeout: 120000,
  headers: { 'Content-Type': 'application/json' }
});

module.exports = { nbi };
