const { test } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { app } = require('../server');

test('GET /api/health mengembalikan ok', async () => {
  const res = await request(app).get('/api/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});
