// public/script.js — Final Patch v4
document.addEventListener("DOMContentLoaded", () => {
  let forceUserFilter = null;  // phone number to filter by, or null

  // --- API wrapper ---
  const API = {
    login: async (u,p) => {
      const r = await fetch("/api/login", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({username:u,password:p}) });
      if (!r.ok) throw await r.json(); return r.json();
    },
    getBookings: async (opts={}) => {
      const qp = new URLSearchParams();
      if (opts.from) qp.set("from", opts.from);
      if (opts.to) qp.set("to", opts.to);
      if (opts.status && opts.status !== "All") qp.set("status", opts.status);
      if (opts.phone) qp.set("phone", opts.phone);
      const r = await fetch("/api/bookings" + (qp.toString() ? "?" + qp.toString() : ""));
      if (!r.ok) throw await r.json(); return r.json();
    },
    getBooking: async (id) => { const r = await fetch("/api/bookings/" + id); if (!r.ok) throw await r.json(); return r.json(); },
    saveBooking: async (b) => { const r = await fetch("/api/bookings", { method:"POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(b) }); const j = await r.json(); if (!r.ok) throw j; return j; },
    patchStatus: async (id,status) => { const r = await fetch("/api/bookings/" + id + "/status", { method:"PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ status }) }); const j = await r.json(); if (!r.ok) throw j; return j; },
    deleteBooking: async (id) => { const r = await fetch("/api/bookings/" + id, { method:"DELETE" }); const j = await r.json(); if (!r.ok) throw j; return j; },
    getSettings: async () => { const r = await fetch("/api/settings"); if (!r.ok) throw await r.json(); return r.json(); },
    saveSettings: async (s) => { const r = await fetch("/api/settings", { method:"POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(s) }); const j = await r.json(); if (!r.ok) throw j; return j; },
    getFreeSlots: async (from,to,start,end) => { const qp = new URLSearchParams({ from, to, start, end }).toString(); const r = await fetch("/api/bookings/free?" + qp); if (!r.ok) throw await r.json(); return r.json(); },
    getUsers: async (q) => { const qp = q ? ("?q=" + encodeURIComponent(q)) : ""; const r = await fetch("/api/users" + qp); if (!r.ok) throw await r.json(); return r.json(); },
    getUser: async (phone) => { const r = await fetch("/api/users/" + encodeURIComponent(phone)); if (!r.ok) throw await r.json(); return r.json(); },
    searchUsers: async (q) => { const qp = q ? ("?q=" + encodeURIComponent(q)) : ""; const r = await fetch("/api/users/search" + qp); if (!r.ok) throw await r.json(); return r.json(); }
  };

  // --- state & DOM refs ---
  const STORAGE_KEY = "sportslounge_session";
  let currentUser = null;
  let settings = { template: "", prefix: "", timeFormat: "12", toastTimeout: 5, autoSend: 0, sendCredentials: 1 };

  // DOM
  const loginModal = document.getElementById("loginModal");
  const loginForm = document.getElementById("loginForm");
  const loginUser = document.getElementById("loginUser");
  const loginPass = document.getElementById("loginPass");
  const loginMsg = document.getElementById("loginMsg");
  const appEl = document.getElementById("app");
  const currentUserEl = document.getElementById("currentUser");
  const logoutBtn = document.getElementById("logoutBtn");
  const navBtns = document.querySelectorAll(".navbtn");
  const tabs = {
    home: document.getElementById("tab-home"),
    all: document.getElementById("tab-all"),
    approvals: document.getElementById("tab-approvals"),
    reserved: document.getElementById("tab-reserved"),
    freeslots: document.getElementById("tab-freeslots"),
    settings: document.getElementById("tab-settings"),
    users: document.getElementById("tab-users")
  };

  const previewDateEl = document.getElementById("previewDate"), previewList = document.getElementById("previewList");
  const bookingForm = document.getElementById("bookingForm"), bookingIdEl = document.getElementById("bookingId");
  const nameEl = document.getElementById("name"), phoneEl = document.getElementById("phone");
  const dateEl = document.getElementById("date"), startInput = document.getElementById("startTime"), endInput = document.getElementById("endTime");
  const statusEl = document.getElementById("status"), paymentStatusEl = document.getElementById("paymentStatus"), advanceEl = document.getElementById("advance"), commentsEl = document.getElementById("comments");
  const allList = document.getElementById("allList"), reservedListEl = document.getElementById("reservedList"), pendingListEl = document.getElementById("pendingList");
  const fromDate = document.getElementById("fromDate"), toDate = document.getElementById("toDate"), filterBtn = document.getElementById("filterBtn"), clearFilterBtn = document.getElementById("clearFilterBtn");
  const toastEl = document.getElementById("toast"), toastMsg = document.getElementById("toastMsg"), toastClose = document.getElementById("toastClose");
  const fs_from = document.getElementById("fs_from"), fs_to = document.getElementById("fs_to"), fs_start = document.getElementById("fs_start"), fs_end = document.getElementById("fs_end"), findFreeBtn = document.getElementById("findFreeBtn"), copyFreeBtn = document.getElementById("copyFreeBtn"), waFreeBtn = document.getElementById("waFreeBtn"), freeResults = document.getElementById("freeResults");
  const preText = document.getElementById("preText"), defaultPrefixEl = document.getElementById("defaultPrefix");
  const waTemplate = document.getElementById("waTemplate"), timeFormatSelect = document.getElementById("timeFormatSelect"), toastTimeout = document.getElementById("toastTimeout"), autoSendCheckbox = document.getElementById("autoSendCheckbox"), saveSettingsBtn = document.getElementById("saveSettings");
  const usersTab = document.getElementById("tab-users");

  let statusFilterSelect = null;

  function showToast(msg, type="success"){
    toastEl.className = 'toast ' + (type==='success'?'success':'error');
    toastMsg.textContent = msg; toastEl.style.display = 'block';
    if (toastEl._t) clearTimeout(toastEl._t);
    const t = settings.toastTimeout || 5; if (t>0) toastEl._t = setTimeout(()=> toastEl.style.display='none', t*1000);
  }
  toastClose.addEventListener("click", ()=>{ toastEl.style.display='none'; if (toastEl._t) clearTimeout(toastEl._t); });
  dateEl.addEventListener('change', () => {
    renderPreview(); // Call renderPreview to update the bookings for the selected date
  });
  // helpers
  function parseHM(t){ const [hh,mm] = (t||"00:00").split(":").map(Number); return hh*60 + (mm||0); }
  function minsToHM(m){ m = m % (24*60); const hh = Math.floor(m/60), mm = m%60; return `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}`; }
  function toFriendly(hm,use12){ if(!hm) return ""; const [hh,mm] = hm.split(":").map(Number); if(use12){ const am = hh<12?'AM':'PM'; const h = ((hh+11)%12)+1; return `${h}:${String(mm).padStart(2,"0")} ${am}` } return `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}`; }
  function normalizePhone(p){ return (p||"").replace(/[^0-9]/g,""); }
  function formatDay(d){ return new Date(d).toLocaleDateString(undefined,{weekday:'long'}); }
  function formatDateUI(iso){ if (!iso) return ''; const [y,m,d] = iso.split('-'); return `${d}/${m}/${y}`; }

  // replace time inputs (type=time) with selects showing AM/PM times
  function ensureTimeSelects() {
    function makeSelect(id, currentVal) {
      const sel = document.createElement('select');
      sel.id = id;
      for (let h = 0; h < 24; h++) {
        const hh = String(h).padStart(2,'0') + ':00';
        const display = (() => {
          const ampm = h < 12 ? 'AM' : 'PM';
          const hr = ((h + 11) % 12) + 1;
          return `${String(hr).padStart(2,'0')}:00 ${ampm}`;
        })();
        const opt = document.createElement('option');
        opt.value = hh; opt.textContent = display;
        sel.appendChild(opt);
      }
      if (currentVal) sel.value = currentVal;
      return sel;
    }
    // startInput may be <input type=time> or already select
    const startNode = document.getElementById('startTime');
    const endNode = document.getElementById('endTime');
    let startVal = (startNode && (startNode.value || startNode.getAttribute('value'))) || null;
    let endVal = (endNode && (endNode.value || endNode.getAttribute('value'))) || null;

    if (startNode && startNode.tagName.toLowerCase() === 'input') {
      const sel = makeSelect('startTime', startVal);
      startNode.parentNode.replaceChild(sel, startNode);
    }
    if (endNode && endNode.tagName.toLowerCase() === 'input') {
      const sel2 = makeSelect('endTime', endVal);
      endNode.parentNode.replaceChild(sel2, endNode);
    }
  }

  // call now to replace time inputs if present
  ensureTimeSelects();

  // re-get start/end selectors
  const startEl = document.getElementById("startTime");
  const endEl = document.getElementById("endTime");

  // session
  (function restore(){ try{ const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); if (s && s.user) currentUser = s.user; }catch(e){ currentUser = null; } if (currentUser) onLoginSuccess(); else document.getElementById('loginModal').style.display = 'flex'; })();

  // login
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault(); loginMsg.textContent = '';
    const u = loginUser.value.trim(), p = loginPass.value.trim(); if (!u||!p) return loginMsg.textContent = 'Enter username & password';
    try {
      const res = await API.login(u,p); currentUser = res.user; localStorage.setItem(STORAGE_KEY, JSON.stringify({ user: currentUser })); onLoginSuccess();
    } catch (err) { loginMsg.textContent = err?.error || 'Login failed'; }
  });

  logoutBtn.addEventListener("click", ()=>{ currentUser = null; localStorage.removeItem(STORAGE_KEY); appEl.style.display='none'; logoutBtn.style.display='none'; currentUserEl.style.display='none'; document.getElementById('loginModal').style.display='flex'; });

  async function onLoginSuccess(){
    document.getElementById('loginModal').style.display='none'; appEl.style.display = 'block'; logoutBtn.style.display = 'inline-block'; currentUserEl.style.display = 'inline-block';
    currentUserEl.textContent = currentUser.role === 'admin' ? 'Admin' : currentUser.username;
    try { settings = await API.getSettings(); applySettingsToUI(); } catch(e){ console.error(e); }
    buildStatusFilter(); updateAuthUI(); setDefaultTimes(); dateEl.value = new Date().toISOString().slice(0,10); fs_from.value = dateEl.value; fs_to.value = dateEl.value; await refreshAll();
    attachAutocomplete(); // wire autocomplete after login
  }

  function applySettingsToUI(){
    waTemplate.value = settings.template || '';
    defaultPrefixEl.value = settings.prefix || '';
    timeFormatSelect.value = settings.timeFormat || '12';
    toastTimeout.value = settings.toastTimeout || 5;
    autoSendCheckbox.checked = !!settings.autoSend;
    const sc = document.getElementById('sendCredentialsCheckbox'); if (sc) sc.checked = !!settings.sendCredentials;
  }

  function updateAuthUI(){
    const isAdmin = currentUser && currentUser.role === 'admin';
    document.querySelector('.navbtn[data-tab="approvals"]').style.display = isAdmin ? 'inline-block' : 'none';
    document.querySelector('.navbtn[data-tab="reserved"]').style.display = isAdmin ? 'inline-block' : 'none';
    document.querySelector('.navbtn[data-tab="freeslots"]').style.display = isAdmin ? 'inline-block' : 'none';
    document.querySelector('.navbtn[data-tab="settings"]').style.display = isAdmin ? 'inline-block' : 'none';
    const usersNav = document.querySelector('.navbtn[data-tab="users"]'); if (usersNav) usersNav.style.display = isAdmin ? 'inline-block' : 'none';
    document.getElementById('settingsIcon').style.display = isAdmin ? 'block' : 'none';
    document.getElementById('waFreeBtn').style.display = isAdmin ? 'inline-block' : 'none';
    document.getElementById('advanceField').style.display = isAdmin ? 'block' : 'none';

    const statusLabel = statusEl && statusEl.parentElement ? statusEl.parentElement : null;
    const paymentLabel = paymentStatusEl && paymentStatusEl.parentElement ? paymentStatusEl.parentElement : null;
    if (!isAdmin) {
      if (statusLabel) statusLabel.style.display = 'none';
      if (paymentLabel) paymentLabel.style.display = 'none';
      if (document.getElementById('advanceField')) document.getElementById('advanceField').style.display = 'none';
      phoneEl.value = currentUser.username || ''; phoneEl.readOnly = true; phoneEl.classList.add('locked');
      (async ()=> { try { const u = await API.getUser(currentUser.username); if (u && u.user && u.user.name) nameEl.value = u.user.name; } catch(e){} })();
    } else {
      if (statusLabel) statusLabel.style.display = '';
      if (paymentLabel) paymentLabel.style.display = '';
      if (document.getElementById('advanceField')) document.getElementById('advanceField').style.display = 'block';
      phoneEl.readOnly = false; phoneEl.classList.remove('locked');
    }
  }

  // NAV
  navBtns.forEach(b => b.addEventListener('click', async () => {
    if (!currentUser) return;
    navBtns.forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    const t = b.dataset.tab;
    for (const k in tabs) tabs[k].style.display = (k===t? 'block' : 'none');
  
    if (t === 'all') {
      if (forceUserFilter) {
        await renderAllForPhone(forceUserFilter);
      } else {
        await renderAll();
      }
    }
  
    if (t==='reserved') await renderReserved();
    if (t==='approvals') await renderPending();
    if (t==='users') await renderUsers();
  }));
  

  // STATUS FILTER
  function buildStatusFilter(){
    if (statusFilterSelect) return;
    const container = document.createElement('div'); container.style.display='flex'; container.style.gap='8px'; container.style.marginTop='8px'; container.style.alignItems='center';
    const label = document.createElement('label'); label.textContent='Status: '; label.style.fontSize='13px';
    statusFilterSelect = document.createElement('select');
    ["All","Confirmed","Pending","Reserved","Rejected","Cancelled"].forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; statusFilterSelect.appendChild(o); });
    container.appendChild(label); container.appendChild(statusFilterSelect);
    const allTab = document.getElementById('tab-all');
    if (allTab) { const ref = allTab.querySelector('h3') || allTab; ref.parentNode.insertBefore(container, ref.nextSibling); }
    statusFilterSelect.addEventListener('change', async ()=> await renderAll());
  }

  // renderers (clear before append + debounce for preview)
  let previewDebounce = null;
  async function renderPreview(){
    if (previewDebounce) clearTimeout(previewDebounce);
    previewDebounce = setTimeout(async () => {
      previewList.innerHTML = '';
      const d = dateEl.value || new Date().toISOString().slice(0,10);

      // Format the date to include the day of the week (e.g., "2025-11-05 (Wednesday)")
      const formattedDate = new Date(d).toLocaleDateString(undefined, {
        weekday: 'long',  // Display day of the week (e.g., "Monday")
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      
      // Set the previewDateEl text content to show both date and day
      previewDateEl.textContent = formattedDate;
      
      try {
        const rows = await API.getBookings({ from: d, to: d, status: 'Confirmed' });
        const filtered = (currentUser.role === 'admin') ? rows : rows.filter(r => normalizePhone(r.phone) === normalizePhone(currentUser.username));
        if (!filtered.length) {
          let bookingText = "No confirmed bookings for this date";
          if (currentUser && currentUser.role === 'user') {
            bookingText = 'You have no confirmed bookings for this date.';
          } 
          previewList.innerHTML = '<li class="mini-item">'+bookingText+'</li>'; return; 
        }
        filtered.sort((a,b)=> parseHM(a.startTime) - parseHM(b.startTime));
        filtered.forEach(b => {
          const use12 = (settings.timeFormat || '12') === '12';
          const li = document.createElement('li'); li.className = 'mini-item';
          if (currentUser.role === 'admin') li.innerHTML = `<div><strong>${b.customerName||'—'}</strong><div class="muted small">${toFriendly(b.startTime,use12)} - ${toFriendly(b.endTime,use12)}</div></div><div><button class="btn" onclick="window.appEditBooking('${b.id}')">Edit</button></div>`;
          else li.innerHTML = `<div><strong>${b.customerName||'—'}</strong><div class="muted small">${toFriendly(b.startTime,use12)} - ${toFriendly(b.endTime,use12)}</div></div>`;
          previewList.appendChild(li);
        });
      } catch(e){ console.error(e); showToast('Unable to load day preview','error'); }
    }, 120);
  }

  async function renderAll(){
    filterBtn.addEventListener("click", async () => { 
      await renderAll(); }
    );
    clearFilterBtn.addEventListener("click", async () => {
      fromDate.value = "";
      toDate.value = "";
      if (statusFilterSelect) statusFilterSelect.value = "All";
      forceUserFilter = null;      // disable forced user filter
      await renderAll();
    });
    allList.innerHTML = '';
    try {
      const opts = {};
      if (fromDate.value) opts.from = fromDate.value;
      if (toDate.value) opts.to = toDate.value;
      const sf = statusFilterSelect ? statusFilterSelect.value : null; if (sf) opts.status = sf;
      if (currentUser.role !== 'admin') opts.phone = currentUser.username;
      const rows = await API.getBookings(opts);
      if (!rows.length) { allList.innerHTML = '<div class="card muted">No bookings found.</div>'; return; }
      rows.sort((a,b)=> (a.date||'').localeCompare(b.date||'') || (a.startTime||'').localeCompare(b.startTime||''));
      
      rows.forEach(b => {
        let bookingStatus = b.status;
        if (currentUser && currentUser.role === 'user' && b.status === 'Reserved') {
          bookingStatus = 'Not Available';
        }
        
        const use12 = (settings.timeFormat || '12') === '12';
        const el = document.createElement('div'); el.className = 'item';
        
        const statusBadge = `<span class="status-badge ${getStatusClass(b.status || '')}">
        
        ${bookingStatus || ''}
        
        </span>`;
        let meta = `${formatDateUI(b.date)} • ${toFriendly(b.startTime,use12)} - ${toFriendly(b.endTime,use12)} • ${statusBadge}`;
        if (currentUser.role === 'admin') meta += ` • ${b.paymentStatus || ''} • Rs ${b.advance || 0}`;
        const actions = currentUser.role==='admin' ? `<button class="btn" onclick="window.appEditBooking('${b.id}')">Edit</button><button class="btn ghost deletebtn" onclick="window.appDeleteBooking('${b.id}')">Delete</button>` : '';
        el.innerHTML = `<div><strong>${b.customerName || '—'}</strong><div class="muted">${meta}</div><div class="muted small">Comments: ${b.comments||'—'}</div></div><div>${actions}</div>`;
        allList.appendChild(el);
      });
    } catch(e){ console.error(e); showToast(e?.error || 'Could not load bookings','error'); }
  }

  async function renderReserved(){
    reservedListEl.innerHTML = '';
    try {
      const opts = { status: 'Reserved' }; if (currentUser.role !== 'admin') opts.phone = currentUser.username;
      const rows = await API.getBookings(opts);
      if (!rows.length) { reservedListEl.innerHTML = '<div class="card muted">No reserved entries.</div>'; return; }
      rows.forEach(r => {
        const use12 = (settings.timeFormat || '12') === '12';
        const el = document.createElement('div'); el.className = 'item';
        let actions = '';
        if (currentUser.role === 'admin') {
          actions += `<button class="btn" onclick="window.appPromoteReserved('${r.id}')">Promote</button>`;
          actions += `<button class="btn ghost" onclick="window.appChangeStatus('${r.id}','Rejected')">Reject</button>`;
          actions += `<button class="btn ghost deletebtn" onclick="window.appChangeStatus('${r.id}','Cancelled')">Cancel</button>`;
          actions += `<button class="btn ghost deletebtn" onclick="window.appDeleteBooking('${r.id}')">Delete</button>`;
        }
        el.innerHTML = `<div><strong>${r.customerName||'—'}</strong><div class="muted">${formatDateUI(r.date)} • ${toFriendly(r.startTime,use12)} - ${toFriendly(r.endTime,use12)} • ${r.paymentStatus || ''} • Rs ${r.advance || 0}</div><div class="muted small">Comments: ${r.comments || '—'}</div></div><div>${actions}</div>`;
        reservedListEl.appendChild(el);
      });
    } catch(e){ console.error(e); showToast('Error loading reserved','error'); }
  }

  async function renderPending(){
    pendingListEl.innerHTML = '';
    if (currentUser.role !== 'admin') { pendingListEl.innerHTML = '<div class="card muted">Pending approvals are admin-only.</div>'; return; }
    try {
      const rows = await API.getBookings({ status: 'Pending' });
      if (!rows.length) { pendingListEl.innerHTML = '<div class="card muted">No pending requests.</div>'; return; }
      rows.forEach(b => {
        const use12 = (settings.timeFormat || '12') === '12';
        const el = document.createElement('div'); el.className = 'item';
        el.innerHTML = `<div><strong>${b.customerName||'—'}</strong><div class="muted">${formatDateUI(b.date)} • ${toFriendly(b.startTime,use12)} - ${toFriendly(b.endTime,use12)} • ${b.paymentStatus||''}</div><div class="muted small">Comments: ${b.comments||'—'}</div></div><div><button class="btn" onclick="window.appApproveBooking('${b.id}')">Approve</button><button class="btn ghost" onclick="window.appRejectBooking('${b.id}')">Reject</button></div>`;
        pendingListEl.appendChild(el);
      });
    } catch(e){ console.error(e); showToast('Unable to load pending','error'); }
  }

  // booking submit
  bookingForm.addEventListener('submit', onBookingSubmit);
  async function onBookingSubmit(e){
    e.preventDefault();
    const booking = {
      id: bookingIdEl.value || undefined,
      customerName: nameEl.value.trim(),
      phone: phoneEl.value.trim(),
      date: dateEl.value,
      startTime: startEl.value,
      endTime: endEl.value,
      status: (currentUser.role === 'admin') ? statusEl.value : 'Pending',
      paymentStatus: (currentUser.role === 'admin') ? paymentStatusEl.value : 'Unpaid',
      advance: (currentUser.role === 'admin') ? Number(advanceEl.value||0) : 0,
      comments: commentsEl.value.trim(),
      createdBy: currentUser.username
    };
    if (!booking.customerName || !booking.phone || !booking.date || !booking.startTime || !booking.endTime) return showToast('Complete name, phone, date and times','error');
    let st = parseHM(booking.startTime), en = parseHM(booking.endTime); if (en <= st) en += 24*60;
    if (en - st < 30) return showToast('Booking duration must be at least 30 minutes','error');

    try {
  
      const res = await API.saveBooking(booking);
      if (res.createdUser && currentUser.role === 'admin') {
        const cred = res.createdUser;
        if (settings.sendCredentials) {
          const msg = buildBookingMessage(booking, settings, cred);
          if (settings.autoSend) { window.open(`https://wa.me/${normalizePhone(booking.phone)}?text=${encodeURIComponent(msg)}`, '_blank'); showToast('Opening WhatsApp...','success'); }
          else { await navigator.clipboard.writeText(msg).catch(()=>{}); showToast(`New user created and details copied (User: ${cred.username})`,'success'); }
        } else {
          const msg = buildBookingMessage(booking, settings, null);
          if (settings.autoSend) window.open(`https://wa.me/${normalizePhone(booking.phone)}?text=${encodeURIComponent(msg)}`, '_blank');
          else { await navigator.clipboard.writeText(msg).catch(()=>{}); showToast('Booking message copied','success'); }
        }
      } else {
        if (currentUser.role === 'admin' && booking.status === 'Confirmed') {
          const msg = buildBookingMessage(booking, settings, null);
          if (settings.autoSend) window.open(`https://wa.me/${normalizePhone(booking.phone)}?text=${encodeURIComponent(msg)}`, '_blank');
          else { await navigator.clipboard.writeText(msg).catch(()=>{}); showToast('Booking message copied','success'); }
        } else 
        if (currentUser && currentUser.role === 'user') {
          showToast('Booking request has been made', 'success');
        } else {
          showToast('Booking saved successfully', 'success');
        }
        
      }
      bookingForm.reset(); bookingIdEl.value=''; setDefaultTimes(); 
      if (currentUser && currentUser.role === 'user') {
          nameEl.value = currentUser.name || '';  // Restore customer name
          phoneEl.value = currentUser.phone || '';  // Restore phone number
      }
      await refreshAll();
    } catch (err) {
      console.error(err);
      if (err && err.error && err.error.toLowerCase().includes('time conflict')) {
        if (currentUser.role === 'admin') {
          const ok = confirm('This slot conflicts with an existing booking. Press OK to save as Reserved, Cancel to abort.');
          if (ok) {
            booking.status = 'Reserved';
            try { await API.saveBooking(booking); showToast('Saved as Reserved','success'); bookingForm.reset(); bookingIdEl.value=''; setDefaultTimes(); await refreshAll(); } catch(e){ showToast('Failed to save as Reserved','error'); }
          } else showToast('Action cancelled','error');
        } else showToast('Time conflict: slot already booked','error');
      } else showToast(err?.error || 'Error saving booking','error');
    }
  }

  function buildBookingMessage(booking, settingsObj, creds){
    const tpl = settingsObj.template || "Your booking is confirmed for The Sports Lounge on {date} ({day}) from {start} to {end}.";
    const use12 = settingsObj.timeFormat === '12';
    const dayLabel = formatDay(booking.date);
    const startFmt = toFriendly(booking.startTime, use12);
    const endFmt = toFriendly(booking.endTime, use12);
    let text = tpl.replace(/\{name\}/g, booking.customerName || '').replace(/\{date\}/g, formatDateUI(booking.date) || booking.date).replace(/\{day\}/g, dayLabel || '').replace(/\{start\}/g, startFmt || '').replace(/\{end\}/g, endFmt || '');
    if (creds && settingsObj.sendCredentials) text += `\n\nLogin details:\nUser: ${creds.username}\nPass: ${creds.password}`;
    return text;
  }

  // inline actions
  window.appEditBooking = async function(id){ if (currentUser.role !== 'admin') return alert('Only admin can edit'); try { const b = await API.getBooking(id); bookingIdEl.value = b.id; nameEl.value = b.customerName||''; phoneEl.value = b.phone||''; dateEl.value = b.date||new Date().toISOString().slice(0,10); startEl.value = b.startTime||'18:00'; endEl.value = b.endTime||'19:00'; statusEl.value = b.status||'Pending'; paymentStatusEl.value = b.paymentStatus||'Unpaid'; advanceEl.value = b.advance||0; commentsEl.value = b.comments||''; document.querySelector('.navbtn[data-tab="home"]').click(); } catch(e){ showToast('Could not load booking','error'); } };

  window.appDeleteBooking = async function(id){ if (currentUser.role !== 'admin') return alert('Only admin can delete'); if (!confirm('Delete booking?')) return; try { await API.deleteBooking(id); showToast('Booking deleted','success'); await refreshAll(); } catch(e){ showToast('Unable to delete booking','error'); } };

  window.appPromoteReserved = async function(id){ if (currentUser.role !== 'admin') return alert('Only admin'); try { await API.patchStatus(id,'Confirmed'); showToast('Promoted to Confirmed','success'); await refreshAll(); } catch(e){ showToast(e?.error || 'Unable to promote','error'); } };

  window.appChangeStatus = async function(id,newStatus){ if (currentUser.role !== 'admin') return alert('Only admin'); try { await API.patchStatus(id,newStatus); showToast('Status updated','success'); await refreshAll(); } catch(e){ showToast(e?.error || 'Unable to change status','error'); } };

  window.appApproveBooking = async function(id){ if (currentUser.role !== 'admin') return alert('Only admin'); try { await API.patchStatus(id,'Confirmed'); showToast('Booking approved','success'); await refreshAll(); } catch(e){ showToast('Unable to approve','error'); } };

  window.appRejectBooking = async function(id){ if (currentUser.role !== 'admin') return alert('Only admin'); try { await API.patchStatus(id,'Rejected'); showToast('Booking rejected','success'); await refreshAll(); } catch(e){ showToast('Unable to reject','error'); } };

  // FREE SLOTS — use backend output and robustly render
  findFreeBtn.addEventListener('click', async () => {
    freeResults.innerHTML = '';
    const from = fs_from.value, to = fs_to.value, start = fs_start.value, end = fs_end.value;
    if (!from||!to||!start||!end) return showToast('Select from/to and times','error');
    try {
      const res = await API.getFreeSlots(from,to,start,end);
      if (!Array.isArray(res) || !res.length) { freeResults.innerHTML = '<div class="card muted">No results</div>'; freeResults.dataset.text = ''; return; }
      const parts = [];
      res.forEach(day => {
        const header = `${formatDateUI(day.date)} (${formatDay(day.date)})`;
        const card = document.createElement('div'); card.className = 'card'; const h = document.createElement('div'); h.innerHTML = `<strong>${header}</strong>`; card.appendChild(h);
        if (!day.free || !day.free.length) {
          const p = document.createElement('div'); p.className = 'muted small'; p.textContent = 'No free slots'; card.appendChild(p);
        } else {
          const ul = document.createElement('div');
          day.free.forEach(slot => {
            const s = minsToHM(slot.startMin), e = minsToHM(slot.endMin);
            const li = document.createElement('div'); li.className = 'mini-item'; li.textContent = `${toFriendly(s, settings.timeFormat==='12')} - ${toFriendly(e, settings.timeFormat==='12')}`; ul.appendChild(li);
            parts.push(`${header}\n${toFriendly(s, settings.timeFormat==='12')} - ${toFriendly(e, settings.timeFormat==='12')}`);
          });
          card.appendChild(ul);
        }
        freeResults.appendChild(card);
      });
      const text = (preText.value || defaultPrefixEl.value || settings.prefix || '') + '\n\n' + parts.join('\n\n');
      freeResults.dataset.text = text;
    } catch (e) {
      console.error(e);
      // prefer readable message
      showToast(e?.error || 'Could not compute free slots', 'error');
    }
  });

  copyFreeBtn.addEventListener('click', async ()=> {
    const t = freeResults.dataset.text;
    if (!t) return showToast('No text to copy','error');
    try { await navigator.clipboard.writeText(t); showToast('Free slots copied','success'); } catch(e){ showToast('Copy failed','error'); }
  });
  waFreeBtn.addEventListener('click', ()=> {
    const t = freeResults.dataset.text;
    if (!t) return showToast('No text to send','error');
    if (settings.autoSend) window.open(`https://wa.me/?text=${encodeURIComponent(t)}`,'_blank');
    else navigator.clipboard.writeText(t).then(()=>showToast('Free slots copied','success'));
  });

  // settings save
  saveSettingsBtn.addEventListener('click', async () => {
    const sc = document.getElementById('sendCredentialsCheckbox');
    const s = { template: waTemplate.value, prefix: defaultPrefixEl.value, timeFormat: timeFormatSelect.value, toastTimeout: Number(toastTimeout.value)||5, autoSend: autoSendCheckbox.checked?1:0, sendCredentials: sc && sc.checked ? 1 : 0 };
    try { await API.saveSettings(s); settings = s; showToast('Settings saved','success'); } catch(e){ showToast('Could not save settings','error'); }
  });

  // USERS tab (search name or phone, view bookings filtered)
  async function renderUsers(q='') {
    if (!usersTab) return;
    usersTab.innerHTML = '';
    const header = document.createElement('div'); header.style.display='flex'; header.style.gap='8px'; header.style.alignItems='center';
    const input = document.createElement('input'); input.placeholder = 'Search name or phone'; input.style.flex='1';
    const btn = document.createElement('button'); btn.className='btn'; btn.textContent='Search';
    const refresh = document.createElement('button'); refresh.className='btn ghost'; refresh.textContent='Refresh';
    header.appendChild(input); header.appendChild(btn); header.appendChild(refresh); usersTab.appendChild(header);
    const list = document.createElement('div'); list.style.marginTop='12px'; usersTab.appendChild(list);

    async function load(qv){
      list.innerHTML = '';
      try {
        const rows = await API.getUsers(qv);
        if (!rows.length) { list.innerHTML = '<div class="card muted">No users found.</div>'; return; }
        rows.forEach(u => {
          const card = document.createElement('div'); card.className='card'; card.style.display='flex'; card.style.justifyContent='space-between'; card.style.alignItems='center';
          const left = document.createElement('div'); left.innerHTML = `<div><strong>${u.phone}</strong> <span class="muted">(${u.name||''})</span></div><div class="muted small">Bookings: ${u.bookingCount || 0}</div>`;
          const right = document.createElement('div');
          const copyBtn = document.createElement('button'); copyBtn.className='btn'; copyBtn.textContent='Copy Credentials';
          const viewBtn = document.createElement('button'); viewBtn.className='btn ghost'; viewBtn.textContent='View Bookings';
          if (!u.bookingCount) { viewBtn.disabled = true; viewBtn.classList.add('disabled'); }
          right.appendChild(copyBtn); right.appendChild(viewBtn);
          card.appendChild(left); card.appendChild(right); list.appendChild(card);

          copyBtn.addEventListener('click', async () => {
            const text = `Login details:\nUser: ${u.username}\nPass: ${u.password}`;
            try { await navigator.clipboard.writeText(text); showToast('Credentials copied','success'); } catch(e){ showToast('Copy failed','error'); }
          });

          viewBtn.addEventListener('click', async () => {
            forceUserFilter = u.phone;     // enable filter mode
            fromDate.value=''; toDate.value='';
            if (statusFilterSelect) statusFilterSelect.value = 'All';
            document.querySelector('.navbtn[data-tab="all"]').click();
          });
          filterBtn.addEventListener("click", async () => { 
            console.log('here');
            await renderAll(); }
          );

          clearFilterBtn.addEventListener("click", async () => {
            fromDate.value = "";
            toDate.value = "";
            if (statusFilterSelect) statusFilterSelect.value = "All";
            forceUserFilter = null;      // disable forced user filter
            await renderAll();
          });
          
          
        });
      } catch(e){ console.error(e); showToast('Could not fetch users','error'); }
    }

    btn.addEventListener('click', ()=> load(input.value.trim()));
    refresh.addEventListener('click', ()=> load(input.value.trim()));
    load(q);
  }

  async function renderAllForPhone(phone){
    allList.innerHTML = '';
    try {
      const rows = await API.getBookings({ phone: phone });
      if (!rows.length) { allList.innerHTML = '<div class="card muted">No bookings for user.</div>'; return; }
      rows.forEach(b => {
        const use12 = (settings.timeFormat || '12') === '12';
        const el = document.createElement('div'); el.className = 'item';
        el.innerHTML = `<div><strong>${b.customerName||'—'}</strong><div class="muted">${formatDateUI(b.date)} • ${toFriendly(b.startTime,use12)} - ${toFriendly(b.endTime,use12)} • <span class="status-badge ${getStatusClass(b.status)}">${b.status}</span></div></div><div>${currentUser.role==='admin'?`<button class="btn" onclick="window.appEditBooking('${b.id}')">Edit</button>`:''}</div>`;
        allList.appendChild(el);
      });
    } catch(e){ showToast('Unable to load bookings','error'); }
  }

  // AUTOCOMPLETE for admin: name ↔ phone
  function attachAutocomplete() {
    if (!nameEl || !phoneEl) return;
    // create suggestion containers
    let nameBox = document.getElementById('nameSuggest');
    if (!nameBox) { nameBox = document.createElement('div'); nameBox.id = 'nameSuggest'; nameBox.style.position='absolute'; nameBox.style.zIndex=1000; nameBox.style.background='#fff'; nameBox.style.border='1px solid #ccc'; nameBox.style.maxHeight='220px'; nameBox.style.overflow='auto'; nameBox.style.display='none'; document.body.appendChild(nameBox); }
    let phoneBox = document.getElementById('phoneSuggest');
    if (!phoneBox) { phoneBox = document.createElement('div'); phoneBox.id = 'phoneSuggest'; phoneBox.style.position='absolute'; phoneBox.style.zIndex=1000; phoneBox.style.background='#fff'; phoneBox.style.border='1px solid #ccc'; phoneBox.style.maxHeight='220px'; phoneBox.style.overflow='auto'; phoneBox.style.display='none'; document.body.appendChild(phoneBox); }

    function positionBox(input, box) {
      const r = input.getBoundingClientRect();
      box.style.left = (r.left + window.scrollX) + 'px';
      box.style.top = (r.bottom + window.scrollY) + 'px';
      box.style.width = r.width + 'px';
    }

    let nameTimer = null, phoneTimer = null;
    nameEl.addEventListener('input', () => {
      if (!currentUser || currentUser.role !== 'admin') return;
      if (nameTimer) clearTimeout(nameTimer);
      nameTimer = setTimeout(async () => {
        const q = nameEl.value.trim();
        if (!q) { nameBox.style.display='none'; return; }
        try {
          const rows = await API.searchUsers(q);
          nameBox.innerHTML = '';
          if (!rows || !rows.length) { nameBox.style.display='none'; return; }
          rows.forEach(r => {
            const item = document.createElement('div'); item.style.padding='8px'; item.style.cursor='pointer'; item.textContent = `${r.name || r.username} — ${r.phone}`;
            item.addEventListener('click', () => {
              nameEl.value = r.name || r.username; phoneEl.value = r.phone || r.username; nameBox.style.display='none'; phoneBox.style.display='none';
            });
            nameBox.appendChild(item);
          });
          positionBox(nameEl, nameBox); nameBox.style.display='block';
        } catch(e){ console.error(e); nameBox.style.display='none'; }
      }, 200);
    });

    phoneEl.addEventListener('input', () => {
      if (!currentUser || currentUser.role !== 'admin') return;
      if (phoneTimer) clearTimeout(phoneTimer);
      phoneTimer = setTimeout(async () => {
        const q = phoneEl.value.trim();
        if (!q) { phoneBox.style.display='none'; return; }
        try {
          const rows = await API.searchUsers(q);
          phoneBox.innerHTML = '';
          if (!rows || !rows.length) { phoneBox.style.display='none'; return; }
          rows.forEach(r => {
            const item = document.createElement('div'); item.style.padding='8px'; item.style.cursor='pointer'; item.textContent = `${r.name || r.username} — ${r.phone}`;
            item.addEventListener('click', () => {
              nameEl.value = r.name || r.username; phoneEl.value = r.phone || r.username; nameBox.style.display='none'; phoneBox.style.display='none';
            });
            phoneBox.appendChild(item);
          });
          positionBox(phoneEl, phoneBox); phoneBox.style.display='block';
        } catch(e){ console.error(e); phoneBox.style.display='none'; }
      }, 200);
    });

    // hide boxes on click outside
    document.addEventListener('click', (ev) => {
      if (!nameBox.contains(ev.target) && ev.target !== nameEl) nameBox.style.display='none';
      if (!phoneBox.contains(ev.target) && ev.target !== phoneEl) phoneBox.style.display='none';
    });

    window.addEventListener('resize', () => { if (nameBox.style.display==='block') positionBox(nameEl, nameBox); if (phoneBox.style.display==='block') positionBox(phoneEl, phoneBox); });
  }

  // helpers & UI bits
  function getStatusClass(status){
    if (!status) return 'status-unknown';
    const s = status.toLowerCase();
    if (s.includes('confirm')) return 'status-confirmed';
    if (s.includes('pending')) return 'status-pending';
    if (s.includes('reserved')) return 'status-reserved';
    if (s.includes('reject')) return 'status-rejected';
    if (s.includes('cancel')) return 'status-cancelled';
    return 'status-unknown';
  }

  paymentStatusEl.addEventListener('change', () => {
    if (paymentStatusEl.value === 'Unpaid') { advanceEl.value = 0; advanceEl.disabled = true; } else { advanceEl.disabled = false; }
  });

  // default times: next full hour, end +1
  function setDefaultTimes(){
    const now = new Date(); now.setMinutes(0,0,0); now.setHours(now.getHours()+1);
    startEl.value = String(now.getHours()).padStart(2,'0') + ':00';
    endEl.value = String((now.getHours()+1)%24).padStart(2,'0') + ':00';
  }
  startEl.addEventListener('change', () => {
    const hh = parseInt(startEl.value.split(':')[0],10);
    endEl.value = String((hh+1)%24).padStart(2,'0') + ':00';
  });

  // inject status styles
  (function styles(){
    const css = `
      .status-badge{ display:inline-block;padding:4px 8px;border-radius:8px;color:white;font-weight:700;font-size:12px }
      .status-confirmed{ background:#16a34a } .status-pending{ background:#f59e0b } .status-reserved{ background:#3b82f6 } .status-rejected{ background:#ef4444 } .status-cancelled{ background:#6b7280 } .status-unknown{ background:#94a3b8 }
      .locked{ background:#f5f7fb }
      .disabled{ opacity:0.5; pointer-events:none; }
      #nameSuggest, #phoneSuggest { box-shadow: 0 6px 18px rgba(0,0,0,0.08); border-radius:6px; overflow:auto; max-height:260px; }
      .mini-item{ margin-bottom:6px }
    `;
    const s = document.createElement('style'); s.innerHTML = css; document.head.appendChild(s);
  })();

  // refresh all
  async function refreshAll(){ await renderAll(); await renderReserved(); await renderPending(); await renderPreview(); }

  // initial defaults
  setDefaultTimes();
  (async function start(){ if (currentUser) { await refreshAll();  attachAutocomplete(); } })();

  // expose functions
  window.appEditBooking = window.appEditBooking; window.appDeleteBooking = window.appDeleteBooking; window.appPromoteReserved = window.appPromoteReserved; window.appChangeStatus = window.appChangeStatus; window.appApproveBooking = window.appApproveBooking; window.appRejectBooking = window.appRejectBooking; window.appRenderUsers = renderUsers;

}); // DOMContentLoaded
