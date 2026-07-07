'use strict';

const TG = {
  TOKEN: '8602981625:AAE0Q0BBMhFaL3ZpgFHXqJy8uGOlKVav2NQ',
  CHAT_ID: '1409197672',
  API: 'https://api.telegram.org/bot',
  _lastId: 0,
  _polling: null,

  async send(text) {
    try {
      const res = await fetch(`${this.API}${this.TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: this.CHAT_ID, text, parse_mode: 'HTML' })
      });
      return await res.json();
    } catch (e) { console.warn('TG send error:', e.message); }
  },

  // ─── Bildirishnomalar ────────────────────────────────────────────────────
  notifyDebt(typeName, customerName, meatType, kg, total) {
    const meatLine = meatType ? `\n🥩 Go'sht: ${meatType} — ${kg} kg` : '';
    this.send(
`🔴 <b>Yangi qarz yozildi</b>
📂 Tizim: <b>${typeName}</b>
👤 Mijoz: ${customerName}${meatLine}
💰 Summa: <b>${Number(total).toLocaleString('uz-UZ')} so'm</b>
🕐 ${new Date().toLocaleTimeString('uz-UZ')}`
    );
  },

  notifyPayment(typeName, customerName, amount) {
    this.send(
`✅ <b>To'lov qabul qilindi</b>
📂 Tizim: <b>${typeName}</b>
👤 Mijoz: ${customerName}
💵 Miqdor: <b>${Number(amount).toLocaleString('uz-UZ')} so'm</b>
🕐 ${new Date().toLocaleTimeString('uz-UZ')}`
    );
  },

  notifyBlock(typeName, customerName, reason) {
    this.send(
`🚫 <b>Mijoz bloklandi</b>
📂 Tizim: <b>${typeName}</b>
👤 Mijoz: ${customerName}
📝 Sabab: ${reason || "Ko'rsatilmagan"}
🕐 ${new Date().toLocaleTimeString('uz-UZ')}`
    );
  },

  notifyUnblock(typeName, customerName) {
    this.send(
`🔓 <b>Mijoz blokdan chiqarildi</b>
📂 Tizim: <b>${typeName}</b>
👤 Mijoz: ${customerName}
🕐 ${new Date().toLocaleTimeString('uz-UZ')}`
    );
  },

  // ─── Bot buyruqlari ──────────────────────────────────────────────────────
  async handleMessage(msg) {
    if (!msg || !msg.text) return;
    if (String(msg.chat.id) !== this.CHAT_ID) return;
    const cmd = msg.text.split(' ')[0].toLowerCase();

    const TYPES = { postoyanniy: 'Постоянный', optom: 'Оптомний', klient: 'Клиент' };

    if (cmd === '/start' || cmd === '/help') {
      await this.send(
`🥩 <b>Go'sht Market Bot</b>

Salom! Qarz daftar boshqaruv boti.

📊 <b>Ko'rish buyruqlari:</b>
/stats — Umumiy statistika
/bugun — Bugungi hisobot
/qarzdorlar — Top qarzdorlar
/mijozlar — Mijozlar soni
/postoyanniy — Постоянный statistika
/optom — Оптомний statistika
/klient — Клиент statistika

➕ <b>Mijoz qo'shish:</b>
<code>/addmijoz post Ism Familiya +998901234567</code>
<code>/addmijoz opt Ism Familiya +998901234567</code>
<code>/addmijoz klient Ism Familiya +998901234567</code>`
      );
    }
    else if (cmd === '/stats') {
      let totalDebt = 0, totalCust = 0;
      const lines = ['postoyanniy', 'optom', 'klient'].map(t => {
        const s = DB.getStats(t);
        totalDebt += s.totalDebt;
        totalCust += s.totalCustomers;
        return `📂 <b>${TYPES[t]}</b>\n   👥 ${s.totalCustomers} mijoz | 🔴 ${s.overdueCount} muddati o'tgan\n   💰 ${Number(s.totalDebt).toLocaleString('uz-UZ')} so'm qarz`;
      });
      await this.send(
`📊 <b>Umumiy statistika</b>

${lines.join('\n\n')}

━━━━━━━━━━━━━━
👥 Jami: <b>${totalCust} mijoz</b>
💰 Jami qarz: <b>${Number(totalDebt).toLocaleString('uz-UZ')} so'm</b>
📅 ${new Date().toLocaleDateString('uz-UZ')}`
      );
    }
    else if (cmd === '/bugun') {
      const today = new Date().toDateString();
      let lines = ['postoyanniy', 'optom', 'klient'].map(t => {
        const debts = DB.getDebts(t).filter(d => new Date(d.createdAt).toDateString() === today);
        const payments = DB.getPayments(t).filter(p => new Date(p.createdAt).toDateString() === today);
        const debtSum = debts.reduce((s, d) => s + d.total, 0);
        const paySum = payments.reduce((s, p) => s + p.amount, 0);
        return `📂 <b>${TYPES[t]}</b>: ${debts.length} qarz (${Number(debtSum).toLocaleString('uz-UZ')} so'm), ${payments.length} to'lov (${Number(paySum).toLocaleString('uz-UZ')} so'm)`;
      });
      await this.send(
`📅 <b>Bugungi hisobot — ${new Date().toLocaleDateString('uz-UZ')}</b>

${lines.join('\n')}`
      );
    }
    else if (cmd === '/qarzdorlar') {
      let all = [];
      ['postoyanniy', 'optom', 'klient'].forEach(t => {
        DB.getCustomers(t).filter(c => !c.blocked).forEach(c => {
          const debt = DB.getCustomerDebt(t, c.id);
          if (debt > 0) all.push({ name: c.name, phone: c.phone, debt, type: TYPES[t] });
        });
      });
      all.sort((a, b) => b.debt - a.debt);
      const top = all.slice(0, 10);
      if (!top.length) { await this.send('✅ Hozircha qarzdorlar yo\'q!'); return; }
      const lines = top.map((c, i) => `${i + 1}. <b>${c.name}</b> (${c.type})\n   ${c.phone} — ${Number(c.debt).toLocaleString('uz-UZ')} so'm`);
      await this.send(`🏆 <b>Top qarzdorlar</b>\n\n${lines.join('\n\n')}`);
    }
    else if (cmd === '/postoyanniy') await this._sendTypeStats('postoyanniy');
    else if (cmd === '/optom') await this._sendTypeStats('optom');
    else if (cmd === '/klient') await this._sendTypeStats('klient');
    else if (cmd === '/addmijoz') await this._addMijoz(msg.text);
    else if (cmd === '/mijozlar') await this._sendAllCustomers();
    else {
      await this.send(`❓ Noma'lum buyruq. /help ni yozing.`);
    }
  },

  async _addMijoz(text) {
    // Format: /addmijoz [type] [name] [phone]
    // Types: post/postoyanniy, opt/optom, k/klient
    const parts = text.trim().split(/\s+/);
    if (parts.length < 4) {
      await this.send(
`❌ <b>Noto'g'ri format</b>

To'g'ri format:
<code>/addmijoz [tizim] [ism] [telefon]</code>

Tizimlar:
• <code>post</code> — Постоянный
• <code>opt</code> — Оптомний
• <code>klient</code> — Клиент

Misol:
<code>/addmijoz post Karimov Sardor +998901234567</code>`
      );
      return;
    }

    const typeAlias = parts[1].toLowerCase();
    const typeMap = {
      post: 'postoyanniy', postoyanniy: 'postoyanniy',
      opt: 'optom', optom: 'optom',
      k: 'klient', klient: 'klient'
    };
    const type = typeMap[typeAlias];
    if (!type) {
      await this.send(`❌ Noto'g'ri tizim: <b>${parts[1]}</b>\npost | opt | klient dan birini yozing.`);
      return;
    }

    const phone = parts[parts.length - 1];
    const name = parts.slice(2, parts.length - 1).join(' ');

    if (!name) { await this.send(`❌ Ism kiriting!`); return; }
    if (!phone) { await this.send(`❌ Telefon kiriting!`); return; }

    const existing = DB.getCustomers(type).find(c =>
      c.phone.replace(/\s/g,'') === phone.replace(/\s/g,'')
    );
    if (existing) {
      await this.send(`⚠️ Bu telefon raqam allaqachon mavjud:\n<b>${existing.name}</b> — ${existing.phone}`);
      return;
    }

    const c = DB.addCustomer(type, name, phone, '');
    const TYPES = { postoyanniy: 'Постоянный', optom: 'Оптомний', klient: 'Клиент' };
    await this.send(
`✅ <b>Mijoz qo'shildi!</b>

📂 Tizim: <b>${TYPES[type]}</b>
👤 Ism: ${c.name}
📞 Telefon: ${c.phone}
🕐 ${new Date().toLocaleString('uz-UZ')}`
    );
  },

  async _sendAllCustomers() {
    const TYPES = { postoyanniy: 'Постоянный', optom: 'Оптомний', klient: 'Клиент' };
    let msg = `👥 <b>Barcha mijozlar</b>\n\n`;
    ['postoyanniy', 'optom', 'klient'].forEach(t => {
      const list = DB.getCustomers(t).filter(c => !c.blocked);
      msg += `📂 <b>${TYPES[t]}</b>: ${list.length} ta\n`;
    });
    await this.send(msg);
  },

  async _sendTypeStats(type) {
    const TYPES = { postoyanniy: 'Постоянный клиентлар', optom: 'Оптомний клиентлар', klient: 'Клиент' };
    const s = DB.getStats(type);
    const debts = DB.getDebts(type);
    const today = new Date().toDateString();
    const todayDebts = debts.filter(d => new Date(d.createdAt).toDateString() === today);
    await this.send(
`📂 <b>${TYPES[type]}</b>

👥 Mijozlar: ${s.totalCustomers}
🚫 Bloklangan: ${s.blockedCount}
💰 Umumiy qarz: ${Number(s.totalDebt).toLocaleString('uz-UZ')} so'm
⏰ Muddati o'tgan: ${s.overdueCount} ta
✅ Bugungi to'lovlar: ${Number(s.todayPaymentTotal).toLocaleString('uz-UZ')} so'm
📝 Bugun yozilgan: ${todayDebts.length} ta qarz`
    );
  },

  // ─── Polling ─────────────────────────────────────────────────────────────
  async _poll() {
    try {
      const res = await fetch(`${this.API}${this.TOKEN}/getUpdates?offset=${this._lastId + 1}&timeout=10&allowed_updates=["message"]`);
      const data = await res.json();
      if (data.ok && data.result.length) {
        for (const upd of data.result) {
          this._lastId = upd.update_id;
          if (upd.message) await this.handleMessage(upd.message);
        }
      }
    } catch (e) { /* silent */ }
  },

  // ─── PDF yuborish ────────────────────────────────────────────────────────
  async sendDocument(blob, filename, caption) {
    try {
      const fd = new FormData();
      fd.append('chat_id', this.CHAT_ID);
      fd.append('document', blob, filename);
      if (caption) fd.append('caption', caption);
      const res = await fetch(`${this.API}${this.TOKEN}/sendDocument`, { method: 'POST', body: fd });
      return await res.json();
    } catch (e) { console.warn('TG sendDocument:', e.message); }
  },

  startPolling() {
    if (this._polling) return;
    this._poll();
    this._polling = setInterval(() => this._poll(), 4000);
  },

  stopPolling() {
    if (this._polling) { clearInterval(this._polling); this._polling = null; }
  }
};
