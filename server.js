const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : ROOT;
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'academy.db');
const UPLOADS = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });

app.disable('x-powered-by');
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true, limit: '8mb' }));
app.use(express.static(PUBLIC));

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','teacher','student','parent')),
  phone TEXT DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_no INTEGER UNIQUE NOT NULL CHECK(class_no BETWEEN 1 AND 12),
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(class_id,name),
  FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS teachers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER UNIQUE NOT NULL,
  subject TEXT DEFAULT '',
  designation TEXT DEFAULT '',
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS parents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER UNIQUE NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER UNIQUE NOT NULL,
  class_id INTEGER,
  section_id INTEGER,
  roll TEXT DEFAULT '',
  student_id TEXT UNIQUE,
  guardian_phone TEXT DEFAULT '',
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE SET NULL,
  FOREIGN KEY(section_id) REFERENCES sections(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS parent_students (
  parent_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  PRIMARY KEY(parent_id,student_id),
  FOREIGN KEY(parent_id) REFERENCES parents(id) ON DELETE CASCADE,
  FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  exam_date TEXT DEFAULT '',
  class_id INTEGER,
  published INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  exam_id INTEGER NOT NULL,
  subject_id INTEGER NOT NULL,
  marks REAL NOT NULL DEFAULT 0,
  max_marks REAL NOT NULL DEFAULT 100,
  grade TEXT DEFAULT '',
  gpa REAL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 0,
  card_blob BLOB,
  card_mime TEXT DEFAULT '',
  card_name TEXT DEFAULT '',
  UNIQUE(student_id,exam_id,subject_id),
  FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY(exam_id) REFERENCES exams(id) ON DELETE CASCADE,
  FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  present INTEGER NOT NULL,
  UNIQUE(student_id,date),
  FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS fees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER UNIQUE NOT NULL,
  total_fee REAL NOT NULL DEFAULT 0,
  additional_charge REAL NOT NULL DEFAULT 0,
  due REAL NOT NULL DEFAULT 0,
  adjustment REAL NOT NULL DEFAULT 0,
  adjustment_reason TEXT DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  method TEXT NOT NULL CHECK(method IN ('bKash','Nagad')),
  transaction_id TEXT NOT NULL,
  amount REAL NOT NULL CHECK(amount > 0),
  payer_phone TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED')),
  reject_reason TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_at TEXT,
  receipt_no TEXT UNIQUE,
  FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
  UNIQUE(method,transaction_id)
);
CREATE TABLE IF NOT EXISTS routines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('CLASS','EXAM')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  class_id INTEGER,
  section_id INTEGER,
  published INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE SET NULL,
  FOREIGN KEY(section_id) REFERENCES sections(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT DEFAULT 'General',
  publish_date TEXT DEFAULT '',
  expiry_date TEXT DEFAULT '',
  target_type TEXT NOT NULL DEFAULT 'ALL' CHECK(target_type IN ('ALL','CLASS','SECTION','STUDENT','PARENT','TEACHER')),
  target_value TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PUBLISHED','UNPUBLISHED','EXPIRED')),
  author_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(author_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  kind TEXT DEFAULT 'notice',
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  url TEXT NOT NULL,
  class_id INTEGER,
  section_id INTEGER,
  published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE SET NULL,
  FOREIGN KEY(section_id) REFERENCES sections(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  due_date TEXT DEFAULT '',
  class_id INTEGER,
  section_id INTEGER,
  published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE SET NULL,
  FOREIGN KEY(section_id) REFERENCES sections(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  details TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
);
`);

try {
  db.exec("ALTER TABLE users ADD COLUMN is_main_admin INTEGER NOT NULL DEFAULT 0");
} catch (e) {}

if (!db.prepare("SELECT 1 FROM users WHERE role='admin' AND is_main_admin=1 LIMIT 1").get()) {
  const firstAdmin = db.prepare("SELECT id FROM users WHERE role='admin' ORDER BY id ASC LIMIT 1").get();
  if (firstAdmin) db.prepare("UPDATE users SET is_main_admin=1 WHERE id=?").run(firstAdmin.id);
}

for (let i = 1; i <= 12; i++) {
  db.prepare('INSERT OR IGNORE INTO classes(class_no,name) VALUES(?,?)').run(i, `Class ${i}`);
}

const now = () => new Date().toISOString();
const clean = v => (v == null ? '' : String(v).trim());

// MIGRATION_MOVED_AFTER_CLEAN
try {
  db.exec("ALTER TABLE users ADD COLUMN username TEXT");
} catch (e) {}

try {
  db.exec("ALTER TABLE fees ADD COLUMN monthly_fee REAL NOT NULL DEFAULT 0");
} catch (e) {}

try {
  db.exec("ALTER TABLE payments ADD COLUMN fee_month TEXT DEFAULT ''");
} catch (e) {}

db.exec(`
CREATE TABLE IF NOT EXISTS fee_cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  month_key TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  paid_amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'UPCOMING'
    CHECK(status IN ('UPCOMING','DUE','PAID')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(student_id,month_key),
  FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE
);
`);

const existingUsers = db.prepare(`
  SELECT
    u.id,
    u.email,
    u.role,
    COALESCE(u.username,'') username,
    (SELECT student_id FROM students WHERE user_id=u.id LIMIT 1) student_id
  FROM users u
  ORDER BY u.id
`).all();

const usedUsernames = new Set(
  existingUsers.map(x => clean(x.username).toLowerCase()).filter(Boolean)
);

for (const u of existingUsers) {
  if (clean(u.username)) continue;

  let base = clean(u.student_id) ||
             clean(u.email).split('@')[0] ||
             (u.role + u.id);

  base = base.toLowerCase()
    .replace(/[^a-z0-9._-]+/g,'')
    .slice(0,24) || (u.role + u.id);

  let candidate = base;
  let n = 1;

  while (usedUsernames.has(candidate.toLowerCase())) {
    candidate = (base + n++).slice(0,30);
  }

  usedUsernames.add(candidate.toLowerCase());

  db.prepare(
    'UPDATE users SET username=? WHERE id=?'
  ).run(candidate,u.id);
}

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username
  ON users(username)
  WHERE username IS NOT NULL AND username<>'';
`);

const legacyFees = db.prepare(
  'SELECT student_id,total_fee,additional_charge,due,adjustment FROM fees'
).all();

for (const f of legacyFees) {
  const amount = Math.max(
    0,
    Number(f.total_fee || 0) +
    Number(f.additional_charge || 0) +
    Number(f.adjustment || 0)
  );

  const due = Math.max(0, Number(f.due || 0));

  if (amount > 0 || due > 0) {
    const paid = Math.min(amount, Math.max(0, amount - due));
    const status = due <= 0 ? 'PAID' : 'DUE';

    db.prepare(`
      INSERT OR IGNORE INTO fee_cycles
      (student_id,month_key,amount,paid_amount,status)
      VALUES(?,?,?,?,?)
    `).run(
      f.student_id,
      new Date().toISOString().slice(0,7),
      amount,
      paid,
      status
    );
  }
}
const bool = v => !!(v === true || v === 1 || v === '1' || v === 'true');
const audit = (userId, action, details='') => db.prepare('INSERT INTO audit_logs(user_id,action,details) VALUES(?,?,?)').run(userId || null, action, details);
const userView = u => u ? ({ id:u.id, name:u.name, username:u.username || '', email:u.email, phone:u.phone || '', role:u.role, active:!!u.active, is_main_admin:!!u.is_main_admin }) : null;

function hashPassword(password) {
  return bcrypt.hashSync(password, 12);
}
function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)').run(token,userId,Date.now()+7*24*60*60*1000);
  return token;
}
function sessionUser(req) {
  const token = req.headers.cookie?.match(/(?:^|;\s*)sca_session=([^;]+)/)?.[1];
  if (!token) return null;
  const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>?`).get(token,Date.now());
  if (!row || !row.active) return null;
  return row;
}
function requireAuth(req,res,next) {
  const u = sessionUser(req);
  if (!u) return res.status(401).json({error:'Authentication required'});
  req.user = u; next();
}
function requireRole(...roles) {
  return (req,res,next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({error:'Permission denied'});
    next();
  };
}
function studentsForUser(u) {
  if (u.role === 'student') return db.prepare('SELECT * FROM students WHERE user_id=?').all(u.id);
  if (u.role === 'parent') return db.prepare(`SELECT s.* FROM students s JOIN parent_students ps ON ps.student_id=s.id JOIN parents p ON p.id=ps.parent_id WHERE p.user_id=?`).all(u.id);
  return [];
}
function recipientIds(targetType,targetValue) {
  targetType = targetType || 'ALL'; targetValue = clean(targetValue);
  if (targetType === 'ALL') return db.prepare("SELECT id FROM users WHERE active=1 AND role!='admin'").all().map(r=>r.id);
  if (targetType === 'PARENT') return db.prepare("SELECT id FROM users WHERE active=1 AND role='parent'").all().map(r=>r.id);
  if (targetType === 'TEACHER') return db.prepare("SELECT id FROM users WHERE active=1 AND role='teacher'").all().map(r=>r.id);
  let students = [];
  if (targetType === 'STUDENT') students = db.prepare('SELECT * FROM students WHERE id=?').all(Number(targetValue));
  if (targetType === 'CLASS') students = db.prepare('SELECT * FROM students WHERE class_id=?').all(Number(targetValue));
  if (targetType === 'SECTION') students = db.prepare('SELECT * FROM students WHERE section_id=?').all(Number(targetValue));
  const ids = new Set();
  const addParents = db.prepare('SELECT p.user_id FROM parent_students ps JOIN parents p ON p.id=ps.parent_id WHERE ps.student_id=?');
  for (const s of students) {
    if (s.user_id) ids.add(s.user_id);
    for (const p of addParents.all(s.id)) ids.add(p.user_id);
  }
  return [...ids].filter(Boolean);
}
function notifyUser(userId,title,message,kind='notice') { db.prepare('INSERT INTO notifications(user_id,title,message,kind) VALUES(?,?,?,?)').run(userId,title,message,kind); }
function publishNotice(n) {
  for (const id of recipientIds(n.target_type,n.target_value)) notifyUser(id,n.title,n.content,'notice');
}
function currentMonthKey(){
  return new Date().toISOString().slice(0,7);
}

function shiftMonth(key,delta){
  const [y,m]=String(key).split('-').map(Number);
  const d=new Date(Date.UTC(y,m-1+delta,1));
  return d.toISOString().slice(0,7);
}

function advanceFeeStatuses(){
  const current=currentMonthKey();

  db.prepare(
    "UPDATE fee_cycles SET status='DUE',updated_at=? WHERE status='UPCOMING' AND month_key<=?"
  ).run(now(),current);

  db.prepare(
    "UPDATE fee_cycles SET status='PAID',updated_at=? WHERE status='DUE' AND paid_amount>=amount"
  ).run(now());
}

function ensureUpcomingCycle(studentId){
  const fee=db.prepare(
    'SELECT monthly_fee FROM fees WHERE student_id=?'
  ).get(studentId);

  const monthly=Math.max(0,Number(fee?.monthly_fee||0));
  if(!monthly)return;

  const next=shiftMonth(currentMonthKey(),1);

  db.prepare(`
    INSERT OR IGNORE INTO fee_cycles
    (student_id,month_key,amount,paid_amount,status)
    VALUES(?,?,?,0,'UPCOMING')
  `).run(studentId,next,monthly);
}

function syncLegacyDue(studentId){
  advanceFeeStatuses();

  const due=db.prepare(`
    SELECT COALESCE(
      SUM(
        CASE
          WHEN status='DUE' AND amount>paid_amount
          THEN amount-paid_amount
          ELSE 0
        END
      ),0
    ) due
    FROM fee_cycles
    WHERE student_id=?
  `).get(studentId).due;

  const fee=db.prepare(
    'SELECT id FROM fees WHERE student_id=?'
  ).get(studentId);

  if(fee){
    db.prepare(
      'UPDATE fees SET due=?,updated_at=? WHERE student_id=?'
    ).run(due,now(),studentId);
  }else{
    db.prepare(
      'INSERT INTO fees(student_id,due) VALUES(?,?)'
    ).run(studentId,due);
  }

  return due;
}

advanceFeeStatuses();

for (const st of db.prepare(
  'SELECT student_id FROM fees'
).all()) {
  ensureUpcomingCycle(st.student_id);
  syncLegacyDue(st.student_id);
}
function gradeFromPercent(p) {
  if (p >= 80) return {grade:'A+',gpa:5}; if (p >=70) return {grade:'A',gpa:4}; if (p>=60) return {grade:'A-',gpa:3.5};
  if (p>=50) return {grade:'B',gpa:3}; if (p>=40) return {grade:'C',gpa:2}; if (p>=33) return {grade:'D',gpa:1}; return {grade:'F',gpa:0};
}

app.get('/api/setup/status',(req,res)=>res.json({needsAdmin:!db.prepare("SELECT 1 FROM users WHERE role='admin' LIMIT 1").get()}));
app.post('/api/setup/admin',(req,res)=>{
  if (db.prepare("SELECT 1 FROM users WHERE role='admin' LIMIT 1").get()) return res.status(400).json({error:'Admin setup is already completed'});
  const name=clean(req.body.name), email=clean(req.body.email).toLowerCase(), password=String(req.body.password||''), confirm=String(req.body.confirm||'');
  if (!name || !validEmail(email) || password.length<8 || password!==confirm) return res.status(400).json({error:'Enter a valid name, email and matching password (minimum 8 characters).'});
  const info=db.prepare("INSERT INTO users(name,email,password_hash,role,is_main_admin) VALUES(?,?,?,'admin',1)").run(name,email,hashPassword(password));
  audit(info.lastInsertRowid,'INITIAL_ADMIN_SETUP',email); res.json({ok:true});
});

app.post('/api/login',(req,res)=>{
  const identifier=clean(req.body.identifier||req.body.email).toLowerCase();
  const password=String(req.body.password||'');
  const role=clean(req.body.role).toLowerCase();

  const u=db.prepare(`
    SELECT * FROM users
    WHERE lower(email)=? OR lower(username)=?
  `).get(identifier,identifier);

  if(
    !u ||
    !u.active ||
    (role && u.role!==role) ||
    !bcrypt.compareSync(password,u.password_hash)
  ){
    return res.status(401).json({
      error:'Invalid username/email or password'
    });
  }

  const token=createSession(u.id);

  res.setHeader(
    'Set-Cookie',
    `sca_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`
  );

  res.json({user:userView(u)});
});
app.post('/api/logout',requireAuth,(req,res)=>{const token=req.headers.cookie?.match(/(?:^|;\s*)sca_session=([^;]+)/)?.[1]; if(token) db.prepare('DELETE FROM sessions WHERE token=?').run(token); res.setHeader('Set-Cookie','sca_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'); res.json({ok:true});});
app.get('/api/me',requireAuth,(req,res)=>res.json({user:userView(req.user)}));
app.post('/api/me/password',requireAuth,(req,res)=>{const old=String(req.body.oldPassword||''), next=String(req.body.newPassword||''); if(!bcrypt.compareSync(old,req.user.password_hash)||next.length<8)return res.status(400).json({error:'Current password is wrong or new password is too short'}); db.prepare('UPDATE users SET password_hash=?,updated_at=? WHERE id=?').run(hashPassword(next),now(),req.user.id); audit(req.user.id,'CHANGE_PASSWORD'); res.json({ok:true});});

app.get('/api/dashboard',requireAuth,(req,res)=>{
  if(req.user.role==='student'||req.user.role==='parent'){
    const ss=studentsForUser(req.user), ids=ss.map(s=>s.id); const due=ids.length?db.prepare(`SELECT COALESCE(SUM(due),0) due FROM fees WHERE student_id IN (${ids.map(()=>'?').join(',')})`).get(...ids).due:0;
    const payments=ids.length?db.prepare(`SELECT COUNT(*) c FROM payments WHERE student_id IN (${ids.map(()=>'?').join(',')})`).get(...ids).c:0;
    res.json({role:req.user.role,students:ss.length,due,payments,unread:db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND read=0').get(req.user.id).c}); return;
  }
  const get=c=>db.prepare(c).get().c;
  res.json({role:req.user.role,students:get('SELECT COUNT(*) c FROM students'),teachers:get('SELECT COUNT(*) c FROM teachers'),parents:get('SELECT COUNT(*) c FROM parents'),pendingPayments:get("SELECT COUNT(*) c FROM payments WHERE status='PENDING'"),due:db.prepare('SELECT COALESCE(SUM(due),0) due FROM fees').get().due,unread:db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND read=0').get(req.user.id).c});
});

app.get('/api/users',requireAuth,requireRole('admin'),
(req,res)=>res.json(
  db.prepare(`
    SELECT id,name,username,email,phone,role,active,is_main_admin,created_at
    FROM users
    ORDER BY id DESC
  `).all()
));

app.post('/api/users',requireAuth,requireRole('admin'),(req,res)=>{
  const r=req.body;
  const name=clean(r.name);
  const username=clean(r.username).toLowerCase();
  const email=clean(r.email).toLowerCase();
  const password=String(r.password||'');

  if(
    !name ||
    !username ||
    !/^[a-z0-9._-]{3,30}$/.test(username) ||
    !validEmail(email) ||
    password.length<8 ||
    !['admin','teacher','student','parent'].includes(r.role)
  ){
    return res.status(400).json({
      error:'Valid username, name, email, role and 8+ character password are required'
    });
  }

  try{
    const tx=db.transaction(()=>{
      const u=db.prepare(`
        INSERT INTO users
        (name,username,email,password_hash,role,phone)
        VALUES(?,?,?,?,?,?)
      `).run(
        name,
        username,
        email,
        hashPassword(password),
        r.role,
        clean(r.phone)
      );

      if(r.role==='teacher'){
        db.prepare(`
          INSERT INTO teachers(user_id,subject,designation)
          VALUES(?,?,?)
        `).run(
          u.lastInsertRowid,
          clean(r.subject),
          clean(r.designation)
        );
      }

      if(r.role==='parent'){
        db.prepare(
          'INSERT INTO parents(user_id) VALUES(?)'
        ).run(u.lastInsertRowid);
      }

      return u.lastInsertRowid;
    });

    const id=tx();

    audit(
      req.user.id,
      'CREATE_USER',
      `${r.role}:${username}`
    );

    res.json({id});
  }catch(e){
    res.status(400).json({error:e.message});
  }
});

app.patch('/api/users/:id/status',requireAuth,requireRole('admin'),(req,res)=>{const active=bool(req.body.active)?1:0; const targetId=Number(req.params.id); const target=db.prepare('SELECT id,is_main_admin FROM users WHERE id=?').get(targetId); if(!target)return res.status(404).json({error:'User not found'}); if(target.is_main_admin && targetId!==req.user.id)return res.status(403).json({error:'Main Admin is protected'}); if(Number(req.params.id)===req.user.id && !active)return res.status(400).json({error:'You cannot deactivate yourself'}); db.prepare('UPDATE users SET active=?,updated_at=? WHERE id=?').run(active,now(),req.params.id); audit(req.user.id,'UPDATE_USER_STATUS',`${req.params.id}:${active}`); res.json({ok:true});});
app.patch('/api/users/:id/password',requireAuth,requireRole('admin'),(req,res)=>{
const p=String(req.body.password||'');
const targetId=Number(req.params.id);
const target=db.prepare('SELECT id,is_main_admin FROM users WHERE id=?').get(targetId);
if(!target)return res.status(404).json({error:'User not found'});
if(target.is_main_admin && targetId!==req.user.id)return res.status(403).json({error:'Main Admin is protected'});
if(p.length<8)return res.status(400).json({error:'Password must be at least 8 characters'});
db.prepare('UPDATE users SET password_hash=?,updated_at=? WHERE id=?').run(hashPassword(p),now(),targetId);
audit(req.user.id,'RESET_USER_PASSWORD',String(targetId));
res.json({ok:true});
});

app.get('/api/classes',requireAuth,(req,res)=>res.json(db.prepare(`SELECT c.*, COALESCE((SELECT json_group_array(json_object('id',s.id,'name',s.name,'active',s.active)) FROM sections s WHERE s.class_id=c.id),'[]') sections_json FROM classes c ORDER BY c.class_no`).all().map(c=>({...c,sections:JSON.parse(c.sections_json)}))));
app.patch('/api/classes/:id',requireAuth,requireRole('admin'),(req,res)=>{db.prepare('UPDATE classes SET name=?,active=? WHERE id=?').run(clean(req.body.name)||`Class ${req.body.class_no}`,bool(req.body.active)?1:0,req.params.id);audit(req.user.id,'UPDATE_CLASS',String(req.params.id));res.json({ok:true});});
app.post('/api/sections',requireAuth,requireRole('admin'),(req,res)=>{try{const x=db.prepare('INSERT INTO sections(class_id,name) VALUES(?,?)').run(req.body.class_id,clean(req.body.name));audit(req.user.id,'CREATE_SECTION',clean(req.body.name));res.json({id:x.lastInsertRowid});}catch(e){res.status(400).json({error:e.message});}});
app.patch('/api/sections/:id',requireAuth,requireRole('admin'),(req,res)=>{db.prepare('UPDATE sections SET name=?,active=? WHERE id=?').run(clean(req.body.name),bool(req.body.active)?1:0,req.params.id);audit(req.user.id,'UPDATE_SECTION',String(req.params.id));res.json({ok:true});});

app.get('/api/subjects',requireAuth,(req,res)=>res.json(db.prepare('SELECT * FROM subjects ORDER BY name').all()));
app.post('/api/subjects',requireAuth,requireRole('admin'),(req,res)=>{try{const x=db.prepare('INSERT INTO subjects(name) VALUES(?)').run(clean(req.body.name));audit(req.user.id,'CREATE_SUBJECT',clean(req.body.name));res.json({id:x.lastInsertRowid});}catch(e){res.status(400).json({error:e.message});}});
app.patch('/api/subjects/:id',requireAuth,requireRole('admin'),(req,res)=>{db.prepare('UPDATE subjects SET name=?,active=? WHERE id=?').run(clean(req.body.name),bool(req.body.active)?1:0,req.params.id);res.json({ok:true});});

app.get('/api/students',requireAuth,(req,res)=>{
  let rows=db.prepare(`SELECT s.id,s.user_id,s.class_id,s.section_id,s.roll,s.student_id,s.guardian_phone,u.name,u.email,u.phone,u.active,c.class_no, c.name class_name, sec.name section_name FROM students s JOIN users u ON u.id=s.user_id LEFT JOIN classes c ON c.id=s.class_id LEFT JOIN sections sec ON sec.id=s.section_id ORDER BY c.class_no,sec.name,s.roll`).all();
  if(req.user.role==='student')rows=rows.filter(x=>x.user_id===req.user.id);
  if(req.user.role==='parent'){const ids=new Set(studentsForUser(req.user).map(s=>s.id));rows=rows.filter(x=>ids.has(x.id));}
  res.json(rows);
});
app.post('/api/students',requireAuth,requireRole('admin'),(req,res)=>{
  const r=req.body;

  const name=clean(r.name);
  const email=clean(r.email).toLowerCase();
  const username=clean(r.username||r.student_id).toLowerCase();
  const password=String(r.password||'');

  if(
    !name ||
    !validEmail(email) ||
    !username ||
    !/^[a-z0-9._-]{3,30}$/.test(username) ||
    password.length<8 ||
    !r.student_id ||
    !r.class_id
  ){
    return res.status(400).json({
      error:'Name, username, email, 8+ character password, Student ID and Class are required'
    });
  }

  try{
    const tx=db.transaction(()=>{
      const u=db.prepare(`
        INSERT INTO users
        (name,username,email,password_hash,role,phone)
        VALUES(?,?,?,?,?,?)
      `).run(
        name,
        username,
        email,
        hashPassword(password),
        'student',
        clean(r.phone)
      );

      const st=db.prepare(`
        INSERT INTO students
        (user_id,class_id,section_id,roll,student_id,guardian_phone)
        VALUES(?,?,?,?,?,?)
      `).run(
        u.lastInsertRowid,
        Number(r.class_id),
        r.section_id?Number(r.section_id):null,
        clean(r.roll),
        clean(r.student_id),
        clean(r.guardian_phone)
      );

      const total=Math.max(
        0,
        Number(r.total_fee)||0
      );

      db.prepare(`
        INSERT INTO fees
        (student_id,total_fee,due,monthly_fee)
        VALUES(?,?,?,?)
      `).run(
        st.lastInsertRowid,
        total,
        total,
        total
      );

      if(total>0){
        db.prepare(`
          INSERT OR REPLACE INTO fee_cycles
          (student_id,month_key,amount,paid_amount,status)
          VALUES(?,?,?,?, 'DUE')
        `).run(
          st.lastInsertRowid,
          currentMonthKey(),
          total,
          0
        );
      }

      return st.lastInsertRowid;
    });

    const id=tx();

    syncLegacyDue(id);
    ensureUpcomingCycle(id);

    audit(
      req.user.id,
      'CREATE_STUDENT',
      clean(r.student_id)
    );

    res.json({id});
  }catch(e){
    res.status(400).json({error:e.message});
  }
});
app.patch('/api/students/:id',requireAuth,requireRole('admin'),(req,res)=>{db.prepare(`UPDATE students SET class_id=?,section_id=?,roll=?,guardian_phone=? WHERE id=?`).run(req.body.class_id?Number(req.body.class_id):null,req.body.section_id?Number(req.body.section_id):null,clean(req.body.roll),clean(req.body.guardian_phone),req.params.id);res.json({ok:true});});
app.post('/api/parent-links',requireAuth,requireRole('admin'),(req,res)=>{try{const parent=db.prepare('SELECT id FROM parents WHERE user_id=?').get(req.body.parent_user_id);if(!parent)return res.status(400).json({error:'Parent profile not found'});db.prepare('INSERT OR IGNORE INTO parent_students(parent_id,student_id) VALUES(?,?)').run(parent.id,Number(req.body.student_id));res.json({ok:true});}catch(e){res.status(400).json({error:e.message});}});
app.get('/api/parents',requireAuth,requireRole('admin','teacher'),(req,res)=>res.json(db.prepare(`SELECT p.id,p.user_id,u.name,u.email,u.phone,u.active,COALESCE((SELECT COUNT(*) FROM parent_students ps WHERE ps.parent_id=p.id),0) children FROM parents p JOIN users u ON u.id=p.user_id ORDER BY u.name`).all()));
app.get('/api/teachers',requireAuth,(req,res)=>res.json(db.prepare(`SELECT t.id,t.user_id,u.name,u.email,u.phone,u.active,t.subject,t.designation FROM teachers t JOIN users u ON u.id=t.user_id ORDER BY u.name`).all().filter(x=>req.user.role==='admin'||x.user_id===req.user.id||req.user.role==='teacher')));

app.get('/api/attendance',requireAuth,(req,res)=>{
  const {date,class_id,section_id}=req.query;
  let q=`SELECT a.*,s.student_id,u.name,c.class_no,sec.name section_name FROM attendance a JOIN students s ON s.id=a.student_id JOIN users u ON u.id=s.user_id LEFT JOIN classes c ON c.id=s.class_id LEFT JOIN sections sec ON sec.id=s.section_id WHERE 1=1`;
  const p=[]; if(date){q+=' AND a.date=?';p.push(date);} if(class_id){q+=' AND s.class_id=?';p.push(class_id);} if(section_id){q+=' AND s.section_id=?';p.push(section_id);} q+=' ORDER BY a.date DESC,c.class_no,sec.name,s.roll';
  let rows=db.prepare(q).all(...p);if(req.user.role==='student'||req.user.role==='parent'){const ids=new Set(studentsForUser(req.user).map(s=>s.id));rows=rows.filter(r=>ids.has(r.student_id));} res.json(rows);
});
app.post('/api/attendance/bulk',requireAuth,requireRole('admin','teacher'),(req,res)=>{const {date,records=[]}=req.body;if(!date||!Array.isArray(records))return res.status(400).json({error:'Date and records are required'});const st=db.prepare('INSERT INTO attendance(student_id,date,present) VALUES(?,?,?) ON CONFLICT(student_id,date) DO UPDATE SET present=excluded.present');const tx=db.transaction(()=>{for(const r of records)st.run(Number(r.student_id),date,bool(r.present)?1:0);});tx();audit(req.user.id,'SAVE_ATTENDANCE',`${date}:${records.length}`);res.json({ok:true});});

app.get('/api/exams',requireAuth,(req,res)=>res.json(db.prepare(`SELECT e.*,c.class_no,c.name class_name FROM exams e LEFT JOIN classes c ON c.id=e.class_id ORDER BY e.exam_date DESC,e.id DESC`).all()));
app.post('/api/exams',requireAuth,requireRole('admin','teacher'),(req,res)=>{const x=db.prepare('INSERT INTO exams(name,exam_date,class_id,published) VALUES(?,?,?,?)').run(clean(req.body.name),clean(req.body.exam_date),req.body.class_id?Number(req.body.class_id):null,bool(req.body.published)?1:0);res.json({id:x.lastInsertRowid});});
app.patch('/api/exams/:id',requireAuth,requireRole('admin','teacher'),(req,res)=>{db.prepare('UPDATE exams SET name=?,exam_date=?,class_id=?,published=? WHERE id=?').run(clean(req.body.name),clean(req.body.exam_date),req.body.class_id?Number(req.body.class_id):null,bool(req.body.published)?1:0,req.params.id);res.json({ok:true});});
app.get('/api/results',requireAuth,(req,res)=>{
  let rows=db.prepare(`SELECT r.id,r.student_id,r.exam_id,r.subject_id,r.marks,r.max_marks,r.grade,r.gpa,r.published,r.card_mime,r.card_name,s.student_id sid,u.name student_name,e.name exam,e.exam_date,e.published exam_published,sub.name subject,c.class_no,sec.name section_name FROM results r JOIN students s ON s.id=r.student_id JOIN users u ON u.id=s.user_id JOIN exams e ON e.id=r.exam_id JOIN subjects sub ON sub.id=r.subject_id LEFT JOIN classes c ON c.id=s.class_id LEFT JOIN sections sec ON sec.id=s.section_id ORDER BY e.exam_date DESC,e.id DESC,u.name,sub.name`).all();
  if(req.user.role==='student'||req.user.role==='parent'){const ids=new Set(studentsForUser(req.user).map(s=>s.id));rows=rows.filter(r=>ids.has(r.student_id)&&r.published&&r.exam_published);}
  res.json(rows);
});
app.post('/api/results',requireAuth,requireRole('admin','teacher'),(req,res)=>{const r=req.body;const marks=Math.max(0,Number(r.marks)||0), max=Math.max(1,Number(r.max_marks)||100), meta=gradeFromPercent((marks/max)*100);try{const x=db.prepare(`INSERT INTO results(student_id,exam_id,subject_id,marks,max_marks,grade,gpa,published) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(student_id,exam_id,subject_id) DO UPDATE SET marks=excluded.marks,max_marks=excluded.max_marks,grade=excluded.grade,gpa=excluded.gpa,published=excluded.published`).run(Number(r.student_id),Number(r.exam_id),Number(r.subject_id),marks,max,meta.grade,meta.gpa,bool(r.published)?1:0);res.json({id:x.lastInsertRowid});}catch(e){res.status(400).json({error:e.message});}});
app.patch('/api/results/:id',requireAuth,requireRole('admin','teacher'),(req,res)=>{const r=req.body;const marks=Math.max(0,Number(r.marks)||0), max=Math.max(1,Number(r.max_marks)||100), meta=gradeFromPercent((marks/max)*100);db.prepare('UPDATE results SET marks=?,max_marks=?,grade=?,gpa=?,published=? WHERE id=?').run(marks,max,meta.grade,meta.gpa,bool(r.published)?1:0,req.params.id);res.json({ok:true});});
app.post('/api/results/:id/card',requireAuth,requireRole('admin','teacher'),(req,res)=>{
  const data=String(req.body.dataUrl||''), m=data.match(/^data:(image\/(?:png|jpeg|jpg));base64,([A-Za-z0-9+/=\r\n]+)$/i);
  if(!m)return res.status(400).json({error:'Only JPG/JPEG/PNG image data is accepted'}); const buf=Buffer.from(m[2].replace(/\s/g,''),'base64'); if(buf.length>5*1024*1024)return res.status(400).json({error:'Image must be 5 MB or smaller'});
  const mime=m[1].toLowerCase().replace('image/jpg','image/jpeg'); const name=clean(req.body.name)||`result-${req.params.id}`; db.prepare('UPDATE results SET card_blob=?,card_mime=?,card_name=? WHERE id=?').run(buf,mime,name,req.params.id); res.json({ok:true});
});
app.get('/api/results/:id/card',requireAuth,(req,res)=>{const r=db.prepare('SELECT * FROM results WHERE id=?').get(req.params.id);if(!r||!r.card_blob)return res.status(404).end();if(req.user.role==='student'&&r.student_id!==studentsForUser(req.user)[0]?.id)return res.status(403).end();if(req.user.role==='parent'&&!studentsForUser(req.user).some(s=>s.id===r.student_id))return res.status(403).end();res.setHeader('Content-Type',r.card_mime||'image/jpeg');res.setHeader('Cache-Control','private, no-store');res.end(r.card_blob);});

app.get('/api/fees',requireAuth,(req,res)=>{
  advanceFeeStatuses();

  let rows=db.prepare(`
    SELECT
      f.*,
      s.student_id sid,
      u.name student_name,
      c.class_no,
      sec.name section_name
    FROM fees f
    JOIN students s ON s.id=f.student_id
    JOIN users u ON u.id=s.user_id
    LEFT JOIN classes c ON c.id=s.class_id
    LEFT JOIN sections sec ON sec.id=s.section_id
    ORDER BY u.name
  `).all();

  if(req.user.role==='student'||req.user.role==='parent'){
    const ids=new Set(
      studentsForUser(req.user).map(s=>s.id)
    );

    rows=rows.filter(r=>ids.has(r.student_id));
  }

  for(const r of rows){
    ensureUpcomingCycle(r.student_id);
    syncLegacyDue(r.student_id);
  }

  const cycles=db.prepare(`
    SELECT *
    FROM fee_cycles
    ORDER BY month_key DESC,id DESC
  `).all();

  res.json(
    rows.map(r=>({
      ...r,
      monthly_cycles:cycles.filter(
        c=>c.student_id===r.student_id
      ),
      monthly_due:cycles
        .filter(
          c=>c.student_id===r.student_id &&
             c.status==='DUE'
        )
        .reduce(
          (a,c)=>a+Math.max(
            0,
            c.amount-c.paid_amount
          ),
          0
        )
    }))
  );
});

app.post('/api/fees/monthly',requireAuth,requireRole('admin'),
(req,res)=>{
  const studentId=Number(req.body.student_id);
  const monthKey=clean(req.body.month_key);
  const amount=Math.max(
    0,
    Number(req.body.amount)||0
  );
  const status=monthKey>currentMonthKey()?'UPCOMING':'DUE';

  if(
    !studentId ||
    !/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(monthKey) ||
    amount<=0
  ){
    return res.status(400).json({
      error:'Student, valid month and amount are required'
    });
  }

  try{
    const student=db.prepare(
      'SELECT id FROM students WHERE id=?'
    ).get(studentId);

    if(!student){
      return res.status(404).json({
        error:'Student not found'
      });
    }

    const tx=db.transaction(()=>{
      db.prepare(`
        INSERT INTO fee_cycles
        (student_id,month_key,amount,paid_amount,status)
        VALUES(?,?,?,0,?)
        ON CONFLICT(student_id,month_key)
        DO UPDATE SET
          amount=excluded.amount,
          status=CASE
            WHEN fee_cycles.paid_amount>=excluded.amount
            THEN 'PAID'
            ELSE 'DUE'
          END,
          updated_at=?
      `).run(
        studentId,
        monthKey,
        amount,
        status,
        now()
      );

      db.prepare(`
        UPDATE fees
        SET monthly_fee=?,updated_at=?
        WHERE student_id=?
      `).run(
        amount,
        now(),
        studentId
      );

      ensureUpcomingCycle(studentId);
      syncLegacyDue(studentId);
    });

    tx();

    audit(
      req.user.id,
      'ADD_MONTHLY_DUE',
      `${studentId}:${monthKey}:${amount}`
    );

    res.json({ok:true});
  }catch(e){
    res.status(400).json({error:e.message});
  }
});

app.patch('/api/fees/:studentId',requireAuth,requireRole('admin'),
(req,res)=>{
  const sid=Number(req.params.studentId);
  const total=Math.max(
    0,
    Number(req.body.total_fee)||0
  );
  const add=Math.max(
    0,
    Number(req.body.additional_charge)||0
  );
  const adjustment=Number(req.body.adjustment)||0;

  const current=db.prepare(
    'SELECT due FROM fees WHERE student_id=?'
  ).get(sid);

  const nextDue=Math.max(
    0,
    (current?.due||0)+add+adjustment
  );

  const t=now();

  if(current){
    db.prepare(`
      UPDATE fees
      SET
        total_fee=?,
        additional_charge=?,
        due=?,
        adjustment=?,
        adjustment_reason=?,
        updated_at=?
      WHERE student_id=?
    `).run(
      total,
      add,
      nextDue,
      adjustment,
      clean(req.body.adjustment_reason),
      t,
      sid
    );
  }else{
    db.prepare(`
      INSERT INTO fees
      (student_id,total_fee,additional_charge,due,adjustment,adjustment_reason,updated_at)
      VALUES(?,?,?,?,?,?,?)
    `).run(
      sid,
      total,
      add,
      nextDue,
      adjustment,
      clean(req.body.adjustment_reason),
      t
    );
  }

  audit(
    req.user.id,
    'UPDATE_FEE_LEGACY',
    `${sid}:${nextDue}`
  );

  res.json({
    ok:true,
    due:nextDue
  });
});

app.get('/api/payments',requireAuth,(req,res)=>{
  let rows=db.prepare(`
    SELECT
      p.*,
      s.student_id sid,
      u.name student_name,
      u.phone student_phone
    FROM payments p
    JOIN students s ON s.id=p.student_id
    JOIN users u ON u.id=s.user_id
    ORDER BY p.id DESC
  `).all();

  if(req.user.role==='student'||req.user.role==='parent'){
    const ids=new Set(
      studentsForUser(req.user).map(s=>s.id)
    );

    rows=rows.filter(
      r=>ids.has(r.student_id)
    );
  }

  res.json(rows);
});

app.post('/api/payments',requireAuth,
requireRole('student','parent'),
(req,res)=>{
  const sid=Number(req.body.student_id);

  const allowed=studentsForUser(req.user)
    .some(s=>s.id===sid);

  if(!allowed){
    return res.status(403).json({
      error:'You cannot pay for this student'
    });
  }

  const amount=Number(req.body.amount)||0;

  if(amount<=0){
    return res.status(400).json({
      error:'Enter a valid amount'
    });
  }

  const cycle=db.prepare(`
    SELECT *
    FROM fee_cycles
    WHERE student_id=? AND status='DUE'
      AND amount>paid_amount
    ORDER BY month_key ASC,id ASC
    LIMIT 1
  `).get(sid);

  if(cycle){
    const remaining=Math.max(
      0,
      cycle.amount-cycle.paid_amount
    );

    if(amount>remaining){
      return res.status(400).json({
        error:'Amount cannot exceed the selected month due'
      });
    }
  }

  try{
    const feeMonth=cycle?.month_key||'';

    const x=db.prepare(`
      INSERT INTO payments
      (student_id,method,transaction_id,amount,payer_phone,fee_month)
      VALUES(?,?,?,?,?,?)
    `).run(
      sid,
      req.body.method,
      clean(req.body.transaction_id),
      amount,
      clean(req.body.payer_phone),
      feeMonth
    );

    const admins=db.prepare(
      "SELECT id FROM users WHERE role='admin' AND active=1"
    ).all();

    for(const a of admins){
      notifyUser(
        a.id,
        'New payment request',
        `Payment request #${x.lastInsertRowid} is waiting for verification.`,
        'payment'
      );
    }

    res.json({
      id:x.lastInsertRowid,
      status:'PENDING'
    });
  }catch(e){
    res.status(400).json({
      error:e.message
    });
  }
});

app.patch('/api/payments/:id',
requireAuth,
requireRole('admin'),
(req,res)=>{
  const p=db.prepare(
    'SELECT * FROM payments WHERE id=?'
  ).get(req.params.id);

  if(!p){
    return res.status(404).json({
      error:'Payment not found'
    });
  }

  if(p.status!=='PENDING'){
    return res.status(400).json({
      error:'This payment is already processed'
    });
  }

  if(req.body.status==='REJECTED'){
    db.prepare(`
      UPDATE payments
      SET status='REJECTED',reject_reason=?
      WHERE id=?
    `).run(
      clean(req.body.reason)||'Not approved',
      p.id
    );

    const stu=db.prepare(
      'SELECT user_id FROM students WHERE id=?'
    ).get(p.student_id);

    if(stu){
      notifyUser(
        stu.user_id,
        'Payment rejected',
        clean(req.body.reason)||'Payment request was rejected.',
        'payment'
      );
    }

    audit(
      req.user.id,
      'REJECT_PAYMENT',
      String(p.id)
    );

    return res.json({ok:true});
  }

  const tx=db.transaction(()=>{
    let dueAfter=0;

    const receipt=
      `SCA-${new Date().getFullYear()}-${String(p.id).padStart(6,'0')}`;

    if(p.fee_month){
      const c=db.prepare(`
        SELECT *
        FROM fee_cycles
        WHERE student_id=? AND month_key=?
      `).get(
        p.student_id,
        p.fee_month
      );

      if(!c){
        return {
          error:'Fee month no longer exists'
        };
      }

      const paid=Math.min(
        c.amount,
        c.paid_amount+p.amount
      );

      const status=
        paid>=c.amount
        ? 'PAID'
        : 'DUE';

      db.prepare(`
        UPDATE fee_cycles
        SET
          paid_amount=?,
          status=?,
          updated_at=?
        WHERE id=?
      `).run(
        paid,
        status,
        now(),
        c.id
      );

      dueAfter=syncLegacyDue(
        p.student_id
      );
    }else{
      const fee=db.prepare(
        'SELECT * FROM fees WHERE student_id=?'
      ).get(p.student_id);

      dueAfter=Math.max(
        0,
        (fee?.due||0)-p.amount
      );

      if(fee){
        db.prepare(`
          UPDATE fees
          SET due=?,updated_at=?
          WHERE student_id=?
        `).run(
          dueAfter,
          now(),
          p.student_id
        );
      }
    }

    db.prepare(`
      UPDATE payments
      SET
        status='APPROVED',
        approved_at=?,
        receipt_no=?
      WHERE id=?
    `).run(
      now(),
      receipt,
      p.id
    );

    return {
      due:dueAfter,
      receipt
    };
  });

  const out=tx();

  if(out.error){
    return res.status(400).json({
      error:out.error
    });
  }

  const stu=db.prepare(
    'SELECT user_id FROM students WHERE id=?'
  ).get(p.student_id);

  if(stu){
    notifyUser(
      stu.user_id,
      'Payment approved',
      `Your payment was approved. Receipt: ${out.receipt}`,
      'payment'
    );
  }

  audit(
    req.user.id,
    'APPROVE_PAYMENT',
    `${p.id}:${out.receipt}`
  );

  res.json({
    ok:true,
    ...out
  });
});

app.get('/api/routines',requireAuth,(req,res)=>{let rows=db.prepare(`SELECT r.*,c.class_no,sec.name section_name FROM routines r LEFT JOIN classes c ON c.id=r.class_id LEFT JOIN sections sec ON sec.id=r.section_id WHERE r.published=1 ORDER BY r.type,r.id DESC`).all();if(req.user.role==='student'||req.user.role==='parent'){const ss=studentsForUser(req.user);const pairs=new Set(ss.map(s=>`${s.class_id}:${s.section_id||0}`));rows=rows.filter(r=>!r.class_id||ss.some(s=>s.class_id===r.class_id && (!r.section_id||r.section_id===s.section_id)));}res.json(rows);});
app.post('/api/routines',requireAuth,requireRole('admin','teacher'),(req,res)=>{const x=db.prepare('INSERT INTO routines(type,title,content,class_id,section_id,published) VALUES(?,?,?,?,?,?)').run(req.body.type,clean(req.body.title),clean(req.body.content),req.body.class_id?Number(req.body.class_id):null,req.body.section_id?Number(req.body.section_id):null,bool(req.body.published)?1:0);res.json({id:x.lastInsertRowid});});
app.patch('/api/routines/:id',requireAuth,requireRole('admin','teacher'),(req,res)=>{db.prepare('UPDATE routines SET type=?,title=?,content=?,class_id=?,section_id=?,published=? WHERE id=?').run(req.body.type,clean(req.body.title),clean(req.body.content),req.body.class_id?Number(req.body.class_id):null,req.body.section_id?Number(req.body.section_id):null,bool(req.body.published)?1:0,req.params.id);res.json({ok:true});});

app.get('/api/notices',requireAuth,(req,res)=>{
  let rows=db.prepare(`SELECT n.*,u.name author FROM notices n LEFT JOIN users u ON u.id=n.author_id ORDER BY n.id DESC`).all();
  const today=now().slice(0,10); rows=rows.map(n=>({...n,status:n.status==='PUBLISHED'&&n.expiry_date&&n.expiry_date<today?'EXPIRED':n.status}));
  if(req.user.role==='student'||req.user.role==='parent'){
    const ss=studentsForUser(req.user); rows=rows.filter(n=>n.status==='PUBLISHED'&&(!n.expiry_date||n.expiry_date>=today)&& (n.target_type==='ALL'||n.target_type==='PARENT'||n.target_type==='STUDENT'&&ss.some(s=>String(s.id)===String(n.target_value))||n.target_type==='CLASS'&&ss.some(s=>String(s.class_id)===String(n.target_value))||n.target_type==='SECTION'&&ss.some(s=>String(s.section_id)===String(n.target_value))));
  }
  if(req.user.role==='teacher') rows=rows.filter(n=>n.status==='PUBLISHED'&&(!n.expiry_date||n.expiry_date>=today)&&(n.target_type==='ALL'||n.target_type==='TEACHER'));
  res.json(rows);
});
app.post('/api/notices',requireAuth,requireRole('admin','teacher'),(req,res)=>{const n=req.body;const status=n.status||'DRAFT';if(req.user.role==='teacher'&&!['ALL','CLASS','SECTION','STUDENT','TEACHER','PARENT'].includes(n.target_type))return res.status(400).json({error:'Invalid target'});const x=db.prepare(`INSERT INTO notices(title,content,category,publish_date,expiry_date,target_type,target_value,status,author_id) VALUES(?,?,?,?,?,?,?,?,?)`).run(clean(n.title),clean(n.content),clean(n.category)||'General',clean(n.publish_date)||now().slice(0,10),clean(n.expiry_date),n.target_type||'ALL',clean(n.target_value),status,req.user.id);if(status==='PUBLISHED')publishNotice({...n,id:x.lastInsertRowid});audit(req.user.id,'CREATE_NOTICE',clean(n.title));res.json({id:x.lastInsertRowid});});
app.patch('/api/notices/:id',requireAuth,requireRole('admin','teacher'),(req,res)=>{const old=db.prepare('SELECT * FROM notices WHERE id=?').get(req.params.id);if(!old)return res.status(404).json({error:'Notice not found'});const n={...old,...req.body};db.prepare(`UPDATE notices SET title=?,content=?,category=?,publish_date=?,expiry_date=?,target_type=?,target_value=?,status=? WHERE id=?`).run(clean(n.title),clean(n.content),clean(n.category)||'General',clean(n.publish_date),clean(n.expiry_date),n.target_type,clean(n.target_value),n.status,req.params.id);if(old.status!=='PUBLISHED'&&n.status==='PUBLISHED')publishNotice(n);res.json({ok:true});});
app.delete('/api/notices/:id',requireAuth,requireRole('admin'),(req,res)=>{db.prepare('DELETE FROM notices WHERE id=?').run(req.params.id);audit(req.user.id,'DELETE_NOTICE',String(req.params.id));res.json({ok:true});});

app.get('/api/notifications',requireAuth,(req,res)=>res.json(db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC').all(req.user.id)));
app.get('/api/notifications/unread-count',requireAuth,(req,res)=>res.json({count:db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND read=0').get(req.user.id).c}));
app.patch('/api/notifications/:id/read',requireAuth,(req,res)=>{db.prepare('UPDATE notifications SET read=1 WHERE id=? AND user_id=?').run(req.params.id,req.user.id);res.json({ok:true});});
app.patch('/api/notifications/read-all',requireAuth,(req,res)=>{db.prepare('UPDATE notifications SET read=1 WHERE user_id=?').run(req.user.id);res.json({ok:true});});

app.get('/api/materials',requireAuth,(req,res)=>{let rows=db.prepare(`SELECT m.*,c.class_no,sec.name section_name FROM materials m LEFT JOIN classes c ON c.id=m.class_id LEFT JOIN sections sec ON sec.id=m.section_id WHERE m.published=1 ORDER BY m.id DESC`).all();if(req.user.role==='student'||req.user.role==='parent'){const ss=studentsForUser(req.user);rows=rows.filter(m=>!m.class_id||ss.some(s=>s.class_id===m.class_id&&(!m.section_id||m.section_id===s.section_id)));}res.json(rows);});
app.post('/api/materials',requireAuth,requireRole('admin','teacher'),(req,res)=>{const x=db.prepare('INSERT INTO materials(title,description,url,class_id,section_id,published) VALUES(?,?,?,?,?,?)').run(clean(req.body.title),clean(req.body.description),clean(req.body.url),req.body.class_id?Number(req.body.class_id):null,req.body.section_id?Number(req.body.section_id):null,bool(req.body.published)?1:0);res.json({id:x.lastInsertRowid});});
app.delete('/api/materials/:id',requireAuth,requireRole('admin','teacher'),(req,res)=>{db.prepare('DELETE FROM materials WHERE id=?').run(req.params.id);res.json({ok:true});});
app.get('/api/assignments',requireAuth,(req,res)=>{let rows=db.prepare(`SELECT a.*,c.class_no,sec.name section_name FROM assignments a LEFT JOIN classes c ON c.id=a.class_id LEFT JOIN sections sec ON sec.id=a.section_id WHERE a.published=1 ORDER BY a.due_date ASC,a.id DESC`).all();if(req.user.role==='student'||req.user.role==='parent'){const ss=studentsForUser(req.user);rows=rows.filter(a=>!a.class_id||ss.some(s=>s.class_id===a.class_id&&(!a.section_id||a.section_id===s.section_id)));}res.json(rows);});
app.post('/api/assignments',requireAuth,requireRole('admin','teacher'),(req,res)=>{const x=db.prepare('INSERT INTO assignments(title,description,due_date,class_id,section_id,published) VALUES(?,?,?,?,?,?)').run(clean(req.body.title),clean(req.body.description),clean(req.body.due_date),req.body.class_id?Number(req.body.class_id):null,req.body.section_id?Number(req.body.section_id):null,bool(req.body.published)?1:0);res.json({id:x.lastInsertRowid});});
app.delete('/api/assignments/:id',requireAuth,requireRole('admin','teacher'),(req,res)=>{db.prepare('DELETE FROM assignments WHERE id=?').run(req.params.id);res.json({ok:true});});

app.get('/api/report',requireAuth,requireRole('admin'),(req,res)=>{
  const approved=db.prepare("SELECT COALESCE(SUM(amount),0) total FROM payments WHERE status='APPROVED'").get().total;
  const pending=db.prepare("SELECT COALESCE(SUM(amount),0) total FROM payments WHERE status='PENDING'").get().total;
  const rejected=db.prepare("SELECT COALESCE(SUM(amount),0) total FROM payments WHERE status='REJECTED'").get().total;
  const attendance=db.prepare('SELECT COUNT(*) total,SUM(present) present FROM attendance').get();
  const results=db.prepare('SELECT COUNT(*) c FROM results WHERE published=1').get().c;
  const collection=(days)=>db.prepare(`SELECT COALESCE(SUM(amount),0) total FROM payments WHERE status='APPROVED' AND datetime(approved_at)>=datetime('now',?)`).get(`-${days} days`).total;
  res.json({students:db.prepare('SELECT COUNT(*) c FROM students').get().c,activeStudents:db.prepare('SELECT COUNT(*) c FROM students s JOIN users u ON u.id=s.user_id WHERE u.active=1').get().c,teachers:db.prepare('SELECT COUNT(*) c FROM teachers').get().c,parents:db.prepare('SELECT COUNT(*) c FROM parents').get().c,due:db.prepare('SELECT COALESCE(SUM(due),0) total FROM fees').get().total,approved,pending,rejected,today:collection(1),last7:collection(7),last30:collection(30),attendanceTotal:attendance.total||0,attendancePresent:attendance.present||0,publishedResults:results});
});

app.get('/api/audit-logs',requireAuth,requireRole('admin'),(req,res)=>res.json(db.prepare(`SELECT a.*,u.name user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 200`).all()));

app.get(/.*/,(req,res)=>res.sendFile(path.join(PUBLIC,'index.html')));

app.listen(PORT,()=>console.log(`Student Care Academy running at http://localhost:${PORT}`));
