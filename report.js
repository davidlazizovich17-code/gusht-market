'use strict';

// Kunlik umumiy qarz PDF hisoboti — Telegramga HAR KUNI FAQAT BIR MARTA,
// soat 20:00 dan keyin yuboriladi. Sahifa ochiq turishi kerak; agar 20:00 da
// yopiq bo'lsa, o'sha kuni sahifa ochilishi bilan yuboriladi.
const Report = {
  FLAG: 'gm_daily_pdf_sent',
  SEND_HOUR: 20,
  SEND_MINUTE: 0,
  _timer: null,

  TYPE_LIST: [
    { key: 'postoyanniy', label: 'Postoyanniy klientlar', cyr: 'Постоянные', lat: 'Postoyanniy' },
    { key: 'optom',       label: 'Optomiy klientlar',     cyr: 'Оптом',      lat: 'Optom'       },
    { key: 'klient',      label: 'Klient',                cyr: 'Клиент',     lat: 'Klient'      }
  ],

  // PDF dagi doimiy so'zlar. Kirill shrifti yuklansa CYR, bo'lmasa LAT.
  L_CYR: { tel: 'Тел.:', debt: 'долг', pay: 'оплата', total: 'ИТОГ', cur: 'сум', ttl: 'Барча қарзлар', page: 'бет' },
  L_LAT: { tel: 'Tel.:', debt: 'qarz', pay: "to'lov", total: 'JAMI', cur: "so'm", ttl: 'Barcha qarzlar', page: 'bet' },

  FONT_URL: 'https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/',
  _fonts: undefined,

  async _b64(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  },

  // Kirill harflari uchun shrift (oddiy va qalin). Yuklanmasa false qaytadi —
  // o'shanda lotin harflariga o'tamiz va hisobot baribir yuboriladi.
  // Bir marta yuklanadi, keyin xotirada qoladi.
  async _ensureFont(doc) {
    if (this._fonts === undefined) {
      try {
        const [reg, bold] = await Promise.all([
          this._b64(this.FONT_URL + 'DejaVuSans.ttf'),
          this._b64(this.FONT_URL + 'DejaVuSans-Bold.ttf').catch(() => null)
        ]);
        this._fonts = { reg, bold };
      } catch (e) {
        console.warn('Kirill shrifti yuklanmadi:', e.message);
        this._fonts = null;
      }
    }
    if (!this._fonts || !this._fonts.reg) return false;
    try {
      doc.addFileToVFS('DejaVuSans.ttf', this._fonts.reg);
      doc.addFont('DejaVuSans.ttf', 'DejaVu', 'normal');
      if (this._fonts.bold) {
        doc.addFileToVFS('DejaVuSans-Bold.ttf', this._fonts.bold);
        doc.addFont('DejaVuSans-Bold.ttf', 'DejaVu', 'bold');
      }
      return true;
    } catch (e) { return false; }
  },

  // Shrift yuklanmasa kirill/maxsus harflarni lotinga o'giramiz
  _CYR_MAP: { 'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'j','з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'x','ц':'ts','ч':'ch','ш':'sh','щ':'sh','ъ':"'",'ы':'i','ь':'','э':'e','ю':'yu','я':'ya','ў':"o'",'қ':'q','ғ':"g'",'ҳ':'h' },
  _lat(v) {
    return Array.from(String(v == null ? '' : v)).map(ch => {
      const lo = ch.toLowerCase();
      const m = this._CYR_MAP[lo];
      if (m !== undefined) return ch !== lo && m ? m.charAt(0).toUpperCase() + m.slice(1) : m;
      if (ch === '–' || ch === '—') return '-';
      if (ch === '‘' || ch === '’' || ch === 'ʻ' || ch === 'ʼ') return "'";
      if (ch === '№') return 'N';
      return ch.charCodeAt(0) > 255 ? '' : ch;
    }).join('');
  },

  _num(n) { return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); },

  _dmy(iso) {
    const d = new Date(iso), p = n => String(n).padStart(2, '0');
    return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + String(d.getFullYear()).slice(2);
  },

  // jsPDF hamma sahifada yuklanmagan — kerak bo'lsa dinamik yuklaymiz
  async _ensureLibs() {
    if (window.jspdf && window.jspdf.jsPDF) return true;
    const load = src => new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
    try {
      await load('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
      await load('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js');
      return !!(window.jspdf && window.jspdf.jsPDF);
    } catch (e) {
      console.warn('jsPDF yuklanmadi:', e.message);
      return false;
    }
  },

  // Barcha bazalar bo'yicha qarzdorlar PDF ini tayyorlab Telegramga yuboradi.
  // Ko'rinishi: har bir mijoz alohida karta, sahifada ikki ustun.
  // onStatus — ixtiyoriy callback (UI status matni uchun).
  // Natija: { ok, totalCount, totalSum, error }
  async buildAndSend(onStatus) {
    const status = msg => { if (onStatus) onStatus(msg); };

    if (!(await this._ensureLibs())) {
      return { ok: false, totalCount: 0, totalSum: 0, error: 'PDF kutubxonasi yuklanmadi' };
    }

    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

      status('Shrift tayyorlanmoqda...');
      const cyr = await this._ensureFont(doc);
      const F = cyr ? 'DejaVu' : 'helvetica';
      const L = cyr ? this.L_CYR : this.L_LAT;
      const T = cyr ? (v => String(v == null ? '' : v)) : (v => this._lat(v));

      status("Ma'lumotlar yig'ilmoqda...");

      // ── Mijozlarni yig'amiz ────────────────────────────────────────────
      const items = [];
      let totalSum = 0, debtCount = 0;
      this.TYPE_LIST.forEach(t => {
        const base = cyr ? t.cyr : t.lat;
        DB.getCustomers(t.key).filter(c => !c.blocked).forEach(c => {
          const debts = DB.getDebts(t.key)
            .filter(d => d.customerId === c.id && d.remaining > 0)
            .sort((x, y) => new Date(x.createdAt) - new Date(y.createdAt));
          if (!debts.length) return;
          const rows = [];
          let sum = 0;
          debts.forEach(d => {
            // Qarz to'liq summasi bilan, to'langani alohida minus qator bo'lib
            // chiqadi — shunda ITOG aynan hozirgi qarzga teng bo'ladi.
            rows.push({ date: d.createdAt, label: L.debt + ' №' + d.num, amount: Number(d.total) || 0, neg: false });
            if (Number(d.paid) > 0) rows.push({ date: d.createdAt, label: L.pay, amount: Number(d.paid), neg: true });
            sum += Number(d.remaining) || 0;
            debtCount++;
          });
          items.push({ name: T(c.name), phone: T(c.phone || '-'), base, rows, total: sum });
          totalSum += sum;
        });
      });

      items.sort((x, y) => x.name.localeCompare(y.name, 'uz'));

      // ── Sahifa o'lchamlari ─────────────────────────────────────────────
      const PW = 210, PH = 297, M = 8, GUT = 5;
      const colW = (PW - 2 * M - GUT) / 2;
      const colX = [M, M + colW + GUT];
      const TOP = 16, BOT = PH - 9;
      const HEAD = 11, ROW = 4.4, FOOT = 6.6, GAP = 4;
      const NAVY = [22, 54, 92], GREY = [92, 102, 116], DARK = [62, 62, 62], RED = [150, 40, 40];
      const BORDER = [186, 198, 212], HEADBG = [221, 229, 238], FOOTBG = [238, 242, 247];

      // Haqiqiy qalin shrift bo'lsa o'shani, bo'lmasa ikki marta chizib
      // qalin ko'rinish hosil qilamiz.
      const hasBold = !cyr || !!(this._fonts && this._fonts.bold);
      const bold = (str, x, y, size, color, align) => {
        doc.setFontSize(size);
        doc.setTextColor(color[0], color[1], color[2]);
        const o = { align: align || 'left' };
        if (hasBold) {
          doc.setFont(F, 'bold');
          doc.text(str, x, y, o);
        } else {
          doc.setFont(F, 'normal');
          doc.text(str, x, y, o);
          doc.text(str + '', x + 0.13, y, o);
        }
      };
      const plain = (str, x, y, size, color, align) => {
        doc.setFont(F, 'normal'); doc.setFontSize(size);
        doc.setTextColor(color[0], color[1], color[2]);
        doc.text(str, x, y, { align: align || 'left' });
      };

      const dateStr = this._dmy(new Date().toISOString());
      let page = 0;
      const pageHeader = () => {
        page++;
        plain(T(L.ttl) + '  —  ' + dateStr, M, 10, 8, GREY);
        plain(L.page + ' ' + page, PW - M, 10, 8, GREY, 'right');
        doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]); doc.setLineWidth(0.2);
        doc.line(M, 12, PW - M, 12);
      };

      let col = 0, y = TOP;
      pageHeader();

      const maxRows = Math.floor((BOT - TOP - HEAD - FOOT) / ROW);

      const drawCard = (it, num, rows, isLast) => {
        const h = HEAD + rows.length * ROW + (isLast ? FOOT : 0);
        const x = colX[col];

        doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]); doc.setLineWidth(0.25);
        doc.setFillColor(255, 255, 255);
        doc.rect(x, y, colW, h, 'FD');

        doc.setFillColor(HEADBG[0], HEADBG[1], HEADBG[2]);
        doc.rect(x, y, colW, HEAD, 'F');
        doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
        doc.line(x, y + HEAD, x + colW, y + HEAD);

        bold(num + '. ' + it.name, x + 3, y + 4.8, 9.2, NAVY);
        plain(it.base + '  •  ' + L.tel + ' ' + it.phone, x + 3, y + 8.9, 7, GREY);

        let ry = y + HEAD + 3.5;
        rows.forEach(r => {
          plain(this._dmy(r.date), x + 3, ry, 7.3, DARK);
          plain(r.label, x + 20, ry, 7.3, DARK);
          bold((r.neg ? '-' : '+') + this._num(r.amount), x + colW - 3, ry, 7.6,
               r.neg ? RED : NAVY, 'right');
          ry += ROW;
        });

        if (isLast) {
          const fy = y + h - FOOT;
          doc.setFillColor(FOOTBG[0], FOOTBG[1], FOOTBG[2]);
          doc.rect(x, fy, colW, FOOT, 'F');
          doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
          doc.line(x, fy, x + colW, fy);
          bold(L.total + ': ' + this._num(it.total) + ' ' + L.cur, x + 3, fy + 4.5, 8.3, NAVY);
        }
        y += h + GAP;
      };

      const newColumn = () => {
        if (col === 0) { col = 1; y = TOP; }
        else { doc.addPage(); pageHeader(); col = 0; y = TOP; }
      };

      status('PDF chizilmoqda...');
      items.forEach((it, idx) => {
        const num = String(idx + 1).padStart(4, '0');
        // Juda uzun ro'yxatni bo'laklarga ajratamiz
        const chunks = [];
        for (let k = 0; k < it.rows.length; k += maxRows) chunks.push(it.rows.slice(k, k + maxRows));
        chunks.forEach((chunk, ci) => {
          const isLast = ci === chunks.length - 1;
          const h = HEAD + chunk.length * ROW + (isLast ? FOOT : 0);
          if (y + h > BOT) newColumn();
          drawCard(it, num, chunk, isLast);
        });
      });

      if (!items.length) {
        plain(T("Qarzdor mijoz yo'q"), PW / 2, 40, 11, GREY, 'center');
      }

      status('PDF yuborilmoqda...');
      const blob = doc.output('blob');
      const fname = `barcha_qarzlar_${new Date().toISOString().split('T')[0]}.pdf`;
      const caption =
        `📋 Kunlik hisobot — barcha bazalar\n` +
        `👥 Jami qarzdor: ${items.length} ta\n` +
        `🧾 Qarzlar soni: ${debtCount} ta\n` +
        `💰 Umumiy qarz: ${totalSum.toLocaleString('uz-UZ')} so'm\n` +
        `📅 ${new Date().toLocaleDateString('uz-UZ')}`;

      const json = await TG.sendDocument(blob, fname, caption);
      return { ok: !!(json && json.ok), totalCount: items.length, totalSum, error: json && json.description };
    } catch (e) {
      console.warn('PDF send error:', e.message);
      return { ok: false, totalCount: 0, totalSum: 0, error: e.message };
    }
  },

  _sentToday() {
    return localStorage.getItem(this.FLAG) === new Date().toDateString();
  },

  async _tick() {
    const now = new Date();
    if (now.getHours() * 60 + now.getMinutes() < this.SEND_HOUR * 60 + this.SEND_MINUTE) return;
    if (this._sentToday()) return;

    // Ikki marta ketmasligi uchun flagni yuborishdan OLDIN qo'yamiz
    localStorage.setItem(this.FLAG, new Date().toDateString());
    const res = await this.buildAndSend();
    if (!res.ok) {
      // Yuborilmadi (masalan, internet yo'q) — keyingi urinish uchun flagni olib tashlaymiz
      localStorage.removeItem(this.FLAG);
    }
  },

  startDailyScheduler() {
    if (this._timer) return;
    this._timer = setInterval(() => this._tick(), 20000);
    this._tick();
  }
};

Report.startDailyScheduler();
