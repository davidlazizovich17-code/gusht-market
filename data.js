'use strict';

const DB = {
  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  },

  _key(type, key) { return `gm_${type}_${key}`; },

  get(type, key) {
    try { const r = localStorage.getItem(this._key(type, key)); return r ? JSON.parse(r) : null; }
    catch { return null; }
  },

  set(type, key, data) {
    const k = this._key(type, key);
    localStorage.setItem(k, JSON.stringify(data));
    if (typeof Cloud !== 'undefined') Cloud.push(k, data);
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
    return t;
  },

  getTypeName(type) { return this.TYPE_NAMES[type] || type; },

  // ─── Customers ────────────────────────────────────────────────────────────
  getCustomers(type) { return this.get(type, 'customers') || []; },
  saveCustomers(type, d) { this.set(type, 'customers', d); },

  addCustomer(type, name, phone, note) {
    const list = this.getCustomers(type);
    const c = { id: this.generateId(), name: name.trim(), phone: phone.trim(), note: (note||'').trim(), blocked: false, blockReason: '', blockDate: null, createdAt: new Date().toISOString() };
    list.push(c); this.saveCustomers(type, list); return c;
  },

  updateCustomer(type, id, name, phone, note) {
    const list = this.getCustomers(type);
    const c = list.find(x => x.id === id);
    if (c) { c.name = name.trim(); c.phone = phone.trim(); c.note = (note||'').trim(); this.saveCustomers(type, list); }
  },

  deleteCustomer(type, id) {
    this.saveCustomers(type, this.getCustomers(type).filter(c => c.id !== id));

  },

  blockCustomer(type, id, reason) {
    const list = this.getCustomers(type);
    const c = list.find(x => x.id === id);
    if (c) { c.blocked = true; c.blockReason = reason || ''; c.blockDate = new Date().toISOString(); this.saveCustomers(type, list); }
  },

  unblockCustomer(type, id) {
    const list = this.getCustomers(type);
    const c = list.find(x => x.id === id);
    if (c) { c.blocked = false; c.blockReason = ''; c.blockDate = null; this.saveCustomers(type, list); }
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
    if (!list) { list = this.DEFAULT_PRODUCTS.map(p => ({ ...p, id: this.generateId() })); this.set(type, 'products', list); }
    return list;
  },

  saveProducts(type, d) { this.set(type, 'products', d); },

  addProduct(type, name, price, icon) {
    const list = this.getProducts(type);
    const p = { id: this.generateId(), name: name.trim(), price: Number(price), icon: icon || 'fa-drumstick-bite' };
    list.push(p); this.saveProducts(type, list); return p;
  },

  updateProduct(type, id, name, price) {
    const list = this.getProducts(type);
    const p = list.find(x => x.id === id);
    if (p) { p.name = name.trim(); p.price = Number(price); this.saveProducts(type, list); }
  },

  deleteProduct(type, id) {
    this.saveProducts(type, this.getProducts(type).filter(p => p.id !== id));
  },

  // ─── Debts ────────────────────────────────────────────────────────────────
  getDebts(type) { return this.get(type, 'debts') || []; },
  saveDebts(type, d) { this.set(type, 'debts', d); },

  addDebt(type, { customerId, customerName, meatType, pricePerKg, kg, note }) {
    const list = this.getDebts(type);
    const num = (this.get(type, 'counter') || 0) + 1;
    this.set(type, 'counter', num);
    const total = Math.round(pricePerKg * kg);
    const d = { id: this.generateId(), num, customerId, customerName, meatType, pricePerKg: Number(pricePerKg), kg: Number(kg), total, paid: 0, remaining: total, note: note || '', status: 'unpaid', createdAt: new Date().toISOString() };
    list.push(d); this.saveDebts(type, list); return d;
  },

  deleteDebt(type, id) {
    this.saveDebts(type, this.getDebts(type).filter(d => d.id !== id));
  },

  writeOffCustomerDebt(type, customerId, amount) {
    let debts = this.getDebts(type);
    const active = debts
      .filter(d => d.customerId === customerId && d.remaining > 0)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    let left = Math.max(0, Number(amount));
    for (const debt of active) {
      if (left <= 0) break;
      const cut = Math.min(left, debt.remaining);
      debt.remaining -= cut;
      debt.total = debt.paid + debt.remaining;
      left -= cut;
    }
    debts = debts.filter(d => d.remaining > 0 || d.customerId !== customerId);
    this.saveDebts(type, debts);
  },

  writeOffDebt(type, debtId, amount) {
    const debts = this.getDebts(type);
    const debt = debts.find(d => d.id === debtId);
    if (!debt) return 0;
    const writeOff = Math.min(Math.max(0, Number(amount)), debt.remaining);
    if (writeOff <= 0) return 0;
    debt.remaining -= writeOff;
    debt.total = debt.paid + debt.remaining;
    if (debt.remaining <= 0) {
      this.saveDebts(type, debts.filter(d => d.id !== debtId));
    } else {
      this.saveDebts(type, debts);
    }
    return writeOff;
  },

  deleteCustomerWithDebts(type, customerId) {
    this.saveCustomers(type, this.getCustomers(type).filter(c => c.id !== customerId));
    this.saveDebts(type, this.getDebts(type).filter(d => d.customerId !== customerId));
    this.savePayments(type, this.getPayments(type).filter(p => p.customerId !== customerId));
  },

  // ─── Payments ─────────────────────────────────────────────────────────────
  getPayments(type) { return this.get(type, 'payments') || []; },
  savePayments(type, d) { this.set(type, 'payments', d); },

  addPayment(type, debtId, amount) {
    const debts = this.getDebts(type);
    const debt = debts.find(d => d.id === debtId);
    if (!debt || debt.remaining <= 0) return null;
    const actual = Math.min(Number(amount), debt.remaining);
    debt.paid += actual; debt.remaining -= actual;
    const payments = this.getPayments(type);
    const p = { id: this.generateId(), debtId, customerId: debt.customerId, customerName: debt.customerName, amount: actual, debtNum: debt.num, createdAt: new Date().toISOString() };
    payments.push(p);
    if (debt.remaining <= 0) {
      // Qarz to'liq uzildi — barcha tarix o'chiriladi
      this.saveDebts(type, debts.filter(d => d.id !== debtId));
      this.savePayments(type, payments.filter(pay => pay.debtId !== debtId));
    } else {
      this.saveDebts(type, debts);
      this.savePayments(type, payments);
    }
    return p;
  },

  // ─── Computed ─────────────────────────────────────────────────────────────
  isOverdue(dateStr) {
    return (Date.now() - new Date(dateStr).getTime()) > 60 * 24 * 60 * 60 * 1000;
  },

  debtStatus(debt) {
    if (debt.status === 'paid') return 'paid';
    if (this.isOverdue(debt.createdAt)) return 'overdue';
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
      overdueCount: active.filter(d => this.isOverdue(d.createdAt)).length,
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
      data[t] = {
        customers: this.getCustomers(t),
        debts:     this.getDebts(t),
        payments:  this.getPayments(t),
        products:  this.getProducts(t),
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
      if (data[t].counter)   this.set(t, 'counter', data[t].counter);
    });
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
