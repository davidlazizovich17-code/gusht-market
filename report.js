'use strict';

// Kunlik umumiy qarz PDF hisoboti — Telegramga HAR KUNI FAQAT BIR MARTA,
// soat 23:59 da yuboriladi. Sahifa shu paytda ochiq turgan bo'lishi kerak.
const Report = {
  FLAG: 'gm_daily_pdf_sent',
  SEND_HOUR: 23,
  SEND_MINUTE: 59,
  _timer: null,

  TYPE_LIST: [
    { key: 'postoyanniy', label: 'Postoyanniy klientlar' },
    { key: 'optom',       label: 'Optomiy klientlar'    },
    { key: 'klient',      label: 'Klient'               }
  ],

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
  // onStatus — ixtiyoriy callback (UI status matni uchun).
  // Natija: { ok, totalCount, totalSum, error }
  async buildAndSend(onStatus) {
    const status = msg => { if (onStatus) onStatus(msg); };

    if (!(await this._ensureLibs())) {
      return { ok: false, totalCount: 0, totalSum: 0, error: 'PDF kutubxonasi yuklanmadi' };
    }
    status("Ma'lumotlar yig'ilmoqda...");

    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const dateStr = new Date().toLocaleDateString('uz-UZ');
      let firstSection = true;
      let totalCount = 0, totalSum = 0;

      for (const { key, label } of this.TYPE_LIST) {
        status(`${label} tayyorlanmoqda...`);

        const customers = DB.getCustomers(key).filter(c => !c.blocked);
        const rows = [];

        customers.forEach(c => {
          const debts = DB.getDebts(key).filter(d => d.customerId === c.id && d.status !== 'paid');
          if (!debts.length) return;
          debts.forEach(d => {
            rows.push([
              '',
              c.name,
              c.phone || '',
              Number(d.remaining).toLocaleString('uz-UZ') + " so'm",
              DB.fmtDate(d.createdAt),
              d.note || '',
              ''
            ]);
            totalCount++;
            totalSum += d.remaining;
          });
        });

        if (!rows.length) continue;
        if (!firstSection) doc.addPage();
        firstSection = false;

        doc.setFontSize(13); doc.setFont('helvetica', 'bold');
        doc.text(label + " — Qarzdorlar ro'yxati", 105, 14, { align: 'center' });
        doc.setFontSize(9); doc.setFont('helvetica', 'normal');
        doc.text(`Sana: ${dateStr}   |   Jami: ${rows.length} ta qarz`, 105, 20, { align: 'center' });

        let rowNum = 0;
        const numberedRows = rows.map(r => { rowNum++; return [String(rowNum), ...r.slice(1)]; });

        doc.autoTable({
          startY: 24,
          head: [['#', 'Ism familiya', 'Telefon', 'Summa', 'Sana', 'Izoh', 'Imzo']],
          body: numberedRows,
          styles: { fontSize: 8, cellPadding: { top: 3, bottom: 3, left: 2, right: 2 }, lineColor: [210, 210, 210], lineWidth: 0.25, overflow: 'linebreak' },
          headStyles: { fillColor: [192, 57, 43], textColor: 255, fontStyle: 'bold', fontSize: 8 },
          columnStyles: {
            0: { cellWidth: 8, halign: 'center' },
            1: { cellWidth: 42 },
            2: { cellWidth: 30 },
            3: { cellWidth: 32, halign: 'right' },
            4: { cellWidth: 22 },
            5: { cellWidth: 28 },
            6: { cellWidth: 30 }
          },
          alternateRowStyles: { fillColor: [248, 248, 248] },
          didDrawPage(data) {
            if (data.pageNumber > 1) {
              doc.setFontSize(9); doc.setFont('helvetica', 'bold');
              doc.setTextColor(192, 57, 43);
              doc.text(label + ' (davomi)', 14, 8);
              doc.setTextColor(0, 0, 0);
            }
          },
          margin: { top: 10 }
        });

        const sectionTotal = rows.reduce((s, r) => s + (parseInt(r[3].replace(/[^\d]/g, ''), 10) || 0), 0);
        const finalY = doc.lastAutoTable.finalY + 6;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
        doc.text(`Jami: ${sectionTotal.toLocaleString('uz-UZ')} so'm`, 14, finalY);
      }

      status('PDF yuborilmoqda...');

      const blob = doc.output('blob');
      const fname = `barcha_qarzlar_${new Date().toISOString().split('T')[0]}.pdf`;
      const caption =
        `📋 Kunlik hisobot — barcha bazalar\n` +
        `👥 Jami qarzdor: ${totalCount} ta\n` +
        `💰 Umumiy qarz: ${totalSum.toLocaleString('uz-UZ')} so'm\n` +
        `📅 ${dateStr}`;

      const json = await TG.sendDocument(blob, fname, caption);
      return { ok: !!(json && json.ok), totalCount, totalSum, error: json && json.description };
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
    if (now.getHours() !== this.SEND_HOUR || now.getMinutes() < this.SEND_MINUTE) return;
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
