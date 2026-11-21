/* Browser QA for the Vol Surface Visualizer. Needs tools/vol_preview_server.py running (or a live page URL).
 * PLAYWRIGHT_MODULE=<path to playwright-core> node tools/vol-browser-qa.cjs [baseUrl] [outDir]
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.argv[2] || 'http://127.0.0.1:8766/';
const out = process.argv[3] || '.hostinger/qa/vol/browser';
fs.mkdirSync(out, {recursive: true});
const results = [];
const check = (name, ok, detail = '') => { results.push({name, ok: !!ok, detail}); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : '')); };
const url = q => base + (base.includes('?') ? '&' : '?') + q;

(async () => {
    const browser = await chromium.launch({headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']});
    const ctx = await browser.newContext({viewport: {width: 1440, height: 1000}, acceptDownloads: true});
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error' && !/WebGL|GPU stall|GroupMarkerNotSet/i.test(m.text())) errors.push(m.text()); });
    const overflow = p => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const traces = sel => page.$eval(sel, el => (el._fullData || []).map(t => t.type));
    const metric = k => page.textContent('[data-metric="' + k + '"]');
    const waitData = () => page.waitForFunction(() => { const el = document.querySelector('.vol-chart--surface'); return el && el.data && el.data.length; }, null, {timeout: 60000});

    await page.goto(base, {waitUntil: 'domcontentloaded'});
    await waitData();
    await page.waitForTimeout(800);
    check('surface renders as a 3D surface with quoted points', JSON.stringify(await traces('.vol-chart--surface')) === '["surface","scatter3d"]', JSON.stringify(await traces('.vol-chart--surface')));
    check('WebGL canvas drawn', await page.$('.vol-chart--surface canvas') !== null);
    check('status names the Deribit book time', /Deribit book at \d{2}:\d{2} UTC/.test(await page.textContent('.vol-status')), await page.textContent('.vol-status'));
    check('metrics filled', /USD$/.test(await metric('index')) && /%$/.test(await metric('atm')) && /vol pts/.test(await metric('rr25')), [await metric('index'), await metric('atm'), await metric('rr25'), await metric('fly25'), await metric('used')].join(' | '));
    check('smile has mid IV and Deribit mark IV', JSON.stringify(await traces('.vol-chart--smile')) === '["scatter","scatter"]');
    check('term structure charts drawn', (await traces('.vol-chart--term')).length === 1 && (await traces('.vol-chart--skew')).length === 1);
    const termRows = await page.$$eval('.vol-term-table tbody tr', r => r.length);
    const quoteRows = await page.$$eval('.vol-quote-table tbody tr', r => r.length);
    check('tables filled', termRows >= 5 && quoteRows >= 10, termRows + ' expiries, ' + quoteRows + ' quotes');
    const ai = await page.getAttribute('[data-ai="Claude"]', 'href');
    check('AI link carries the prompt', /claude\.ai\/new\?q=.*ATM%20IV/.test(ai || ''));
    check('no horizontal overflow at 1440px', (await overflow(page)) <= 0);
    await page.screenshot({path: path.join(out, 'desktop-dark.png')});
    await page.locator('.vol-workbench').screenshot({path: path.join(out, 'desktop-dark-surface.png')});
    await page.locator('.vol-term-grid').screenshot({path: path.join(out, 'desktop-dark-term.png')});

    // Coins
    const btcIndex = await metric('index');
    await page.click('[data-coin="ETH"]');
    await page.waitForFunction(b => document.querySelector('[data-metric="index"]').textContent !== b, btcIndex, {timeout: 60000});
    check('ETH loads with its own index price', (await metric('index')) !== btcIndex && /coin=ETH/.test(page.url()), await metric('index'));
    await page.click('[data-coin="SOL"]');
    await page.waitForFunction(() => /coin=SOL/.test(location.search) && document.querySelector('.vol-quote-table caption').textContent.includes('SOL'), null, {timeout: 60000});
    check('SOL loads, prices in USDC', /USDC/.test(await page.textContent('.vol-quote-table caption')), await page.textContent('.vol-quote-table caption'));
    await page.screenshot({path: path.join(out, 'desktop-dark-sol.png')});
    await page.click('[data-coin="BTC"]');
    await page.waitForFunction(() => /coin=BTC/.test(location.search));

    // Axis, side, chart type
    await page.click('[data-axis="strike"]');
    await page.waitForTimeout(400);
    const xs = await page.$eval('.vol-chart--surface', el => el.data[0].x);
    check('strike axis uses strikes', xs[0] > 1000 && xs[xs.length - 1] > xs[0], xs[0] + '–' + xs[xs.length - 1]);
    await page.click('[data-chart="heatmap"]');
    await page.waitForTimeout(400);
    const hm = await page.$eval('.vol-chart--surface', el => ({type: el._fullData[0].type, symbol: el._fullData[0].marker.symbol, colored: Array.isArray(el._fullData[0].marker.color), n: el._fullData[0].x.length, rects: el.querySelectorAll('.scatterlayer .point').length}));
    check('heatmap view draws coloured squares', hm.type === 'scatter' && hm.symbol === 'square' && hm.colored && hm.rects > 100 && /chart=heatmap/.test(page.url()), JSON.stringify(hm));
    await page.locator('.vol-workbench').screenshot({path: path.join(out, 'desktop-dark-heatmap-strike.png')});
    await page.click('[data-side="P"]');
    await page.waitForTimeout(400);
    const allPuts = await page.$eval('.vol-chart--smile', el => el.data[0].customdata.every(c => /-P$/.test(c[0])));
    check('puts only', allPuts);
    await page.click('[data-side="otm"]'); await page.click('[data-axis="delta"]'); await page.click('[data-chart="surface"]');
    await page.waitForTimeout(400);

    // Filters
    await page.fill('.vol-mindays', '30'); await page.dispatchEvent('.vol-mindays', 'change');
    await page.waitForTimeout(400);
    const ys = await page.$eval('.vol-chart--surface', el => el.data[0].y);
    check('minimum days filter', ys.every(v => v >= 30), ys.map(v => v.toFixed(0)).join(','));
    await page.fill('.vol-mindays', '2'); await page.dispatchEvent('.vol-mindays', 'change');
    const before = await page.$$eval('.vol-chart--smile', els => els[0].data[0].x.length);
    await page.selectOption('.vol-spread', '10');
    await page.waitForTimeout(300);
    const after = await page.$$eval('.vol-chart--smile', els => els[0].data[0].x.length);
    check('tighter spread limit drops quotes', after <= before, before + ' -> ' + after);
    await page.selectOption('.vol-spread', '30');
    const options = await page.$$eval('.vol-expiry option', o => o.map(x => x.value));
    await page.selectOption('.vol-expiry', options[options.length - 1]);
    await page.waitForTimeout(300);
    check('expiry select updates the quote table', (await page.textContent('.vol-quote-table caption')).includes(options[options.length - 1]));

    // Camera
    await page.click('[data-camera="smile"]');
    await page.waitForTimeout(300);
    const eye = await page.$eval('.vol-chart--surface', el => el.layout.scene.camera.eye);
    check('camera preset "look along expiries"', Math.abs(eye.x) < 0.05 && eye.y < -2, JSON.stringify(eye));
    await page.click('[data-camera="iso"]');

    // Downloads
    const [csv] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="csv-expiry"]')]);
    const csvText = fs.readFileSync(await csv.path(), 'utf8');
    check('expiry CSV', csvText.startsWith('instrument,expiry,strike,type,bid_btc') && csvText.split('\r\n').length > 5, csv.suggestedFilename());
    const [md] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="report-md"]')]);
    const mdText = fs.readFileSync(await md.path(), 'utf8');
    check('Markdown report', /^# Vol Surface Visualizer: BTC/.test(mdText) && /Term structure/.test(mdText), md.suggestedFilename());
    const [pdf] = await Promise.all([page.waitForEvent('download', {timeout: 60000}), page.click('[data-action="report-pdf"]')]);
    const pdfPath = path.join(out, pdf.suggestedFilename());
    await pdf.saveAs(pdfPath);
    const pdfHead = fs.readFileSync(pdfPath).subarray(0, 5).toString();
    check('PDF report', pdfHead === '%PDF-' && fs.statSync(pdfPath).size > 20000, pdf.suggestedFilename() + ' ' + fs.statSync(pdfPath).size + ' bytes');

    // Expand
    await page.click('[data-action="expand"]');
    await page.waitForTimeout(300);
    check('expanded view hides the rest', await page.$eval('.ethos-vol', el => el.classList.contains('vol-expanded')) && !(await page.isVisible('.vol-reading')));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    check('Escape closes the expanded view', !(await page.$eval('.ethos-vol', el => el.classList.contains('vol-expanded'))));

    // Light theme
    await page.click('#theme').catch(() => page.evaluate(() => { document.documentElement.dataset.theme = 'light'; }));
    await page.waitForTimeout(600);
    await page.screenshot({path: path.join(out, 'desktop-light.png')});
    await page.screenshot({path: path.join(out, 'desktop-light-full.png'), fullPage: true});

    // Shared link restores the view
    const p2 = await ctx.newPage();
    p2.on('pageerror', e => errors.push(String(e)));
    await p2.goto(url('coin=SOL&axis=moneyness&chart=heatmap&side=C'), {waitUntil: 'domcontentloaded'});
    await p2.waitForFunction(() => { const el = document.querySelector('.vol-chart--surface'); return el && el._fullData && el._fullData[0] && el._fullData[0].marker && el._fullData[0].marker.symbol === 'square'; }, null, {timeout: 60000});
    const pressed = await p2.$$eval('[aria-pressed="true"]', b => b.map(x => x.textContent.trim()));
    check('link restores coin, side, axis and chart', ['SOL', 'Calls', 'Strike / forward', 'Heatmap'].every(s => pressed.includes(s)), pressed.join(', '));
    await p2.close();

    // Phone
    const phone = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, deviceScaleFactor: 2});
    const m = await phone.newPage();
    m.on('pageerror', e => errors.push(String(e)));
    await m.goto(base, {waitUntil: 'domcontentloaded'});
    await m.waitForFunction(() => { const el = document.querySelector('.vol-chart--surface'); return el && el.data && el.data.length; }, null, {timeout: 60000});
    await m.waitForTimeout(800);
    check('phone: no horizontal overflow', (await overflow(m)) <= 0, String(await overflow(m)));
    check('phone: rotate button shown, chart starts locked', await m.isVisible('[data-action="rotate"]') && (await m.$eval('.vol-chart--surface', el => el.layout.scene.dragmode)) === false);
    await m.tap('[data-action="rotate"]');
    await m.waitForTimeout(200);
    check('phone: rotate unlocks the chart', (await m.$eval('.vol-chart--surface', el => el.layout.scene.dragmode)) === 'turntable');
    check('phone: filters start closed', !(await m.$eval('.vol-controls', d => d.open)));
    await m.locator('.vol-chart-panel').screenshot({path: path.join(out, 'phone-dark.png')});
    await m.screenshot({path: path.join(out, 'phone-dark-full.png'), fullPage: true});
    await phone.close();

    check('no JavaScript errors', errors.length === 0, errors.slice(0, 5).join(' | '));
    await browser.close();
    const failed = results.filter(r => !r.ok).length;
    console.log('\n' + (results.length - failed) + ' passed, ' + failed + ' failed');
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
