/* api.js - thin wrapper around fetch() for the Flask REST API.
   The browser never runs BFS/DFS itself: it only sends the graph and receives the result. */
(function (global) {
  'use strict';

  // When served by Flask the base is '' (same origin). If index.html is opened from disk, fall back to localhost.
  const BASE = location.protocol === 'file:' ? 'http://127.0.0.1:5000' : '';

  class ApiError extends Error {
    constructor(message, code, status) {
      super(message);
      this.name = 'ApiError';
      this.code = code || 'error';
      this.status = status || 0;
    }
  }

  async function request(path, options) {
    let res;
    try {
      res = await fetch(BASE + path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, options));
    } catch (err) {
      throw new ApiError('Cannot reach the Flask backend. Start it with "python app.py" and reload this page.',
        'backend_unavailable', 0);
    }
    let data = null;
    try { data = await res.json(); } catch (_) { /* non-JSON body */ }
    if (!res.ok) {
      throw new ApiError((data && data.message) || ('Request failed (HTTP ' + res.status + ').'),
        data && data.error, res.status);
    }
    return data;
  }

  const post = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) });

  global.GTV = global.GTV || {};
  global.GTV.api = {
    ApiError,
    health: () => request('/api/health'),
    algorithms: () => request('/api/algorithms'),
    validate: (payload) => post('/api/graph/validate', payload),
    traverse: (payload) => post('/api/graph/traverse', payload),
  };
})(window);
