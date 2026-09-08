const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const multer = require('multer');
const db = require('../db/sqlite');
const models = require('../db/models');
const sm = require('../services/stateMachine');
const gemini = require('../services/gemini');
const { parseCookies, COOKIE } = require('./session');

const router = express.Router();
const deps = { models, llm: gemini };

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 4 },
  fileFilter: (req, file, cb) => {
    const ok = ['application/pdf', 'image/png', 'image/jpeg'].includes(file.mimetype);
    cb(ok ? null : new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname), ok);
  },
});

function chatErrorHandler(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Upload ditolak: ${err.message}. Maksimal 4 file, masing-masing 4 MB, format PDF/JPG/PNG.` });
  }
  next(err);
}

router.post('/api/chat', upload.array('files', 4), chatErrorHandler, async (req, res, next) => {
  try {
    const token = parseCookies(req)[COOKIE];
    const session = token ? models.getSessionByToken(token) : undefined;
    if (!session) return res.status(401).json({ error: 'NO_SESSION' });

    const files = (req.files || []).map((f) => ({ buffer: f.buffer, mimetype: f.mimetype, originalname: f.originalname }));

    // onSaveDocument: tulis file ke uploads setelah baris dokumen tersimpan
    const onSaveDocument = (docRow, file) => {
      const ext = file.mimetype === 'application/pdf' ? 'pdf' : file.mimetype === 'image/png' ? 'png' : 'jpg';
      const rel = path.join('uploads', session.id, `${docRow.jenis}-${Date.now()}.${ext}`);
      fs.mkdirSync(path.join(__dirname, '..', 'uploads', session.id), { recursive: true });
      fs.writeFileSync(path.join(__dirname, '..', rel), file.buffer);
      db.prepare('UPDATE documents SET path = ? WHERE id = ?').run(rel, docRow.id);
    };

    const result = await sm.handleMessage({
      session: models.getSession(session.id),
      text: req.body.message || '',
      files,
      deps: { ...deps, onSaveDocument },
    });

    if (result.resumeSessionId) {
      // pindahkan cookie ke sesi lama agar chat berikutnya memakai sesi itu
      const target = models.getSession(result.resumeSessionId);
      res.setHeader('Set-Cookie',
        `${COOKIE}=${encodeURIComponent(target.cookie_token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`);
    }

    // code = result.code bila ada; kalau tidak, kode sesi yang kini ditunjuk cookie
    const codeSession = result.resumeSessionId ? models.getSession(result.resumeSessionId) : session;
    const code = result.code !== undefined && result.code !== null ? result.code : codeSession.code;

    res.json({
      reply: result.reply,
      options: result.options,
      code,
      progress: result.progress,
      state: result.state,
    });
  } catch (err) {
    if (err.message === 'LLM_UNAVAILABLE') {
      return res.status(503).json({ error: 'Layanan analisis sedang tidak tersedia. Dokumen Anda tersimpan; silakan coba kirim ulang nanti.' });
    }
    next(err);
  }
});

module.exports = { router };
