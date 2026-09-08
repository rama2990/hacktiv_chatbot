const db = require('./sqlite');

const mapSession = (row) =>
  row ? { ...row, cookieToken: row.cookie_token, currentIndex: row.current_index } : row;

const createSession = ({ id, code, cookieToken }) =>
  db.prepare('INSERT INTO sessions (id, code, cookie_token) VALUES (?, ?, ?)').run(id, code, cookieToken);

const getSession = (id) => mapSession(db.prepare('SELECT * FROM sessions WHERE id = ?').get(id));
const getSessionByCode = (code) => mapSession(db.prepare('SELECT * FROM sessions WHERE code = ?').get(code));
const getSessionByToken = (token) => mapSession(db.prepare('SELECT * FROM sessions WHERE cookie_token = ?').get(token));

const updateSession = (id, { state, profession, currentIndex } = {}) => {
  const s = getSession(id);
  db.prepare(`UPDATE sessions SET state = ?, profession = ?, current_index = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(state ?? s.state, profession ?? s.profession, currentIndex ?? s.currentIndex, id);
  return getSession(id);
};

const addMessage = (sessionId, role, content) =>
  db.prepare('INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)').run(sessionId, role, content);

const getMessages = (sessionId) =>
  db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY id ASC').all(sessionId);

const addDocument = ({ sessionId, jenis, path, mime, status = null, notes = null }) => {
  const info = db.prepare('INSERT INTO documents (session_id, jenis, path, mime, status, notes) VALUES (?, ?, ?, ?, ?, ?)')
    .run(sessionId, jenis, path, mime, status, notes);
  return db.prepare('SELECT * FROM documents WHERE id = ?').get(info.lastInsertRowid);
};

const updateDocument = (id, { status, notes }) =>
  db.prepare('UPDATE documents SET status = ?, notes = ? WHERE id = ?').run(status, notes, id);

const getDocuments = (sessionId) =>
  db.prepare('SELECT * FROM documents WHERE session_id = ? ORDER BY id ASC').all(sessionId);

module.exports = {
  createSession, getSession, getSessionByCode, getSessionByToken,
  updateSession, addMessage, getMessages, addDocument, updateDocument, getDocuments,
};
