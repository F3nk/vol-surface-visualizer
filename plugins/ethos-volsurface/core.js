/* Ethos vol surface: pure functions (no DOM), shared by the explorer and the Node tests. */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.EthosVolCore = api;
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const DAY = 86400000;

    /** Rows of the server payload as objects. spread = (ask - bid) / mid, null without a two-sided quote. */
    function options(data) {
        const at = {};
        data.fields.forEach((f, i) => { at[f] = i; });
        return data.rows.map(r => {
            const bid = r[at.bid], ask = r[at.ask], mid = bid !== null && ask !== null ? (bid + ask) / 2 : null;
            const e = data.expiries[r[at.expiry]];
            return {
                e: r[at.expiry], code: e.code, forward: e.forward, k: r[at.strike], type: r[at.type],
                bid, ask, mid, spread: mid ? (ask - bid) / mid : null,
                ivBid: r[at.iv_bid], ivMid: r[at.iv_mid], ivAsk: r[at.iv_ask], mark: r[at.mark_iv],
                delta: r[at.delta], oi: r[at.oi],
                // Call-equivalent delta: a put's delta + 1, so calls and puts share one 0..1 axis (0.5 ~ at the money).
                cd: r[at.type] === 'C' ? r[at.delta] : r[at.delta] + 1,
            };
        });
    }

    const daysTo = (ts, now) => (ts * 1000 - now) / DAY;

    function xOf(o, axis) {
        if (axis === 'strike') return o.k;
        if (axis === 'moneyness') return o.k / o.forward;
        return o.cd;
    }

    /**
     * One expiry's smile: options with a mid IV, a spread within maxSpread, delta inside [deltaMin, 1 - deltaMin],
     * sorted by x. side 'otm' takes puts below the forward and calls at or above it; 'C' / 'P' take one type.
     */
    function curve(opts, e, f) {
        const pts = [];
        for (const o of opts) {
            if (o.e !== e || o.ivMid === null || o.spread === null || o.spread > f.maxSpread) continue;
            if (f.side === 'otm' ? (o.type === 'C') !== (o.k >= o.forward) : o.type !== f.side) continue;
            if (o.cd < f.deltaMin || o.cd > 1 - f.deltaMin) continue;
            pts.push({x: xOf(o, f.axis), iv: o.ivMid, o});
        }
        pts.sort((a, b) => a.x - b.x);
        return pts.filter((p, i) => i === 0 || p.x !== pts[i - 1].x);
    }

    /** Linear interpolation of iv at x inside the curve's range; null outside it (no extrapolation). */
    function interp(pts, x) {
        if (pts.length < 2 || x < pts[0].x || x > pts[pts.length - 1].x) return pts.length === 1 && pts[0].x === x ? pts[0].iv : null;
        let i = 1;
        while (pts[i].x < x) i++;
        const a = pts[i - 1], b = pts[i];
        return b.x === a.x ? a.iv : a.iv + (b.iv - a.iv) * (x - a.x) / (b.x - a.x);
    }

    const linspace = (lo, hi, n) => Array.from({length: n}, (_, i) => lo + (hi - lo) * i / (n - 1));

    /**
     * The surface on a regular x grid: one row per expiry inside [minDays, maxDays] with at least 3 points.
     * Cells outside an expiry's quoted range stay null (a gap, never an invented value).
     */
    function surface(data, f, now) {
        const opts = options(data), rows = [];
        data.expiries.forEach((e, i) => {
            const days = daysTo(e.ts, now);
            if (days < f.minDays || days > f.maxDays) return;
            const pts = curve(opts, i, f);
            if (pts.length >= 3) rows.push({e: i, code: e.code, days, forward: e.forward, pts});
        });
        if (!rows.length) return {x: [], y: [], z: [], rows};
        let lo, hi, n;
        if (f.axis === 'delta') { lo = f.deltaMin; hi = 1 - f.deltaMin; n = 37; }
        else {
            lo = Math.min(...rows.map(r => r.pts[0].x)); hi = Math.max(...rows.map(r => r.pts[r.pts.length - 1].x)); n = 61;
            if (f.axis === 'moneyness') { lo = Math.max(lo, 0.3); hi = Math.min(hi, 3); }
        }
        const x = linspace(lo, hi, n).map(v => Math.round(v * 1e6) / 1e6);
        return {x, y: rows.map(r => r.days), z: rows.map(r => x.map(v => interp(r.pts, v))), rows};
    }

    /**
     * Per-expiry summary from the out-of-the-money smile: ATM IV at strike = forward, 25-delta risk reversal
     * (25-delta call IV minus 25-delta put IV) and butterfly ((call + put) / 2 minus ATM), in vol points.
     */
    function termStructure(data, f, now) {
        const opts = options(data), out = [];
        data.expiries.forEach((e, i) => {
            const days = daysTo(e.ts, now);
            if (days <= 0) return;
            const base = {side: 'otm', maxSpread: f.maxSpread, deltaMin: 0.02};
            const m = curve(opts, i, Object.assign({axis: 'moneyness'}, base));
            const d = curve(opts, i, Object.assign({axis: 'delta'}, base));
            const atm = interp(m, 1), c25 = interp(d, 0.25), p25 = interp(d, 0.75);
            out.push({
                e: i, code: e.code, days, forward: e.forward, n: m.length, atm,
                rr25: c25 !== null && p25 !== null ? c25 - p25 : null,
                fly25: c25 !== null && p25 !== null && atm !== null ? (c25 + p25) / 2 - atm : null,
            });
        });
        return out;
    }

    /** A term-structure value at a constant maturity (e.g. 30 days). ATM IV is interpolated in total variance. */
    function atDays(term, key, days) {
        const pts = term.filter(r => r[key] !== null);
        for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1], b = pts[i];
            if (a.days <= days && b.days >= days) {
                const w = (days - a.days) / (b.days - a.days);
                if (key !== 'atm') return a[key] + w * (b[key] - a[key]);
                const v = (a.atm ** 2 * a.days + w * (b.atm ** 2 * b.days - a.atm ** 2 * a.days)) / days;
                return v > 0 ? Math.sqrt(v) : null;
            }
        }
        return null;
    }

    function toCsv(header, rows) {
        const cell = v => { const s = v === null || v === undefined ? '' : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
        return [header].concat(rows).map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
    }

    const LANG_EN = {el: 'Greek', ru: 'Russian', es: 'Spanish', he: 'Hebrew', fr: 'French', de: 'German', it: 'Italian'};
    const r1 = v => (v === null || v === undefined ? 'n/a' : (Math.round(v * 10) / 10).toFixed(1));
    const sg = v => (v === null || v === undefined ? 'n/a' : (v > 0 ? '+' : '') + r1(v));

    /**
     * The prompt for ChatGPT, Claude or Perplexity: the current surface in figures plus what to explain.
     * ctx: {coin, index, fetched (ISO), term, at30: {atm, rr25, fly25}, check, lang, url}
     */
    function aiPrompt(ctx) {
        const when = ctx.fetched.replace('T', ' ').slice(0, 16) + ' UTC';
        const rows = ctx.term.filter(r => r.atm !== null && r.days >= 1).slice(0, 12);
        if (!rows.length) return '';
        const lines = [
            ctx.coin + ' options implied volatility from the Deribit order book at ' + when + '. ' + ctx.coin + ' index price: ' + ctx.index + ' USD.',
            'Implied volatility is computed by Ethos Research with Black-Scholes (on each expiry\'s forward, zero rate) from the mid-market price, in % a year.',
            '',
            '30-day constant maturity: ATM IV ' + r1(ctx.at30.atm) + '%, 25-delta risk reversal ' + sg(ctx.at30.rr25) + ' vol points (call minus put), 25-delta butterfly ' + sg(ctx.at30.fly25) + '.',
            'Term structure by expiry (days to expiry; ATM IV; 25-delta risk reversal; 25-delta butterfly):',
        ];
        rows.forEach(r => lines.push('- ' + r.code + ' (' + Math.round(r.days * 10) / 10 + ' days): ATM ' + r1(r.atm) + '%; RR ' + sg(r.rr25) + '; fly ' + sg(r.fly25)));
        const lang = String(ctx.lang || 'en').slice(0, 2).toLowerCase();
        lines.push('',
            'Explain this to me as an investor who is not an options specialist, in a short answer I can read in two minutes (about 250 words, short bullets under brief headings). Start with a two-sentence bottom line, then cover:',
            '1. What the level of implied volatility says about how much the market expects ' + ctx.coin + ' to move, and how it compares across expiries (term structure: rising, flat or inverted).',
            '2. What the skew (risk reversal) says about whether traders pay more to protect against falls or to bet on rises, and what the butterfly says about tail risk.',
            '3. What this could mean for ' + ctx.coin + ' in the coming weeks, and the limits of reading it (implied volatility is a price, not a forecast).',
            '4. How I could use it in practice and what else to check alongside it.',
            'Use plain language. This is for education, not investment advice.' + (LANG_EN[lang] ? ' Reply in ' + LANG_EN[lang] + '.' : ''),
            '',
            'Do not create any image, chart or code yet. End your answer by asking whether I would like a downloadable figure that sums it up. Only if I say yes, make one PNG drawn with code from exactly the figures above, not an illustration: for example ATM IV by expiry with the 25-delta risk reversal beneath it. Title it with your one-line takeaway, add the line "Source: Deribit order book, ' + when + '; IV by Ethos Research" and the watermark "Ethos Research · ethosresearch.xyz" in the bottom-right corner. Use a dark background (#111411), light text and the colours #199e70, #3987e5 and #d95926. If you cannot create files, give me complete Python (matplotlib) code that saves it.',
            '',
            'Source: Deribit, via Ethos Research ' + ctx.url);
        return lines.join('\n');
    }

    function aiLinks(prompt) {
        const q = encodeURIComponent(prompt);
        return {ChatGPT: 'https://chatgpt.com/?q=' + q, Claude: 'https://claude.ai/new?q=' + q, Perplexity: 'https://www.perplexity.ai/search?q=' + q};
    }

    return {options, daysTo, xOf, curve, interp, linspace, surface, termStructure, atDays, toCsv, aiPrompt, aiLinks};
}));
