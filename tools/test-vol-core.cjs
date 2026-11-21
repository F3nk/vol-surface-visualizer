/* Unit tests for plugins/ethos-volsurface/core.js: node tools/test-vol-core.cjs [payload.json] */
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const C = require(path.join(__dirname, '..', 'plugins', 'ethos-volsurface', 'core.js'));

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok   ' + name); };

// Synthetic book: 2 expiries, forward 100, flat 50% vol with a put skew, every strike quoted both sides.
const now = Date.UTC(2026, 10, 21, 8);
const ts = d => Math.round((now + d * 86400000) / 1000);
const fields = ['expiry', 'strike', 'type', 'bid', 'ask', 'iv_bid', 'iv_mid', 'iv_ask', 'mark_iv', 'delta', 'oi'];
const rows = [];
[[0, 10], [1, 60]].forEach(([e, days]) => {
    for (let k = 60; k <= 140; k += 10) {
        for (const type of ['C', 'P']) {
            const iv = 50 + (100 - k) * 0.2 + e * 5; // skew: lower strikes, higher vol; longer expiry +5
            const m = Math.log(100 / k) / (iv / 100 * Math.sqrt(days / 365));
            const cd = 1 / (1 + Math.exp(-1.7 * m)); // rough monotone call delta, enough for ordering
            rows.push([e, k, type, 0.01, 0.0105, iv - 1, iv, iv + 1, iv + 0.2, type === 'C' ? cd : cd - 1, 5]);
        }
    }
});
const data = {version: 1, coin: 'BTC', expiries: [{code: 'A', ts: ts(10), forward: 100}, {code: 'B', ts: ts(60), forward: 100}], fields, rows};

test('options: call-equivalent delta of a put is delta + 1', () => {
    const o = C.options(data).find(x => x.type === 'P' && x.k === 80);
    assert.ok(Math.abs(o.cd - (o.delta + 1)) < 1e-12);
});
test('curve otm: puts below the forward, calls at or above', () => {
    const pts = C.curve(C.options(data), 0, {side: 'otm', axis: 'strike', maxSpread: 0.3, deltaMin: 0});
    assert.deepStrictEqual(pts.map(p => p.o.type + p.x), ['P60', 'P70', 'P80', 'P90', 'C100', 'C110', 'C120', 'C130', 'C140']);
});
test('curve drops wide quotes', () => {
    const wide = JSON.parse(JSON.stringify(data));
    wide.rows.forEach(r => { if (r[1] === 120) r[4] = 0.03; });
    const pts = C.curve(C.options(wide), 0, {side: 'otm', axis: 'strike', maxSpread: 0.3, deltaMin: 0});
    assert.ok(!pts.some(p => p.x === 120));
});
test('interp is linear inside and null outside', () => {
    const pts = [{x: 1, iv: 10}, {x: 3, iv: 30}];
    assert.strictEqual(C.interp(pts, 2), 20);
    assert.strictEqual(C.interp(pts, 0.5), null);
    assert.strictEqual(C.interp(pts, 3.5), null);
});
test('surface: rows per expiry inside the day window, nulls outside the quoted range', () => {
    const s = C.surface(data, {side: 'otm', axis: 'strike', minDays: 0, maxDays: 400, maxSpread: 0.3, deltaMin: 0}, now);
    assert.strictEqual(s.z.length, 2);
    assert.strictEqual(s.x.length, 61);
    assert.ok(Math.abs(s.y[0] - 10) < 1e-9);
    assert.ok(Math.abs(s.z[0][0] - 58) < 1e-9); // K = 60: 50 + 40 * 0.2
    const one = C.surface(data, {side: 'otm', axis: 'strike', minDays: 30, maxDays: 400, maxSpread: 0.3, deltaMin: 0}, now);
    assert.strictEqual(one.z.length, 1);
});
test('term structure: ATM at forward, risk reversal negative with a put skew', () => {
    const term = C.termStructure(data, {maxSpread: 0.3}, now);
    assert.strictEqual(term.length, 2);
    assert.ok(Math.abs(term[0].atm - 50) < 1e-9);
    assert.ok(term[0].rr25 < 0);
});
test('atDays: total-variance interpolation of ATM between expiries', () => {
    const term = [{days: 10, atm: 50}, {days: 60, atm: 55}];
    const v = C.atDays(term, 'atm', 30);
    const expect = Math.sqrt((50 ** 2 * 10 + (20 / 50) * (55 ** 2 * 60 - 50 ** 2 * 10)) / 30);
    assert.ok(Math.abs(v - expect) < 1e-9);
    assert.strictEqual(C.atDays(term, 'atm', 90), null);
});
test('csv quotes cells with commas', () => {
    assert.strictEqual(C.toCsv(['a', 'b'], [['x,y', null]]), 'a,b\r\n"x,y",\r\n');
});
test('ai prompt carries the figures and the source line', () => {
    const term = C.termStructure(data, {maxSpread: 0.3}, now);
    const p = C.aiPrompt({coin: 'BTC', index: '100', fetched: '2026-11-21T08:00:00+00:00', term, at30: {atm: 51, rr25: -3, fly25: 0.5}, lang: 'el', url: 'https://x/'});
    assert.ok(p.includes('ATM IV 51.0%') && p.includes('Reply in Greek') && p.includes('Source: Deribit, via Ethos Research https://x/'));
});

// Optional: a real payload from tools/vol_harness.php json <file> <COIN>
const file = process.argv[2];
if (file) {
    const real = JSON.parse(fs.readFileSync(file, 'utf8'));
    const at = Date.parse(real.fetched);
    test('real book: surface builds with every default filter', () => {
        const s = C.surface(real, {side: 'otm', axis: 'delta', minDays: 2, maxDays: 400, maxSpread: 0.3, deltaMin: 0.05}, at);
        assert.ok(s.z.length >= 3, 'expiries ' + s.z.length);
        const vals = s.z.flat().filter(v => v !== null);
        assert.ok(vals.length > s.z.length * 10);
        assert.ok(Math.min(...vals) > 5 && Math.max(...vals) < 400);
        console.log('     ' + real.coin + ': ' + s.z.length + ' expiries x ' + s.x.length + ' deltas, IV ' + Math.min(...vals).toFixed(1) + '–' + Math.max(...vals).toFixed(1) + '%');
    });
    test('real book: 30-day ATM, risk reversal and butterfly exist', () => {
        const term = C.termStructure(real, {maxSpread: 0.3}, at);
        const a = C.atDays(term, 'atm', 30), rr = C.atDays(term, 'rr25', 30), fly = C.atDays(term, 'fly25', 30);
        console.log('     30d ATM ' + a.toFixed(2) + '%, RR ' + rr.toFixed(2) + ', fly ' + fly.toFixed(2));
        assert.ok(a > 5 && a < 300 && Number.isFinite(rr) && Number.isFinite(fly));
    });
}
console.log(n + ' tests passed');
