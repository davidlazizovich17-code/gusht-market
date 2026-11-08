// ───────────────────────────────────────────────────────────────────────────
//  Muddati o'tgan qarzlar uchun avtomatik SMS (Eskiz.uz orqali)
//
//  GitHub Actions da ishlaydi — kompyuter o'chiq bo'lsa ham jo'natiladi.
//  Har kuni ishga tushadi, lekin bitta mijozga COOLDOWN_DAYS kunda bir marta
//  yuboriladi. Shuning uchun amalda har 4 kunda bir marta boradi.
//
//  Kerakli maxfiy sozlamalar (GitHub > Settings > Secrets and variables):
//    ESKIZ_EMAIL     — Eskiz hisobining pochtasi
//    ESKIZ_PASSWORD  — SMS shlyuzining maxfiy kaliti (kabinet paroli EMAS)
//    SMS_ENABLED     — "true" bo'lsagina haqiqiy yuboriladi; aks holda sinov
// ───────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');

const ESKIZ = 'https://notify.eskiz.uz/api';

// Supabase manzili va kalitini saytning o'z faylidan o'qiymiz — ular
// supabase.js da allaqachon bor, bu yerga nusxalash shart emas.
function readSupabaseConfig() {
  const f = path.join(__dirname, '..', 'supabase.js');
  const src = fs.readFileSync(f, 'utf8');
  const url = src.match(/_url:\s*'([^']+)'/);
  const key = src.match(/_apiKey:\s*'([^']+)'/);
  if (!url || !key) throw new Error("supabase.js dan manzil/kalit o'qilmadi");
  return { url: url[1] + '/rest/v1/store', key: key[1] };
}
const { url: SUPA, key: SUPA_KEY } = readSupabaseConfig();

const MESSAGE = "Hurmatli {ISM}! Navoiy go'sht do'konidan qarzingiz: {SUMMA} SO'M. "
              + "3 kun ichida to'lang yoki bog'laning: +998933361590";
const FROM           = '4546';
const COOLDOWN_DAYS  = 4;     // bitta mijozga necha kunda bir marta
const GRACE_DEFAULT  = 60;    // qarz necha kundan keyin "muddati o'tgan"
const MAX_PER_RUN    = 600;   // xavfsizlik chegarasi
const LOG_ROW        = 'sms_log';

const TYPES = ['klient', 'postoyanniy', 'optom'];
const DAY   = 86400000;

// Operator narxlari — faqat hisob-kitob uchun
const PRICE = { '93':160,'94':160,'90':160,'91':160,'97':170,'98':170,
                '95':145,'99':145,'77':145,'50':145,'55':145,
                '88':95,'33':95,'20':110 };

// Tasdiqlangan shablon bo'lmasa, xabar reklama deb hisoblanadi va
// narx qariyb ikki barobar oshadi. Bu — oddiy narxdan reklama narxiga jadval.
const AD = { 160: 350, 170: 370, 145: 350, 95: 95, 110: 110 };
const adPrice = p => AD[p] || p * 2;

// ─── Ism qoidasi ───────────────────────────────────────────────────────────
const TITLES = ['AKA','OPA','XOLA','HOLA','BOBO','BUVA','BUVI','AMAKI','TOGA','UKA','BO'];
const DROP   = ['KEN','ZNAK','MAGAZIN','TERSAK','KUZICHI'];
const CYR = { 'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'j','з':'z','и':'i',
  'й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u',
  'ф':'f','х':'x','ц':'ts','ч':'ch','ш':'sh','щ':'sh','ъ':"'",'ы':'i','ь':'','э':'e',
  'ю':'yu','я':'ya','ў':"o'",'қ':'q','ғ':"g'",'ҳ':'h' };

function toLatin(v) {
  return Array.from(String(v == null ? '' : v)).map(ch => {
    const lo = ch.toLowerCase();
    const m = CYR[lo];
    if (m !== undefined) return (ch !== lo && m) ? m[0].toUpperCase() + m.slice(1) : m;
    if ('‘’ʻʼ'.includes(ch)) return "'";
    if (ch === ' ') return ' ';
    return ch.charCodeAt(0) > 255 ? '' : ch;
  }).join('');
}

function smsName(raw) {
  let w = toLatin(raw).toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ')
            .split(/\s+/).filter(Boolean)
            .map(x => x.replace(/B0$/, 'BO'))
            .filter(x => !/^\d+$/.test(x) && !DROP.includes(x));
  if (!w.length) return '';
  const x = [];
  for (const t of w) {
    const m = TITLES.includes(t) ? null : t.match(/^(.{4,})(AKA|OPA|XOLA|BO)$/);
    if (m) { x.push(m[1], m[2]); } else { x.push(t); }
  }
  w = x;
  const ti = w.findIndex(t => TITLES.includes(t));
  const out = ti >= 0
    ? ((ti === w.length - 1 && ti >= 2) ? w.slice(ti - 1, ti + 1) : w.slice(0, ti + 1))
    : w.slice(0, 2);
  return out.join(' ').toLowerCase().replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase());
}

// Oddiy probel bilan — toLocaleString uzilmas probel qo'yadi, u GSM-7 da yo'q
const numSp = n => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

function phoneOf(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('998')) d = d.slice(3);
  if (d.length === 10 && d[0] === '8') d = d.slice(1);
  if (d.length !== 9 || !PRICE[d.slice(0, 2)]) return null;
  return '998' + d;
}

// ─── Yordamchilar ──────────────────────────────────────────────────────────
const log = (...a) => console.log(...a);
const supaHeaders = { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY };

async function supaFetchAll() {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${SUPA}?select=id,data&limit=1000&offset=${offset}`, { headers: supaHeaders });
    if (!res.ok) throw new Error('Supabase o\'qilmadi: HTTP ' + res.status);
    const page = await res.json();
    if (!Array.isArray(page) || !page.length) break;
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

// Telegram sozlamalari saytning o'z faylidan o'qiladi — nusxalash shart emas.
function readTelegramConfig() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'telegram.js'), 'utf8');
  const tok = src.match(/TOKEN:\s*'([^']+)'/);
  const cid = src.match(/CHAT_ID:\s*'([^']+)'/);
  if (!tok || !cid) throw new Error("telegram.js dan token/chat o'qilmadi");
  return { token: tok[1], chat: cid[1] };
}

// Kimga yuborilgani haqida PDF tuzib, botga jo'natadi.
// Ismlar lotinga o'girilgani uchun oddiy shrift yetarli.
async function sendReportPdf(rows, meta) {
  const { jsPDF } = require('jspdf');
  require('jspdf-autotable');

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();

  doc.setFont('helvetica', 'bold').setFontSize(15);
  doc.text(meta.dry ? 'SMS ro\u2019yxati (sinov)' : 'SMS yuborildi', 40, 46);
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(90);
  doc.text(meta.when, W - 40, 46, { align: 'right' });

  doc.setTextColor(0).setFontSize(10);
  const head = (meta.dry
    ? [`Jami: ${meta.total} ta`, 'Hech narsa yuborilmadi (sinov rejimi)']
    : [`Jami: ${meta.total} ta`, `Yetib bordi: ${meta.ok} ta`, `Xato: ${meta.err} ta`]
  ).concat(`Narx: ${numSp(meta.cost)} so'm${meta.ad ? ' (reklama tarifi)' : ''}`).join('     ');
  doc.text(head, 40, 66);

  doc.autoTable({
    startY: 82,
    head: [['#', 'Ism', 'Telefon', "Qarz, so'm", 'Holat']],
    body: rows.map((x, n) => [
      String(n + 1), x.name, '+' + x.phone, numSp(x.debt),
      meta.dry ? 'sinov' : (x.ok ? 'yetdi' : (x.err || 'xato'))
    ]),
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [45, 55, 72], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    columnStyles: {
      0: { cellWidth: 32, halign: 'right' },
      2: { cellWidth: 92 },
      3: { cellWidth: 78, halign: 'right' },
      4: { cellWidth: 62 }
    },
    didParseCell: d => {
      const okTxt = meta.dry ? 'sinov' : 'yetdi';
      if (d.section === 'body' && d.column.index === 4 && d.cell.raw !== okTxt) {
        d.cell.styles.textColor = [200, 30, 30];
      }
    }
  });

  const buf = Buffer.from(doc.output('arraybuffer'));
  const { token, chat } = readTelegramConfig();
  const fd = new FormData();
  fd.append('chat_id', chat);
  fd.append('caption', meta.dry
    ? `SINOV: ${meta.total} ta nomzod, ${numSp(meta.cost)} so'm — hech narsa yuborilmadi`
    : `SMS yuborildi: ${meta.ok}/${meta.total} ta, ${numSp(meta.cost)} so'm`);
  fd.append('document', new Blob([buf], { type: 'application/pdf' }), meta.file);
  const r = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: 'POST', body: fd });
  const j = await r.json().catch(() => ({}));
  if (!j || !j.ok) throw new Error('Telegram javobi: ' + JSON.stringify(j).slice(0, 200));
}

async function supaWrite(id, data) {
  const res = await fetch(SUPA, {
    method: 'POST',
    headers: { ...supaHeaders, 'Content-Type': 'application/json',
               Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ id, data })
  });
  if (!res.ok) throw new Error('Jurnal saqlanmadi: HTTP ' + res.status);
}

// ─── Asosiy ────────────────────────────────────────────────────────────────
(async () => {
  const email   = process.env.ESKIZ_EMAIL;
  const secret  = process.env.ESKIZ_PASSWORD;
  const enabled = String(process.env.SMS_ENABLED || '').toLowerCase() === 'true';
  const forced  = String(process.env.FORCE_DRY || '').toLowerCase() === 'true';
  const dry     = !enabled || forced;

  if (!email || !secret) {
    const miss = [];
    if (!email)  miss.push('ESKIZ_EMAIL');
    if (!secret) miss.push('ESKIZ_PASSWORD');
    console.error('XATO: quyidagi sirlar topilmadi: ' + miss.join(', '));
    console.error('Mavjud sozlamalar (qiymatlari ko\'rsatilmaydi):');
    ['ESKIZ_EMAIL', 'ESKIZ_PASSWORD', 'SMS_ENABLED', 'FORCE_DRY'].forEach(k => {
      const v = process.env[k];
      console.error('   ' + k + ' = ' + (v ? '[bor, ' + v.length + ' belgi]' : '[YO\'Q]'));
    });
    console.error("GitHub > Settings > Secrets and variables > Actions sahifasida");
    console.error("nomlar aynan shunday yozilganini tekshiring (Variables emas, Secrets).");
    process.exit(1);
  }

  log('rejim:', dry ? 'SINOV (hech narsa yuborilmaydi)' : 'HAQIQIY YUBORISH');

  // 1. Kirish
  const fd = new FormData();
  fd.append('email', email);
  fd.append('password', secret);
  const authRes = await fetch(`${ESKIZ}/auth/login`, { method: 'POST', body: fd });
  const auth = await authRes.json().catch(() => ({}));
  const token = auth && auth.data && auth.data.token;
  if (!token) {
    console.error('XATO: token olinmadi.', JSON.stringify(auth).slice(0, 300));
    process.exit(1);
  }
  const eh = { Authorization: 'Bearer ' + token };
  log('token olindi');

  // 2. Hisob
  const me = await (await fetch(`${ESKIZ}/auth/user`, { headers: eh })).json().catch(() => ({}));
  const balance = Number((me && me.data && me.data.balance) || 0);
  const role    = (me && me.data && me.data.role) || '?';
  log(`balans: ${numSp(balance)} so'm, rejim: ${role}`);

  // 2b. Shablon tasdiqlanganmi? Matnning o'zgarmas bo'laklari shablonda
  // bor-yo'qligiga qarab aniqlaymiz — Eskiz o'zgaruvchilarni qanday
  // yozishidan qat'i nazar ishlaydi.
  const FIXED = MESSAGE.split(/\{ISM\}|\{SUMMA\}/)
                       .map(x => x.trim()).filter(x => x.length > 8);
  let approved = false;
  try {
    const tr = await (await fetch(`${ESKIZ}/user/templates`, { headers: eh })).json();
    const list = (tr && (tr.result || tr.data)) || [];
    if (!list.length) log("shablon: hali yo'q");
    for (const t of list) {
      const txt  = String(t.original_text || t.template || '');
      const st   = String(t.status || '?');
      const mine = FIXED.every(x => txt.includes(x));
      log(`shablon #${t.id || '?'} [${st}]${mine ? '  <- bizniki' : ''}`);
      if (mine && st === 'service') approved = true;
    }
  } catch (e) { log("shablon holati o'qilmadi:", e.message); }
  log('shablon tasdiqlangan:', approved ? 'HA — oddiy narx' : "YO'Q — reklama narxi");

  // 3. Ma'lumot
  const rows = await supaFetchAll();
  const cust = {}, debt = {}, pays = {};
  for (const t of TYPES) { cust[t] = {}; debt[t] = {}; pays[t] = {}; }
  let sentLog = {};

  const bucket = c => (c === 'customers' ? cust : c === 'debts' ? debt : c === 'payments' ? pays : null);

  for (const row of rows) {
    const id = row.id || '', d = row.data;
    if (id === LOG_ROW && d && typeof d === 'object') { sentLog = d; continue; }
    if (id.startsWith('r_') && d && d.r && d.r.id) {
      const b = bucket(d.c); if (b && b[d.t]) b[d.t][d.r.id] = d.r;
    } else {
      const m = id.match(/^gm_(klient|postoyanniy|optom)_(customers|debts|payments)$/);
      if (m && Array.isArray(d)) {
        const b = bucket(m[2]);
        for (const rec of d) if (rec && rec.id && b[m[1]][rec.id] === undefined) b[m[1]][rec.id] = rec;
      }
    }
  }
  log('mijozlar:', TYPES.map(t => `${t}=${Object.keys(cust[t]).length}`).join(' '));

  // 4. Kimga yuboriladi
  const now = Date.now();
  const targets = [];
  const skip = {};
  const bump = k => { skip[k] = (skip[k] || 0) + 1; };

  for (const t of TYPES) {
    const lastPay = {};
    for (const p of Object.values(pays[t])) {
      if (p._del) continue;
      const ts = Date.parse(p.createdAt || '') || 0;
      if (ts > (lastPay[p.customerId] || 0)) lastPay[p.customerId] = ts;
    }
    const open = {};
    for (const d of Object.values(debt[t])) {
      if (d._del || d.status === 'paid' || !(Number(d.remaining) > 0)) continue;
      (open[d.customerId] = open[d.customerId] || []).push(d);
    }
    for (const c of Object.values(cust[t])) {
      if (c._del || c.blocked) continue;
      const list = open[c.id];
      if (!list) continue;
      const sum = list.reduce((s, d) => s + Number(d.remaining || 0), 0);
      if (sum <= 0) continue;

      const grace = Number(c.graceDays) > 0 ? Number(c.graceDays) : GRACE_DEFAULT;
      if (c.dueUntil && Date.parse(c.dueUntil) > now) { bump('muddat berilgan'); continue; }
      const lp = lastPay[c.id] || 0;
      if (lp && (now - lp) <= grace * DAY) { bump("yaqinda to'lagan"); continue; }
      if (!list.some(d => (now - (Date.parse(d.createdAt || '') || 0)) > grace * DAY)) {
        bump("muddati o'tmagan"); continue;
      }

      const phone = phoneOf(c.phone);
      if (!phone) { bump("raqam noto'g'ri"); continue; }
      const nm = smsName(c.name);
      if (!nm) { bump("ism bo'sh"); continue; }

      const text = MESSAGE.replace('{ISM}', nm).replace('{SUMMA}', numSp(sum));
      const base = PRICE[phone.slice(3, 5)] || 160;
      targets.push({ id: c.id, phone, name: nm, debt: sum, text,
                     price: approved ? base : adPrice(base) });
    }
  }
  log(`nomzod: ${targets.length} ta`);
  for (const k of Object.keys(skip).sort()) log(`  chetda — ${k}: ${skip[k]}`);

  // 5. Yaqinda yuborilganlarni chiqaramiz
  const queue = [];
  let cooled = 0;
  for (const x of targets) {
    const last = Date.parse(sentLog[x.id] || '') || 0;
    if (last && (now - last) < COOLDOWN_DAYS * DAY) { cooled++; continue; }
    queue.push(x);
    if (queue.length >= MAX_PER_RUN) break;
  }
  log(`oxirgi ${COOLDOWN_DAYS} kunda yuborilgani uchun o'tkazildi: ${cooled}`);

  const cost   = queue.reduce((s, x) => s + x.price, 0);
  const maxLen = queue.reduce((m, x) => Math.max(m, x.text.length), 0);
  log(`yuboriladi: ${queue.length} ta,  taxminiy narx: ${numSp(cost)} so'm`);
  log(`eng uzun matn: ${maxLen} belgi ${maxLen > 160 ? '(DIQQAT: 160 dan oshdi)' : '(bitta SMS)'}`);
  if (queue.length) log('namuna:', queue[0].phone, '|', queue[0].text);

  const stamp = () => new Date(Date.now() + 5 * 3600000)   // Toshkent vaqti
                        .toISOString().slice(0, 16).replace('T', ' ');

  async function report(sent, ok, err, isDry) {
    const when = stamp();
    try {
      await sendReportPdf(sent, {
        when, total: sent.length, ok, err, dry: isDry, ad: !approved,
        cost: (isDry ? sent : sent.filter(x => x.ok)).reduce((a, x) => a + x.price, 0),
        file: `sms_${when.slice(0, 10)}.pdf`
      });
      log('botga PDF hisobot yuborildi');
    } catch (e) {
      console.error('OGOHLANTIRISH: botga hisobot ketmadi —', e.message);
    }
  }

  if (dry) {
    log("\nSINOV REJIMI — hech narsa yuborilmadi.");
    log('Haqiqiy yuborish uchun SMS_ENABLED sirini "true" qiling.');
    if (queue.length) await report(queue, 0, 0, true);
    return;
  }
  if (role === 'test') {
    console.error("TO'XTATILDI: hisob test rejimida — haqiqiy matn ketmaydi.");
    process.exit(1);
  }
  // Shablon tasdiqlanmagan bo'lsa ham yuboriladi (shunday kelishilgan),
  // faqat narx reklama tarifida ketadi — jurnalda ogohlantirib qo'yamiz.
  if (!approved) {
    log("\nOGOHLANTIRISH: shablon tasdiqlanmagan — reklama narxida ketadi.");
  }
  if (balance > 0 && balance < cost) {
    console.error(`TO'XTATILDI: balans yetarli emas (${numSp(balance)} < ${numSp(cost)} so'm).`);
    process.exit(1);
  }
  if (!queue.length) { log('Yuboriladigan mijoz yo\'q.'); return; }

  // 6. Yuborish
  let ok = 0, err = 0;
  for (const x of queue) {
    const f = new FormData();
    f.append('mobile_phone', x.phone);
    f.append('message', x.text);
    f.append('from', FROM);
    try {
      const r = await fetch(`${ESKIZ}/message/sms/send`, { method: 'POST', headers: eh, body: f });
      const j = await r.json().catch(() => ({}));
      if (j && j.id) {
        ok++; x.ok = true; sentLog[x.id] = new Date().toISOString();
      } else {
        err++; x.ok = false;
        x.err = String((j && (j.message || j.status)) || 'xato').slice(0, 30);
        console.error('xato:', x.phone, JSON.stringify(j).slice(0, 160));
      }
    } catch (e) {
      err++; x.ok = false; x.err = e.message.slice(0, 30);
      console.error('xato:', x.phone, e.message);
    }
    await new Promise(r => setTimeout(r, 250));
  }

  try { await supaWrite(LOG_ROW, sentLog); log('jurnal saqlandi'); }
  catch (e) { console.error('OGOHLANTIRISH:', e.message); }

  log(`\nyuborildi: ${ok} ta,  xato: ${err} ta`);

  // 7. Botga hisobot — kimga ketgani haqida PDF
  await report(queue, ok, err, false);

  if (err && !ok) process.exit(1);
})().catch(e => { console.error('XATO:', e && e.stack || e); process.exit(1); });
