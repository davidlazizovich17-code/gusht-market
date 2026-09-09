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
  _key: 'sb_publishable_IXsZC_7OdHAq08BtPTrjJw_wGvpF96z',

  QUEUE_KEY: 'gm_sync_queue',
  BATCH: 200,
  PAGE: 1000,

  _pending: null,
  _busy: false,
  _fails: 0,
  _timer: null,

  _h(extra) {
    const h = {
      'apikey': this._key,
      'Authorization': 'Bearer ' + this._key,
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

  _save() {
    try { localStorage.setItem(this.QUEUE_KEY, JSON.stringify(this._pending || [])); }
    catch (e) { /* joy yetmasa ham ishlashda davom etamiz */ }
  },

  _enqueue(id, data) {
    const q = this._load();
    // Bir xil yozuv navbatda bo'lsa, eskisini yangisi bilan almashtiramiz
    const i = q.findIndex(x => x.id === id);
    if (i >= 0) q[i] = { id, data }; else q.push({ id, data });
    this._save();
    this._later();
  },

  pushRecord(type, coll, rec) {
    if (!rec || !rec.id) return;
    this._enqueue(this.rowId(type, coll, rec.id), { t: type, c: coll, r: rec });
  },

  pushCounter(type, value) {
    this._enqueue('c_' + type, { t: type, c: 'counter', v: value });
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
    try {
      const res = await fetch(this._url + '/rest/v1/store', {
        method: 'POST',
        headers: this._h({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify(batch.map(x => ({ id: x.id, data: x.data })))
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);

      // Faqat yuborilganlarini navbatdan olib tashlaymiz
      const sent = {};
      batch.forEach(x => { sent[x.id] = true; });
      this._pending = this._load().filter(x => !sent[x.id]);
      this._save();
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
