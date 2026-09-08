const express = require('express');
const crypto = require('node:crypto');
const models = require('../db/models');
const sm = require('../services/stateMachine');
const gemini = require('../services/gemini');

const router = express.Router();
const deps = { models, llm: gemini };
const COOKIE = 'kpr_session';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // detik

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(header.split(';').map((c) => c.trim().split('=').map(decodeURIComponent)).filter((p) => p[0]));
}

router.post('/api/session', (req, res) => {
  const code = (req.body?.code || '').trim().toUpperCase();
  let token = parseCookies(req)[COOKIE];
  let session = token ? models.getSessionByToken(token) : undefined;
  let resumed = false;

  if (code) {
    const target = models.getSessionByCode(code);
    if (target) {
      session = target;
      token = target.cookie_token;
      resumed = true;
    }
  }

  if (!session) {
    token = crypto.randomUUID();
    session = sm.startNewSession({ cookieToken: token, deps });
  }

  res.setHeader('Set-Cookie',
    `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`);
  const messages = models.getMessages(session.id).map((m) => ({ role: m.role, content: m.content }));
  res.json({
    resumed,
    code: session.code,
    state: session.state,
    messages,
    progress: sm.progress(session, models),
  });
});

module.exports = { router, parseCookies, COOKIE };
