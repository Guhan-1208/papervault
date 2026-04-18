// ─────────────────────────────────────────────────────────────
//  PaperVault — Backend Server
//  Stack: Express · JWT · bcrypt · Multer (memory) · Supabase
// ─────────────────────────────────────────────────────────────

const express  = require('express');
const cors     = require('cors');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const multer   = require('multer');
const { createClient } = require('@supabase/supabase-js');

const app  = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'changeme_in_production';

// ── Supabase client ───────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const BUCKET = 'papers';

// ── Multer — memory storage ───────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'));
  },
});

// ── CORS ──────────────────────────────────────────────────────
const corsOptions = {
  origin: (origin, cb) => {
    const allowed = process.env.FRONTEND_URL || '*';
    if (!origin || allowed === '*' || origin === allowed) cb(null, true);
    else cb(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());

// ── Auth helpers ──────────────────────────────────────────────
function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
}
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try { req.user = jwt.verify(header.slice(7), JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid or expired token' }); }
}
function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}
function sanitizeUser(u) { const { password, ...safe } = u; return safe; }
function getFileUrl(filePath) {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(filePath);
  return data.publicUrl;
}

// ── Seed admin ────────────────────────────────────────────────
async function ensureAdmin() {
  const EMAIL = process.env.ADMIN_EMAIL || 'admin@college.edu';
  const PASS  = process.env.ADMIN_PASS  || 'Admin@123';
  const { data } = await supabase.from('users').select('id').eq('email', EMAIL).single();
  if (!data) {
    const hash = await bcrypt.hash(PASS, 10);
    await supabase.from('users').insert({ fname:'Admin', lname:'User', email: EMAIL, password: hash, dept:'Administration', role:'admin' });
    console.log(`✓ Admin seeded: ${EMAIL}`);
  }
}

// ═══════════════════════════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════════════════════════
app.post('/api/auth/register', async (req, res) => {
  try {
    const { fname, lname, email, password, dept } = req.body;
    if (!fname||!lname||!email||!password||!dept) return res.status(400).json({ error: 'All fields are required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const { data: ex } = await supabase.from('users').select('id').eq('email', email.toLowerCase()).single();
    if (ex) return res.status(409).json({ error: 'Email already registered' });
    const hash = await bcrypt.hash(password, 10);
    const { data: user, error } = await supabase.from('users').insert({ fname, lname, email: email.toLowerCase(), password: hash, dept, role: 'student' }).select().single();
    if (error) throw error;
    res.status(201).json({ token: signToken(user), user: sanitizeUser(user) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email||!password) return res.status(400).json({ error: 'Email and password required' });
    const { data: user } = await supabase.from('users').select('*').eq('email', email.toLowerCase()).single();
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    res.json({ token: signToken(user), user: sanitizeUser(user) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const { data: user } = await supabase.from('users').select('*').eq('id', req.user.id).single();
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(sanitizeUser(user));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════
//  PAPERS — PUBLIC
// ═══════════════════════════════════════════════════════════════
app.get('/api/papers', async (req, res) => {
  try {
    const { dept, year, semester, q } = req.query;
    let query = supabase.from('papers').select('*, uploaded_by_user:users!uploaded_by(fname, lname)').eq('status', 'approved').order('created_at', { ascending: false });
    if (dept)     query = query.eq('dept', dept);
    if (year)     query = query.eq('year', year);
    if (semester) query = query.eq('semester', semester);
    if (q)        query = query.or(`subject.ilike.%${q}%,dept.ilike.%${q}%,code.ilike.%${q}%`);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data.map(p => ({ ...p, uploader_name: p.uploaded_by_user ? `${p.uploaded_by_user.fname} ${p.uploaded_by_user.lname}` : 'Unknown', file_url: getFileUrl(p.file_path) })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/papers/filters', async (req, res) => {
  try {
    const { data } = await supabase.from('papers').select('dept, year, semester').eq('status', 'approved');
    res.json({
      depts: [...new Set(data.map(p => p.dept))].sort(),
      years: [...new Set(data.map(p => p.year))].sort((a,b) => b-a),
      sems:  [...new Set(data.map(p => p.semester))].sort(),
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/papers/:id', async (req, res) => {
  try {
    const { data: p, error } = await supabase.from('papers').select('*, uploaded_by_user:users!uploaded_by(fname, lname)').eq('id', req.params.id).single();
    if (error||!p) return res.status(404).json({ error: 'Paper not found' });
    if (p.status !== 'approved') return res.status(403).json({ error: 'Paper not yet approved' });
    res.json({ ...p, uploader_name: p.uploaded_by_user ? `${p.uploaded_by_user.fname} ${p.uploaded_by_user.lname}` : 'Unknown', file_url: getFileUrl(p.file_path) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════
//  PAPERS — STUDENT UPLOAD
// ═══════════════════════════════════════════════════════════════
app.post('/api/papers', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'PDF file is required' });
    const { subject, code, dept, semester, year, exam_type, notes } = req.body;
    if (!subject||!dept||!semester||!year) return res.status(400).json({ error: 'subject, dept, semester and year are required' });

    const filePath = `papers/${Date.now()}-${Math.round(Math.random()*1e6)}.pdf`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(filePath, req.file.buffer, { contentType: 'application/pdf' });
    if (upErr) throw upErr;

    const { data: paper, error } = await supabase.from('papers').insert({
      subject, code: code||null, dept, semester, year, exam_type: exam_type||'End Semester',
      notes: notes||null, file_name: req.file.originalname, file_path: filePath,
      file_size: req.file.size, uploaded_by: req.user.id, status: 'pending',
    }).select().single();
    if (error) throw error;
    res.status(201).json({ ...paper, file_url: getFileUrl(paper.file_path) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/my/papers', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase.from('papers').select('*').eq('uploaded_by', req.user.id).order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data.map(p => ({ ...p, file_url: getFileUrl(p.file_path) })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════
//  ADMIN
// ═══════════════════════════════════════════════════════════════
app.get('/api/admin/papers', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { status } = req.query;
    let query = supabase.from('papers').select('*, uploaded_by_user:users!uploaded_by(fname, lname)').order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data.map(p => ({ ...p, uploader_name: p.uploaded_by_user ? `${p.uploaded_by_user.fname} ${p.uploaded_by_user.lname}` : 'Unknown', file_url: getFileUrl(p.file_path) })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/admin/papers/:id/status', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['approved','rejected'].includes(status)) return res.status(400).json({ error: 'status must be approved or rejected' });
    const { error } = await supabase.from('papers').update({ status, reviewed_by: req.user.id, reviewed_at: new Date().toISOString() }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true, status });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/papers/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { data: paper } = await supabase.from('papers').select('file_path').eq('id', req.params.id).single();
    if (!paper) return res.status(404).json({ error: 'Paper not found' });
    await supabase.storage.from(BUCKET).remove([paper.file_path]);
    const { error } = await supabase.from('papers').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/users', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { data: users, error } = await supabase.from('users').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    const { data: counts } = await supabase.from('papers').select('uploaded_by');
    const countMap = {};
    counts?.forEach(p => { countMap[p.uploaded_by] = (countMap[p.uploaded_by]||0)+1; });
    res.json(users.map(u => ({ ...sanitizeUser(u), upload_count: countMap[u.id]||0 })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/admin/users/:id/role', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { role } = req.body;
    if (!['student','admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    const { error } = await supabase.from('users').update({ role }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/users/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const targetId = req.params.id;
    if (targetId === String(req.user.id)) return res.status(400).json({ error: 'You cannot delete your own account' });
    const { data: target } = await supabase.from('users').select('id, role').eq('id', targetId).single();
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.role === 'admin') return res.status(403).json({ error: 'Admin accounts cannot be deleted' });
    const { data: papers } = await supabase.from('papers').select('file_path').eq('uploaded_by', targetId);
    if (papers?.length) await supabase.storage.from(BUCKET).remove(papers.map(p => p.file_path));
    await supabase.from('papers').delete().eq('uploaded_by', targetId);
    const { error } = await supabase.from('users').delete().eq('id', targetId);
    if (error) throw error;
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/stats', authMiddleware, adminOnly, async (req, res) => {
  try {
    const [t, p, a, u] = await Promise.all([
      supabase.from('papers').select('*', { count:'exact', head:true }),
      supabase.from('papers').select('*', { count:'exact', head:true }).eq('status','pending'),
      supabase.from('papers').select('*', { count:'exact', head:true }).eq('status','approved'),
      supabase.from('users').select('*',  { count:'exact', head:true }),
    ]);
    res.json({ total: t.count, pending: p.count, approved: a.count, users: u.count });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Error handler ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large (max 20 MB)' });
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`\n🚀  PaperVault API → http://localhost:${PORT}`);
  await ensureAdmin();
});