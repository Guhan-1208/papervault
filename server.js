// ─────────────────────────────────────────────────────────────
//  PaperVault — Backend Server  (Node.js + Express)
//  Stack: Express · JWT · bcrypt · Multer · SQLite (via better-sqlite3)
// ─────────────────────────────────────────────────────────────

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'changeme_in_production';

// ── Directories ──────────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ── Database ─────────────────────────────────────────────────
const db = new Database(path.join(__dirname, 'papervault.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    fname       TEXT NOT NULL,
    lname       TEXT NOT NULL,
    email       TEXT UNIQUE NOT NULL,
    password    TEXT NOT NULL,
    dept        TEXT,
    role        TEXT NOT NULL DEFAULT 'student',
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS papers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    subject       TEXT NOT NULL,
    code          TEXT,
    dept          TEXT NOT NULL,
    semester      TEXT NOT NULL,
    year          TEXT NOT NULL,
    exam_type     TEXT DEFAULT 'End Semester',
    notes         TEXT,
    file_name     TEXT NOT NULL,
    file_path     TEXT NOT NULL,
    file_size     INTEGER,
    uploaded_by   INTEGER NOT NULL REFERENCES users(id),
    status        TEXT NOT NULL DEFAULT 'pending',
    reviewed_by   INTEGER REFERENCES users(id),
    reviewed_at   TEXT,
    created_at    TEXT DEFAULT (datetime('now'))
  );
`);

// Seed admin if not exists
const adminExists = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@college.edu');
if (!adminExists) {
  const hash = bcrypt.hashSync('Admin@123', 10);
  db.prepare(`INSERT INTO users (fname, lname, email, password, dept, role)
              VALUES (?, ?, ?, ?, ?, ?)`).run('Admin', 'User', 'admin@college.edu', hash, 'Administration', 'admin');
  console.log('✓ Seeded admin account: admin@college.edu / Admin@123');
}

// ── Middleware ───────────────────────────────────────────────
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, Postman)
    // and any origin in development or the configured frontend URL
    const allowed = process.env.FRONTEND_URL || '*';
    if (!origin || allowed === '*' || origin === allowed) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // handle preflight for all routes
app.use(express.json());
app.use('/uploads', express.static(UPLOAD_DIR));

// ── Multer (PDF only, 20 MB limit) ───────────────────────────
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
    cb(null, unique + path.extname(file.originalname));
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'));
  },
});

// ── Auth Helpers ─────────────────────────────────────────────
function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

// ═══════════════════════════════════════════════════════════════
//  AUTH ROUTES
// ═══════════════════════════════════════════════════════════════

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  const { fname, lname, email, password, dept } = req.body;
  if (!fname || !lname || !email || !password || !dept)
    return res.status(400).json({ error: 'All fields are required' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  const hash = await bcrypt.hash(password, 10);
  const result = db.prepare(
    'INSERT INTO users (fname, lname, email, password, dept, role) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(fname, lname, email.toLowerCase(), hash, dept, 'student');

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ token: signToken(user), user: sanitizeUser(user) });
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  res.json({ token: signToken(user), user: sanitizeUser(user) });
});

// GET /api/auth/me
app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(sanitizeUser(user));
});

function sanitizeUser(u) {
  const { password, ...safe } = u;
  return safe;
}

// ═══════════════════════════════════════════════════════════════
//  PAPERS — PUBLIC
// ═══════════════════════════════════════════════════════════════

// GET /api/papers  — approved papers, with optional filters
app.get('/api/papers', (req, res) => {
  const { dept, year, semester, q } = req.query;
  let sql = `SELECT p.*, u.fname || ' ' || u.lname AS uploader_name
             FROM papers p JOIN users u ON p.uploaded_by = u.id
             WHERE p.status = 'approved'`;
  const params = [];
  if (dept) { sql += ' AND p.dept = ?'; params.push(dept); }
  if (year) { sql += ' AND p.year = ?'; params.push(year); }
  if (semester) { sql += ' AND p.semester = ?'; params.push(semester); }
  if (q) {
    sql += ' AND (p.subject LIKE ? OR p.dept LIKE ? OR p.code LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY p.created_at DESC';
  res.json(db.prepare(sql).all(...params).map(p => addFileUrl(p, req)));
});

// GET /api/papers/filters  — distinct values for filter dropdowns
app.get('/api/papers/filters', (req, res) => {
  const depts = db.prepare("SELECT DISTINCT dept FROM papers WHERE status='approved' ORDER BY dept").all().map(r => r.dept);
  const years = db.prepare("SELECT DISTINCT year FROM papers WHERE status='approved' ORDER BY year DESC").all().map(r => r.year);
  const sems = db.prepare("SELECT DISTINCT semester FROM papers WHERE status='approved' ORDER BY semester").all().map(r => r.semester);
  res.json({ depts, years, sems });
});

// GET /api/papers/:id
app.get('/api/papers/:id', (req, res) => {
  const p = db.prepare(
    `SELECT p.*, u.fname || ' ' || u.lname AS uploader_name
     FROM papers p JOIN users u ON p.uploaded_by = u.id WHERE p.id = ?`
  ).get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Paper not found' });
  if (p.status !== 'approved') return res.status(403).json({ error: 'Paper not yet approved' });
  res.json(addFileUrl(p, req));
});

// ═══════════════════════════════════════════════════════════════
//  PAPERS — STUDENT UPLOAD
// ═══════════════════════════════════════════════════════════════

// POST /api/papers  — upload (authenticated students)
app.post('/api/papers', authMiddleware, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'PDF file is required' });
  const { subject, code, dept, semester, year, exam_type, notes } = req.body;
  if (!subject || !dept || !semester || !year)
    return res.status(400).json({ error: 'subject, dept, semester and year are required' });

  const result = db.prepare(`
    INSERT INTO papers (subject, code, dept, semester, year, exam_type, notes, file_name, file_path, file_size, uploaded_by, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(subject, code || null, dept, semester, year, exam_type || 'End Semester', notes || null,
    req.file.originalname, req.file.filename, req.file.size, req.user.id);

  const paper = db.prepare('SELECT * FROM papers WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(addFileUrl(paper, req));
});

// GET /api/papers/my  — current user's own submissions
app.get('/api/my/papers', authMiddleware, (req, res) => {
  const papers = db.prepare(
    'SELECT * FROM papers WHERE uploaded_by = ? ORDER BY created_at DESC'
  ).all(req.user.id);
  res.json(papers.map(p => addFileUrl(p, req)));
});

// ═══════════════════════════════════════════════════════════════
//  ADMIN ROUTES
// ═══════════════════════════════════════════════════════════════

// GET /api/admin/papers  — all papers with optional status filter
app.get('/api/admin/papers', authMiddleware, adminOnly, (req, res) => {
  const { status } = req.query;
  let sql = `SELECT p.*, u.fname || ' ' || u.lname AS uploader_name
             FROM papers p JOIN users u ON p.uploaded_by = u.id`;
  const params = [];
  if (status) { sql += ' WHERE p.status = ?'; params.push(status); }
  sql += ' ORDER BY p.created_at DESC';
  res.json(db.prepare(sql).all(...params).map(p => addFileUrl(p, req)));
});

// PATCH /api/admin/papers/:id/status  — approve or reject
app.patch('/api/admin/papers/:id/status', authMiddleware, adminOnly, (req, res) => {
  const { status } = req.body;
  if (!['approved', 'rejected'].includes(status))
    return res.status(400).json({ error: 'status must be approved or rejected' });

  const paper = db.prepare('SELECT id FROM papers WHERE id = ?').get(req.params.id);
  if (!paper) return res.status(404).json({ error: 'Paper not found' });

  db.prepare(
    "UPDATE papers SET status = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?"
  ).run(status, req.user.id, req.params.id);

  res.json({ success: true, status });
});

// DELETE /api/admin/papers/:id
app.delete('/api/admin/papers/:id', authMiddleware, adminOnly, (req, res) => {
  const paper = db.prepare('SELECT file_path FROM papers WHERE id = ?').get(req.params.id);
  if (!paper) return res.status(404).json({ error: 'Paper not found' });

  // Delete physical file
  const filePath = path.join(UPLOAD_DIR, paper.file_path);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  db.prepare('DELETE FROM papers WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// GET /api/admin/users
app.get('/api/admin/users', authMiddleware, adminOnly, (req, res) => {
  const users = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
  const papers = db.prepare('SELECT uploaded_by, COUNT(*) as count FROM papers GROUP BY uploaded_by').all();
  const countMap = Object.fromEntries(papers.map(p => [p.uploaded_by, p.count]));
  res.json(users.map(u => ({ ...sanitizeUser(u), upload_count: countMap[u.id] || 0 })));
});

// PATCH /api/admin/users/:id/role
app.patch('/api/admin/users/:id/role', authMiddleware, adminOnly, (req, res) => {
  const { role } = req.body;
  if (!['student', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  res.json({ success: true });
});

// DELETE /api/admin/users/:id  — delete user + their uploaded files & papers
app.delete('/api/admin/users/:id', authMiddleware, adminOnly, (req, res) => {
  const targetId = parseInt(req.params.id);

  if (targetId === req.user.id)
    return res.status(400).json({ error: 'You cannot delete your own account' });

  const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(targetId);
  if (!target) return res.status(404).json({ error: 'User not found' });

  if (target.role === 'admin')
    return res.status(403).json({ error: 'Admin accounts cannot be deleted' });

  // Delete all their PDF files from disk
  const papers = db.prepare('SELECT file_path FROM papers WHERE uploaded_by = ?').all(targetId);
  papers.forEach(p => {
    const filePath = path.join(UPLOAD_DIR, p.file_path);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });

  // Delete their papers from DB, then the user
  db.prepare('DELETE FROM papers WHERE uploaded_by = ?').run(targetId);
  db.prepare('DELETE FROM users WHERE id = ?').run(targetId);

  res.json({ success: true });
});

// GET /api/admin/stats
app.get('/api/admin/stats', authMiddleware, adminOnly, (req, res) => {
  const total = db.prepare("SELECT COUNT(*) as n FROM papers").get().n;
  const pending = db.prepare("SELECT COUNT(*) as n FROM papers WHERE status='pending'").get().n;
  const approved = db.prepare("SELECT COUNT(*) as n FROM papers WHERE status='approved'").get().n;
  const users = db.prepare("SELECT COUNT(*) as n FROM users").get().n;
  res.json({ total, pending, approved, users });
});

// ── Helper ───────────────────────────────────────────────────
function addFileUrl(p, req) {
  return {
    ...p,
    file_url: `${req.protocol}://${req.get('host')}/uploads/${p.file_path}`,
  };
}

// ── Error Handler ────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large (max 20 MB)' });
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ── Start ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀  PaperVault API running at http://localhost:${PORT}`);
  console.log(`📂  Uploads folder: ${UPLOAD_DIR}`);
  console.log(`🔑  Admin login: admin@college.edu / Admin@123\n`);
});