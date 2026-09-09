'use strict';

const DB = {
  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  },

  _key(type, key) { return `gm_${type}_${key}`; },

  // Har o'qishda localStorage'ni JSON.parse qilmaslik uchun xotira keshi.
  // Barcha yozuvlar set() dan o'tgani uchun kesh doim yangi bo'lib qoladi;
  // localStorage tashqaridan o'zgarsa (Cloud.pull) clearCache() chaqiriladi.
  _cache: {},
  _payIdx: {},

  get(type, key) {
    const k = this._key(type, key);
    if (k in this._cache) return this._cache[k];
    let val = null;
    try { const r = localStorage.getItem(k); val = r ? JSON.parse(r) : null; }
    catch { val = null; }
    this._cache[k] = val;
    return val;
  },

  // Faqat shu qurilma xotirasiga yozadi. Bulutga yuborish _touch() orqali,
  // har bir yozuv alohida — butun ro'yxat hech qachon almashtirilmaydi.
  set(type, key, data) {
    const k = this._key(type, key);
    this._cache[k] = data;
    this._payIdx = {};
    try { localStorage.setItem(k, JSON.stringify(data)); } catch (e) {}
  },

  clearCache() { this._cache = {}; this._payIdx = {}; },

  _list(type, coll) { return this.get(type, coll) || []; },
  _alive(list) { return list.filter(x => x && !x._del); },

  // Yozuvni "o'zgardi" deb belgilab, bulutga navbatga qo'yadi
  _touch(type, coll, rec) {
    if (!rec) return rec;
    rec._ts = Date.now();
    if (typeof Cloud !== 'undefined') Cloud.pushRecord(type, coll, rec);
    return rec;
  },

  // Yozuvni o'chirmaymiz — belgilaymiz. Shu sababli eski nusxa yangisining
  // ustiga tushsa ham hech narsa yo'qolmaydi.
  _kill(type, coll, rec) {
    if (!rec) return;
    rec._del = true;
    this._touch(type, coll, rec);
  },

  COLLS: ['customers', 'debts', 'payments', 'history', 'products'],

  // Serverdan kelgan yozuvlarni mahalliy ro'yxat bilan BIRLASHTIRADI.
  // Ustiga yozmaydi: ikkala tomonda bor yozuvdan yangirog'i (_ts) olinadi,
  // faqat bir tomonda borlari esa shunchaki qo'shiladi. Shu sababli eski
  // nusxa yangi qarzni o'chira olmaydi.
  applyRemote(groups, counters, legacy) {
    groups = groups || {}; counters = counters || {}; legacy = legacy || {};
    this.TYPES.forEach(type => {
      this.COLLS.forEach(coll => {
        const local = this._list(type, coll);
        const byId = {};
        local.forEach(r => { if (r && r.id) byId[r.id] = r; });

        // Eski (butun ro'yxatli) qatorlar — yangi qurilma uchun va o'tish davri
        const leg = legacy[this._key(type, coll)];
        if (Array.isArray(leg)) {
          leg.forEach(r => { if (r && r.id && !byId[r.id]) byId[r.id] = r; });
        }

        const remote = groups[type + '|' + coll] || [];
        remote.forEach(r => {
          if (!r || !r.id) return;
          const cur = byId[r.id];
          if (!cur || (r._ts || 0) > (cur._ts || 0)) byId[r.id] = r;
        });

        const merged = Object.keys(byId).map(k => byId[k]);
        if (!merged.length && !local.length) return;
        merged.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
        this.set(type, coll, merged);
      });

      // Hisoblagich hech qachon orqaga ketmasin — aks holda qarz raqamlari
      // qayta ishlatilib, eski qarz ustiga yozilib ketardi
      const lc = Number(this.get(type, 'counter') || 0);
      const gc = Number(legacy[this._key(type, 'counter')] || 0);
      const rc = Number(counters[type] || 0);
      const mx = Math.max(lc, gc, rc);
      if (mx !== lc) this.set(type, 'counter', mx);
    });
    this._payIdx = {};
  },

  // Serverda yo'q yoki eskirgan yozuvlarni yuborish navbatiga qo'yadi.
  // Birinchi ishga tushirishda eski ma'lumotni ko'chiradi, keyinchalik esa
  // yuborilmay qolgan har qanday yozuvni tiklaydi.
  pushMissing(groups) {
    if (typeof Cloud === 'undefined') return;
    groups = groups || {};
    this.TYPES.forEach(type => {
      this.COLLS.forEach(coll => {
        const remote = {};
        (groups[type + '|' + coll] || []).forEach(r => { if (r && r.id) remote[r.id] = r; });
        this._list(type, coll).forEach(r => {
          if (!r || !r.id) return;
          const rem = remote[r.id];
          if (!rem || (r._ts || 0) > (rem._ts || 0)) Cloud.pushRecord(type, coll, r);
        });
      });
      const c = Number(this.get(type, 'counter') || 0);
      if (c) Cloud.pushCounter(type);
    });
  },

  // ─── Auth ─────────────────────────────────────────────────────────────
  checkLogin() {
    if (!sessionStorage.getItem('gm_auth')) { location.href = 'login.html'; return false; }
    return true;
  },

  _h(s) { return s.split('').reduce((a,c)=>((a<<5)-a+c.charCodeAt(0))|0,0).toString(16); },
  login(user, pass) {
    if (this._h(user) === this._h('gushtmarket') && this._h(pass) === this._h('937221940')) {
      sessionStorage.setItem('gm_auth', '1');
      return true;
    }
    return false;
  },

  logout() { sessionStorage.removeItem('gm_auth'); location.href = 'login.html'; },

  // ─── Type ─────────────────────────────────────────────────────────────────
  TYPES: ['postoyanniy', 'optom', 'klient'],
  TYPE_NAMES: {
    postoyanniy: 'Постоянный клиентлар',
    optom: 'Оптомний клиентлар',
    klient: 'Клиент'
  },
  TYPE_ICONS: {
    postoyanniy: 'fa-star',
    optom: 'fa-boxes-stacked',
    klient: 'fa-user'
  },

  getType() {
    const t = new URLSearchParams(location.search).get('type');
    if (!t || !this.TYPES.includes(t)) { location.href = 'select.html'; return null; }
    this._currentType = t;
    return t;
  },

  getTypeName(type) { return this.TYPE_NAMES[type] || type; },

  // ─── Customers ────────────────────────────────────────────────────────────
  getCustomers(type) { return this._alive(this._list(type, 'customers')); },
  saveCustomers(type, d) { this.set(type, 'customers', d); },

  addCustomer(type, name, phone, note) {
    const list = this._list(type, 'customers');
    const c = { id: this.generateId(), name: name.trim(), phone: phone.trim(), note: (note||'').trim(), blocked: false, blockReason: '', blockDate: null, createdAt: new Date().toISOString() };
    this._touch(type, 'customers', c);
    list.push(c); this.saveCustomers(type, list); return c;
  },

  updateCustomer(type, id, name, phone, note) {
    const list = this._list(type, 'customers');
    const c = list.find(x => x.id === id);
    if (c) { c.name = name.trim(); c.phone = phone.trim(); c.note = (note||'').trim(); this._touch(type, 'customers', c); this.saveCustomers(type, list); }
  },

  deleteCustomer(type, id) {
    const list = this._list(type, 'customers');
    const c = list.find(x => x.id === id);
    if (c) { this._kill(type, 'customers', c); this.saveCustomers(type, list); }
  },

  blockCustomer(type, id, reason) {
    const list = this._list(type, 'customers');
    const c = list.find(x => x.id === id);
    if (c) { c.blocked = true; c.blockReason = reason || ''; c.blockDate = new Date().toISOString(); this._touch(type, 'customers', c); this.saveCustomers(type, list); }
  },

  unblockCustomer(type, id) {
    const list = this._list(type, 'customers');
    const c = list.find(x => x.id === id);
    if (c) { c.blocked = false; c.blockReason = ''; c.blockDate = null; this._touch(type, 'customers', c); this.saveCustomers(type, list); }
  },

  // ─── Products ─────────────────────────────────────────────────────────────
  DEFAULT_PRODUCTS: [
    { name: "Mol go'shti", price: 30000, icon: 'fa-cow' },
    { name: "Qo'y go'shti", price: 40000, icon: 'fa-horse' },
    { name: 'Tovuq', price: 15000, icon: 'fa-feather' },
    { name: "Sigir go'shti", price: 45000, icon: 'fa-cow' },
    { name: "Qovurg'a", price: 35000, icon: 'fa-bone' },
    { name: 'Ichak-chavaq', price: 12000, icon: 'fa-heart-pulse' },
  ],

  getProducts(type) {
    let list = this.get(type, 'products');
    if (!list) {
      list = this.DEFAULT_PRODUCTS.map(p => ({ ...p, id: this.generateId() }));
      list.forEach(p => this._touch(type, 'products', p));
      this.set(type, 'products', list);
    }
    return this._alive(list);
  },

  saveProducts(type, d) { this.set(type, 'products', d); },

  addProduct(type, name, price, icon) {
    const list = this._list(type, 'products');
    const p = { id: this.generateId(), name: name.trim(), price: Number(price), icon: icon || 'fa-drumstick-bite' };
    this._touch(type, 'products', p);
    list.push(p); this.saveProducts(type, list); return p;
  },

  updateProduct(type, id, name, price) {
    const list = this._list(type, 'products');
    const p = list.find(x => x.id === id);
    if (p) { p.name = name.trim(); p.price = Number(price); this._touch(type, 'products', p); this.saveProducts(type, list); }
  },

  deleteProduct(type, id) {
    const list = this._list(type, 'products');
    const p = list.find(x => x.id === id);
    if (p) { this._kill(type, 'products', p); this.saveProducts(type, list); }
  },

  // ─── Debts ────────────────────────────────────────────────────────────────
  // Ko'rinadigan qarzlar: o'chirilmagan va to'lanmagan.
  // To'langan qarz endi ro'yxatdan O'CHIRILMAYDI, faqat 'paid' deb belgilanadi —
  // shu sababli sinxronizatsiyada uni "yo'q qilingan" deb tushunish mumkin emas.
  getDebts(type) {
    return this._list(type, 'debts').filter(d => d && !d._del && d.status !== 'paid');
  },
  saveDebts(type, d) { this.set(type, 'debts', d); },

  addDebt(type, { customerId, customerName, meatType, pricePerKg, kg, note }) {
    this.getHistory(type); // migratsiya yangi yozuvdan OLDIN bajarilsin
    const list = this._list(type, 'debts');
    const num = (this.get(type, 'counter') || 0) + 1;
    this.set(type, 'counter', num);
    if (typeof Cloud !== 'undefined') Cloud.pushCounter(type);
    const total = Math.round(pricePerKg * kg);
    const d = { id: this.generateId(), num, customerId, customerName, meatType, pricePerKg: Number(pricePerKg), kg: Number(kg), total, paid: 0, remaining: total, note: note || '', status: 'unpaid', createdAt: new Date().toISOString() };
    this._touch(type, 'debts', d);
    list.push(d); this.saveDebts(type, list);
    this.logHistory(type, { customerId, customerName, kind: 'debt', amount: total, note, debtNum: num });
    return d;
  },

  deleteDebt(type, id) {
    const list = this._list(type, 'debts');
    const d = list.find(x => x.id === id);
    if (d) { this._kill(type, 'debts', d); this.saveDebts(type, list); }
  },

  writeOffCustomerDebt(type, customerId, amount) {
    this.getHistory(type); // migratsiya o'zgarishdan OLDIN bajarilsin
    const debts = this._list(type, 'debts');
    const active = debts
      .filter(d => !d._del && d.status !== 'paid' && d.customerId === customerId && d.remaining > 0)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    let left = Math.max(0, Number(amount));
    for (const debt of active) {
      if (left <= 0) break;
      const cut = Math.min(left, debt.remaining);
      debt.remaining -= cut;
      debt.total = debt.paid + debt.remaining;
      if (debt.remaining <= 0) debt.status = 'paid';
      this._touch(type, 'debts', debt);
      left -= cut;
    }
    this.saveDebts(type, debts);
  },

  writeOffDebt(type, debtId, amount) {
    this.getHistory(type); // migratsiya o'zgarishdan OLDIN bajarilsin
    const debts = this._list(type, 'debts');
    const debt = debts.find(d => d.id === debtId && !d._del);
    if (!debt) return 0;
    const writeOff = Math.min(Math.max(0, Number(amount)), debt.remaining);
    if (writeOff <= 0) return 0;
    debt.remaining -= writeOff;
    debt.total = debt.paid + debt.remaining;
    if (debt.remaining <= 0) debt.status = 'paid';
    this._touch(type, 'debts', debt);
    this.saveDebts(type, debts);
    return writeOff;
  },

  deleteCustomerWithDebts(type, customerId) {
    const custs = this._list(type, 'customers');
    const c = custs.find(x => x.id === customerId);
    if (c) this._kill(type, 'customers', c);
    this.saveCustomers(type, custs);

    const debts = this._list(type, 'debts');
    debts.forEach(d => { if (d.customerId === customerId && !d._del) this._kill(type, 'debts', d); });
    this.saveDebts(type, debts);

    const pays = this._list(type, 'payments');
    pays.forEach(p => { if (p.customerId === customerId && !p._del) this._kill(type, 'payments', p); });
    this.savePayments(type, pays);
  },

  // ─── Payments ─────────────────────────────────────────────────────────────
  getPayments(type) { return this._alive(this._list(type, 'payments')); },
  savePayments(type, d) { this.set(type, 'payments', d); },

  addPayment(type, debtId, amount) {
    this.getHistory(type); // migratsiya yangi yozuvdan OLDIN bajarilsin
    const debts = this._list(type, 'debts');
    const debt = debts.find(d => d.id === debtId && !d._del);
    if (!debt || debt.remaining <= 0) return null;
    const actual = Math.min(Number(amount), debt.remaining);
    debt.paid += actual; debt.remaining -= actual;
    if (debt.remaining <= 0) debt.status = 'paid';
    this._touch(type, 'debts', debt);
    const payments = this._list(type, 'payments');
    const p = { id: this.generateId(), debtId, customerId: debt.customerId, customerName: debt.customerName, amount: actual, debtNum: debt.num, createdAt: new Date().toISOString() };
    this._touch(type, 'payments', p);
    payments.push(p);
    this.logHistory(type, { customerId: debt.customerId, customerName: debt.customerName, kind: 'payment', amount: actual, debtNum: debt.num });
    this.saveDebts(type, debts);
    this.savePayments(type, payments);
    return p;
  },

  // Qarz kamaytirilganda to'lov yozuvini qo'shadi (ilgari bu customers.html
  // ichida qo'lda qilinardi — u yerda o'chirilgan yozuvlar yo'qolib ketardi)
  addWriteOffPayment(type, customerId, customerName, amount) {
    const payments = this._list(type, 'payments');
    const p = { id: this.generateId(), debtId: null, customerId, customerName: customerName || '', amount: Number(amount), debtNum: null, createdAt: new Date().toISOString() };
    this._touch(type, 'payments', p);
    payments.push(p);
    this.savePayments(type, payments);
    return p;
  },

  // ─── History (o'chirilmas pul tarixi) ─────────────────────────────────────
  // Har bir mijoz uchun berilgan qarz va olingan to'lovlarning to'liq tarixi.
  // Qarz yoki mijoz o'chirilsa ham tarix qoladi — faqat clearCustomerHistory
  // orqali qo'lda o'chiriladi.
  getHistory(type) {
    let list = this.get(type, 'history');
    if (!list) {
      // Birinchi ishga tushirishda mavjud qarz/to'lovlardan tarixni tiklaymiz
      list = [
        ...this.getDebts(type).map(d => ({ id: this.generateId(), customerId: d.customerId, customerName: d.customerName, kind: 'debt', amount: d.total, note: d.note || '', debtNum: d.num, createdAt: d.createdAt })),
        ...this.getPayments(type).map(p => ({ id: this.generateId(), customerId: p.customerId, customerName: p.customerName, kind: 'payment', amount: p.amount, note: '', debtNum: p.debtNum || null, createdAt: p.createdAt }))
      ].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      list.forEach(h => this._touch(type, 'history', h));
      this.set(type, 'history', list);
    }
    return this._alive(list);
  },

  saveHistory(type, d) { this.set(type, 'history', d); },

  logHistory(type, { customerId, customerName, kind, amount, note, debtNum }) {
    this.getHistory(type); // migratsiya bo'lsa avval bajarilsin
    const list = this._list(type, 'history');
    const h = {
      id: this.generateId(), customerId, customerName,
      kind, // 'debt' — pul berildi (qarz yozildi), 'payment' — pul olindi (to'lov)
      amount: Number(amount), note: (note || '').trim(), debtNum: debtNum || null,
      createdAt: new Date().toISOString()
    };
    this._touch(type, 'history', h);
    list.push(h);
    this.saveHistory(type, list);
  },

  getCustomerHistory(type, customerId) {
    return this.getHistory(type).filter(h => h.customerId === customerId);
  },

  clearCustomerHistory(type, customerId) {
    const list = this._list(type, 'history');
    list.forEach(h => { if (h.customerId === customerId && !h._del) this._kill(type, 'history', h); });
    this.saveHistory(type, list);
  },

  buildHistoryHTML(type, customerId, customerName) {
    const items = this.getCustomerHistory(type, customerId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const given    = items.filter(h => h.kind === 'debt').reduce((s, h) => s + h.amount, 0);
    const received = items.filter(h => h.kind === 'payment').reduce((s, h) => s + h.amount, 0);

    const totals = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
        <div style="background:var(--bg3);border-radius:10px;padding:12px 14px">
          <div style="font-size:11px;color:var(--text2);letter-spacing:1px">BERILGAN (QARZ)</div>
          <div style="font-size:17px;font-weight:700;color:var(--red-light)">${this.fmt(given)} so'm</div>
        </div>
        <div style="background:var(--bg3);border-radius:10px;padding:12px 14px">
          <div style="font-size:11px;color:var(--text2);letter-spacing:1px">OLINGAN (TO'LOV)</div>
          <div style="font-size:17px;font-weight:700;color:var(--green)">${this.fmt(received)} so'm</div>
        </div>
      </div>`;

    if (!items.length) {
      return `<div style="margin-bottom:10px;font-weight:700;font-size:15px">${customerName || ''}</div>
        ${totals}
        <div style="text-align:center;color:var(--text2);padding:24px"><i class="fa-solid fa-clock-rotate-left"></i> Tarix bo'sh</div>`;
    }

    const rows = items.map(h => {
      const isDebt = h.kind === 'debt';
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px">
        <div>
          <span style="color:${isDebt ? 'var(--red-light)' : 'var(--green)'};font-weight:600">
            <i class="fa-solid fa-arrow-${isDebt ? 'up' : 'down'}" style="font-size:10px"></i>
            ${isDebt ? 'Pul berildi (qarz)' : "Pul olindi (to'lov)"}
          </span>
          <span style="color:var(--text2);margin-left:8px">${this.fmtDate(h.createdAt)} • ${this.fmtTime(h.createdAt)}${h.debtNum ? ' • #' + h.debtNum : ''}</span>
          ${h.note ? `<div style="font-size:11px;color:var(--text2);margin-top:2px">${h.note}</div>` : ''}
        </div>
        <span style="font-weight:700;color:${isDebt ? 'var(--red-light)' : 'var(--green)'}">${isDebt ? '−' : '+'}${this.fmt(h.amount)} so'm</span>
      </div>`;
    }).join('');

    return `<div style="margin-bottom:10px;font-weight:700;font-size:15px">${customerName || ''}
        <span style="font-weight:400;font-size:12px;color:var(--text2)">(${items.length} ta yozuv)</span>
      </div>
      ${totals}
      <div style="border:1px solid var(--border);border-radius:10px;padding:6px 14px;max-height:320px;overflow-y:auto">${rows}</div>`;
  },

  // ─── Computed ─────────────────────────────────────────────────────────────
  isOverdue(dateStr) {
    return (Date.now() - new Date(dateStr).getTime()) > 60 * 24 * 60 * 60 * 1000;
  },

  // Mijoz bo'yicha oxirgi to'lov sanasi. Har qarz uchun to'lovlar ro'yxatini
  // to'liq aylanib chiqmaslik uchun bir marta indeks quriladi.
  lastPaymentDate(type, customerId) {
    let idx = this._payIdx[type];
    if (!idx) {
      idx = {};
      this.getPayments(type).forEach(p => {
        if (!idx[p.customerId] || p.createdAt > idx[p.customerId]) idx[p.customerId] = p.createdAt;
      });
      this._payIdx[type] = idx;
    }
    return idx[customerId] || null;
  },

  // Qarz "qizil" (2+ oy) bo'ladi: qarz yozilganiga 2 oydan oshgan VA mijoz
  // oxirgi 2 oy ichida umuman to'lov (minus) qilmagan bo'lsa. Qandaydir summa
  // to'langan bo'lsa — 2 oylik muddat qayta boshlanadi, qizilga tushmaydi.
  isDebtOverdue(debt, type) {
    const t = type || this._currentType;
    if (!this.isOverdue(debt.createdAt)) return false;
    const lastPay = t ? this.lastPaymentDate(t, debt.customerId) : null;
    return !(lastPay && !this.isOverdue(lastPay));
  },

  debtStatus(debt, type) {
    if (debt.status === 'paid') return 'paid';
    if (this.isDebtOverdue(debt, type)) return 'overdue';
    return 'unpaid';
  },

  getStats(type) {
    const customers = this.getCustomers(type);
    const debts = this.getDebts(type);
    const payments = this.getPayments(type);
    const today = new Date().toDateString();
    const active = debts.filter(d => d.status !== 'paid');
    return {
      totalCustomers: customers.filter(c => !c.blocked).length,
      totalDebt: active.reduce((s, d) => s + d.remaining, 0),
      todayPaymentTotal: payments.filter(p => new Date(p.createdAt).toDateString() === today).reduce((s, p) => s + p.amount, 0),
      overdueCount: active.filter(d => this.isDebtOverdue(d, type)).length,
      blockedCount: customers.filter(c => c.blocked).length
    };
  },

  getCustomerDebt(type, customerId) {
    return this.getDebts(type).filter(d => d.customerId === customerId && d.status !== 'paid').reduce((s, d) => s + d.remaining, 0);
  },

  // ─── Backup / Restore ─────────────────────────────────────────────────────
  exportAll() {
    const data = {};
    ['postoyanniy', 'optom', 'klient'].forEach(t => {
      // Xom ro'yxat olinadi — o'chirilgan va to'langanlari ham zaxiraga tushsin
      data[t] = {
        customers: this._list(t, 'customers'),
        debts:     this._list(t, 'debts'),
        payments:  this._list(t, 'payments'),
        products:  this._list(t, 'products'),
        history:   this._list(t, 'history'),
        counter:   this.get(t, 'counter') || 0
      };
    });
    data._exported = new Date().toISOString();
    data._version  = '1.0';
    return data;
  },

  importAll(data) {
    if (!data || !data._version) return false;
    ['postoyanniy', 'optom', 'klient'].forEach(t => {
      if (!data[t]) return;
      if (data[t].customers) this.saveCustomers(t, data[t].customers);
      if (data[t].debts)     this.saveDebts(t, data[t].debts);
      if (data[t].payments)  this.savePayments(t, data[t].payments);
      if (data[t].products)  this.saveProducts(t, data[t].products);
      if (data[t].history)   this.saveHistory(t, data[t].history);
      if (data[t].counter)   this.set(t, 'counter', data[t].counter);
    });
    // Tiklangan yozuvlarni bulutga ham yuboramiz
    this.pushMissing({});
    return true;
  },

  downloadBackup() {
    const data  = this.exportAll();
    const json  = JSON.stringify(data, null, 2);
    const blob  = new Blob([json], { type: 'application/json' });
    const url   = URL.createObjectURL(blob);
    const a     = document.createElement('a');
    const date  = new Date().toISOString().split('T')[0];
    a.download  = `gusht_market_backup_${date}.json`;
    a.href      = url;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    localStorage.setItem('gm_last_backup', new Date().toDateString());
  },

  shouldAutoBackup() {
    const last = localStorage.getItem('gm_last_backup');
    return last !== new Date().toDateString();
  },

  // ─── Format ───────────────────────────────────────────────────────────────
  fmt(num) { return Number(num).toLocaleString('uz-UZ'); },
  fmtDate(iso) { return new Date(iso).toLocaleDateString('uz-UZ'); },
  fmtTime(iso) { return new Date(iso).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' }); },

  // ─── UI ───────────────────────────────────────────────────────────────────
  statusBadge(status) {
    if (status === 'paid') return `<span class="badge badge-green"><i class="fa-solid fa-check"></i> To'langan</span>`;
    if (status === 'overdue') return `<span class="overdue-badge"><i class="fa-solid fa-clock"></i> 2+ oy</span>`;
    return `<span class="badge badge-yellow"><i class="fa-solid fa-hourglass-half"></i> To'lanmagan</span>`;
  },

  buildSidebar(type, active) {
    const t = `?type=${type}`;
    const navItems = [
      ['dashboard', 'fa-chart-bar', 'Dashboard', `dashboard.html${t}`],
      ['debts', 'fa-receipt', 'Qarzlar', `debts.html${t}`],
      ['customers', 'fa-users', 'Mijozlar', `customers.html${t}`],
    ];
    const reportItems = [
      ['today', 'fa-calendar-day', 'Bugungi', `today.html${t}`],
      ['blacklist', 'fa-ban', "Qora ro'yxat", `blacklist.html${t}`],
    ];
    const item = ([key, icon, label, href]) =>
      `<a href="${href}" class="nav-item${active === key ? ' active' : ''}"><i class="fa-solid ${icon} icon"></i> ${label}</a>`;

    const name = this.getTypeName(type);
    return `
      <div class="sidebar-logo">
        <div class="sidebar-logo-icon"><i class="fa-solid fa-drumstick-bite"></i></div>
        <h2>Go'sht Market</h2>
        <span class="sidebar-type-badge">${name}</span>
      </div>
      <nav class="sidebar-nav">
        <div class="nav-section">Asosiy</div>
        ${navItems.map(item).join('')}
        <div class="nav-section">Hisobot</div>
        ${reportItems.map(item).join('')}
      </nav>
      <div class="sidebar-footer">
        <a href="select.html" class="nav-item"><i class="fa-solid fa-layer-group icon"></i> Tizim tanlash</a>
        <a href="#" class="nav-item" onclick="DB.logout();return false"><i class="fa-solid fa-right-from-bracket icon"></i> Chiqish</a>
      </div>`;
  }
};

// Boshqa tabda ma'lumot o'zgarsa shu tabdagi kesh eskiradi. Tozalamasak, bu tab
// eski ro'yxatni ustiga yozib, u yerda kiritilgan qarzni o'chirib yuborardi.
window.addEventListener('storage', e => {
  if (!e.key || e.key.indexOf('gm_') === 0) DB.clearCache();
});
