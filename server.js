// server.js — Final Patch v4 (autocomplete endpoint + migrations)
import express from "express";
import cors from "cors";
import sqlite3 from "sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const dbPath = path.join(__dirname, "db.sqlite");
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) { console.error("❌ Could not open DB:", err.message); process.exit(1); }
  console.log("✅ DB opened:", dbPath);
  initDB();
});

function runAsync(sql, params=[]) {
  return new Promise((resolve,reject) => {
    db.run(sql, params, function(err){
      if (err) reject(err); else resolve(this);
    });
  });
}
function getAsync(sql, params=[]) {
  return new Promise((resolve,reject) => {
    db.get(sql, params, (err,row)=> { if (err) reject(err); else resolve(row); });
  });
}
function allAsync(sql, params=[]) {
  return new Promise((resolve,reject) => {
    db.all(sql, params, (err,rows)=>{ if (err) reject(err); else resolve(rows); });
  });
}

async function initDB(){
  try {
    await runAsync(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      phone TEXT,
      role TEXT,
      name TEXT
    )`);
    await runAsync(`CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      customerName TEXT,
      phone TEXT,
      date TEXT,
      startTime TEXT,
      endTime TEXT,
      status TEXT,
      paymentStatus TEXT,
      advance REAL DEFAULT 0,
      comments TEXT,
      createdBy TEXT,
      createdAt TEXT
    )`);
    await runAsync(`CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY,
      template TEXT,
      prefix TEXT,
      timeFormat TEXT,
      toastTimeout INTEGER,
      autoSend INTEGER
    )`);

    const settingRow = await getAsync("SELECT id FROM settings WHERE id = 1");
    if (!settingRow) {
      await runAsync("INSERT INTO settings (id,template,prefix,timeFormat,toastTimeout,autoSend) VALUES (1,?,?,?,?,?)",
        ["Your booking is confirmed for The Sports Lounge on {date} ({day}) from {start} to {end}.","Booking available today at The Sports Lounge:","12",5,0]);
    }

    // migration: add sendCredentials column if not present
    const info = await allAsync(`PRAGMA table_info(settings)`);
    const hasSendCred = info.some(c => c.name === 'sendCredentials');
    if (!hasSendCred) {
      console.log("🛠️ Migrating settings table: adding sendCredentials column (default 1)");
      await runAsync("ALTER TABLE settings ADD COLUMN sendCredentials INTEGER DEFAULT 1");
      await runAsync("UPDATE settings SET sendCredentials = 1 WHERE id = 1");
    }

    // seed admin/test users if none
    const ucount = await getAsync("SELECT COUNT(*) AS c FROM users");
    if (ucount && ucount.c === 0) {
      await runAsync("INSERT INTO users (username,password,phone,role,name) VALUES (?,?,?,?,?)", ["admin","1234","000","admin","Administrator"]);
      await runAsync("INSERT INTO users (username,password,phone,role,name) VALUES (?,?,?,?,?)", ["03001234567","pass123","03001234567","user","Test User"]);
    }

    console.log("✅ DB initialized and migrations applied.");
  } catch (e) {
    console.error("DB init error:", e);
    process.exit(1);
  }
}

function sendError(res, code, msg) { res.status(code).json({ error: msg }); }
function normalizePhone(p=""){ return (p||"").replace(/[^0-9]/g,""); }
function gen6(){ return String(Math.floor(100000 + Math.random()*900000)); }

// ---------------- AUTH ----------------
app.post("/api/login", async (req,res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return sendError(res,400,"username & password required");
  try {
    const row = await getAsync("SELECT id,username,phone,role,name FROM users WHERE username = ? AND password = ?", [username,password]);
    if (!row) return sendError(res,401,"Invalid credentials");
    res.json({ success:true, user: row });
  } catch(e){ sendError(res,500,e.message); }
});

// ---------------- USERS (search endpoint added) ----------------
app.get("/api/users", async (req,res) => {
  try {
    const q = req.query.q ? req.query.q.trim() : "";
    let rows;
    if (!q) {
      rows = await allAsync(`SELECT u.id, u.username, u.phone, u.name, u.password,
         (SELECT COUNT(*) FROM bookings b WHERE b.phone = u.phone OR b.createdBy = u.username) AS bookingCount
         FROM users u ORDER BY u.username`);
    } else {
      const like = `%${q}%`;
      rows = await allAsync(`SELECT u.id, u.username, u.phone, u.name, u.password,
         (SELECT COUNT(*) FROM bookings b WHERE b.phone = u.phone OR b.createdBy = u.username) AS bookingCount
         FROM users u WHERE u.phone LIKE ? OR u.name LIKE ? OR u.username LIKE ? ORDER BY u.username`, [like, like, like]);
    }
    res.json(rows || []);
  } catch(e){ sendError(res,500,e.message); }
});

// quick autocomplete endpoint (returns limited results)
app.get("/api/users/search", async (req,res) => {
  try {
    const q = (req.query.q||"").trim();
    if (!q) return res.json([]);
    const like = `%${q}%`;
    const rows = await allAsync(`SELECT username, phone, name FROM users WHERE phone LIKE ? OR name LIKE ? OR username LIKE ? ORDER BY name LIMIT 20`, [like, like, like]);
    res.json(rows || []);
  } catch(e){ sendError(res,500,e.message); }
});

app.get("/api/users/:phone", async (req,res) => {
  try {
    const p = normalizePhone(req.params.phone);
    const row = await getAsync("SELECT id,username,phone,name,password FROM users WHERE phone = ? OR username = ?", [p,p]);
    if (!row) return sendError(res,404,"user not found");
    const bookings = await allAsync("SELECT * FROM bookings WHERE phone = ? OR createdBy = ? ORDER BY date, startTime", [row.username, row.username]);
    res.json({ user: row, bookings: bookings || [] });
  } catch(e){ sendError(res,500,e.message); }
});

app.post("/api/users/ensure", async (req,res) => {
  const { phone, name } = req.body || {};
  if (!phone) return sendError(res,400,"phone required");
  const p = normalizePhone(phone);
  try {
    const r = await getAsync("SELECT id,username,phone,role,name FROM users WHERE phone = ? OR username = ?", [p,p]);
    if (r) return res.json({ created: false, user: r });
    const pwd = gen6();
    const info = await runAsync("INSERT INTO users (username,password,phone,role,name) VALUES (?,?,?,?,?)", [p,pwd,p,"user",name||""]);
    const newRow = await getAsync("SELECT id,username,phone,role,name FROM users WHERE id = ?", [info.lastID]);
    res.json({ created: true, user: newRow, password: pwd });
  } catch(e){ sendError(res,500,e.message); }
});

// ---------------- SETTINGS ----------------
app.get("/api/settings", async (req,res) => {
  try {
    const row = await getAsync("SELECT * FROM settings WHERE id = 1");
    if (!row) return sendError(res,500,"settings missing");
    res.json({
      template: row.template,
      prefix: row.prefix,
      timeFormat: row.timeFormat || "12",
      toastTimeout: Number(row.toastTimeout) || 5,
      autoSend: Number(row.autoSend) || 0,
      sendCredentials: Number(row.sendCredentials) || 0
    });
  } catch(e){ sendError(res,500,e.message); }
});

app.post("/api/settings", async (req,res) => {
  try {
    const s = req.body || {};
    await runAsync("UPDATE settings SET template=?, prefix=?, timeFormat=?, toastTimeout=?, autoSend=?, sendCredentials=? WHERE id = 1",
      [s.template||"", s.prefix||"", s.timeFormat||"12", s.toastTimeout||5, s.autoSend?1:0, s.sendCredentials?1:0]);
    res.json({ message: "settings updated" });
  } catch(e){ sendError(res,500,e.message); }
});

// ---------------- BOOKINGS ----------------
app.get("/api/bookings", async (req,res) => {
  try {
    const { from, to, status, phone } = req.query;
    const cond = []; const params = [];
    if (from) { cond.push("date >= ?"); params.push(from); }
    if (to) { cond.push("date <= ?"); params.push(to); }
    if (status && status !== "All") { cond.push("status = ?"); params.push(status); }
    if (phone) { const p = normalizePhone(phone); cond.push("(phone = ? OR createdBy = ?)"); params.push(p,p); }
    const where = cond.length ? ("WHERE " + cond.join(" AND ")) : "";
    const rows = await allAsync(`SELECT id, customerName, phone, date, startTime, endTime, status, paymentStatus, advance, comments, createdBy, createdAt FROM bookings ${where} ORDER BY date, startTime`, params);
    res.json(rows || []);
  } catch(e){ sendError(res,500,e.message); }
});



// free slots (corrected)
app.get("/api/bookings/free", async (req,res) => {
  try {
    
    const { from, to, start, end } = req.query;
    if (!from || !to || !start || !end) return sendError(res,400,"from,to,start,end required");
    function toMin(t){ const [hh,mm] = (t||"00:00").split(":").map(Number); return hh*60 + (mm||0); }
    const windowStart = toMin(start);
    let windowEnd = toMin(end); if (windowEnd <= windowStart) windowEnd += 24*60;

    const rows = await allAsync("SELECT date, startTime, endTime FROM bookings WHERE date >= ? AND date <= ? AND status = 'Confirmed' ORDER BY date, startTime", [from, to]);
    const byDate = {};
    for (const b of rows || []) {
      const s = toMin(b.startTime), e = toMin(b.endTime);
      const eAdj = (e <= s) ? e + 24*60 : e;
      if (!byDate[b.date]) byDate[b.date] = [];
      const a = Math.max(s, windowStart), c = Math.min(eAdj, windowEnd);
      if (a < c) byDate[b.date].push([a, c]);
    }
    

    const out = [];
    const sDate = new Date(from), eDate = new Date(to);
    for (let d = new Date(sDate); d <= eDate; d.setDate(d.getDate()+1)) {
      const ds = d.toISOString().slice(0,10);
      const occ = (byDate[ds] || []).sort((x,y)=>x[0]-y[0]);
      const merged = [];
      for (const r of occ) {
        if (!merged.length) merged.push(r);
        else {
          const last = merged[merged.length-1];
          if (r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
          else merged.push(r);
        }
      }
      const frees = [];
      let cursor = windowStart;
      for (const m of merged) {
        if (m[0] > cursor) frees.push([cursor, m[0]]);
        cursor = Math.max(cursor, m[1]);
      }
      if (cursor < windowEnd) frees.push([cursor, windowEnd]);
      out.push({ date: ds, free: frees.map(f => ({ startMin: f[0], endMin: f[1] })) });
    }

    res.json(out);
  } catch(e){ sendError(res,500,e.message); }
});

app.get("/api/bookings/:id", async (req,res) => {

  try {
    const row = await getAsync("SELECT * FROM bookings WHERE id = ?", [req.params.id]);
    if (!row) return sendError(res,404,"booking not found");
    res.json(row);
  } catch(e){ sendError(res,500,e.message); }
});

// create/upsert booking (conflict checks & user creation)
app.post("/api/bookings", async (req,res) => {
  try {
    const b = req.body || {};
    if (!b.customerName || !b.phone || !b.date || !b.startTime || !b.endTime) return sendError(res,400,"customerName, phone, date, startTime, endTime required");
    const phoneClean = normalizePhone(b.phone);
    const id = b.id || ("B" + Date.now());
    function toMin(t){ const [hh,mm] = (t||"00:00").split(":").map(Number); return hh*60 + (mm||0); }
    function overlaps(a1,b1,a2,b2){ if (b1 <= a1) b1 += 24*60; if (b2 <= a2) b2 += 24*60; return Math.max(a1,a2) < Math.min(b1,b2); }

    const existing = await getAsync("SELECT id FROM bookings WHERE id = ?", [id]);
    const startMin = toMin(b.startTime), endMin = toMin(b.endTime);

    async function conflictCheck(date, excludeId) {
      const rows = await allAsync("SELECT id,startTime,endTime,status FROM bookings WHERE date = ? AND id <> ? AND (status = 'Confirmed' OR status = 'Reserved')", [date, excludeId]);
      for (const r of rows || []) {
        const s2 = toMin(r.startTime), e2 = toMin(r.endTime);
        if (overlaps(startMin,endMin,s2,e2)) return { conflict: true, with: r };
      }
      return { conflict: false };
    }

    if (existing) {
      if (b.status === "Confirmed") {
        const chk = await conflictCheck(b.date, id);
        if (chk.conflict) return sendError(res,409,"Time conflict: slot already booked");
      }
      const fields = []; const vals = [];
      ["customerName","phone","date","startTime","endTime","status","paymentStatus","advance","comments","createdBy"].forEach(k => {
        if (k in b) fields.push(`${k} = ?`), vals.push(k==="phone"?phoneClean:(k==="advance"?Number(b[k]||0):b[k]));
      });
      vals.push(id);
      await runAsync(`UPDATE bookings SET ${fields.join(", ")} WHERE id = ?`, vals);
      return res.json({ message: "Booking updated", id });
    }

    if (b.status === "Confirmed") {
      const chk = await conflictCheck(b.date, id);
      if (chk.conflict) return sendError(res,409,"Time conflict: slot already booked");
    }

    // ensure user exists
    let createdUser = null;
    const userRow = await getAsync("SELECT id,username,phone FROM users WHERE phone = ? OR username = ?", [phoneClean, phoneClean]);
    if (!userRow) {
      const pwd = gen6();
      await runAsync("INSERT INTO users (username,password,phone,role,name) VALUES (?,?,?,?,?)", [phoneClean, pwd, phoneClean, "user", b.customerName || ""]);
      createdUser = { username: phoneClean, password: pwd };
    }

    const createdAt = new Date().toISOString();
    const createdBy = b.createdBy || phoneClean;
    const adv = Number(b.advance || 0);
    await runAsync(`INSERT INTO bookings (id,customerName,phone,date,startTime,endTime,status,paymentStatus,advance,comments,createdBy,createdAt)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [id, b.customerName, phoneClean, b.date, b.startTime, b.endTime, b.status || "Pending", b.paymentStatus || "Unpaid", adv, b.comments || "", createdBy, createdAt]);

    const out = { message: "Booking saved", id };
    if (createdUser) out.createdUser = createdUser;
    res.json(out);

  } catch(e){ sendError(res,500,e.message); }
});

app.patch("/api/bookings/:id/status", async (req,res) => {
  try {
    const id = req.params.id; const status = req.body.status;
    if (!status) return sendError(res,400,"status required");
    const row = await getAsync("SELECT * FROM bookings WHERE id = ?", [id]);
    if (!row) return sendError(res,404,"booking not found");
    if (status === "Confirmed") {
      const toMin = t => { const [hh,mm] = (t||"00:00").split(":").map(Number); return hh*60 + (mm||0); };
      const smin = toMin(row.startTime), emin = toMin(row.endTime);
      const rows = await allAsync("SELECT id,startTime,endTime,status FROM bookings WHERE date = ? AND id <> ? AND (status = 'Confirmed' OR status = 'Reserved')", [row.date, id]);
      for (const r of rows || []) {
        let s2 = toMin(r.startTime), e2 = toMin(r.endTime);
        if (e2 <= s2) e2 += 24*60;
        let eAdj = emin; if (eAdj <= smin) eAdj += 24*60;
        if (Math.max(smin, s2) < Math.min(eAdj, e2)) return sendError(res,409,"Time conflict: slot already booked");
      }
    }
    await runAsync("UPDATE bookings SET status = ? WHERE id = ?", [status, id]);
    res.json({ message: "Status updated" });
  } catch(e){ sendError(res,500,e.message); }
});

app.delete("/api/bookings/:id", async (req,res) => {
  try {
    const info = await runAsync("DELETE FROM bookings WHERE id = ?", [req.params.id]);
    if (info.changes === 0) return sendError(res,404,"booking not found");
    res.json({ message: "Booking deleted" });
  } catch(e){ sendError(res,500,e.message); }
});

app.get("*", (req,res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
