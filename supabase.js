'use strict';

// Bulut sinxronizatsiyasi.
//
// MUHIM: ilgari butun ro'yxat (masalan barcha qarzlar) bitta qator ichida
// saqlanardi va har yozuvda to'liq almashtirilardi. Ikki qurilma bir vaqtda
// yozsa, biri ikkinchisining yozuvini o'chirib yuborardi — qarzlar shu sababli
// yo'qolgan.
//
// Endi HAR BIR yozuv (qarz, mijoz, to'lov) serverda ALOHIDA qator. Ikki qurilma
// turli qarz yozsa, ular turli qatorlarga tushadi va bir-biriga umuman tegmaydi.
// O'chirish ham qatorni yo'q qilmaydi — faqat _del belgisi qo'yiladi.
const Cloud = {
  _url: 'https://fkizqvhgkqhjmzbuufcr.supabase.co',
  _apiKey: 'sb_publishable_IXsZC_7OdHAq08BtPTrjJw_wGvpF96z',

  QUEUE_KEY: 'gm_sync_queue',
  BATCH: 200,
  PAGE: 1000,

  _pending: null,
  _index: null,
  _dirty: false,
  _saveTimer: null,
  _busy: false,
  _fails: 0,
  _timer: null,

  _h(extra) {
    const h = {
      'apikey': this._apiKey,
      'Authorization': 'Bearer ' + this._apiKey,
      'Content-Type': 'application/json'
    };
    return extra ? Object.assign(h, extra) : h;
  },

  rowId(type, coll, recId) { return 'r_' + type + '_' + coll + '_' + recId; },

  // ─── Navbat (yuborilmagan yozuvlar) ──────────────────────────────────────
  // Navbat localStorage'da saqlanadi — internet uzilsa yoki sahifa yopilsa ham
  // yozuv yo'qolmaydi, keyingi safar qayta yuboriladi.
  _load() {
    if (this._pending) return this._pending;
    try {
      const raw = localStorage.getItem(this.QUEUE_KEY);
      this._pending = raw ? JSON.parse(raw) : [];
    } catch (e) { this._pending = []; }
    if (!Array.isArray(this._pending)) this._pending = [];
    return this._pending;
  },

  // Saqlash kechiktiriladi. Ilgari har bir yozuvda butun navbat qaytadan
  // JSON ga aylantirilardi — minglab yozuvda brauzer qotib qolardi.
  _saveNow() {
    if (!this._pending) return;
    this._dirty = false;
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    try { localStorage.setItem(this.QUEUE_KEY, JSON.stringify(this._pending)); }
    catch (e) { /* joy yetmasa ham ishlashda davom etamiz */ }
  },

  _save() {
    this._dirty = true;
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => { this._saveTimer = null; if (this._dirty) this._saveNow(); }, 300);
  },

  // Navbatda faqat HAVOLA saqlanadi: qaysi baza, qaysi to'plam, qaysi yozuv.
  // Yozuvning o'zi yuborish paytida o'qiladi — shuning uchun navbat kichik
  // bo'ladi va doim eng oxirgi holat yuboriladi.
  _qkey(e) { return e.t + '|' + e.c + '|' + (e.i || ''); },

  _reindex() {
    this._index = {};
    const q = this._load();
    for (let n = 0; n < q.length; n++) this._index[this._qkey(q[n])] = n;
  },

  _enqueue(entry) {
    const q = this._load();
    if (!this._index) this._reindex();
    const k = this._qkey(entry);
    if (this._index[k] === undefined) { this._index[k] = q.length; q.push(entry); }
    this._save();
    this._later();
  },

  pushRecord(type, coll, rec) {
    if (!rec || !rec.id) return;
    this._enqueue({ t: type, c: coll, i: rec.id });
  },

  pushCounter(type) {
    this._enqueue({ t: type, c: 'counter' });
  },

  pendingCount() { return this._load().length; },

  _later() {
    if (this._timer) return;
    this._timer = setTimeout(() => { this._timer = null; this.flush(); }, 400);
  },

  async flush() {
    if (this._busy) return;
    const q = this._load();
    if (!q.length) { this._status(true); return; }
    this._busy = true;

    const batch = q.slice(0, this.BATCH);
    const rows = [];
    const maps = {};
    batch.forEach(e => {
      if (e.c === 'counter') {
        const v = Number((typeof DB !== 'undefined' && DB.get(e.t, 'counter')) || 0);
        rows.push({ id: 'c_' + e.t, data: { t: e.t, c: 'counter', v } });
        return;
      }
      if (typeof DB === 'undefined') return;
      const mk = e.t + '|' + e.c;
      if (!maps[mk]) {
        const m = {};
        (DB.get(e.t, e.c) || []).forEach(r => { if (r && r.id) m[r.id] = r; });
        maps[mk] = m;
      }
      const rec = maps[mk][e.i];
      if (rec) rows.push({ id: this.rowId(e.t, e.c, e.i), data: { t: e.t, c: e.c, r: rec } });
    });

    try {
      if (rows.length) {
        const res = await fetch(this._url + '/rest/v1/store', {
          method: 'POST',
          headers: this._h({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
          body: JSON.stringify(rows)
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
      }

      // Faqat yuborilganlarini navbatdan olib tashlaymiz
      const sent = {};
      batch.forEach(e => { sent[this._qkey(e)] = true; });
      this._pending = this._load().filter(e => !sent[this._qkey(e)]);
      this._reindex();
      this._saveNow();
      this._fails = 0;
      this._busy = false;
      this._status(true);
      if (this._pending.length) this.flush();
    } catch (e) {
      // Navbat joyida qoladi — keyinroq qayta urinamiz
      this._fails++;
      this._busy = false;
      this._status(false);
      const wait = Math.min(60000, 2000 * this._fails);
      setTimeout(() => this.flush(), wait);
    }
  },

  // ─── Serverdan olish ─────────────────────────────────────────────────────
  async pull() {
    let rows = [];
    try {
      let offset = 0;
      for (;;) {
        const res = await fetch(
          this._url + '/rest/v1/store?select=id,data&limit=' + this.PAGE + '&offset=' + offset,
          { headers: this._h() }
        );
        if (!res.ok) { this._status(false); return false; }
        const page = await res.json();
        if (!Array.isArray(page)) { this._status(false); return false; }
        rows = rows.concat(page);
        if (page.length < this.PAGE) break;
        offset += this.PAGE;
      }
    } catch (e) {
      console.warn('Cloud pull:', e.message);
      this._status(false);
      return false;
    }

    const groups = {};    // "type|coll" -> [yozuvlar]
    const counters = {};  // type -> son
    const legacy = {};    // eski gm_* qatorlari (o'tish davri uchun)

    rows.forEach(row => {
      const id = row.id || '';
      const d = row.data;
      if (id.indexOf('r_') === 0 && d && d.r) {
        const k = d.t + '|' + d.c;
        (groups[k] = groups[k] || []).push(d.r);
      } else if (id.indexOf('c_') === 0 && d && typeof d.v === 'number') {
        counters[d.t] = d.v;
      } else if (id.indexOf('gm_') === 0) {
        legacy[id] = d;
      }
    });

    if (typeof DB !== 'undefined') {
      DB.applyRemote(groups, counters, legacy);
      // Serverda yo'q, faqat shu qurilmada bor yozuvlarni yuboramiz.
      // Bu birinchi ishga tushirishda eski ma'lumotni ko'chiradi va
      // yuborilmay qolgan har qanday yozuvni tiklaydi.
      DB.pushMissing(groups);
    }
    this._status(true);
    this.flush();
    return true;
  },

  // ─── Holat ko'rsatkichi ──────────────────────────────────────────────────
  _status(ok) {
    const n = this._load().length;
    let el = document.getElementById('gmSyncBadge');
    if (!el) {
      el = document.createElement('div');
      el.id = 'gmSyncBadge';
      el.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:9999;' +
        'padding:8px 14px;border-radius:9px;font-size:12px;font-weight:700;' +
        'font-family:Segoe UI,sans-serif;cursor:pointer;display:none;' +
        'box-shadow:0 4px 14px rgba(0,0,0,.4)';
      el.onclick = () => this.flush();
      document.body.appendChild(el);
    }
    if (!ok) {
      el.style.display = 'block';
      el.style.background = 'rgba(255,68,68,.16)';
      el.style.color = '#ff4444';
      el.style.border = '1px solid rgba(255,68,68,.45)';
      el.textContent = n ? ('⚠ Saqlanmadi: ' + n + ' ta — qayta urinish') : '⚠ Ulanish yo’q';
    } else if (n) {
      el.style.display = 'block';
      el.style.background = 'rgba(243,156,18,.16)';
      el.style.color = '#f39c12';
      el.style.border = '1px solid rgba(243,156,18,.45)';
      el.textContent = '↻ Yuborilmoqda: ' + n + ' ta';
    } else {
      el.style.display = 'none';
    }
  }
};

// Sahifa ochilganda va internet qaytganda navbatni yuborishga urinamiz
window.addEventListener('online', () => Cloud.flush());
window.addEventListener('load', () => Cloud.flush());
// Sahifa yopilishidan oldin navbatni albatta saqlab qolamiz
window.addEventListener('pagehide', () => Cloud._saveNow());
window.addEventListener('beforeunload', () => Cloud._saveNow());
