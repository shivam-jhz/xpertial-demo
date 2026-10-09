/* ═══════════════════════════════════════════════════════
   XPERTIAL — Shared JS v3 (Firebase Edition)
   ═══════════════════════════════════════════════════════ */

/* ────────────────────────────────────────────────────────
   FIREBASE CONFIG
   Paste your Firebase project config here.
   Get it from: Firebase Console → Project Settings → Your Apps → SDK setup
   ──────────────────────────────────────────────────────── */
const FIREBASE_CONFIG = {
  apiKey:            "PASTE_YOUR_API_KEY",
  authDomain:        "PASTE_YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "PASTE_YOUR_PROJECT_ID",
  storageBucket:     "PASTE_YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "PASTE_YOUR_SENDER_ID",
  appId:             "PASTE_YOUR_APP_ID"
};

/* Razorpay publishable key — from Razorpay Dashboard → Settings → API Keys */
window.RAZORPAY_KEY = "rzp_test_ShotJ0QBtKXH9s"; /* ← replace with live key in production */

/* Cloud Functions base URL — set after deploying functions
   e.g. "https://us-central1-your-project-id.cloudfunctions.net"     */
window.FUNCTIONS_URL = "https://us-central1-PASTE_YOUR_PROJECT_ID.cloudfunctions.net";

/* ── FIREBASE INIT ── */
try {
  firebase.initializeApp(FIREBASE_CONFIG);
  window.auth    = firebase.auth();
  window.db      = firebase.firestore();
  window.storage = firebase.storage();
} catch(e) {
  console.warn("Firebase init failed — check FIREBASE_CONFIG in assets/xpertial.js", e);
}

/* ────────────────────────────────────────────────────────
   AUTH — Firebase-backed, localStorage-cached for fast UX
   ──────────────────────────────────────────────────────── */
window.xpAuth = {
  getUser() {
    try { return JSON.parse(localStorage.getItem('xp_user')); } catch { return null; }
  },
  setUser(u) { localStorage.setItem('xp_user', JSON.stringify(u)); },

  logout() {
    firebase.auth().signOut().then(() => {
      localStorage.removeItem('xp_user');
      window.location.href = xpAuth._root() + 'login.html';
    });
  },

  requireAuth() {
    const cached = this.getUser();
    if (!cached) {
      window.location.href = xpAuth._root() + 'login.html?redirect=' + encodeURIComponent(location.pathname);
      return null;
    }
    firebase.auth().onAuthStateChanged(fbUser => {
      if (!fbUser) {
        localStorage.removeItem('xp_user');
        window.location.href = xpAuth._root() + 'login.html';
      } else {
        xpAuth._refreshCache(fbUser);
      }
    });
    return cached;
  },

  async _refreshCache(fbUser) {
    try {
      const snap = await db.collection('users').doc(fbUser.uid).get();
      const p = snap.data() || {};
      const user = {
        uid: fbUser.uid, email: fbUser.email,
        name: p.name || fbUser.displayName || fbUser.email.split('@')[0],
        company: p.company || '', phone: p.phone || '',
        emailVerified: fbUser.emailVerified, role: p.role || 'client'
      };
      this.setUser(user);
      return user;
    } catch(e) { return null; }
  },

  waitForUser() {
    return new Promise(resolve => {
      firebase.auth().onAuthStateChanged(async fbUser => {
        if (!fbUser) { resolve(null); return; }
        resolve(await xpAuth._refreshCache(fbUser));
      });
    });
  },

  _root() {
    const p = location.pathname;
    if (p.includes('/client/') || p.includes('/company/')) return '../';
    return '';
  }
};

/* ────────────────────────────────────────────────────────
   DB — Firestore helpers
   ──────────────────────────────────────────────────────── */
window.xpDB = {
  async submitRequest(data) {
    const ref = db.collection('requests').doc();
    const reqId = 'REQ-' + Date.now().toString(36).toUpperCase();
    await ref.set({ ...data, id: reqId, firestoreId: ref.id, status: 'pending', createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    return reqId;
  },

  async getProjects(clientId) {
    const snap = await db.collection('projects').where('clientId','==',clientId).orderBy('createdAt','desc').get();
    return snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
  },

  async getProject(projectId) {
    const snap = await db.collection('projects').doc(projectId).get();
    if (snap.exists) return { firestoreId: snap.id, ...snap.data() };
    const q = await db.collection('projects').where('id','==',projectId).limit(1).get();
    if (q.empty) return null;
    return { firestoreId: q.docs[0].id, ...q.docs[0].data() };
  },

  listenProject(projectId, callback) {
    return db.collection('projects').doc(projectId).onSnapshot(snap => {
      if (snap.exists) callback({ firestoreId: snap.id, ...snap.data() });
    });
  },

  async getPayments(clientId) {
    const snap = await db.collection('payments').where('clientId','==',clientId).orderBy('createdAt','desc').get();
    return snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
  },

  async recordPayment(data) {
    const ref = db.collection('payments').doc();
    await ref.set({ ...data, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    return ref.id;
  },

  listenNotifications(userId, callback) {
    return db.collection('notifications').where('userId','==',userId)
      .orderBy('createdAt','desc').limit(50)
      .onSnapshot(snap => callback(snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }))));
  },

  async markNotifRead(notifId) {
    await db.collection('notifications').doc(notifId).update({ read: true });
  },

  async markAllNotifsRead(userId) {
    const snap = await db.collection('notifications').where('userId','==',userId).where('read','==',false).get();
    const batch = db.batch();
    snap.docs.forEach(d => batch.update(d.ref, { read: true }));
    await batch.commit();
  },

  async getContracts(clientId) {
    const snap = await db.collection('contracts').where('clientId','==',clientId).orderBy('createdAt','desc').get();
    return snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
  },

  async signContract(projectId, clientId) {
    const ref = db.collection('contracts').doc();
    await ref.set({ projectId, clientId, status: 'signed', signedAt: firebase.firestore.FieldValue.serverTimestamp() });
    await db.collection('projects').doc(projectId).update({ contractSigned: true, contractId: ref.id });
    return ref.id;
  },

  async getInvoices(clientId) {
    const snap = await db.collection('invoices').where('clientId','==',clientId).orderBy('createdAt','desc').get();
    return snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
  },

  async getDownloads(clientId) {
    const snap = await db.collection('downloads').where('clientId','==',clientId).orderBy('createdAt','desc').get();
    return snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
  },

  async updateProfile(uid, data) {
    await db.collection('users').doc(uid).set(data, { merge: true });
    const cached = xpAuth.getUser() || {};
    xpAuth.setUser({ ...cached, ...data });
  }
};

/* ────────────────────────────────────────────────────────
   STORAGE — Firebase Storage + Cloud Function signed URLs
   ──────────────────────────────────────────────────────── */
window.xpStorage = {
  async getDownloadUrl(storagePath) {
    const token = await firebase.auth().currentUser?.getIdToken();
    const res = await fetch(`${FUNCTIONS_URL}/generateDownloadUrl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ path: storagePath })
    });
    if (!res.ok) throw new Error('Failed to generate download URL');
    const { url } = await res.json();
    return url;
  }
};

/* ── NAV AUTH STATE ── */
(function() {
  const user = xpAuth.getUser();
  document.querySelectorAll('.nav-auth-in').forEach(el  => { el.style.display = user ? 'flex' : 'none'; });
  document.querySelectorAll('.nav-auth-out').forEach(el => { el.style.display = user ? 'none' : 'flex'; });
  if (user) document.querySelectorAll('.nav-user-init').forEach(el => { el.textContent = (user.name || user.email || 'U')[0].toUpperCase(); });
})();

/* ── NAV SCROLL ── */
(function() {
  const nav = document.getElementById('xpNav');
  if (nav) window.addEventListener('scroll', () => nav.classList.toggle('scrolled', window.scrollY > 10), { passive: true });
  const hbg = document.getElementById('xpHbg'), mob = document.getElementById('xpMob');
  if (hbg && mob) hbg.addEventListener('click', () => { hbg.classList.toggle('open'); mob.classList.toggle('open'); });
  document.querySelectorAll('.xp-msb').forEach(b => b.addEventListener('click', () => b.closest('.xp-ms').classList.toggle('open')));
})();

/* ── SEARCH MODAL ── */
const SEARCH_PAGES = [
  {ico:'🏠',label:'Home',sub:'Landing page',href:'index.html'},
  {ico:'📋',label:'Request a Dataset',sub:'Start a new project',href:'request.html'},
  {ico:'⚙️',label:'Services',sub:'Image, Text, Audio, Custom',href:'services.html'},
  {ico:'🔍',label:'How It Works',sub:'5-step process',href:'how-it-works.html'},
  {ico:'👤',label:'Join as Collector',sub:'Earn by collecting data',href:'join-collector.html'},
  {ico:'🏢',label:'About Us',sub:'Our mission and team',href:'company/about.html'},
  {ico:'✉️',label:'Contact',sub:'Get in touch',href:'company/contact.html'},
  {ico:'🔒',label:'Privacy Policy',sub:'Data & privacy',href:'company/privacy.html'},
  {ico:'📄',label:'Terms of Service',sub:'Legal',href:'company/terms.html'},
  {ico:'📊',label:'Client Dashboard',sub:'Your projects',href:'client/index.html'},
];
window.xpSearchOpen = function() {
  let ov = document.getElementById('xpSearchOverlay');
  if (!ov) {
    ov = document.createElement('div'); ov.id='xpSearchOverlay'; ov.className='search-overlay';
    const root = xpAuth._root();
    ov.innerHTML = `<div class="search-box"><div class="search-inner"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg><input class="search-input" id="xpSearchInput" placeholder="Search pages, services..." autocomplete="off"/><button class="search-close-btn" onclick="xpSearchClose()">✕</button></div><div class="search-results" id="xpSearchResults"></div><div class="search-hint">TYPE TO SEARCH · ESC TO CLOSE</div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', e => { if (e.target === ov) xpSearchClose(); });
    const inp = document.getElementById('xpSearchInput');
    inp.addEventListener('input', () => {
      const q = inp.value.toLowerCase().trim();
      const res = document.getElementById('xpSearchResults');
      const f = q ? SEARCH_PAGES.filter(p => p.label.toLowerCase().includes(q)||p.sub.toLowerCase().includes(q)) : SEARCH_PAGES.slice(0,6);
      res.innerHTML = f.length ? f.map(p=>`<a class="search-result-item" href="${root+p.href}"><span class="search-result-ico">${p.ico}</span><div><div class="search-result-label">${p.label}</div><div class="search-result-sub">${p.sub}</div></div></a>`).join('') : `<div style="padding:1.5rem;text-align:center;color:var(--t3);font-size:13px;">No results found</div>`;
    });
    inp.dispatchEvent(new Event('input'));
  }
  ov.classList.add('open');
  document.getElementById('xpSearchInput').focus();
  document.body.style.overflow = 'hidden';
};
window.xpSearchClose = function() { const ov=document.getElementById('xpSearchOverlay'); if(ov){ov.classList.remove('open');document.body.style.overflow='';} };
document.addEventListener('keydown', e => { if(e.key==='Escape') xpSearchClose(); if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();xpSearchOpen();} });

/* ── TOAST ── */
window.xpToast = function(msg, type='info') {
  const colors={info:'#00D4FF',success:'#22C55E',error:'#EF4444',warn:'#F59E0B'};
  const el=document.createElement('div');
  el.style.cssText=`position:fixed;bottom:24px;right:24px;z-index:9999;background:#0A0D14;border:1px solid ${colors[type]};border-radius:8px;padding:12px 18px;font-family:'Inter',sans-serif;font-size:13px;color:#E8EDF5;display:flex;align-items:center;gap:10px;box-shadow:0 8px 32px rgba(0,0,0,.6);animation:slideIn .3s ease;max-width:320px;`;
  el.innerHTML=`<span style="color:${colors[type]};font-size:16px">${type==='success'?'✓':type==='error'?'✕':type==='warn'?'⚠':'ℹ'}</span><span>${msg}</span>`;
  if(!document.getElementById('xpSlideStyle')){const s=document.createElement('style');s.id='xpSlideStyle';s.textContent='@keyframes slideIn{from{transform:translateX(120%);opacity:0}to{transform:translateX(0);opacity:1}}';document.head.appendChild(s);}
  document.body.appendChild(el);
  setTimeout(()=>el.remove(),3500);
};

/* ── MODAL ── */
window.xpModal={
  open(id){const m=document.getElementById(id);if(m){m.classList.add('open');document.body.style.overflow='hidden';}},
  close(id){const m=document.getElementById(id);if(m){m.classList.remove('open');document.body.style.overflow='';}}
};
document.addEventListener('click',e=>{if(e.target.classList.contains('modal-overlay'))xpModal.close(e.target.id);});

/* ── FORMAT HELPERS ── */
window.xpFmt = {
  currency: n => '₹' + Number(n).toLocaleString('en-IN'),
  date: d => new Date(d).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}),
  fileSize: b => b>=1e9?(b/1e9).toFixed(1)+' GB':b>=1e6?(b/1e6).toFixed(1)+' MB':(b/1024).toFixed(0)+' KB'
};

/* ── PARALLAX ── */
(function(){
  const els=document.querySelectorAll('[data-parallax]');if(!els.length)return;
  let ticking=false;
  window.addEventListener('scroll',()=>{if(!ticking){requestAnimationFrame(()=>{const sy=window.scrollY;els.forEach(el=>{el.style.transform=`translateY(${sy*(parseFloat(el.dataset.parallax)||.15)}px)`;});ticking=false;});ticking=true;}},{passive:true});
})();

/* ── MAGNETIC CARD GLOW ── */
(function(){
  function initGlow(){
    document.querySelectorAll('.card,.uc-card,.why-card,.feature-item').forEach(card=>{
      if(card.dataset.glowInit)return;card.dataset.glowInit='1';
      const gc=card.classList.contains('uc-card')?'uc-card-glow':card.classList.contains('why-card')?'why-card-glow':card.classList.contains('feature-item')?'feature-item-glow':'card-glow';
      if(!card.querySelector('.'+gc)){const g=document.createElement('div');g.className=gc;card.appendChild(g);}
      card.addEventListener('mousemove',e=>{const r=card.getBoundingClientRect();card.style.setProperty('--mx',((e.clientX-r.left)/r.width*100).toFixed(1)+'%');card.style.setProperty('--my',((e.clientY-r.top)/r.height*100).toFixed(1)+'%');});
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initGlow);else initGlow();
  window.xpInitGlow=initGlow;
})();
