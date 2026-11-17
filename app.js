'use strict';
/* 記帳 App：Supabase 是唯一資料來源；離線時只暫存「新增/修改」，連線後自動補送（同一筆不會重複）。 */
const SB_URL = 'https://ghkxtkpfitcecdcvqwxr.supabase.co';
const SB_KEY = 'sb_publishable_sytoYT8OqueRTeT40VQbXg_aKVIB2zY';
const sb = supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true } });

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => Number(v) || 0;
const KO = ['現金', '銀行帳戶', '電子支付', '信用卡'];
const todayStr = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const curMonth = () => todayStr().slice(0, 7);
const addMonth = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
const money = v => Formula.fmt(v, 'money');
const mc = (v, c) => { v = num(v); const s = (c && c !== 'TWD' ? c + ' ' : 'NT$') + (Math.round(Math.abs(v) * 100) / 100).toLocaleString('zh-TW'); return (v < 0 ? '−' : '') + s; };
const md = d => d ? String(d).slice(5).replace('-', '/') : '';
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };

const S = {
  user: null, page: 'dash', ready: false, offline: false,
  accts: [], items: [], trips: [], bal: [], monthly: [], cat: [], budgets: [], cards: [], subs: [], insts: [], fx: [], recent: [],
  txs: [], txMonth: curMonth(), q: '', rm: curMonth(), sort: false, showOff: false,
  form: null, tf: null, legacy: { q: '', p: 0, rows: [], n: 0 }, msg: '', loginErr: '', pend: store.get('pend', [])
};
const A = id => S.accts.find(a => a.id === id);
const an = id => (A(id) || {}).name || '—';
const acur = id => (A(id) || {}).currency || 'TWD';
const itemName = id => (S.items.find(i => i.id === id) || {}).name || '';

/* ---------- 小工具 ---------- */
let toastT;
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 3200); }
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = crypto.getRandomValues(new Uint8Array(1))[0] & 15; return (c === 'x' ? r : (r & 3) | 8).toString(16); }));
const isNet = e => !navigator.onLine || /fetch|network|load failed/i.test((e && e.message) || '');
function nextId(list, prefix) {
  let mx = 0, pf = prefix, w = 3;
  list.forEach(x => { const m = /^([A-Za-z]+)(\d+)$/.exec(x.id); if (m) { pf = m[1]; w = Math.max(w, m[2].length); mx = Math.max(mx, Number(m[2])); } });
  return pf + String(mx + 1).padStart(w, '0');
}
function nextDateFor(anchor) {
  const t = new Date(todayStr() + 'T00:00:00');
  const mk = (y, m) => { const last = new Date(y, m + 1, 0).getDate(); const d = new Date(y, m, Math.min(anchor, last)); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  let c = mk(t.getFullYear(), t.getMonth());
  if (c <= todayStr()) c = mk(t.getFullYear(), t.getMonth() + 1);
  return c;
}
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: type || 'application/json' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
}

/* ---------- 載入資料 ---------- */
const DEFAULT_CARDS = [
  ['淨資產', '淨資產', 'money', '帳戶總額 − 信用卡淨待繳'],
  ['實際剩餘可用', '淨資產-外幣帳戶總額', 'money', '淨資產扣掉所有外幣帳戶'],
  ['本月收入', '本月收入', 'money', ''],
  ['本月支出', '本月支出', 'money', '含手續費'],
  ['本月結餘', '本月收入-本月支出', 'money', ''],
  ['信用卡淨待繳', '信用卡淨待繳', 'money', '待繳扣掉溢繳']
];
async function load() {
  const r = await Promise.all([
    sb.from('accounts').select('*').order('sort_order').order('id'),
    sb.from('items').select('*').order('sort_order').order('id'),
    sb.from('trips').select('*').order('start_date', { ascending: false }),
    sb.from('account_balances').select('*'),
    sb.from('monthly_totals').select('*').order('month'),
    sb.from('monthly_category').select('*'),
    sb.from('budgets').select('*'),
    sb.from('dashboard_cards').select('*').order('sort_order').order('created_at'),
    sb.from('subscriptions').select('*').order('next_date'),
    sb.from('installments').select('*').order('next_date'),
    sb.from('fx_rates').select('*').order('rate_date', { ascending: false }).limit(80),
    sb.from('transactions').select('*').is('deleted_at', null).order('tx_date', { ascending: false }).order('created_at', { ascending: false }).limit(8)
  ]);
  const bad = r.find(x => x.error);
  if (bad) throw bad.error;
  const k = ['accts', 'items', 'trips', 'bal', 'monthly', 'cat', 'budgets', 'cards', 'subs', 'insts', 'fx', 'recent'];
  k.forEach((key, i) => { S[key] = r[i].data || []; });
  store.set('cache', Object.fromEntries(k.map(key => [key, S[key]])));
  S.offline = false;
  if (!S.cards.length) {
    const rows = DEFAULT_CARDS.map((c, i) => ({ title: c[0], formula: c[1], format: c[2], note: c[3], sort_order: (i + 1) * 10 }));
    const { error } = await sb.from('dashboard_cards').insert(rows);
    if (!error) { const x = await sb.from('dashboard_cards').select('*').order('sort_order'); S.cards = x.data || []; }
  }
}
function loadCache() {
  const c = store.get('cache', null);
  if (!c) return false;
  Object.assign(S, c); S.offline = true; return true;
}

/* ---------- 指標卡變數與計算（全站唯一算法） ---------- */
function vars() {
  const ym = curMonth(), v = {};
  let tot = 0, bank = 0, cash = 0, epay = 0, fx = 0, due = 0, over = 0;
  S.bal.forEach(b => {
    const a = A(b.id); if (!a) return;
    const tw = num(b.twd_value);
    v['帳戶_' + b.id] = tw;
    if (a.kind === '信用卡') { if (tw < 0) due += -tw; else over += tw; return; }
    if (!a.include_in_assets) return;
    tot += tw;
    if (a.kind === '銀行帳戶') bank += tw; else if (a.kind === '現金') cash += tw; else if (a.kind === '電子支付') epay += tw;
    if (a.currency !== 'TWD') fx += tw;
  });
  const m = S.monthly.find(x => x.month === ym) || {};
  const inc = num(m.income), exp = num(m.expense);
  const groups = S.budgets.map(b => b.group_name);
  const bt = S.budgets.reduce((s, b) => s + num(b.amount_twd), 0);
  const bu = S.cat.filter(c => c.month === ym && groups.includes(c.grp)).reduce((s, c) => s + num(c.amount), 0);
  Object.assign(v, {
    '本月收入': inc, '本月支出': exp, '本月結餘': inc - exp,
    '總資產': tot, '帳戶總額': tot, '銀行帳戶總額': bank, '現金總額': cash, '電子支付總額': epay, '外幣帳戶總額': fx,
    '信用卡待繳': due, '信用卡溢繳': over, '信用卡淨待繳': due - over, '淨資產': tot - (due - over),
    '本月預算': bt, '本月預算已用': bu, '本月預算剩餘': bt - bu
  });
  return v;
}
const BASE_VARS = ['本月收入', '本月支出', '本月結餘', '總資產', '帳戶總額', '銀行帳戶總額', '現金總額', '電子支付總額', '外幣帳戶總額', '信用卡待繳', '信用卡溢繳', '信用卡淨待繳', '淨資產', '本月預算', '本月預算已用', '本月預算剩餘'];

/* ---------- 離線暫存佇列 ---------- */
let flushing = false;
async function flush() {
  if (flushing || !S.pend.length || !S.user) return;
  flushing = true; let done = 0;
  try {
    for (const p of S.pend.slice()) {
      const q = p.op === 'insert'
        ? await sb.from('transactions').upsert({ id: p.id, ...p.row }, { onConflict: 'id', ignoreDuplicates: true })
        : await sb.from('transactions').update(p.row).eq('id', p.id);
      if (q.error) {
        if (isNet(q.error)) break;
        p.err = q.error.message; toast('有一筆送出失敗：' + q.error.message); break;
      }
      S.pend = S.pend.filter(x => x !== p); done++;
    }
  } finally { flushing = false; store.set('pend', S.pend); }
  if (done) { try { await load(); } catch (e) {} if (S.page === 'list') await loadTxs(); render(); toast('已同步 ' + done + ' 筆'); }
}
function queue(op, id, row) {
  S.pend = S.pend.filter(p => !(p.id === id && p.op === op));
  if (op === 'update') { const ins = S.pend.find(p => p.id === id && p.op === 'insert'); if (ins) { ins.row = { ...ins.row, ...row }; store.set('pend', S.pend); return; } }
  S.pend.push({ op, id, row }); store.set('pend', S.pend);
}

/* ---------- 明細 ---------- */
async function loadTxs() {
  const m = S.txMonth;
  const { data, error } = await sb.from('transactions').select('*').is('deleted_at', null)
    .gte('tx_date', m + '-01').lt('tx_date', addMonth(m, 1) + '-01')
    .order('tx_date', { ascending: false }).order('created_at', { ascending: false }).limit(1500);
  if (error) { toast('讀取失敗：' + error.message); return; }
  S.txs = data || [];
}
function txAmt(t) {
  if (t.type === '轉帳') {
    const fc = acur(t.from_account_id), tc = acur(t.to_account_id);
    return '<span class="t">' + mc(t.from_amount, fc) + (fc !== tc ? ' → ' + mc(t.to_amount, tc) : '') + '</span>';
  }
  const c = acur(t.account_id), s = t.type === '支' ? -1 : 1;
  return '<span class="' + (s < 0 ? 'e' : 'i') + '">' + mc(s * num(t.amount), c) + '</span>' + (c !== 'TWD' && t.twd_amount ? '<br><small>≈ ' + money(s * num(t.twd_amount)) + '</small>' : '');
}
function txRow(t, pending) {
  const title = t.type === '轉帳' ? an(t.from_account_id) + ' → ' + an(t.to_account_id) : (itemName(t.item_id) || (t.type === '支' ? '支出' : '收入'));
  const sub = (t.type === '轉帳' ? '轉帳' : an(t.account_id)) + (t.trip_id ? ' · ' + esc((S.trips.find(x => x.id === t.trip_id) || {}).name || '') : '') + (t.note ? ' · ' + esc(t.note) : '');
  const tag = (pending ? '<span class="tag">待同步</span>' : '') + (t.source && t.source !== 'app' ? '<span class="tag">自動</span>' : '') + (num(t.fee) > 0 ? '<span class="tag">手續費 ' + mc(t.fee, acur(t.type === '轉帳' ? t.from_account_id : t.account_id)) + '</span>' : '');
  return '<div class="item click" data-act="editTx" data-id="' + t.id + '"><div><b>' + esc(title) + '</b>' + tag + '<br><small>' + md(t.tx_date) + ' · ' + sub + '</small></div><div class="amt">' + txAmt(t) + '</div></div>';
}

/* ---------- 記帳表單 ---------- */
function newTf(type) {
  return { type: type || '支', date: todayStr(), amount: '', account: store.get('lastAcct', ''), item: '', trip: '', fee: '', note: '', from: store.get('lastAcct', ''), fromAmt: '', to: '', toAmt: '', editId: null };
}
function acctOptions(sel, filter) {
  let h = '<option value="">請選擇</option>';
  KO.forEach(k => {
    const l = S.accts.filter(a => a.kind === k && (a.active || a.id === sel) && (!filter || filter(a)));
    if (l.length) h += '<optgroup label="' + k + '">' + l.map(a => '<option value="' + a.id + '"' + (a.id === sel ? ' selected' : '') + '>' + esc(a.name) + (a.currency !== 'TWD' ? '（' + a.currency + '）' : '') + '</option>').join('') + '</optgroup>';
  });
  return h;
}
function itemOptions(type, sel) {
  const l = S.items.filter(i => i.type === type && (i.active || i.id === sel));
  const g = {}; l.forEach(i => (g[i.group_name] = g[i.group_name] || []).push(i));
  return '<option value="">請選擇</option>' + Object.keys(g).map(k => '<optgroup label="' + esc(k) + '">' + g[k].map(i => '<option value="' + i.id + '"' + (i.id === sel ? ' selected' : '') + '>' + esc(i.name) + '</option>').join('') + '</optgroup>').join('');
}
function tripOptions(sel) {
  return '<option value="">（無）</option>' + S.trips.filter(t => t.active || t.id === sel).map(t => '<option value="' + t.id + '"' + (t.id === sel ? ' selected' : '') + '>' + esc(t.name) + '</option>').join('');
}
function addView() {
  const f = S.tf || (S.tf = newTf()), tr = f.type === '轉帳';
  const feeCur = acur(tr ? f.from : f.account);
  let h = '<div class="ph"><h2>' + (f.editId ? '編輯交易' : '記一筆') + '</h2></div><div class="form">';
  h += '<div class="seg">' + ['支', '收', '轉帳'].map(t => '<button data-act="tfType" data-v="' + t + '" class="' + (f.type === t ? 'on' : '') + '">' + (t === '支' ? '支出' : t === '收' ? '收入' : '轉帳') + '</button>').join('') + '</div>';
  if (!tr) {
    h += '<label>金額' + (acur(f.account) !== 'TWD' ? '（' + acur(f.account) + '）' : '') + '<input class="big" data-t="amount" inputmode="decimal" placeholder="0" value="' + esc(f.amount) + '"></label>';
    h += '<label>帳戶<select data-t="account">' + acctOptions(f.account) + '</select></label>';
    h += '<label>項目<select data-t="item">' + itemOptions(f.type, f.item) + '</select></label>';
  } else {
    h += '<div class="row"><label>轉出帳戶<select data-t="from">' + acctOptions(f.from) + '</select></label><label>轉出金額' + (acur(f.from) !== 'TWD' ? '（' + acur(f.from) + '）' : '') + '<input data-t="fromAmt" inputmode="decimal" value="' + esc(f.fromAmt) + '"></label></div>';
    h += '<div class="row"><label>轉入帳戶<select data-t="to">' + acctOptions(f.to) + '</select></label><label>轉入金額' + (acur(f.to) !== 'TWD' ? '（' + acur(f.to) + '）' : '') + '<input data-t="toAmt" inputmode="decimal" value="' + esc(f.toAmt) + '"></label></div>';
  }
  h += '<div class="row"><label>日期<input type="date" data-t="date" value="' + esc(f.date) + '"></label><label>手續費（' + feeCur + '）<input data-t="fee" inputmode="decimal" placeholder="0" value="' + esc(f.fee) + '"></label></div>';
  if (!tr) h += '<label>旅遊<select data-t="trip">' + tripOptions(f.trip) + '</select></label>';
  h += '<label>備註<input data-t="note" value="' + esc(f.note) + '"></label>';
  h += '<button class="btn block" data-act="saveTx">' + (f.editId ? '儲存修改' : '儲存') + '</button>';
  if (f.editId) h += '<div class="fbtn"><button class="btn sec" data-act="cancelTx">取消</button><button class="btn sec" data-act="delTx">刪除</button></div>';
  return h + '<p class="sub">手續費填在這裡，會跟這筆放在同一筆交易（算在「金融費用」）。</p></div>';
}
async function saveTx() {
  const f = S.tf, n = x => (x === '' || x == null ? null : Number(x));
  let row;
  if (f.type === '轉帳') {
    if (!f.from || !f.to) return toast('請選擇轉出與轉入帳戶');
    if (f.from === f.to) return toast('轉出與轉入不能是同一個帳戶');
    const fa = n(f.fromAmt), ta = n(f.toAmt) == null ? (acur(f.from) === acur(f.to) ? fa : null) : n(f.toAmt);
    if (!(fa > 0) || !(ta > 0)) return toast('請輸入轉出與轉入金額');
    row = { type: '轉帳', account_id: null, amount: null, item_id: null, trip_id: null, from_account_id: f.from, from_amount: fa, to_account_id: f.to, to_amount: ta };
  } else {
    if (!(n(f.amount) > 0)) return toast('請輸入金額');
    if (!f.account) return toast('請選擇帳戶');
    if (!f.item) return toast('請選擇項目');
    row = { type: f.type, account_id: f.account, amount: n(f.amount), item_id: f.item, trip_id: f.trip || null, from_account_id: null, from_amount: null, to_account_id: null, to_amount: null };
  }
  if (!f.date) return toast('請選擇日期');
  Object.assign(row, { tx_date: f.date, fee: n(f.fee) || 0, note: f.note || null, fx_rate: null });
  const id = f.editId || uuid();
  queue(f.editId ? 'update' : 'insert', id, row);
  if (f.type !== '轉帳') store.set('lastAcct', f.account);
  const wasEdit = !!f.editId;
  S.tf = newTf(f.type); S.page = wasEdit ? 'list' : 'add';
  render(); toast('處理中…');
  await flush();
  if (S.pend.length) toast('已暫存，連線後會自動送出'); else toast(wasEdit ? '已修改' : '已記帳');
  if (S.page === 'list') { await loadTxs(); render(); }
}

/* ---------- 通用表單（帳戶／項目／旅遊／訂閱／分期／指標卡／預算） ---------- */
const F = (k, label, t, o) => ({ k, label, t: t || 'text', ...(o || {}) });
const ENT = {
  acct: { table: 'accounts', title: '帳戶', prefix: 'A', list: () => S.accts, back: 'acct', sort: true, fields: () => [
    F('name', '名稱', 'text', { req: 1 }), F('kind', '類型', 'select', { opts: KO.map(k => [k, k]) }), F('institution', '銀行／機構（信用卡用來彙總）'),
    F('currency', '幣別（例如 TWD、USD、JPY）', 'text', { upper: 1 }), F('opening_balance', '起始餘額（信用卡欠款填負數）', 'number'),
    F('include_in_assets', '列入資產', 'check'), F('statement_day', '結帳日（信用卡）', 'number'), F('due_day', '繳款日（信用卡）', 'number'), F('active', '使用中（取消勾選＝新增交易時不再出現）', 'check')],
    defaults: { kind: '銀行帳戶', currency: 'TWD', opening_balance: 0, include_in_assets: true, active: true } },
  item: { table: 'items', title: '項目', prefix: 'I', list: () => S.items, back: 'settings', fields: e => [
    F('name', '名稱', 'text', { req: 1 }), F('type', '收支', 'select', { opts: [['支', '支出'], ['收', '收入']], lock: !!e }),
    F('group_name', '分類（群組）', 'text', { req: 1, dl: [...new Set(S.items.map(i => i.group_name))] }), F('active', '使用中', 'check')], defaults: { type: '支', active: true } },
  trip: { table: 'trips', title: '旅遊', prefix: 'T', list: () => S.trips, back: 'settings', fields: () => [
    F('name', '名稱', 'text', { req: 1 }), F('start_date', '開始日', 'date'), F('end_date', '結束日', 'date'), F('currency', '主要幣別', 'text', { upper: 1 }), F('active', '使用中', 'check')], defaults: { active: true } },
  sub: { table: 'subscriptions', title: '訂閱', prefix: 'S', list: () => S.subs, back: 'subs', fields: () => [
    F('name', '名稱', 'text', { req: 1 }), F('account_id', '扣款帳戶', 'select', { opts: S.accts.filter(a => a.active).map(a => [a.id, a.name]), blank: 1 }),
    F('item_id', '支出項目', 'select', { opts: S.items.filter(i => i.type === '支' && i.active).map(i => [i.id, i.group_name + '／' + i.name]), blank: 1 }),
    F('currency', '幣別', 'text', { upper: 1 }), F('amount', '每期金額', 'number', { req: 1 }), F('fee', '每期手續費（會另開一列記帳）', 'number'),
    F('cycle', '週期', 'select', { opts: [['每月', '每月'], ['每週', '每週'], ['每年', '每年']] }), F('anchor_day', '每月幾號扣款（1–31）', 'number'),
    F('next_date', '下次扣款日（到這天會自動入帳）', 'date'), F('auto_post', '自動入帳', 'check'), F('active', '使用中', 'check')], defaults: { currency: 'TWD', cycle: '每月', fee: 0, auto_post: true, active: true } },
  inst: { table: 'installments', title: '分期', prefix: 'P', list: () => S.insts, back: 'subs', fields: () => [
    F('name', '名稱', 'text', { req: 1 }), F('card_id', '信用卡', 'select', { opts: S.accts.filter(a => a.kind === '信用卡' && a.active).map(a => [a.id, a.name]), blank: 1 }),
    F('item_id', '支出項目', 'select', { opts: S.items.filter(i => i.type === '支' && i.active).map(i => [i.id, i.group_name + '／' + i.name]), blank: 1 }),
    F('total_amount', '總金額', 'number', { req: 1 }), F('periods', '分幾期', 'number', { req: 1 }), F('per_period', '每期金額（留空＝總金額÷期數）', 'number'),
    F('fee', '每期手續費（會另開一列記帳）', 'number'), F('anchor_day', '每月幾號扣款（1–31）', 'number'), F('posted_periods', '已入帳期數', 'number'),
    F('next_date', '下次扣款日（到這天會自動入帳）', 'date'), F('auto_post', '自動入帳', 'check'), F('active', '使用中', 'check')], defaults: { fee: 0, posted_periods: 0, auto_post: true, active: true } }
};
function openEnt(kind, id) {
  const E = ENT[kind], row = id ? E.list().find(x => x.id === id) : null;
  S.form = { kind, id: id || null, v: { ...(E.defaults || {}), ...(row || {}) }, back: S.page };
  render(); window.scrollTo(0, 0);
}
function fieldHtml(f, v) {
  const val = v[f.k];
  if (f.t === 'check') return '<label class="chk"><input type="checkbox" data-f="' + f.k + '"' + (val ? ' checked' : '') + '>' + esc(f.label) + '</label>';
  let inp;
  if (f.t === 'select') inp = '<select data-f="' + f.k + '"' + (f.lock ? ' disabled' : '') + '>' + (f.blank ? '<option value="">請選擇</option>' : '') + f.opts.map(o => '<option value="' + esc(o[0]) + '"' + (String(val) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>';
  else if (f.t === 'area') inp = '<textarea id="fml" data-f="' + f.k + '" rows="3">' + esc(val) + '</textarea>';
  else inp = '<input data-f="' + f.k + '" type="' + (f.t === 'number' ? 'text' : f.t) + '"' + (f.t === 'number' ? ' inputmode="decimal"' : '') + (f.dl ? ' list="dl_' + f.k + '"' : '') + ' value="' + esc(val == null ? '' : val) + '">' + (f.dl ? '<datalist id="dl_' + f.k + '">' + f.dl.map(x => '<option value="' + esc(x) + '">').join('') + '</datalist>' : '');
  return '<label>' + esc(f.label) + inp + '</label>';
}
function entForm() {
  const fm = S.form, E = ENT[fm.kind], row = fm.id ? E.list().find(x => x.id === fm.id) : null;
  const fields = E.fields(row);
  return '<div class="ph"><h2>' + (fm.id ? '編輯' : '新增') + E.title + '</h2></div><div class="form">' + fields.map(f => fieldHtml(f, fm.v)).join('') +
    '<div class="fbtn"><button class="btn sec" data-act="formCancel">取消</button><button class="btn" data-act="entSave">儲存</button></div></div>';
}
async function entSave() {
  const fm = S.form, E = ENT[fm.kind], row = fm.id ? E.list().find(x => x.id === fm.id) : null, out = {};
  for (const f of E.fields(row)) {
    let v = fm.v[f.k];
    if (f.t === 'check') v = !!v;
    else if (f.t === 'number') { v = (v === '' || v == null) ? null : Number(v); if (v != null && isNaN(v)) return toast('「' + f.label + '」要填數字'); }
    else { v = (v == null ? '' : String(v)).trim(); if (f.upper) v = v.toUpperCase(); if (v === '') v = null; }
    if (f.req && (v == null)) return toast('請填「' + f.label.split('（')[0] + '」');
    if (f.t === 'select' && f.blank && v == null && (fm.kind === 'sub' || fm.kind === 'inst') ) return toast('請選擇「' + f.label.split('（')[0] + '」');
    out[f.k] = v;
  }
  if (fm.kind === 'acct') {
    if (!/^[A-Z]{3}$/.test(out.currency || '')) return toast('幣別要是 3 個英文字母，例如 TWD');
    if (out.opening_balance == null) out.opening_balance = 0;
  }
  if (fm.kind === 'sub' || fm.kind === 'inst') {
    if (out.fee == null) out.fee = 0;
    if (out.anchor_day != null && (out.anchor_day < 1 || out.anchor_day > 31)) return toast('扣款日要在 1–31');
    if (!out.next_date && out.anchor_day) out.next_date = nextDateFor(out.anchor_day);
    if (out.auto_post && !out.next_date) return toast('自動入帳需要「每月幾號」或「下次扣款日」');
  }
  if (fm.kind === 'sub' && !(out.amount > 0)) return toast('每期金額要大於 0');
  if (fm.kind === 'inst') {
    if (!(out.total_amount > 0) || !(out.periods > 0)) return toast('總金額與期數要大於 0');
    if (out.per_period == null) out.per_period = Math.round(out.total_amount / out.periods * 100) / 100;
    if (out.posted_periods == null) out.posted_periods = 0;
    if (out.posted_periods > out.periods) return toast('已入帳期數不能大於總期數');
  }
  let q;
  if (fm.id) { if (fm.kind === 'item') delete out.type; q = await sb.from(E.table).update(out).eq('id', fm.id); }
  else {
    out.id = nextId(E.list(), E.prefix);
    if (E.sort || fm.kind === 'item') { const same = fm.kind === 'item' ? S.items.filter(i => i.type === out.type) : S.accts.filter(a => a.kind === out.kind); out.sort_order = same.reduce((m, x) => Math.max(m, x.sort_order || 0), 0) + 10; }
    q = await sb.from(E.table).insert(out);
  }
  if (q.error) return toast('儲存失敗：' + q.error.message);
  S.form = null; await load(); render(); toast('已儲存');
}

/* ---------- 指標卡 ---------- */
function openCard(id) {
  const c = id ? S.cards.find(x => x.id === id) : null;
  S.form = { kind: 'card', id: id || null, v: c ? { title: c.title, format: c.format, note: c.note || '', formula: c.formula } : { title: '', format: 'money', note: '', formula: '' }, back: 'dash' };
  render(); window.scrollTo(0, 0); previewCard();
}
function cardForm() {
  const fm = S.form, v = vars();
  const ops = ['+', '−', '×', '÷', '(', ')'].map(o => '<button class="chip" data-act="chip" data-t="' + o + '">' + o + '</button>').join('');
  const base = BASE_VARS.map(n => '<button class="chip" data-act="chip" data-t="' + n + '" title="' + esc(money(v[n])) + '">' + n + '</button>').join('');
  const acc = S.accts.filter(a => a.active || num(v['帳戶_' + a.id]) !== 0).map(a => '<button class="chip" data-act="chip" data-t="帳戶_' + a.id + '" title="' + esc(money(v['帳戶_' + a.id])) + '">' + esc(a.name) + '</button>').join('');
  return '<div class="ph"><h2>' + (fm.id ? '編輯指標卡' : '新增指標卡') + '</h2></div><div class="form">' +
    fieldHtml(F('title', '名稱', 'text'), fm.v) +
    fieldHtml(F('format', '顯示格式', 'select', { opts: [['money', '金額'], ['percent', '百分比'], ['number', '數字']] }), fm.v) +
    fieldHtml(F('note', '備註（卡片下方小字）', 'text'), fm.v) +
    fieldHtml(F('formula', '公式（點下面的項目就會加進去，也可以直接輸入）', 'area'), fm.v) +
    '<div class="chips">' + ops + '</div><div class="chips">' + base + '</div><details><summary>各帳戶（台幣價值）</summary><div class="chips">' + acc + '</div></details>' +
    '<div class="prev" id="prev"></div>' +
    '<div class="fbtn"><button class="btn sec" data-act="formCancel">取消</button>' + (fm.id ? '<button class="btn sec" data-act="cardDel">刪除</button>' : '') + '<button class="btn" data-act="cardSave">儲存</button></div></div>';
}
function previewCard() {
  const p = $('#prev'); if (!p || !S.form) return;
  const r = Formula.evalFormula(S.form.v.formula, vars());
  p.innerHTML = r.error ? '<span class="e">⚠ ' + esc(r.error) + '</span>' : '<b>預覽：' + esc(Formula.fmt(r.value, S.form.v.format)) + '</b>';
}
async function cardSave() {
  const v = S.form.v;
  if (!String(v.title || '').trim()) return toast('請填名稱');
  const r = Formula.evalFormula(v.formula, vars());
  if (r.error) return toast('公式有問題：' + r.error);
  const row = { title: v.title.trim(), formula: v.formula.trim(), format: v.format, note: (v.note || '').trim() || null };
  let q;
  if (S.form.id) q = await sb.from('dashboard_cards').update(row).eq('id', S.form.id);
  else { row.sort_order = S.cards.reduce((m, c) => Math.max(m, c.sort_order || 0), 0) + 10; q = await sb.from('dashboard_cards').insert(row); }
  if (q.error) return toast('儲存失敗：' + q.error.message);
  S.form = null; await load(); render(); toast('已儲存');
}
async function moveRows(table, list, id, dir) {
  const i = list.findIndex(x => x.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  const arr = list.slice(); [arr[i], arr[j]] = [arr[j], arr[i]];
  const rs = await Promise.all(arr.map((x, n) => (x.sort_order !== (n + 1) * 10 ? sb.from(table).update({ sort_order: (n + 1) * 10 }).eq('id', x.id) : null)).filter(Boolean));
  const bad = rs.find(r => r.error);
  if (bad) return toast('排序失敗：' + bad.error.message);
  await load(); render();
}

/* ---------- 匯率 ---------- */
function latestFx() { const m = {}; S.fx.forEach(f => { if (!m[f.currency]) m[f.currency] = f; }); return m; }
async function fxUpdate(silent) {
  const cur = [...new Set(S.accts.filter(a => a.active && a.currency !== 'TWD').map(a => a.currency))];
  if (!cur.length) return;
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/TWD');
    const j = await res.json();
    if (!j.rates) throw new Error('no rates');
    const d = todayStr(), rows = cur.filter(c => j.rates[c] > 0).map(c => ({ user_id: S.user.id, rate_date: d, currency: c, rate: Number((1 / j.rates[c]).toFixed(6)), source: 'open.er-api.com' }));
    if (!rows.length) return;
    const { error } = await sb.from('fx_rates').upsert(rows, { onConflict: 'user_id,currency,rate_date' });
    if (error) throw error;
    await load(); render(); if (!silent) toast('匯率已更新');
  } catch (e) { if (!silent) toast('匯率更新失敗，可以手動輸入'); }
}

/* ---------- 頁面 ---------- */
function dashView() {
  const v = vars(), n = S.cards.length;
  let h = '<div class="ph"><h2>財務總覽</h2><div class="pa"><button class="btn sm sec" data-act="exportAll">備份資料</button><button class="btn sm" data-act="cardNew">＋ 指標卡</button></div></div>';
  if (S.offline) h += '<div class="box warn">目前離線，顯示的是上次同步的資料。</div>';
  if (S.pend.length) h += '<div class="box warn">有 ' + S.pend.length + ' 筆待同步，連線後會自動送出。<button class="btn sm" data-act="flush">立即同步</button></div>';
  h += '<div class="cards">' + S.cards.map((c, i) => {
    const r = Formula.evalFormula(c.formula, v);
    return '<div class="mcard"><div class="mh"><span>' + esc(c.title) + '</span><span class="mc"><button class="ico" data-act="cardMove" data-id="' + c.id + '" data-d="-1"' + (i === 0 ? ' disabled' : '') + ' aria-label="往前">←</button><button class="ico" data-act="cardMove" data-id="' + c.id + '" data-d="1"' + (i === n - 1 ? ' disabled' : '') + ' aria-label="往後">→</button><button class="ico" data-act="cardEdit" data-id="' + c.id + '" aria-label="設定">⚙</button></span></div>' +
      '<div class="cv ' + (r.error ? 'e' : '') + '">' + (r.error ? '公式有誤' : esc(Formula.fmt(r.value, c.format))) + '</div><div class="mn">' + esc(r.error || c.note || '') + '</div></div>';
  }).join('') + '</div>';
  h += '<div class="two"><div class="panel"><h3>近 8 個月收支</h3>' + trend() + '</div><div class="panel"><h3>本月支出分類</h3>' + catBars(curMonth(), false) + '</div></div>';
  h += '<div class="two"><div class="panel"><h3>最近交易 <button class="link" data-act="go" data-p="list">全部 ›</button></h3>' + (S.pend.map(p => txRow({ ...p.row, id: p.id }, true)).join('') + S.recent.map(t => txRow(t)).join('') || '<p class="sub">還沒有交易</p>') + '</div>' + fxPanel() + '</div>';
  return h;
}
function trend() {
  const ms = []; for (let i = 7; i >= 0; i--) ms.push(addMonth(curMonth(), -i));
  const d = ms.map(m => { const r = S.monthly.find(x => x.month === m) || {}; return [m, num(r.income), num(r.expense)]; });
  const mx = Math.max(1, ...d.map(x => Math.max(x[1], x[2])));
  let s = '<svg class="chart" viewBox="0 0 320 130" role="img" aria-label="近八個月收入與支出長條圖">';
  d.forEach((x, i) => {
    const bx = 8 + i * 38, hi = x[1] / mx * 96, he = x[2] / mx * 96;
    s += '<rect class="bi" x="' + bx + '" y="' + (104 - hi) + '" width="14" height="' + hi + '" rx="2"><title>' + x[0] + ' 收入 ' + money(x[1]) + '</title></rect><rect class="be" x="' + (bx + 15) + '" y="' + (104 - he) + '" width="14" height="' + he + '" rx="2"><title>' + x[0] + ' 支出 ' + money(x[2]) + '</title></rect><text x="' + (bx + 15) + '" y="120" text-anchor="middle">' + x[0].slice(5) + '月</text>';
  });
  return s + '</svg><div class="legend"><span><i style="background:var(--inc)"></i>收入</span><span><i style="background:var(--exp)"></i>支出</span></div>';
}
function catBars(m, withBudget) {
  const rows = S.cat.filter(c => c.month === m && num(c.amount) > 0);
  const bud = {}; S.budgets.forEach(b => (bud[b.group_name] = num(b.amount_twd)));
  const names = [...new Set([...rows.map(r => r.grp), ...(withBudget ? Object.keys(bud) : [])])];
  const data = names.map(g => ({ g, a: num((rows.find(r => r.grp === g) || {}).amount), b: bud[g] || 0 })).sort((x, y) => y.a - x.a);
  if (!data.length) return '<p class="sub">這個月還沒有支出</p>';
  const mx = Math.max(1, ...data.map(d => d.a));
  return data.map(d => {
    const pct = withBudget && d.b ? Math.min(100, d.a / d.b * 100) : d.a / mx * 100;
    return '<div class="crow"><div><span>' + esc(d.g) + '</span><b>' + money(d.a) + (withBudget && d.b ? ' <small>/ ' + money(d.b) + '</small>' : '') + '</b></div><div class="bar ' + (withBudget && d.b && d.a > d.b ? 'over' : '') + '"><i style="width:' + pct + '%"></i></div></div>';
  }).join('');
}
function fxPanel() {
  const l = latestFx(), ks = Object.keys(l);
  return '<div class="panel"><h3>匯率 <span><button class="btn sm sec" data-act="fxUpdate">更新</button></span></h3>' + (ks.length ? ks.map(k => '<div class="item"><span>' + k + '</span><span class="amt">' + Number(l[k].rate).toFixed(4) + ' <small>' + md(l[k].rate_date) + '</small></span></div>').join('') : '<p class="sub">尚無匯率</p>') + '</div>';
}

function listView() {
  const q = S.q.trim().toLowerCase();
  const rows = S.txs.filter(t => !q || [t.note, itemName(t.item_id), an(t.account_id), an(t.from_account_id), an(t.to_account_id), String(t.amount || t.from_amount || '')].join(' ').toLowerCase().includes(q));
  const inc = rows.filter(t => t.type === '收').reduce((s, t) => s + num(t.twd_amount), 0), exp = rows.filter(t => t.type === '支').reduce((s, t) => s + num(t.twd_amount), 0) + rows.reduce((s, t) => s + num(t.fee_twd), 0);
  return '<div class="ph"><h2>明細</h2><div class="pa"><button class="btn sm sec" data-act="mon" data-d="-1">‹</button><input type="month" id="txm" value="' + S.txMonth + '" style="width:150px;margin:0"><button class="btn sm sec" data-act="mon" data-d="1">›</button></div></div>' +
    '<input id="txq" placeholder="搜尋備註、項目、帳戶、金額" value="' + esc(S.q) + '" style="margin:0 0 10px">' +
    '<div class="sum"><div>收入<b class="i">' + money(inc) + '</b></div><div>支出<b class="e">' + money(exp) + '</b></div><div>結餘<b>' + money(inc - exp) + '</b></div></div>' +
    '<div class="panel">' + (S.pend.map(p => txRow({ ...p.row, id: p.id }, true)).join('') + rows.map(t => txRow(t)).join('') || '<p class="sub">沒有符合的交易</p>') + '</div>';
}

function acctRow(a, list) {
  const b = S.bal.find(x => x.id === a.id) || {}, bal = num(b.balance), fx = a.currency !== 'TWD';
  const left = '<div><b>' + esc(a.name) + '</b>' + (a.active ? '' : '<span class="tag">停用</span>') + (a.include_in_assets ? '' : '<span class="tag">不列入資產</span>') + '<br><small>' + esc(a.institution || '') + (fx ? ' ' + a.currency : '') + '</small></div>';
  if (S.sort) {
    const i = list.findIndex(x => x.id === a.id);
    return '<div class="item">' + left + '<span class="pa"><button class="mvb" data-act="acctMove" data-id="' + a.id + '" data-d="-1"' + (i === 0 ? ' disabled' : '') + ' aria-label="上移">▲</button><button class="mvb" data-act="acctMove" data-id="' + a.id + '" data-d="1"' + (i === list.length - 1 ? ' disabled' : '') + ' aria-label="下移">▼</button></span></div>';
  }
  return '<div class="item click" data-act="acctEdit" data-id="' + a.id + '">' + left + '<div class="amt ' + (bal < 0 ? 'e' : '') + '">' + mc(bal, a.currency) + (fx ? '<br><small>≈ ' + money(b.twd_value) + '</small>' : '') + '</div></div>';
}
const hiddenAcct = a => !a.name || /^(保留|預留|備用)/.test(a.name);
function acctGroups(kinds) {
  return kinds.map(k => {
    const l = S.accts.filter(a => a.kind === k && !hiddenAcct(a) && (a.active || S.showOff || S.sort));
    if (!l.length) return '';
    const sum = l.filter(a => a.include_in_assets || k === '信用卡').reduce((s, a) => s + num((S.bal.find(b => b.id === a.id) || {}).twd_value), 0);
    return '<div class="panel"><h3>' + k + ' <span class="sub">' + money(sum) + '</span></h3><div class="cols2">' + l.map(a => acctRow(a, l)).join('') + '</div></div>';
  }).join('');
}
function acctView() {
  const v = vars();
  return '<div class="ph"><h2>帳戶</h2><div class="pa"><button class="btn sm sec" data-act="sortToggle">' + (S.sort ? '完成排序' : '整理順序') + '</button><button class="btn sm sec" data-act="offToggle">' + (S.showOff ? '隱藏停用' : '顯示停用') + '</button><button class="btn sm" data-act="acctNew">＋ 新增</button></div></div>' +
    '<div class="sum"><div>帳戶總額<b>' + money(v['帳戶總額']) + '</b></div><div>信用卡淨待繳<b class="e">' + money(v['信用卡淨待繳']) + '</b></div><div>淨資產<b>' + money(v['淨資產']) + '</b></div></div>' +
    (S.sort ? '<div class="box warn">用 ▲▼ 調整順序（只在同類型內移動）。</div>' : '') + acctGroups(KO);
}

function cardsView() {
  const cs = S.accts.filter(a => a.kind === '信用卡' && !hiddenAcct(a) && (a.active || S.showOff || S.sort));
  const info = cs.map(a => ({ a, bal: num((S.bal.find(b => b.id === a.id) || {}).twd_value) }));
  const due = info.filter(x => x.bal < 0).reduce((s, x) => s + -x.bal, 0), over = info.filter(x => x.bal > 0).reduce((s, x) => s + x.bal, 0);
  const banks = {}; info.forEach(x => { const k = x.a.institution || '其他'; (banks[k] = banks[k] || { due: 0, list: [] }); banks[k].due += -x.bal; banks[k].list.push(x); });
  let h = '<div class="ph"><h2>信用卡</h2><div class="pa"><button class="btn sm sec" data-act="sortToggle">' + (S.sort ? '完成排序' : '整理順序') + '</button><button class="btn sm" data-act="acctNew">＋ 新增</button></div></div>';
  h += '<div class="sum"><div>未扣溢繳待繳<b class="e">' + money(due) + '</b></div><div>溢繳合計<b class="i">' + money(over) + '</b></div><div>扣抵後淨待繳<b class="e">' + money(due - over) + '</b></div></div>';
  h += '<div class="panel"><h3>各銀行待繳</h3>' + Object.keys(banks).map(k => '<div class="item"><span>' + esc(k) + '</span><b class="' + (banks[k].due > 0 ? 'e' : 'i') + '">' + money(banks[k].due) + '</b></div>').join('') + '</div>';
  h += '<div class="cols2">' + info.map(x => {
    const a = x.a, st = x.bal < 0 ? '待繳 ' + money(-x.bal) : x.bal > 0 ? '溢繳 ' + money(x.bal) : '已繳清';
    const days = (a.statement_day ? '結帳 ' + a.statement_day + ' 號' : '') + (a.due_day ? (a.statement_day ? '・' : '') + '繳款 ' + a.due_day + ' 號' : '');
    if (S.sort) { const i = cs.findIndex(c => c.id === a.id); return '<div class="panel item"><div><b>' + esc(a.name) + '</b></div><span class="pa"><button class="mvb" data-act="acctMove" data-id="' + a.id + '" data-d="-1"' + (i === 0 ? ' disabled' : '') + '>▲</button><button class="mvb" data-act="acctMove" data-id="' + a.id + '" data-d="1"' + (i === cs.length - 1 ? ' disabled' : '') + '>▼</button></span></div>'; }
    return '<div class="panel item click" data-act="acctEdit" data-id="' + a.id + '"><div><b>' + esc(a.name) + '</b>' + (a.active ? '' : '<span class="tag">停用</span>') + '<br><small>' + esc(a.institution || '') + (days ? ' ・ ' + days : '') + '</small></div><div class="amt ' + (x.bal < 0 ? 'e' : x.bal > 0 ? 'i' : '') + '">' + st + '</div></div>';
  }).join('') + '</div>';
  return h;
}

function subsView() {
  let h = '<div class="ph"><h2>訂閱與分期</h2><div class="pa"><button class="btn sm sec" data-act="runNow">檢查今天到期項目</button></div></div>';
  h += '<div class="box">到扣款日，系統每天凌晨與你打開 App 時會自動入帳；手續費另開一列。</div>';
  h += '<div class="panel"><h3>訂閱 <button class="btn sm" data-act="subNew">＋ 新增</button></h3>' + (S.subs.map(s => '<div class="item click" data-act="subEdit" data-id="' + s.id + '" style="' + (s.active ? '' : 'opacity:.5') + '"><div><b>' + esc(s.name) + '</b>' + (s.auto_post ? '<span class="tag">自動</span>' : '') + (s.active ? '' : '<span class="tag">停用</span>') + '<br><small>' + esc(an(s.account_id)) + ' · ' + s.cycle + (s.cycle === '每月' && s.anchor_day ? ' ' + s.anchor_day + ' 號' : '') + ' · 下次 ' + (s.next_date || '—') + '</small></div><div class="amt">' + mc(s.amount, s.currency) + (num(s.fee) > 0 ? '<br><small>+手續費 ' + mc(s.fee, s.currency) + '</small>' : '') + '</div></div>').join('') || '<p class="sub">尚無訂閱</p>') + '</div>';
  h += '<div class="panel"><h3>分期 <button class="btn sm" data-act="instNew">＋ 新增</button></h3>' + (S.insts.map(p => {
    const left = Math.max(0, p.periods - p.posted_periods), pct = p.posted_periods / p.periods * 100;
    return '<div class="item click" data-act="instEdit" data-id="' + p.id + '" style="' + (p.active ? '' : 'opacity:.5') + '"><div style="flex:1"><b>' + esc(p.name) + '</b>' + (p.auto_post ? '<span class="tag">自動</span>' : '') + '<br><small>' + esc(an(p.card_id)) + ' · 每月 ' + (p.anchor_day || '—') + ' 號 · ' + p.posted_periods + '/' + p.periods + ' 期 · 下次 ' + (left ? (p.next_date || '—') : '已完成') + '</small><div class="bar"><i style="width:' + pct + '%"></i></div></div><div class="amt">' + money(p.per_period) + '<br><small>剩 ' + money(left * num(p.per_period)) + '</small></div></div>';
  }).join('') || '<p class="sub">尚無分期</p>') + '</div>';
  return h;
}
async function runNow(silent) {
  const { data, error } = await sb.rpc('run_recurring');
  if (error) { if (!silent) toast('檢查失敗：' + error.message); return; }
  if (data && data.posted > 0) { await load(); if (S.page === 'list') await loadTxs(); render(); toast('已自動入帳 ' + data.posted + ' 筆'); }
  else if (!silent) toast('今天沒有到期的項目');
  if (data && data.errors && data.errors.length) toast('有項目失敗：' + data.errors[0].name + '：' + data.errors[0].error);
}

function reportView() {
  const m = S.rm, r = S.monthly.find(x => x.month === m) || {}, inc = num(r.income), exp = num(r.expense);
  return '<div class="ph"><h2>月報</h2><div class="pa"><button class="btn sm sec" data-act="rmon" data-d="-1">‹</button><b>' + m + '</b><button class="btn sm sec" data-act="rmon" data-d="1">›</button></div></div>' +
    '<div class="sum"><div>收入<b class="i">' + money(inc) + '</b></div><div>支出<b class="e">' + money(exp) + '</b></div><div>結餘<b>' + money(inc - exp) + '</b></div></div>' +
    '<div class="panel"><h3>分類支出與預算 <button class="btn sm sec" data-act="budgetEdit">設定預算</button></h3>' + catBars(m, true) + '</div>';
}
function budgetForm() {
  const groups = [...new Set(S.items.filter(i => i.type === '支').map(i => i.group_name)), '金融費用'];
  const v = S.form.v;
  return '<div class="ph"><h2>每月預算</h2></div><div class="form"><p class="sub">以分類為單位，留空＝不設預算。</p>' + groups.map((g, i) => '<label>' + esc(g) + '<input data-f="b' + i + '" inputmode="decimal" value="' + esc(v['b' + i] == null ? '' : v['b' + i]) + '"></label>').join('') +
    '<div class="fbtn"><button class="btn sec" data-act="formCancel">取消</button><button class="btn" data-act="budgetSave">儲存</button></div></div>';
}
async function budgetSave() {
  const groups = [...new Set(S.items.filter(i => i.type === '支').map(i => i.group_name)), '金融費用'];
  const up = [], del = [];
  for (let i = 0; i < groups.length; i++) {
    const raw = String(S.form.v['b' + i] == null ? '' : S.form.v['b' + i]).trim();
    if (raw === '') { del.push(groups[i]); continue; }
    const n = Number(raw); if (isNaN(n) || n < 0) return toast('「' + groups[i] + '」要填數字');
    up.push({ user_id: S.user.id, group_name: groups[i], amount_twd: n });
  }
  let q = up.length ? await sb.from('budgets').upsert(up, { onConflict: 'user_id,group_name' }) : {};
  if (q.error) return toast('儲存失敗：' + q.error.message);
  if (del.length) { q = await sb.from('budgets').delete().in('group_name', del); if (q.error) return toast('儲存失敗：' + q.error.message); }
  S.form = null; await load(); render(); toast('已儲存');
}

function settingsView() {
  let h = '<div class="ph"><h2>設定</h2></div>';
  ['支', '收'].forEach(t => {
    const l = S.items.filter(i => i.type === t);
    h += '<div class="panel"><h3>' + (t === '支' ? '支出' : '收入') + '項目 <span class="pa"><button class="btn sm sec" data-act="itemSort">' + (S.sort ? '完成排序' : '整理順序') + '</button><button class="btn sm" data-act="itemNew" data-t="' + t + '">＋ 新增</button></span></h3><div class="cols2">' + l.map((i, n) => S.sort
      ? '<div class="item"><span>' + esc(i.group_name) + '／' + esc(i.name) + '</span><span class="pa"><button class="mvb" data-act="itemMove" data-id="' + i.id + '" data-d="-1"' + (n === 0 ? ' disabled' : '') + '>▲</button><button class="mvb" data-act="itemMove" data-id="' + i.id + '" data-d="1"' + (n === l.length - 1 ? ' disabled' : '') + '>▼</button></span></div>'
      : '<div class="item click" data-act="itemEdit" data-id="' + i.id + '" style="' + (i.active ? '' : 'opacity:.5') + '"><span>' + esc(i.name) + ' <small>' + esc(i.group_name) + '</small></span></div>').join('') + '</div></div>';
  });
  h += '<div class="panel"><h3>旅遊 <button class="btn sm" data-act="tripNew">＋ 新增</button></h3>' + (S.trips.map(t => '<div class="item click" data-act="tripEdit" data-id="' + t.id + '"><span>' + esc(t.name) + '</span><small>' + (t.start_date || '') + (t.end_date ? ' ~ ' + t.end_date : '') + '</small></div>').join('') || '<p class="sub">尚無</p>') + '</div>';
  h += '<div class="panel"><h3>匯率 <button class="btn sm sec" data-act="fxUpdate">自動更新</button></h3>' + Object.values(latestFx()).map(f => '<div class="item"><span>' + f.currency + '</span><span>' + Number(f.rate).toFixed(4) + ' <small>' + f.rate_date + '</small></span></div>').join('') + '<button class="link" data-act="fxManual">手動輸入匯率</button></div>';
  h += '<div class="panel"><h3>資料</h3><div class="pa"><button class="btn sm sec" data-act="exportAll">備份全部（JSON）</button><button class="btn sm sec" data-act="exportCsv">匯出交易（CSV）</button><button class="btn sm sec" data-act="go" data-p="legacy">查看舊資料（唯讀）</button></div></div>';
  h += '<div class="panel"><h3>帳號</h3><p class="sub">' + esc((S.user || {}).email || '') + '</p><button class="btn sm sec" data-act="logout">登出</button></div>';
  return h;
}
function fxForm() {
  return '<div class="ph"><h2>手動輸入匯率</h2></div><div class="form">' + fieldHtml(F('currency', '幣別', 'text'), S.form.v) + fieldHtml(F('rate', '1 單位外幣 = 多少台幣', 'number'), S.form.v) + fieldHtml(F('date', '日期', 'date'), S.form.v) +
    '<div class="fbtn"><button class="btn sec" data-act="formCancel">取消</button><button class="btn" data-act="fxSave">儲存</button></div></div>';
}
async function fxSave() {
  const v = S.form.v, c = String(v.currency || '').trim().toUpperCase(), r = Number(v.rate);
  if (!/^[A-Z]{3}$/.test(c) || c === 'TWD' || !(r > 0) || !v.date) return toast('請填正確的幣別、匯率、日期');
  const { error } = await sb.from('fx_rates').upsert({ user_id: S.user.id, rate_date: v.date, currency: c, rate: r, source: 'manual' }, { onConflict: 'user_id,currency,rate_date' });
  if (error) return toast('儲存失敗：' + error.message);
  S.form = null; await load(); render(); toast('已儲存');
}

async function loadLegacy() {
  const L = S.legacy, q = L.q.replace(/[,()%*\\]/g, ' ').trim();
  let r = sb.from('legacy_transactions').select('*', { count: 'exact' });
  if (q) r = r.or('note.ilike.%' + q + '%,item_name.ilike.%' + q + '%,account_name.ilike.%' + q + '%');
  const { data, count, error } = await r.order('tx_date', { ascending: false }).range(L.p * 50, L.p * 50 + 49);
  if (error) return toast('讀取失敗：' + error.message);
  L.rows = data || []; L.n = count || 0;
}
function legacyView() {
  const L = S.legacy;
  return '<div class="ph"><h2>舊資料（唯讀）</h2><button class="btn sm sec" data-act="go" data-p="settings">返回</button></div><input id="lq" placeholder="搜尋備註、項目、帳戶" value="' + esc(L.q) + '" style="margin:0 0 10px"><div class="panel">' +
    (L.rows.map(t => '<div class="item"><div><b>' + esc(t.item_name || t.type || '') + '</b><br><small>' + esc(t.tx_date || '') + ' · ' + esc(t.account_name || (t.from_name ? t.from_name + ' → ' + t.to_name : '')) + (t.note ? ' · ' + esc(t.note) : '') + '</small></div><div class="amt">' + (t.amount != null ? Math.round(num(t.amount)).toLocaleString('zh-TW') : t.from_amount != null ? Math.round(num(t.from_amount)).toLocaleString('zh-TW') : '') + '</div></div>').join('') || '<p class="sub">沒有資料</p>') +
    '</div><div class="pa"><button class="btn sm sec" data-act="lpage" data-d="-1"' + (L.p === 0 ? ' disabled' : '') + '>上一頁</button><span class="sub">' + (L.n ? (L.p * 50 + 1) + '–' + Math.min(L.n, L.p * 50 + 50) + ' / ' + L.n : '0') + '</span><button class="btn sm sec" data-act="lpage" data-d="1"' + ((L.p + 1) * 50 >= L.n ? ' disabled' : '') + '>下一頁</button></div>';
}
function moreView() {
  return '<div class="ph"><h2>更多</h2></div><div class="panel">' + [['cards', '信用卡'], ['subs', '訂閱與分期'], ['report', '月報與預算'], ['settings', '設定']].map(x => '<div class="item click" data-act="go" data-p="' + x[0] + '"><b>' + x[1] + '</b><span>›</span></div>').join('') + '</div>';
}

/* ---------- 匯出 ---------- */
async function fetchAll(table) {
  let out = [], from = 0;
  for (;;) {
    const { data, error } = await sb.from(table).select('*').order('id').range(from, from + 999);
    if (error) throw error;
    out = out.concat(data); if (data.length < 1000) break; from += 1000;
  }
  return out;
}
async function exportAll() {
  toast('備份中…');
  try {
    const t = ['accounts', 'items', 'trips', 'fx_rates', 'budgets', 'goals', 'subscriptions', 'installments', 'dashboard_cards', 'transactions', 'legacy_transactions'], o = {};
    for (const k of t) o[k] = await fetchAll(k);
    download('ledger-backup-' + todayStr() + '.json', JSON.stringify(o));
    toast('已下載備份檔');
  } catch (e) { toast('備份失敗：' + e.message); }
}
async function exportCsv() {
  try {
    const rows = await fetchAll('transactions'), cols = ['tx_date', 'type', 'account_id', 'amount', 'item_id', 'trip_id', 'from_account_id', 'from_amount', 'to_account_id', 'to_amount', 'fee', 'twd_amount', 'fee_twd', 'note', 'source'];
    const c = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    download('transactions-' + todayStr() + '.csv', '﻿' + cols.join(',') + '\n' + rows.filter(r => !r.deleted_at).map(r => cols.map(k => c(r[k])).join(',')).join('\n'), 'text/csv');
  } catch (e) { toast('匯出失敗：' + e.message); }
}

/* ---------- 版面 ---------- */
const NAV = [['dash', '總覽'], ['add', '記帳'], ['list', '明細'], ['acct', '帳戶'], ['cards', '信用卡'], ['subs', '訂閱與分期'], ['report', '月報'], ['settings', '設定']];
const BOT = [['dash', '總覽'], ['list', '明細'], ['add', '＋記帳'], ['acct', '帳戶'], ['more', '更多']];
function loginView() {
  return '<div class="login"><h2 style="margin-bottom:14px">記帳</h2><label>Email<input id="em" type="email" autocomplete="username"></label><label>密碼<input id="pw" type="password" autocomplete="current-password"></label>' +
    (S.loginErr ? '<p class="e">' + esc(S.loginErr) + '</p>' : '') + '<button class="btn block" data-act="login">登入</button></div>';
}
function body() {
  const f = S.form;
  if (f) {
    if (f.kind === 'card') return cardForm();
    if (f.kind === 'budget') return budgetForm();
    if (f.kind === 'fx') return fxForm();
    return entForm();
  }
  switch (S.page) {
    case 'dash': return dashView(); case 'add': return addView(); case 'list': return listView(); case 'acct': return acctView();
    case 'cards': return cardsView(); case 'subs': return subsView(); case 'report': return reportView(); case 'settings': return settingsView();
    case 'legacy': return legacyView(); case 'more': return moreView();
  }
  return '';
}
function render() {
  const app = $('#app');
  if (!S.user) { app.innerHTML = loginView(); return; }
  const on = p => (S.page === p || (p === 'more' && ['cards', 'subs', 'report', 'settings', 'legacy'].includes(S.page))) ? 'on' : '';
  const ae = document.activeElement, keep = ae && ae.id && $('#' + ae.id) ? ae.id : null;
  app.innerHTML = '<div class="shell"><nav class="side"><div class="brand">記帳</div>' + NAV.map(n => '<button data-act="go" data-p="' + n[0] + '" class="' + on(n[0]) + '">' + n[1] + '</button>').join('') + '</nav><main>' + body() + '</main></div>' +
    '<nav class="bottom">' + BOT.map(n => '<button data-act="go" data-p="' + n[0] + '" class="' + on(n[0]) + '">' + n[1] + '</button>').join('') + '</nav>';
  if (keep) { const el = $('#' + keep); if (el) { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch (e) {} } }
}

/* ---------- 事件 ---------- */
const ACT = {
  async login() {
    const { error } = await sb.auth.signInWithPassword({ email: $('#em').value.trim(), password: $('#pw').value });
    if (error) { S.loginErr = '登入失敗：' + (/Invalid/i.test(error.message) ? 'Email 或密碼不對' : error.message); render(); }
  },
  async logout() { await sb.auth.signOut(); },
  go(d) {
    S.form = null; S.sort = false; S.page = d.p; render(); window.scrollTo(0, 0);
    if (d.p === 'list') loadTxs().then(render);
    if (d.p === 'legacy') loadLegacy().then(render);
    if (d.p === 'add' && S.tf && S.tf.editId) { S.tf = newTf(); render(); }
  },
  tfType(d) { S.tf.type = d.v; S.tf.item = ''; render(); },
  saveTx, cancelTx() { S.tf = newTf(); S.page = 'list'; render(); loadTxs().then(render); },
  async delTx() {
    if (!confirm('確定刪除這筆交易？')) return;
    const id = S.tf.editId; queue('update', id, { deleted_at: new Date().toISOString() });
    S.tf = newTf(); S.page = 'list'; render(); await flush(); await loadTxs(); render(); toast('已刪除');
  },
  editTx(d) {
    const t = S.txs.find(x => x.id === d.id) || S.recent.find(x => x.id === d.id); if (!t) return;
    const s = x => (x == null ? '' : String(x));
    S.tf = { editId: t.id, type: t.type, date: t.tx_date, amount: s(t.amount), account: t.account_id || '', item: t.item_id || '', trip: t.trip_id || '', fee: num(t.fee) ? s(t.fee) : '', note: t.note || '', from: t.from_account_id || '', fromAmt: s(t.from_amount), to: t.to_account_id || '', toAmt: s(t.to_amount) };
    S.page = 'add'; render(); window.scrollTo(0, 0);
  },
  mon(d) { S.txMonth = addMonth(S.txMonth, Number(d.d)); loadTxs().then(render); },
  rmon(d) { S.rm = addMonth(S.rm, Number(d.d)); render(); },
  cardNew() { openCard(null); }, cardEdit(d) { openCard(d.id); }, cardSave,
  async cardDel() { if (!confirm('刪除這張指標卡？')) return; const { error } = await sb.from('dashboard_cards').delete().eq('id', S.form.id); if (error) return toast(error.message); S.form = null; await load(); render(); },
  cardMove(d) { return moveRows('dashboard_cards', S.cards, d.id, Number(d.d)); },
  chip(d) {
    const ta = $('#fml'), s = ta.selectionStart == null ? ta.value.length : ta.selectionStart, e = ta.selectionEnd == null ? s : ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + d.t + ta.value.slice(e); S.form.v.formula = ta.value;
    ta.focus(); ta.setSelectionRange(s + d.t.length, s + d.t.length); previewCard();
  },
  formCancel() { S.form = null; render(); },
  entSave, budgetSave, fxSave,
  acctNew() { openEnt('acct'); }, acctEdit(d) { openEnt('acct', d.id); },
  acctMove(d) {
    const a = A(d.id), kind = a.kind;
    const l = S.accts.filter(x => x.kind === kind && !hiddenAcct(x) && (x.active || S.showOff || S.sort));
    return moveRows('accounts', l, d.id, Number(d.d));
  },
  sortToggle() { S.sort = !S.sort; render(); }, offToggle() { S.showOff = !S.showOff; render(); },
  itemNew(d) { openEnt('item'); S.form.v.type = d.t || '支'; render(); }, itemEdit(d) { openEnt('item', d.id); },
  itemSort() { S.sort = !S.sort; render(); },
  itemMove(d) { const it = S.items.find(x => x.id === d.id); return moveRows('items', S.items.filter(x => x.type === it.type), d.id, Number(d.d)); },
  tripNew() { openEnt('trip'); }, tripEdit(d) { openEnt('trip', d.id); },
  subNew() { openEnt('sub'); }, subEdit(d) { openEnt('sub', d.id); }, instNew() { openEnt('inst'); }, instEdit(d) { openEnt('inst', d.id); },
  runNow() { return runNow(false); },
  budgetEdit() { const v = {}; const groups = [...new Set(S.items.filter(i => i.type === '支').map(i => i.group_name)), '金融費用']; groups.forEach((g, i) => { const b = S.budgets.find(x => x.group_name === g); if (b) v['b' + i] = num(b.amount_twd); }); S.form = { kind: 'budget', v }; render(); },
  fxUpdate() { return fxUpdate(false); },
  fxManual() { S.form = { kind: 'fx', v: { currency: '', rate: '', date: todayStr() } }; render(); },
  exportAll, exportCsv, flush() { return flush(); },
  lpage(d) { S.legacy.p = Math.max(0, S.legacy.p + Number(d.d)); loadLegacy().then(render); }
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
  const f = ACT[el.dataset.act]; if (f) Promise.resolve(f(el.dataset, el)).catch(err => toast('錯誤：' + err.message));
});
function onField(e) {
  const el = e.target;
  if (el.dataset.t) { S.tf[el.dataset.t] = el.value; if (e.type === 'change' && el.tagName === 'SELECT') { if (el.dataset.t === 'account' || el.dataset.t === 'from' || el.dataset.t === 'to') render(); } return; }
  if (el.dataset.f && S.form) { S.form.v[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value; if (S.form.kind === 'card') previewCard(); return; }
  if (el.id === 'txm' && el.value) { S.txMonth = el.value; loadTxs().then(render); }
  if (el.id === 'txq') { S.q = el.value; render(); }
  if (el.id === 'lq' && e.type === 'change') { S.legacy.q = el.value; S.legacy.p = 0; loadLegacy().then(render); }
}
document.addEventListener('input', e => { if (e.target.id === 'txm') return; onField(e); });
document.addEventListener('change', onField);
document.addEventListener('keydown', e => { if (e.key === 'Enter' && !S.user && (e.target.id === 'pw' || e.target.id === 'em')) ACT.login(); });

/* ---------- 啟動 ---------- */
async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  window.addEventListener('online', () => flush());
  const { data } = await sb.auth.getSession();
  S.user = data.session ? data.session.user : null;
  sb.auth.onAuthStateChange((ev, ses) => {
    const u = ses ? ses.user : null;
    if (!!u !== !!S.user) { S.user = u; if (u) start(); else render(); }
  });
  if (S.user) start(); else render();
}
async function start() {
  render();
  try { await load(); }
  catch (e) {
    if (isNet(e) && loadCache()) toast('離線中，顯示上次的資料');
    else { $('#app').innerHTML = '<div class="login"><h2>讀取失敗</h2><p class="e">' + esc(e.message) + '</p><p class="sub">如果是「relation dashboard_cards does not exist」之類，請先在 Supabase 執行 schema_v2.sql。</p><button class="btn block" data-act="logout">登出</button></div>'; return; }
  }
  render();
  if (!S.offline) {
    await flush();
    runNow(true).catch(() => {});
    const lf = latestFx(), cs = Object.values(lf);
    if (!cs.length || cs.some(f => f.rate_date < todayStr())) fxUpdate(true);
  }
}
boot();
