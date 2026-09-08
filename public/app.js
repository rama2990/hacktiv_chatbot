const $ = (sel) => document.querySelector(sel);
const messagesEl = $('#messages');
const optionsEl = $('#options');
const progressEl = $('#progress');
const form = $('#chat-form');
const textInput = $('#text-input');
const fileInput = $('#file-input');
const fileNamesEl = $('#file-names');

// API base: saat dibuka via Live Server (port 5500/5501), API Express ada di :3000.
// Saat disajikan oleh Express sendiri (http://localhost:3000), pakai relative path.
const API_BASE = ['5500', '5501', '3001'].includes(location.port) ? 'http://localhost:3000' : '';
const CREDENTIALS = API_BASE ? 'include' : 'same-origin';

function addMessage(role, content) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.textContent = content;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderOptions(options) {
  optionsEl.innerHTML = '';
  (options || []).forEach((label) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.addEventListener('click', () => send({ message: label }));
    optionsEl.appendChild(btn);
  });
}

function renderProgress(progress) {
  if (!progress || progress.length === 0) { progressEl.textContent = ''; return; }
  const icons = { valid: '✅', perlu_perbaikan: '⚠️', tidak_sesuai: '❌', perlu_review_manual: '🔍' };
  progressEl.textContent = progress.map((p) => `${icons[p.status] ?? '⬜'} ${p.key}`).join('  ');
}

function renderSessionCode(code) {
  if (code) $('#session-code').textContent = code;
}

async function send({ message = '', files = [] } = {}) {
  if (!message && files.length === 0) return;
  if (message) addMessage('user', message);
  else addMessage('user', `📎 ${files.map((f) => f.name).join(', ')}`);
  optionsEl.innerHTML = '';
  const fd = new FormData();
  fd.append('message', message);
  files.forEach((f) => fd.append('files', f));
  textInput.value = ''; fileInput.value = ''; fileNamesEl.textContent = '';
  try {
    const res = await fetch(`${API_BASE}/api/chat`, { method: 'POST', body: fd, credentials: CREDENTIALS });
    const data = await res.json();
    if (!res.ok) { addMessage('bot', data.error || 'Terjadi kesalahan.'); return; }
    addMessage('bot', data.reply);
    renderOptions(data.options);
    renderProgress(data.progress);
    renderSessionCode(data.code);
  } catch {
    addMessage('bot', 'Tidak dapat menghubungi server. Coba lagi.');
  }
}

fileInput.addEventListener('change', () => {
  fileNamesEl.textContent = [...fileInput.files].map((f) => f.name).join(', ');
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  send({ message: textInput.value.trim(), files: [...fileInput.files] });
});

(async function init() {
  const res = await fetch(`${API_BASE}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    credentials: CREDENTIALS,
  });
  const data = await res.json();
  renderSessionCode(data.code);
  renderProgress(data.progress);
  (data.messages || []).forEach((m) => addMessage(m.role === 'bot' ? 'bot' : 'user', m.content));
  if (!data.resumed) send({ message: 'mulai' });
})();
