/* Ethos vol surface explorer: 3D surface / heatmap, smile, term structure, tables, downloads. */
(function () {
    'use strict';
    const C = window.EthosVolCore;
    // House categorical palette (validated, both modes) and a one-hue sequential ramp for the surface.
    const PALETTE = {dark: ['#199e70', '#3987e5', '#d95926'], light: ['#008f5f', '#2a78d6', '#d4541f']};
    const RAMP = {
        dark: [[0, '#0d2e23'], [0.35, '#12704f'], [0.7, '#2fbf89'], [1, '#c4f2de']],
        light: [[0, '#d9f2e7'], [0.35, '#6cc9a3'], [0.7, '#008f5f'], [1, '#00402a']],
    };
    const COINS = ['BTC', 'ETH', 'SOL'];
    const CAMERAS = {iso: {x: -1.3, y: -1.4, z: 0.62}, smile: {x: 0.001, y: -2.05, z: 0.1}, term: {x: 2.05, y: 0.001, z: 0.1}};
    // Days-to-expiry ticks for log axes (most listed expiries sit inside two weeks).
    const DAY_TICKS = [1, 2, 5, 10, 20, 50, 100, 200, 500];

    function boot(root) {
        const T = JSON.parse(root.dataset.i18n || '{}');
        const endpoint = root.dataset.endpoint;
        const $ = sel => root.querySelector(sel);
        const $$ = sel => Array.from(root.querySelectorAll(sel));
        const t = key => T[key] || key;
        const fill = (s, ...args) => args.reduce((out, a, i) => out.replace('%' + (i + 1) + '$s', a), s).replace('%s', args[0]);
        const lang = document.documentElement.lang || 'en';
        const nf = d => new Intl.NumberFormat(lang, {minimumFractionDigits: d, maximumFractionDigits: d});
        const nf0 = nf(0), nf1 = nf(1), nf2 = nf(2);
        const tf = new Intl.DateTimeFormat(lang, {hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hourCycle: 'h23'});
        const df = new Intl.DateTimeFormat(lang, {day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'});
        const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
        const dash = v => v === null || v === undefined || Number.isNaN(v);
        const pct = v => (dash(v) ? '—' : nf1.format(v) + '%');
        const pts = v => (dash(v) ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + nf1.format(Math.abs(v)));
        const price = v => (dash(v) ? '—' : (v >= 1000 ? nf0 : nf2).format(v));
        const coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
        const webgl = (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl') || c.getContext('experimental-webgl')); } catch (e) { return false; } })();

        const state = {coin: 'BTC', side: 'otm', axis: 'delta', chart: webgl ? 'surface' : 'heatmap', expiry: null, camera: 'iso',
            minDays: 2, maxDays: 400, deltaMin: 0.05, maxSpread: 30, points: true, rotate: !coarse};
        const cache = {};
        let data = null, view = null, timer = null, clock = null, aiText = '';

        /* ---------- URL ---------- */
        // Parameter names avoid WordPress's public query vars (m, p, s, w, year, page…), which would 404.
        function readUrl() {
            const p = new URLSearchParams(location.search);
            if (COINS.includes(p.get('coin'))) state.coin = p.get('coin');
            if (['otm', 'C', 'P'].includes(p.get('side'))) state.side = p.get('side');
            if (['delta', 'strike', 'moneyness'].includes(p.get('axis'))) state.axis = p.get('axis');
            if (['surface', 'heatmap'].includes(p.get('chart')) && (webgl || p.get('chart') === 'heatmap')) state.chart = p.get('chart');
            if (/^\d{1,2}[A-Z]{3}\d{2}$/.test(p.get('expiry') || '')) state.expiry = p.get('expiry');
            const num = (k, lo, hi) => { const v = parseFloat(p.get(k)); return Number.isFinite(v) && v >= lo && v <= hi ? v : null; };
            state.minDays = num('mindays', 0, 1000) ?? state.minDays;
            state.maxDays = num('maxdays', 1, 1000) ?? state.maxDays;
            if (['0.02', '0.05', '0.1', '0.15', '0.25'].includes(p.get('delta'))) state.deltaMin = +p.get('delta');
            if (['10', '20', '30', '50', '100'].includes(p.get('spread'))) state.maxSpread = +p.get('spread');
        }
        function query() {
            const p = new URLSearchParams();
            p.set('coin', state.coin);
            if (state.side !== 'otm') p.set('side', state.side);
            if (state.axis !== 'delta') p.set('axis', state.axis);
            if (state.chart !== 'surface') p.set('chart', state.chart);
            if (state.expiry) p.set('expiry', state.expiry);
            if (state.minDays !== 2) p.set('mindays', state.minDays);
            if (state.maxDays !== 400) p.set('maxdays', state.maxDays);
            if (state.deltaMin !== 0.05) p.set('delta', state.deltaMin);
            if (state.maxSpread !== 30) p.set('spread', state.maxSpread);
            return p.toString();
        }
        const shareUrl = () => location.origin + location.pathname + '?' + query();
        const writeUrl = () => history.replaceState(null, '', location.pathname + '?' + query() + location.hash);

        /* ---------- colours & layout ---------- */
        const token = name => getComputedStyle(root).getPropertyValue('--wp--preset--color--' + name).trim();
        function isLight() {
            const m = token('base').match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
            if (!m) return document.documentElement.dataset.theme === 'light';
            return (0.2126 * parseInt(m[1], 16) + 0.7152 * parseInt(m[2], 16) + 0.0722 * parseInt(m[3], 16)) > 128;
        }
        const mode = () => (isLight() ? 'light' : 'dark');
        const narrow = () => root.clientWidth < 640;
        const font = () => ({color: token('ink'), family: getComputedStyle(root).fontFamily, size: narrow() ? 11 : 12});
        const axisBase = () => ({gridcolor: token('line'), zerolinecolor: token('line'), linecolor: token('line'), tickfont: {color: token('muted')}, title: {font: {color: token('muted'), size: 11}}, automargin: true});
        const config = () => ({displaylogo: false, responsive: true, scrollZoom: false, modeBarButtonsToRemove: ['toImage', 'sendDataToCloud', 'lasso2d', 'select2d', 'resetCameraLastSave3d', 'hoverClosest3d']});
        const filters = () => ({side: state.side, axis: state.axis, minDays: state.minDays, maxDays: state.maxDays, deltaMin: state.deltaMin, maxSpread: state.maxSpread / 100});
        const axisTitle = () => t(state.axis === 'moneyness' ? 'moneyness' : state.axis);

        /** Delta axis ticks: named for the out-of-the-money view, signed deltas for calls or puts alone. */
        function deltaTicks() {
            const vals = [0.1, 0.25, 0.5, 0.75, 0.9].filter(v => v >= state.deltaMin - 1e-9 && v <= 1 - state.deltaMin + 1e-9);
            const text = vals.map(v => {
                if (state.side === 'C') return nf2.format(v);
                if (state.side === 'P') return '−' + nf2.format(1 - v);
                if (v === 0.5) return t('atm');
                return Math.round((v < 0.5 ? v : 1 - v) * 100) + 'Δ ' + t(v < 0.5 ? 'call' : 'put');
            });
            return {tickvals: vals, ticktext: text, autorange: 'reversed'};
        }
        const xAxisExtra = () => (state.axis === 'delta' ? deltaTicks() : state.axis === 'strike' ? {tickformat: ',d'} : {tickformat: '.2f'});
        const xHover = () => (state.axis === 'strike' ? '%{x:,.0f}' : '%{x:.2f}');
        /** Log time axis when expiries span a wide range, with round tick values instead of Plotly's 2-5-10 minor labels. */
        function daysAxis(ys) {
            const lo = Math.min(...ys), hi = Math.max(...ys);
            if (!(lo > 0) || hi / lo < 20) return {type: 'linear'};
            const ticks = DAY_TICKS.filter(v => v >= lo * 0.8 && v <= hi * 1.25);
            return {type: 'log', tickvals: ticks, ticktext: ticks.map(String)};
        }
        // Camera further back on phones so the whole surface fits the narrow plot.
        const eyeFor = name => { const e = CAMERAS[name], k = narrow() ? 1.3 : 1; return {x: e.x * k, y: e.y * k, z: e.z * k}; };

        /* ---------- data ---------- */
        async function load(coin, force) {
            const hit = cache[coin];
            if (hit && !force && Date.now() < hit.expires) return hit.data;
            const res = await fetch(endpoint + '?coin=' + encodeURIComponent(coin), {headers: {Accept: 'application/json'}, cache: force ? 'reload' : 'default'});
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const body = await res.json();
            if (!body || body.version !== 1 || !Array.isArray(body.rows) || !Array.isArray(body.expiries)) throw new Error('bad payload');
            // Next refresh: when the server's 5-minute window ends, plus a little slack for the fetch itself.
            const fetchedAt = Date.parse(body.fetched);
            body._next = fetchedAt + (body.ttl || 300) * 1000 + 15000;
            cache[coin] = {data: body, expires: Math.max(Date.now() + 30000, body._next)};
            return body;
        }

        async function reload(force) {
            const coin = state.coin;
            root.setAttribute('aria-busy', 'true');
            $('.vol-retry').hidden = true;
            if (!data || data.coin !== coin) setStatus(t('loading'));
            try {
                const d = await load(coin, force);
                if (state.coin !== coin) return; // the reader switched coin meanwhile
                data = d;
                if (state.expiry && !data.expiries.some(e => e.code === state.expiry)) state.expiry = null;
                render();
            } catch (e) {
                if (state.coin !== coin) return;
                setStatus(t('unavailable'), true);
                $('.vol-retry').hidden = false;
            } finally {
                root.removeAttribute('aria-busy');
                schedule();
            }
        }

        /** Re-fetch when the server's book turns over, only while the tab is visible. */
        function schedule() {
            clearTimeout(timer);
            const next = data && data.coin === state.coin ? data._next : Date.now() + 60000;
            timer = setTimeout(() => { if (document.visibilityState === 'visible') reload(true); else schedule(); }, Math.max(30000, next - Date.now()));
        }
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && data && Date.now() > data._next) reload(true);
        });

        function setStatus(text, warn) {
            const el = $('.vol-status');
            el.textContent = text;
            el.dataset.stale = warn ? 'true' : 'false';
        }
        function renderStatus() {
            if (!data) return;
            const at = Date.parse(data.fetched), mins = Math.floor((Date.now() - at) / 60000);
            const ago = mins < 1 ? t('justNow') : fill(t('minAgo'), nf0.format(mins));
            let text = fill(t('updated'), tf.format(new Date(at)), ago, tf.format(new Date(Math.max(at + (data.ttl || 300) * 1000, Date.now() + 60000))));
            if (data.stale) text = t('stale') + ' ' + text;
            setStatus(text, !!data.stale);
        }

        /* ---------- render ---------- */
        function render() {
            const now = Date.now();
            const f = filters();
            const surf = C.surface(data, f, now);
            const term = C.termStructure(data, {maxSpread: f.maxSpread}, now);
            const at30 = {atm: C.atDays(term, 'atm', 30), rr25: C.atDays(term, 'rr25', 30), fly25: C.atDays(term, 'fly25', 30)};
            const opts = C.options(data);
            view = {surf, term, at30, opts, now};
            renderSwitches(); renderStatus(); renderMetrics(); renderExpiries();
            renderSurface(); renderSmile(); renderTerm(); renderTables(); renderDiagnostics(); renderAi();
            writeUrl();
        }

        function renderSwitches() {
            $$('[data-coin]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.coin === state.coin)));
            $$('[data-side]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.side === state.side)));
            $$('[data-axis]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.axis === state.axis)));
            $$('[data-chart]').forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.chart === state.chart)); if (b.dataset.chart === 'surface') b.disabled = !webgl; });
            $$('[data-camera]').forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.camera === state.camera)); b.disabled = state.chart !== 'surface'; });
            const rot = $('[data-action="rotate"]');
            rot.hidden = !coarse || state.chart !== 'surface';
            rot.setAttribute('aria-pressed', String(state.rotate));
            rot.textContent = t(state.rotate ? 'rotateOff' : 'rotateOn');
            $('.vol-mindays').value = state.minDays; $('.vol-maxdays').value = state.maxDays;
            $('.vol-deltamin').value = String(state.deltaMin); $('.vol-spread').value = String(state.maxSpread);
            $('.vol-points').checked = state.points;
        }

        function renderMetrics() {
            const set = (k, v) => { $('[data-metric="' + k + '"]').textContent = v; };
            set('index', price(data.index) + ' USD');
            set('atm', pct(view.at30.atm));
            set('rr25', dash(view.at30.rr25) ? '—' : pts(view.at30.rr25) + ' ' + t('volPts'));
            set('fly25', dash(view.at30.fly25) ? '—' : pts(view.at30.fly25) + ' ' + t('volPts'));
            set('used', nf0.format(data.counts.two_sided) + ' / ' + nf0.format(data.counts.instruments));
        }

        function renderExpiries() {
            const sel = $('.vol-expiry');
            const list = view.term.filter(r => r.days > 0);
            if (!state.expiry || !list.some(r => r.code === state.expiry)) {
                // Default: the expiry nearest 30 days, the horizon the headline figures use.
                const best = list.slice().sort((a, b) => Math.abs(a.days - 30) - Math.abs(b.days - 30))[0];
                state.expiry = best ? best.code : null;
            }
            sel.innerHTML = list.map(r => '<option value="' + esc(r.code) + '"' + (r.code === state.expiry ? ' selected' : '') + '>' + esc(df.format(new Date(data.expiries[r.e].ts * 1000))) + ' · ' + nf1.format(r.days) + ' d</option>').join('');
        }

        function plot(el, traces, layout, extra) {
            try {
                window.Plotly.react(el, traces, layout, Object.assign(config(), extra || {}));
                return true;
            } catch (e) {
                el.innerHTML = '<p class="vol-empty">' + esc(t('chartFailed')) + '</p>';
                return false;
            }
        }

        function renderSurface() {
            const el = $('.vol-chart--surface'), empty = $('.vol-empty');
            const {surf} = view;
            if (!surf.rows.length) {
                if (window.Plotly) window.Plotly.purge(el);
                el.hidden = true; empty.hidden = false; empty.textContent = t('empty');
                return;
            }
            el.hidden = false; empty.hidden = true;
            const m = mode(), zs = surf.z.flat().filter(v => v !== null);
            const zmin = Math.min(...zs), zmax = Math.max(...zs);
            const hover = t(state.axis === 'moneyness' ? 'moneyness' : state.axis) + ' ' + xHover() + '<br>' + t('days') + ' %{y:.1f}<br>' + t('ivShort') + ' %{z:.1f}%<extra></extra>';
            const colorbar = narrow()
                ? {orientation: 'h', x: 0.5, xanchor: 'center', y: -0.02, yanchor: 'top', len: 0.8, thickness: 8, outlinewidth: 0, tickfont: {color: token('muted'), size: 10}, title: {text: t('ivShort') + ' %', side: 'right', font: {color: token('muted'), size: 10}}}
                : {title: {text: t('ivShort') + ' %', font: {color: token('muted'), size: 11}}, thickness: 10, len: 0.7, outlinewidth: 0, tickfont: {color: token('muted')}};
            const yAxis = daysAxis(surf.y);
            const pointsUsed = surf.rows.flatMap(r => r.pts.map(p => ({x: p.x, y: r.days, z: p.iv, o: p.o})));
            let traces, layout;
            const base = {paper_bgcolor: 'transparent', plot_bgcolor: 'transparent', font: font(), uirevision: state.coin + state.side + state.axis + state.chart, showlegend: false};
            if (state.chart === 'surface') {
                traces = [{type: 'surface', x: surf.x, y: surf.y, z: surf.z, colorscale: RAMP[m], cmin: zmin, cmax: zmax, colorbar, hovertemplate: hover, connectgaps: false,
                    lighting: {ambient: 0.75, diffuse: 0.55, specular: 0.04, roughness: 0.9, fresnel: 0.1}, contours: {z: {show: false}}, opacity: 0.97}];
                if (state.points) traces.push({type: 'scatter3d', mode: 'markers', x: pointsUsed.map(p => p.x), y: pointsUsed.map(p => p.y), z: pointsUsed.map(p => p.z),
                    marker: {size: narrow() ? 1.8 : 2.4, color: token('ink'), opacity: 0.45}, customdata: pointsUsed.map(p => [instrument(p.o), p.o.ivBid, p.o.ivAsk]),
                    hovertemplate: '%{customdata[0]}<br>' + t('ivShort') + ' %{z:.1f}% (' + t('bid') + ' %{customdata[1]:.1f} / ' + t('ask') + ' %{customdata[2]:.1f})<extra></extra>'});
                const ax = extra => Object.assign({backgroundcolor: 'transparent', showbackground: false, gridcolor: token('line'), zerolinecolor: token('line'), linecolor: token('line'), tickfont: {color: token('muted'), size: 10}, title: {font: {color: token('muted'), size: 11}}}, extra);
                layout = Object.assign(base, {margin: {l: 0, r: 0, t: 0, b: narrow() ? 40 : 0}, scene: {
                    xaxis: ax(Object.assign({title: {text: axisTitle(), font: {color: token('muted'), size: 11}}}, xAxisExtra())),
                    yaxis: ax(Object.assign({title: {text: t('days'), font: {color: token('muted'), size: 11}}}, yAxis)),
                    zaxis: ax({title: {text: t('iv'), font: {color: token('muted'), size: 11}}, ticksuffix: '%'}),
                    camera: {eye: eyeFor(state.camera), up: {x: 0, y: 0, z: 1}}, aspectmode: 'manual', aspectratio: {x: 1.25, y: 1.25, z: 0.7},
                    dragmode: state.rotate ? 'turntable' : false,
                }});
            } else {
                // Heatmap as a grid of coloured squares, one row per expiry: the 3D bundle has no heatmap trace,
                // and SVG markers also work where WebGL does not.
                const cells = [];
                surf.z.forEach((row, i) => row.forEach((v, j) => { if (v !== null) cells.push([surf.x[j], surf.y[i], v]); }));
                const size = Math.max(4, Math.min(18, Math.floor((el.clientWidth - 140) / surf.x.length) - 1));
                traces = [{type: 'scatter', mode: 'markers', x: cells.map(c => c[0]), y: cells.map(c => c[1]),
                    marker: {symbol: 'square', size, color: cells.map(c => c[2]), colorscale: RAMP[m], cmin: zmin, cmax: zmax, colorbar, line: {width: 0}},
                    customdata: cells.map(c => c[2]), hovertemplate: hover.replace('%{z:.1f}', '%{customdata:.1f}')}];
                if (state.points) traces.push({type: 'scatter', mode: 'markers', x: pointsUsed.map(p => p.x), y: pointsUsed.map(p => p.y), marker: {size: 3, color: token('ink'), opacity: 0.5},
                    customdata: pointsUsed.map(p => [instrument(p.o), p.z]), hovertemplate: '%{customdata[0]}<br>' + t('ivShort') + ' %{customdata[1]:.1f}%<extra></extra>'});
                layout = Object.assign(base, {margin: {l: 56, r: 8, t: 8, b: 48}, dragmode: coarse ? false : 'zoom',
                    xaxis: Object.assign(axisBase(), {title: {text: axisTitle(), font: {color: token('muted'), size: 11}}}, xAxisExtra()),
                    yaxis: Object.assign(axisBase(), {title: {text: t('days'), font: {color: token('muted'), size: 11}}}, yAxis)});
                if (narrow()) layout.margin.b = 88;
            }
            plot(el, traces, layout, coarse ? {displayModeBar: false} : null);
        }

        function instrument(o) {
            const k = o.k % 1 ? String(o.k).replace('.', 'd') : String(o.k);
            return (state.coin === 'SOL' ? 'SOL_USDC' : state.coin) + '-' + o.code + '-' + k + '-' + o.type;
        }

        function selectedRows() {
            const e = data.expiries.findIndex(x => x.code === state.expiry);
            return e < 0 ? [] : view.opts.filter(o => o.e === e);
        }

        function renderSmile() {
            const el = $('.vol-chart--smile');
            const e = data.expiries.findIndex(x => x.code === state.expiry);
            const f = Object.assign(filters(), {minDays: -1, maxDays: 1e9});
            const pts = e < 0 ? [] : C.curve(view.opts, e, f);
            const pal = PALETTE[mode()];
            if (!pts.length) { if (window.Plotly) window.Plotly.purge(el); el.innerHTML = '<p class="vol-empty">' + esc(t('noRows')) + '</p>'; return; }
            if (el.querySelector('.vol-empty')) el.innerHTML = '';
            const xs = pts.map(p => p.x);
            const fwd = data.expiries[e].forward, xF = state.axis === 'strike' ? fwd : state.axis === 'moneyness' ? 1 : 0.5;
            const traces = [
                {type: 'scatter', mode: 'markers', name: t('midIv'), x: xs, y: pts.map(p => p.iv),
                    error_y: {type: 'data', symmetric: false, array: pts.map(p => (p.o.ivAsk ?? p.iv) - p.iv), arrayminus: pts.map(p => p.iv - (p.o.ivBid ?? p.iv)), color: pal[0], thickness: 1.5, width: 0},
                    marker: {size: 8, color: pal[0], line: {width: 2, color: token('base')}},
                    customdata: pts.map(p => [instrument(p.o), p.o.ivBid, p.o.ivAsk, p.o.delta]),
                    hovertemplate: '%{customdata[0]}<br>' + t('ivShort') + ' %{y:.1f}% (' + t('bid') + ' %{customdata[1]:.1f} / ' + t('ask') + ' %{customdata[2]:.1f})<br>' + t('delta') + ' %{customdata[3]:.2f}<extra></extra>'},
                {type: 'scatter', mode: 'lines', name: t('markIv'), x: xs, y: pts.map(p => p.o.mark), line: {color: pal[1], width: 2}, hovertemplate: t('markIv') + ' %{y:.1f}%<extra></extra>'},
            ];
            const layout = {paper_bgcolor: 'transparent', plot_bgcolor: 'transparent', font: font(), margin: {l: 52, r: 12, t: 12, b: 48}, hovermode: 'closest', dragmode: coarse ? false : 'zoom',
                uirevision: state.coin + state.expiry + state.axis + state.side,
                legend: {orientation: 'h', x: 0, y: 1.12, font: {color: token('ink'), size: 11}},
                xaxis: Object.assign(axisBase(), {title: {text: axisTitle(), font: {color: token('muted'), size: 11}}}, xAxisExtra()),
                yaxis: Object.assign(axisBase(), {title: {text: t('iv'), font: {color: token('muted'), size: 11}}, ticksuffix: '%'}),
                shapes: [{type: 'line', xref: 'x', yref: 'paper', x0: xF, x1: xF, y0: 0, y1: 1, line: {color: token('muted'), width: 1}}],
                annotations: [{xref: 'x', yref: 'paper', x: xF, y: 1, yanchor: 'bottom', text: state.axis === 'delta' ? t('atm') : t('forward'), showarrow: false, font: {color: token('muted'), size: 10}}]};
            plot(el, traces, layout);
        }

        function renderTerm() {
            const rows = view.term.filter(r => r.days >= Math.min(state.minDays, 1) && r.days <= state.maxDays);
            const pal = PALETTE[mode()];
            const layout = yTitle => ({paper_bgcolor: 'transparent', plot_bgcolor: 'transparent', font: font(), margin: {l: 52, r: 12, t: 8, b: 44}, showlegend: false, dragmode: coarse ? false : 'zoom',
                xaxis: Object.assign(axisBase(), {title: {text: t('days'), font: {color: token('muted'), size: 11}}}, daysAxis(rows.map(r => r.days).filter(d => d > 0).concat(1))),
                yaxis: Object.assign(axisBase(), {title: {text: yTitle, font: {color: token('muted'), size: 11}}})});
            const atm = rows.filter(r => r.atm !== null), rr = rows.filter(r => r.rr25 !== null);
            plot($('.vol-chart--term'), [{type: 'scatter', mode: 'lines+markers', x: atm.map(r => r.days), y: atm.map(r => r.atm), text: atm.map(r => r.code),
                line: {color: pal[0], width: 2}, marker: {size: 8, color: pal[0], line: {width: 2, color: token('base')}}, hovertemplate: '%{text}<br>' + t('atmIv') + ' %{y:.1f}%<extra></extra>'}],
                Object.assign(layout(t('atmIv') + ' (%)'), {}));
            const l2 = layout(t('rr25') + ' (' + t('volPts') + ')');
            l2.yaxis.zeroline = true; l2.yaxis.zerolinecolor = token('muted');
            plot($('.vol-chart--skew'), [{type: 'scatter', mode: 'lines+markers', x: rr.map(r => r.days), y: rr.map(r => r.rr25), text: rr.map(r => r.code),
                line: {color: pal[1], width: 2}, marker: {size: 8, color: pal[1], line: {width: 2, color: token('base')}}, hovertemplate: '%{text}<br>' + t('rr25') + ' %{y:+.1f}<extra></extra>'}], l2);
        }

        function termTableRows() {
            return view.term.map(r => [r.code, nf1.format(r.days), price(r.forward), pct(r.atm), pts(r.rr25), pts(r.fly25), nf0.format(r.n)]);
        }
        function quoteRows() {
            return selectedRows().slice().sort((a, b) => a.k - b.k || (a.type < b.type ? -1 : 1));
        }
        const fmtQuote = v => (dash(v) ? '—' : data.settle === 'inverse' ? nf(4).format(v) : nf2.format(v));

        function renderTables() {
            const head = cols => '<thead><tr>' + cols.map((c, i) => '<th scope="col"' + (i ? '' : ' class="is-left"') + '>' + esc(c) + '</th>').join('') + '</tr></thead>';
            $('.vol-term-table').innerHTML = '<caption>' + esc(state.coin + ' · ' + t('reportTerm')) + '</caption>' + head([t('expiry'), t('days'), t('forward'), t('atmIv'), t('rr25'), t('fly25'), t('quotes')]) +
                '<tbody>' + termTableRows().map(r => '<tr>' + r.map((c, i) => (i ? '<td>' : '<th scope="row" class="is-left">') + esc(c) + (i ? '</td>' : '</th>')).join('') + '</tr>').join('') + '</tbody>';
            const q = quoteRows();
            $('.vol-quote-table').innerHTML = '<caption>' + esc(state.coin + ' · ' + (state.expiry || '') + ' · ' + fill(t('priceIn'), data.quote)) + '</caption>' +
                head([t('strike'), t('type'), t('bid'), t('ask'), t('bidIv'), t('ivShort'), t('askIv'), t('markIv'), t('delta'), t('oi')]) + '<tbody>' +
                (q.length ? q.map(o => '<tr><th scope="row" class="is-left">' + esc(price(o.k)) + '</th><td>' + esc(t(o.type === 'C' ? 'callShort' : 'putShort')) + '</td><td>' + fmtQuote(o.bid) + '</td><td>' + fmtQuote(o.ask) + '</td><td>' + pct(o.ivBid) + '</td><td><strong>' + pct(o.ivMid) + '</strong></td><td>' + pct(o.ivAsk) + '</td><td>' + pct(o.mark) + '</td><td>' + (dash(o.delta) ? '—' : nf2.format(o.delta)) + '</td><td>' + (dash(o.oi) ? '—' : nf0.format(o.oi)) + '</td></tr>').join('')
                    : '<tr><td colspan="10" class="is-left">' + esc(t('noRows')) + '</td></tr>') + '</tbody>';
        }

        function renderDiagnostics() {
            const items = [
                [t('fetched'), data.fetched.replace('T', ' ').slice(0, 19) + ' UTC'],
                [t('instruments'), nf0.format(data.counts.instruments)],
                [t('twoSided'), nf0.format(data.counts.two_sided)],
                [t('expiries'), nf0.format(data.expiries.length)],
                [t('checkMedian'), data.check.median_abs_diff_vs_mark === null ? '—' : nf2.format(data.check.median_abs_diff_vs_mark) + ' ' + t('volPts') + ' (' + nf0.format(data.check.compared) + ')'],
            ];
            $('.vol-diagnostics').innerHTML = items.map(([k, v]) => '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>').join('');
        }

        /* ---------- explain with AI ---------- */
        function renderAi() {
            aiText = C.aiPrompt({coin: state.coin, index: price(data.index), fetched: data.fetched, term: view.term, at30: view.at30, lang, url: shareUrl()});
            const box = $('.vol-ai');
            box.hidden = !aiText;
            if (!aiText) return;
            const links = C.aiLinks(aiText);
            $$('[data-ai]').forEach(a => { a.href = links[a.dataset.ai]; });
            box.querySelector('pre').textContent = aiText;
            box.querySelector('.vol-ai__status').textContent = '';
        }
        async function copyAi() {
            const status = $('.vol-ai__status');
            try { await navigator.clipboard.writeText(aiText); status.textContent = t('aiCopied'); }
            catch (e) { status.textContent = t('aiCopyFailed'); $('.vol-ai__prompt').open = true; }
        }
        $('.vol-ai').addEventListener('click', ev => { if (ev.target.closest('a[data-ai]') && aiText) copyAi(); });

        /* ---------- downloads ---------- */
        function feedback(text) { $('.vol-feedback').textContent = text; }
        function download(name, text, type) {
            const blob = new Blob([text], {type}), a = document.createElement('a');
            a.href = URL.createObjectURL(blob); a.download = name;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        }
        function csv(rows) {
            const q = data.quote.toLowerCase();
            const head = ['instrument', 'expiry', 'strike', 'type', 'bid_' + q, 'ask_' + q, 'iv_bid_pct', 'iv_mid_pct', 'iv_ask_pct', 'deribit_mark_iv_pct', 'delta', 'open_interest', 'forward_usd'];
            return C.toCsv(head, rows.map(o => [instrument(o), o.code, o.k, o.type, o.bid, o.ask, o.ivBid, o.ivMid, o.ivAsk, o.mark, o.delta, o.oi, o.forward]));
        }
        const stamp = () => data.fetched.slice(0, 16).replace(/[-:]/g, '').replace('T', '-');

        function reportSpec() {
            const smileEl = $('.vol-chart--smile'), surfEl = $('.vol-chart--surface');
            const sel = data.expiries.find(e => e.code === state.expiry);
            return {kicker: t('reportKicker'), title: 'Vol Surface Visualizer: ' + state.coin,
                subtitle: 'Deribit · ' + data.fetched.replace('T', ' ').slice(0, 16) + ' UTC', url: shareUrl(),
                sections: [
                    {type: 'facts', title: t('reportSelection'), items: [
                        [t('options'), t('side_' + state.side)], [t('axis'), axisTitle()],
                        [t('range'), nf0.format(state.minDays) + '–' + nf0.format(state.maxDays) + ' d'], [t('maxSpread'), state.maxSpread + '%'],
                        [t('index'), price(data.index) + ' USD'],
                        [t('at30') + ' ' + t('atmIv'), pct(view.at30.atm)], [t('at30') + ' ' + t('rr25'), pts(view.at30.rr25) + ' ' + t('volPts')], [t('at30') + ' ' + t('fly25'), pts(view.at30.fly25) + ' ' + t('volPts')],
                        [t('quotes'), fill(t('used'), nf0.format(data.counts.two_sided), nf0.format(data.counts.instruments))],
                    ]},
                    ...(surfEl.hidden || !surfEl.data ? [] : [{type: 'chart', title: t('reportSurface'), element: surfEl}]),
                    ...(smileEl.data ? [{type: 'chart', title: t('reportSmile') + (sel ? ' · ' + df.format(new Date(sel.ts * 1000)) : ''), element: smileEl}] : []),
                    {type: 'table', title: t('reportTerm'), note: t('ivShort') + ' %; ' + t('rr25') + ' / ' + t('fly25') + ' ' + t('volPts'),
                        columns: [t('expiry'), t('days'), t('forward'), t('atmIv'), t('rr25'), t('fly25'), t('quotes')].map((label, i) => ({label, align: i ? 'right' : 'left'})), rows: termTableRows()},
                    {type: 'table', title: t('reportSmile') + ' · ' + (state.expiry || ''), note: fill(t('priceIn'), data.quote),
                        columns: [t('strike'), t('type'), t('bid'), t('ask'), t('bidIv'), t('ivShort'), t('askIv'), t('markIv'), t('delta')].map((label, i) => ({label, align: i === 1 ? 'left' : 'right'})),
                        rows: quoteRows().map(o => [price(o.k), o.type, fmtQuote(o.bid), fmtQuote(o.ask), pct(o.ivBid), pct(o.ivMid), pct(o.ivAsk), pct(o.mark), dash(o.delta) ? '—' : nf2.format(o.delta)])},
                    {type: 'text', title: t('reportMethod'), paragraphs: [t('reportMethodText')]},
                ], footer: t('reportFooter')};
        }
        async function report(format, button) {
            if (!data || !window.EthosReport) { feedback(t('reportFailed')); return; }
            button.disabled = true; feedback(t('reportBuilding'));
            try { await window.EthosReport.save(reportSpec(), format, 'ethos-vol-surface-' + state.coin.toLowerCase() + '-' + stamp()); feedback(t('reportDone')); }
            catch (e) { feedback(t('reportFailed')); }
            finally { button.disabled = false; }
        }

        /* ---------- events ---------- */
        root.addEventListener('click', async ev => {
            const b = ev.target.closest('button');
            if (!b || !root.contains(b) || b.disabled) return;
            const d = b.dataset;
            if (d.coin && d.coin !== state.coin) { state.coin = d.coin; state.expiry = null; renderSwitches(); await reload(false); }
            else if (d.side) { state.side = d.side; if (data) render(); }
            else if (d.axis) { state.axis = d.axis; if (data) render(); }
            else if (d.chart) { state.chart = d.chart; if (data) { renderSwitches(); renderSurface(); writeUrl(); } }
            else if (d.camera) {
                state.camera = d.camera; renderSwitches();
                const el = $('.vol-chart--surface');
                if (el.data && state.chart === 'surface') window.Plotly.relayout(el, {'scene.camera': {eye: eyeFor(state.camera), up: {x: 0, y: 0, z: 1}}});
            }
            else if (d.action === 'rotate') { state.rotate = !state.rotate; renderSwitches(); const el = $('.vol-chart--surface'); if (el.data) window.Plotly.relayout(el, {'scene.dragmode': state.rotate ? 'turntable' : false}); }
            else if (d.action === 'expand') {
                const on = !root.classList.contains('vol-expanded');
                root.classList.toggle('vol-expanded', on); b.setAttribute('aria-expanded', String(on));
                b.textContent = t(on ? 'collapse' : 'expand');
                document.documentElement.classList.toggle('ethos-vol-lock', on);
                requestAnimationFrame(() => { const el = $('.vol-chart--surface'); if (el.data) window.Plotly.Plots.resize(el); });
            }
            else if (d.action === 'retry') await reload(true);
            else if (d.action === 'ai-copy') await copyAi();
            else if (d.action === 'copy') { try { await navigator.clipboard.writeText(shareUrl()); feedback(t('copied')); } catch (e) { feedback(t('copyFailed')); } }
            else if (d.action === 'csv-expiry' && data) { download('ethos-vol-' + state.coin.toLowerCase() + '-' + (state.expiry || 'expiry') + '-' + stamp() + '.csv', csv(quoteRows()), 'text/csv;charset=utf-8'); feedback(t('csvDone')); }
            else if (d.action === 'csv-book' && data) { download('ethos-vol-' + state.coin.toLowerCase() + '-book-' + stamp() + '.csv', csv(view.opts), 'text/csv;charset=utf-8'); feedback(t('csvDone')); }
            else if (d.action === 'report-md') await report('md', b);
            else if (d.action === 'report-pdf') await report('pdf', b);
        });
        const onFilter = () => {
            const lo = parseFloat($('.vol-mindays').value), hi = parseFloat($('.vol-maxdays').value);
            if (Number.isFinite(lo) && lo >= 0) state.minDays = Math.min(lo, 1000);
            if (Number.isFinite(hi) && hi >= 1) state.maxDays = Math.min(hi, 1000);
            if (state.maxDays <= state.minDays) state.maxDays = state.minDays + 1;
            state.deltaMin = +$('.vol-deltamin').value;
            state.maxSpread = +$('.vol-spread').value;
            state.points = $('.vol-points').checked;
            if (data) render();
        };
        $$('.vol-controls input, .vol-controls select').forEach(el => el.addEventListener('change', onFilter));
        $('.vol-expiry').addEventListener('change', ev => { state.expiry = ev.target.value; renderSmile(); renderTables(); writeUrl(); });
        document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && root.classList.contains('vol-expanded')) $('[data-action="expand"]').click(); });

        new MutationObserver(() => { if (data) { renderSurface(); renderSmile(); renderTerm(); } })
            .observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});
        clock = setInterval(renderStatus, 20000);
        if (!webgl) setStatus(t('noWebgl'));
        const disclosure = $('.vol-controls');
        if (disclosure && window.matchMedia('(max-width: 781px)').matches) disclosure.open = false;

        readUrl();
        renderSwitches();
        reload(false);
    }

    function start() { document.querySelectorAll('.ethos-vol').forEach(boot); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
}());
