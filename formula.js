// 指標卡公式：只接受數字、+ - * / ( ) 和項目名稱，不會執行任何程式碼
(function (g) {
  function normalize(src) {
    return String(src || '')
      .replace(/[＋]/g, '+').replace(/[－−–—]/g, '-').replace(/[×＊]/g, '*')
      .replace(/[÷／]/g, '/').replace(/（/g, '(').replace(/）/g, ')');
  }

  function tokenize(src) {
    const s = normalize(src), out = [];
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (/\s/.test(ch)) { i++; continue; }
      if ('+-*/()'.includes(ch)) { out.push({ t: ch }); i++; continue; }
      if (/[0-9.]/.test(ch)) {
        let j = i;
        while (j < s.length && /[0-9.]/.test(s[j])) j++;
        const v = Number(s.slice(i, j));
        if (!isFinite(v)) throw new Error('數字格式不對：' + s.slice(i, j));
        out.push({ t: 'num', v });
        i = j;
        continue;
      }
      let j = i;
      while (j < s.length && !/[\s+\-*/()]/.test(s[j])) j++;
      out.push({ t: 'id', v: s.slice(i, j) });
      i = j;
    }
    return out;
  }

  function parse(tokens) {
    let p = 0;
    const peek = () => tokens[p];
    function expr() {
      let l = term();
      while (peek() && (peek().t === '+' || peek().t === '-')) {
        const op = tokens[p++].t;
        l = { op, l, r: term() };
      }
      return l;
    }
    function term() {
      let l = unary();
      while (peek() && (peek().t === '*' || peek().t === '/')) {
        const op = tokens[p++].t;
        l = { op, l, r: unary() };
      }
      return l;
    }
    function unary() {
      if (peek() && peek().t === '-') { p++; return { neg: unary() }; }
      if (peek() && peek().t === '+') { p++; return unary(); }
      return prim();
    }
    function prim() {
      const t = tokens[p++];
      if (!t) throw new Error('公式還沒寫完');
      if (t.t === 'num') return { num: t.v };
      if (t.t === 'id') return { id: t.v };
      if (t.t === '(') {
        const e = expr();
        if (!peek() || peek().t !== ')') throw new Error('少了右括號 )');
        p++;
        return e;
      }
      throw new Error('這裡不能放「' + t.t + '」');
    }
    const e = expr();
    if (p < tokens.length) {
      const t = tokens[p];
      throw new Error(t.t === ')' ? '多了一個右括號 )' : '缺少運算符號（+ - * /），在「' + (t.v !== undefined ? t.v : t.t) + '」前面');
    }
    return e;
  }

  // 回傳數字；除以 0 回傳 null
  function run(n, vars) {
    if (n.num !== undefined) return n.num;
    if (n.id !== undefined) {
      if (!Object.prototype.hasOwnProperty.call(vars, n.id)) throw new Error('找不到項目「' + n.id + '」');
      return Number(vars[n.id]) || 0;
    }
    if (n.neg) { const v = run(n.neg, vars); return v === null ? null : -v; }
    const a = run(n.l, vars), b = run(n.r, vars);
    if (a === null || b === null) return null;
    if (n.op === '+') return a + b;
    if (n.op === '-') return a - b;
    if (n.op === '*') return a * b;
    return b === 0 ? null : a / b;
  }

  function evalFormula(src, vars) {
    try {
      if (!String(src || '').trim()) return { error: '請輸入公式' };
      return { value: run(parse(tokenize(src)), vars) };
    } catch (e) {
      return { error: e.message };
    }
  }

  function fmt(v, format) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    const sign = v < 0 ? '−' : '';
    const a = Math.abs(v);
    if (format === 'percent') return sign + (Math.round(a * 1000) / 10).toLocaleString('zh-TW') + '%';
    if (format === 'number') return sign + (Math.round(a * 100) / 100).toLocaleString('zh-TW');
    return sign + 'NT$' + Math.round(a).toLocaleString('zh-TW');
  }

  const api = { evalFormula, fmt, tokenize, parse };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  g.Formula = api;
})(typeof window !== 'undefined' ? window : globalThis);
