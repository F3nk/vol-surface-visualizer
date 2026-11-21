/* Ethos Research report export, shared by the tool plugins (copied into each as report.js by tools/sync-report.py).
 *
 * EthosReport.save(spec, 'md' | 'pdf', basename) builds a report of what a tool currently shows and downloads it.
 * No dependencies: the PDF is written directly (standard Helvetica, A4) and charts are embedded as JPEG images
 * rendered by Plotly, which every tool already loads.
 *
 * spec = {
 *   title, subtitle, url, kicker,
 *   sections: [
 *     {type: 'facts', title, items: [[label, value], ...]},
 *     {type: 'chart', title, element: <plotly div>, exclude: trace => bool, colors: {dark: light}},
 *     {type: 'table', title, note, columns: [{label, align: 'left' | 'right'}], rows: [[cell, ...]]},
 *     {type: 'text', title, paragraphs: [...]},
 *   ],
 *   footer: 'source and disclaimer line',
 * }
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.EthosReport = root.EthosReport || api;
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const PDF_TABLE_ROWS = 1500;
    const stamp = d => d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

    /* ---------------- Markdown ---------------- */

    const mdCell = v => String(v ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

    function markdown(spec, generated = new Date()) {
        const L = ['# ' + spec.title];
        if (spec.subtitle) L.push('', '_' + spec.subtitle + '_');
        L.push('', ['Generated ' + stamp(generated), spec.url ? '[Open this view](' + spec.url + ')' : ''].filter(Boolean).join(' · '));
        for (const s of spec.sections || []) {
            if (s.type === 'facts' && s.items.length) {
                L.push('', '## ' + s.title, '');
                s.items.forEach(([k, v]) => L.push('- **' + k + ':** ' + v));
            } else if (s.type === 'chart') {
                L.push('', '## ' + s.title, '', '_The chart is included in the PDF version of this report; its data is in the table below._');
            } else if (s.type === 'table') {
                L.push('', '## ' + s.title, '');
                if (s.note && s.note.trim()) L.push('_' + s.note.trim() + '_', '');
                if (!s.rows.length) { L.push('_No rows._'); continue; }
                L.push('| ' + s.columns.map(c => mdCell(c.label)).join(' | ') + ' |');
                L.push('|' + s.columns.map(c => (c.align === 'right' ? ' ---: ' : ' --- ')).join('|') + '|');
                s.rows.forEach(r => L.push('| ' + r.map(mdCell).join(' | ') + ' |'));
            } else if (s.type === 'text' && s.paragraphs.length) {
                L.push('', '## ' + s.title, '');
                s.paragraphs.forEach(p => L.push(p, ''));
            }
        }
        if (spec.footer) L.push('', '---', '', spec.footer);
        return L.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
    }

    /* ---------------- Text for the standard PDF fonts (WinAnsi) ---------------- */

    const SUBS = {'−': '-', '‐': '-', '‑': '-', '≤': '<=', '≥': '>=', '→': '->', '←': '<-',
        '↗': '', '↘': '', '↑': '', '↓': '', '●': '', ' ': ' ', ' ': ' ', ' ': ' ', '≈': '~', 'Δ': 'Chg'};
    const CP1252 = {0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88,
        0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93,
        0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B,
        0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F};
    function bytesOf(value) {
        const out = [];
        for (const ch of String(value ?? '')) {
            if (Object.prototype.hasOwnProperty.call(SUBS, ch)) { for (const c of SUBS[ch]) out.push(c.charCodeAt(0)); continue; }
            const c = ch.codePointAt(0);
            if ((c >= 32 && c <= 126) || (c >= 160 && c <= 255)) out.push(c);
            else if (CP1252[c]) out.push(CP1252[c]);
            else if (c === 9 || c === 10 || c === 13) out.push(32);
            else out.push(63); // outside the standard fonts: shown as "?"; the Markdown report keeps every character
        }
        return out;
    }
    // Helvetica and Helvetica-Bold advance widths (1/1000 em) for 32..126, from the standard AFM metrics.
    const HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
    const HELVB = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
    const EXTRA = {0xB7: 278, 0x95: 350, 0x96: 556, 0x97: 1000, 0x91: 222, 0x92: 222, 0x93: 333, 0x94: 333, 0x85: 1000, 0xA0: 278, 0xD7: 584};
    function textWidth(bytes, size, bold) {
        const table = bold ? HELVB : HELV;
        let w = 0;
        for (const b of bytes) w += b >= 32 && b <= 126 ? table[b - 32] : (EXTRA[b] || 556);
        return w * size / 1000;
    }
    const hex = bytes => '<' + bytes.map(b => b.toString(16).padStart(2, '0')).join('') + '>';

    /* ---------------- Minimal PDF document ---------------- */

    const A4 = {w: 595.28, h: 841.89};
    const M = {l: 46, r: 46, t: 54, b: 58};
    const INK = '0.071 0.078 0.071', MUTED = '0.337 0.353 0.325', ACCENT = '0.106 0.416 0.278', RULE = '0.827 0.824 0.784';

    function Doc(title) {
        this.title = title; this.pages = []; this.images = []; this.y = 0;
        this.width = A4.w - M.l - M.r;
        this.newPage();
    }
    Doc.prototype.newPage = function () {
        this.page = {ops: [], images: new Set(), links: []};
        this.pages.push(this.page);
        this.y = A4.h - M.t;
        if (this.pages.length > 1) {
            this.text(M.l, A4.h - 30, 'ETHOS RESEARCH  ·  ' + this.title, {size: 7, color: MUTED});
            this.rule(A4.h - 36);
            this.y = A4.h - 50;
        }
    };
    Doc.prototype.ensure = function (h) { if (this.y - h < M.b) this.newPage(); };
    Doc.prototype.text = function (x, y, str, o = {}) {
        const size = o.size || 9, bytes = bytesOf(str);
        let left = x;
        if (o.align === 'right') left = x - textWidth(bytes, size, o.bold);
        this.page.ops.push('BT /' + (o.bold ? 'F2' : 'F1') + ' ' + size + ' Tf ' + (o.color || INK) + ' rg ' + left.toFixed(2) + ' ' + y.toFixed(2) + ' Td ' + hex(bytes) + ' Tj ET');
    };
    /** A clickable web link over a rectangle of the current page. */
    Doc.prototype.link = function (x, y, w, h, uri) {
        this.page.links.push({rect: [x, y, x + w, y + h].map(n => n.toFixed(2)).join(' '), uri});
    };
    Doc.prototype.rule = function (y, color = RULE, width = 0.6) {
        this.page.ops.push(color + ' RG ' + width + ' w ' + M.l + ' ' + y.toFixed(2) + ' m ' + (A4.w - M.r) + ' ' + y.toFixed(2) + ' l S');
    };
    Doc.prototype.wrap = function (str, size, bold, max) {
        const words = String(str ?? '').split(/\s+/).filter(Boolean), lines = [];
        let line = '';
        const fits = s => textWidth(bytesOf(s), size, bold) <= max;
        for (let word of words) {
            const next = line ? line + ' ' + word : word;
            if (fits(next)) { line = next; continue; }
            if (line) lines.push(line);
            while (!fits(word) && word.length > 1) { // hard-break very long tokens (URLs)
                let cut = word.length - 1;
                while (cut > 1 && !fits(word.slice(0, cut))) cut--;
                lines.push(word.slice(0, cut)); word = word.slice(cut);
            }
            line = word;
        }
        if (line) lines.push(line);
        return lines.length ? lines : [''];
    };
    Doc.prototype.paragraph = function (str, o = {}) {
        const size = o.size || 9, lead = size * 1.45;
        for (const line of this.wrap(str, size, o.bold, o.width || this.width)) {
            this.ensure(lead);
            this.y -= lead;
            this.text(M.l + (o.indent || 0), this.y + size * 0.3, line, o);
        }
    };
    Doc.prototype.heading = function (str) {
        this.ensure(40);
        this.y -= 16;
        this.text(M.l, this.y, str, {size: 11.5, bold: true});
        this.y -= 7;
    };
    Doc.prototype.facts = function (items) {
        const labelW = 150, size = 9, lead = size * 1.45;
        for (const [label, value] of items) {
            const lines = this.wrap(value, size, false, this.width - labelW);
            const labels = this.wrap(label, 8, false, labelW - 10); // long labels wrap inside their own column
            const rows = Math.max(lines.length, labels.length);
            this.ensure(rows * lead + 2);
            labels.forEach((line, i) => this.text(M.l, this.y - lead * (i + 1) + size * 0.3, line, {size: 8, color: MUTED}));
            lines.forEach((line, i) => this.text(M.l + labelW, this.y - lead * (i + 1) + size * 0.3, line, {size}));
            this.y -= rows * lead + 2;
        }
    };
    Doc.prototype.image = function (img, caption) {
        const w = this.width, h = w * img.height / img.width;
        this.ensure(h + 10);
        const index = this.images.push(img) - 1;
        this.page.images.add(index);
        this.y -= h;
        this.page.ops.push('q ' + w.toFixed(2) + ' 0 0 ' + h.toFixed(2) + ' ' + M.l + ' ' + this.y.toFixed(2) + ' cm /Im' + index + ' Do Q');
        if (caption) { this.y -= 4; this.paragraph(caption, {size: 7.5, color: MUTED}); }
    };
    Doc.prototype.table = function (columns, rows, note) {
        if (note) { this.paragraph(note, {size: 8, color: MUTED}); this.y -= 4; }
        if (!rows.length) { this.paragraph('No rows.', {size: 8.5, color: MUTED}); return; }
        const cells = rows.map(r => r.map(v => String(v ?? '')));
        const pad = 7, maxText = 190;
        const measure = size => columns.map((c, i) => Math.min(maxText, Math.max(textWidth(bytesOf(c.label), size, true), ...cells.map(r => textWidth(bytesOf(r[i]), size, false)))) + pad);
        let size = 8, widths = measure(size);
        while (widths.reduce((a, b) => a + b, 0) > this.width && size > 6) { size -= 0.5; widths = measure(size); }
        // Too wide even at 6pt: split into column groups, each repeating the first column.
        const groups = [];
        let current = [0], used = widths[0];
        for (let i = 1; i < columns.length; i++) {
            if (used + widths[i] > this.width && current.length > 1) { groups.push(current); current = [0]; used = widths[0]; }
            current.push(i); used += widths[i];
        }
        groups.push(current);
        groups.forEach((cols, g) => {
            if (groups.length > 1) { this.ensure(30); this.y -= 6; this.text(M.l, this.y - 6, 'Columns ' + (g + 1) + ' of ' + groups.length, {size: 7.5, color: MUTED}); this.y -= 10; }
            const extra = Math.max(0, this.width - cols.reduce((a, i) => a + widths[i], 0)) / cols.length;
            const lead = size * 1.55;
            const fit = (s, w) => { let t = s; while (t.length > 1 && textWidth(bytesOf(t), size, false) > w - pad) t = t.slice(0, -2) + '…'; return t; };
            const header = () => {
                this.ensure(lead * 2);
                let x = M.l;
                this.y -= lead;
                cols.forEach((i, k) => {
                    const w = widths[i] + extra, right = columns[i].align === 'right';
                    this.text(right ? x + w - pad / 2 : x + (k ? pad / 2 : 0), this.y + size * 0.3, fit(columns[i].label, w), {size, bold: true, color: MUTED, align: right ? 'right' : 'left'});
                    x += w;
                });
                this.y -= 3; this.rule(this.y, INK, 0.5);
            };
            header();
            for (const r of cells) {
                if (this.y - lead < M.b) { this.newPage(); header(); }
                this.y -= lead;
                let x = M.l;
                cols.forEach((i, k) => {
                    const w = widths[i] + extra, right = columns[i].align === 'right';
                    this.text(right ? x + w - pad / 2 : x + (k ? pad / 2 : 0), this.y + size * 0.3, fit(r[i], w), {size, align: right ? 'right' : 'left'});
                    x += w;
                });
            }
            this.y -= 4; this.rule(this.y);
            this.y -= 6;
        });
    };
    /** zlib deflate (PDF FlateDecode) with the browser's CompressionStream; null where unavailable. */
    async function deflate(bytes) {
        if (typeof CompressionStream === 'undefined') return null;
        try { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer()); }
        catch (e) { return null; }
    }
    /**
     * Ethos Research watermark as a picture, not text: a full-page greyscale image with the brand repeated
     * diagonally across the page, drawn last with the Multiply blend (/GSm), so white leaves the page untouched
     * and the grey marks show over tables and charts alike. Being an image, it cannot be selected, copied with
     * the data or stripped out as a text object, and the tiling means any crop of a table still carries it.
     * Returns null where no canvas is available; the PDF then falls back to the text watermark below.
     */
    async function watermarkImage() {
        if (typeof document === 'undefined') return null;
        const k = 2, W = Math.round(A4.w * k), H = Math.round(A4.h * k);
        const canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        const g = canvas.getContext('2d');
        if (!g) return null;
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
        g.translate(W / 2, H / 2); g.rotate(-35 * Math.PI / 180);
        g.fillStyle = 'rgb(232,233,230)'; g.textAlign = 'center'; g.textBaseline = 'middle';
        const big = 'bold ' + 30 * k + 'px Helvetica, Arial, sans-serif', small = 12 * k + 'px Helvetica, Arial, sans-serif';
        const stepX = 330 * k, stepY = 125 * k, reach = Math.hypot(W, H) / 2 + stepX;
        for (let row = 0, y = -reach; y <= reach; row++, y += stepY) {
            for (let x = -reach + (row % 2) * stepX / 2; x <= reach; x += stepX) {
                g.font = big; g.fillText('ETHOS RESEARCH', x, y);
                g.font = small; g.fillText('ethosresearch.xyz', x, y + 26 * k);
            }
        }
        const rgba = g.getImageData(0, 0, W, H).data, grey = new Uint8Array(W * H);
        for (let i = 0; i < grey.length; i++) grey[i] = rgba[i * 4];
        const packed = await deflate(grey);
        return packed ? {bytes: packed, filter: ' /Filter /FlateDecode', width: W, height: H} : {bytes: grey, filter: '', width: W, height: H};
    }
    /** Fallback watermark as faint diagonal type (6% opacity through /GSw), used only without a canvas. */
    function watermarkOps() {
        const ops = [], angle = 35 * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
        const line = (text, size, bold, offset) => {
            const bytes = bytesOf(text), w = textWidth(bytes, size, bold), h = size * 0.7;
            // Centre of the line sits `offset` points below the page centre, measured across the slant.
            const cx = A4.w / 2 + sin * offset, cy = A4.h / 2 - cos * offset;
            const e = cx - cos * w / 2 + sin * h / 2, f = cy - sin * w / 2 - cos * h / 2;
            ops.push('BT /' + (bold ? 'F2' : 'F1') + ' ' + size + ' Tf ' + [cos, sin, -sin, cos, e, f].map(n => n.toFixed(4)).join(' ') + ' Tm ' + hex(bytes) + ' Tj ET');
        };
        line('ETHOS RESEARCH', 54, true, 0);
        line('ethosresearch.xyz', 18, false, 44);
        return 'q /GSw gs ' + INK + ' rg\n' + ops.join('\n') + '\nQ';
    }

    Doc.prototype.bytes = async function () {
        const total = this.pages.length;
        let mark = null;
        try { mark = await watermarkImage(); } catch (e) { mark = null; }
        this.pages.forEach((p, i) => {
            p.ops.push(mark ? 'q /GSm gs ' + A4.w + ' 0 0 ' + A4.h + ' 0 0 cm /Wm Do Q' : watermarkOps());
            p.ops.push('BT /F1 7 Tf ' + MUTED + ' rg ' + M.l + ' 30 Td ' + hex(bytesOf('Ethos Research  ·  ethosresearch.xyz')) + ' Tj ET');
            const label = bytesOf('Page ' + (i + 1) + ' of ' + total);
            p.ops.push('BT /F1 7 Tf ' + MUTED + ' rg ' + (A4.w - M.r - textWidth(label, 7, false)).toFixed(2) + ' 30 Td ' + hex(label) + ' Tj ET');
        });
        const enc = s => { const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 255; return a; };
        const streams = await Promise.all(this.pages.map(async p => {
            const raw = enc(p.ops.join('\n')), packed = await deflate(raw);
            return packed ? {data: packed, filter: ' /Filter /FlateDecode'} : {data: raw, filter: ''};
        }));
        const chunks = [], offsets = [];
        let length = 0;
        const push = part => { const b = typeof part === 'string' ? enc(part) : part; chunks.push(b); length += b.length; };
        const obj = (n, body) => { offsets[n] = length; push(n + ' 0 obj\n'); body.forEach(push); push('\nendobj\n'); };
        const firstImage = 5, markObj = firstImage + this.images.length, firstPage = markObj + (mark ? 1 : 0), firstLink = firstPage + total * 2;
        const links = [];
        this.pages.forEach((p, i) => p.links.forEach(l => links.push({page: i, ...l})));
        const info = firstLink + links.length;
        push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
        obj(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
        obj(2, ['<< /Type /Pages /Count ' + total + ' /Kids [' + this.pages.map((_, i) => (firstPage + i * 2) + ' 0 R').join(' ') + '] >>']);
        obj(3, ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>']);
        obj(4, ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>']);
        this.images.forEach((img, i) => obj(firstImage + i, ['<< /Type /XObject /Subtype /Image /Width ' + img.width + ' /Height ' + img.height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + img.bytes.length + ' >>\nstream\n', img.bytes, '\nendstream']));
        if (mark) obj(markObj, ['<< /Type /XObject /Subtype /Image /Width ' + mark.width + ' /Height ' + mark.height + ' /ColorSpace /DeviceGray /BitsPerComponent 8' + mark.filter + ' /Length ' + mark.bytes.length + ' >>\nstream\n', mark.bytes, '\nendstream']);
        this.pages.forEach((p, i) => {
            const n = firstPage + i * 2;
            const xobj = [...p.images].map(k => '/Im' + k + ' ' + (firstImage + k) + ' 0 R').concat(mark ? ['/Wm ' + markObj + ' 0 R'] : []).join(' ');
            const annots = links.map((l, k) => (l.page === i ? (firstLink + k) + ' 0 R' : '')).filter(Boolean).join(' ');
            obj(n, ['<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + A4.w + ' ' + A4.h + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /ExtGState << /GSw << /Type /ExtGState /ca 0.06 /CA 0.06 >> /GSm << /Type /ExtGState /BM /Multiply >> >>' + (xobj ? ' /XObject << ' + xobj + ' >>' : '') + ' >>' + (annots ? ' /Annots [' + annots + ']' : '') + ' /Contents ' + (n + 1) + ' 0 R >>']);
            obj(n + 1, ['<< /Length ' + streams[i].data.length + streams[i].filter + ' >>\nstream\n', streams[i].data, '\nendstream']);
        });
        links.forEach((l, k) => obj(firstLink + k, ['<< /Type /Annot /Subtype /Link /Rect [' + l.rect + '] /Border [0 0 0] /A << /S /URI /URI ' + hex(bytesOf(l.uri)) + ' >> >>']));
        obj(info, ['<< /Title ' + hex(bytesOf(this.title)) + ' /Producer (Ethos Research) /CreationDate (D:' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z) >>']);
        const xref = length;
        let table = 'xref\n0 ' + (info + 1) + '\n0000000000 65535 f \n';
        for (let n = 1; n <= info; n++) table += String(offsets[n]).padStart(10, '0') + ' 00000 n \n';
        push(table + 'trailer\n<< /Size ' + (info + 1) + ' /Root 1 0 R /Info ' + info + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
        const out = new Uint8Array(length);
        let at = 0;
        chunks.forEach(c => { out.set(c, at); at += c.length; });
        return out;
    };

    /* ---------------- Charts (Plotly → JPEG, redrawn for paper) ---------------- */

    const PAPER = {ink: '#121412', muted: '#565a53', line: '#d3d2c8', accent: '#1b6a47', surface: '#ebeae3', base: '#ffffff'};
    async function chartImage(section) {
        const gd = section.element;
        if (!gd || !gd.data || !gd.data.length || typeof Plotly === 'undefined' || !Plotly.toImage) return null;
        const css = getComputedStyle(gd);
        const map = new Map(Object.entries(section.colors || {}).map(([a, b]) => [a.toLowerCase(), b]));
        for (const key of Object.keys(PAPER)) {
            const v = css.getPropertyValue('--wp--preset--color--' + key).trim().toLowerCase();
            if (v && !map.has(v)) map.set(v, PAPER[key]);
        }
        const traces = gd.data.filter(t => !(section.exclude && section.exclude(t)));
        if (!traces.length) return null;
        let json = JSON.stringify({data: traces, layout: gd.layout || {}});
        for (const [from, to] of map) json = json.split('"' + from + '"').join('"' + to + '"');
        const fig = JSON.parse(json);
        if (section.patch) section.patch(fig.layout);
        // A vertical legend with many series needs a taller image, or Plotly clips it.
        const legendRows = fig.layout.showlegend !== false && fig.layout.legend && fig.layout.legend.orientation === 'v' ? traces.length : 0;
        const width = 1100, height = Math.max(section.height || 560, legendRows * 24 + 90), scale = 1.6;
        Object.assign(fig.layout, {paper_bgcolor: '#ffffff', plot_bgcolor: '#ffffff', width, height, autosize: false, dragmode: false});
        fig.layout.font = Object.assign({}, fig.layout.font, {color: PAPER.ink, size: 14, family: 'Helvetica, Arial, sans-serif'});
        if (fig.layout.legend) fig.layout.legend = Object.assign({}, fig.layout.legend, {font: {size: 13, color: PAPER.ink}});
        const url = await Plotly.toImage(fig, {format: 'jpeg', width, height, scale});
        const bin = atob(url.slice(url.indexOf(',') + 1));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return {bytes, width: Math.round(width * scale), height: Math.round(height * scale)};
    }

    async function pdf(spec, generated = new Date()) {
        const doc = new Doc(spec.title);
        doc.text(M.l, doc.y, (spec.kicker || 'Ethos Research').toUpperCase(), {size: 7.5, bold: true, color: ACCENT});
        doc.y -= 8;
        doc.wrap(spec.title, 19, true, doc.width).forEach(line => { doc.y -= 23; doc.text(M.l, doc.y, line, {size: 19, bold: true}); });
        doc.y -= 4;
        if (spec.subtitle) doc.paragraph(spec.subtitle, {size: 10, color: MUTED});
        // Short visible line; the full view URL (which can be very long) sits behind a clickable link.
        doc.y -= 11;
        const generatedText = 'Generated ' + stamp(generated) + (spec.url ? '  ·  ' : '');
        doc.text(M.l, doc.y, generatedText, {size: 7.5, color: MUTED});
        if (spec.url) {
            const x = M.l + textWidth(bytesOf(generatedText), 7.5, false), label = 'Open this view online';
            doc.text(x, doc.y, label, {size: 7.5, color: ACCENT});
            doc.link(x, doc.y - 2, textWidth(bytesOf(label), 7.5, false), 10, spec.url);
        }
        doc.y -= 6; doc.rule(doc.y); doc.y -= 4;
        for (const s of spec.sections || []) {
            if (s.type === 'facts' && s.items.length) { doc.heading(s.title); doc.facts(s.items); }
            else if (s.type === 'chart') {
                let img = null;
                try { img = await chartImage(s); } catch (e) { img = null; }
                if (img) {
                    doc.ensure(doc.width * img.height / img.width + 40); // keep the heading with its chart
                    doc.heading(s.title); doc.image(img, s.caption);
                }
            } else if (s.type === 'table') {
                doc.heading(s.title);
                const rows = s.rows.length > PDF_TABLE_ROWS ? s.rows.slice(0, PDF_TABLE_ROWS) : s.rows;
                const note = [s.note && s.note.trim(), s.rows.length > PDF_TABLE_ROWS ? 'The PDF shows the first ' + PDF_TABLE_ROWS.toLocaleString('en') + ' of ' + s.rows.length.toLocaleString('en') + ' rows; the Markdown report and CSV contain all of them.' : ''].filter(Boolean).join(' ');
                doc.table(s.columns, rows, note);
            } else if (s.type === 'text' && s.paragraphs.length) {
                doc.heading(s.title);
                s.paragraphs.forEach(p => { doc.paragraph(p, {size: 8.5, color: MUTED}); doc.y -= 3; });
            }
        }
        if (spec.footer) { doc.y -= 8; doc.rule(doc.y); doc.y -= 2; doc.paragraph(spec.footer, {size: 7.5, color: MUTED}); }
        return await doc.bytes();
    }

    /* ---------------- Download ---------------- */

    function download(data, type, filename) {
        const blob = new Blob([data], {type});
        const url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url; a.download = filename; a.rel = 'noopener';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
    }

    async function save(spec, format, basename) {
        const generated = new Date();
        const name = String(basename || 'ethos-report').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') + '-' + generated.toISOString().slice(0, 10);
        if (format === 'md') download(markdown(spec, generated), 'text/markdown;charset=utf-8', name + '.md');
        else download(await pdf(spec, generated), 'application/pdf', name + '.pdf');
    }

    return {markdown, pdf, save, bytesOf, textWidth};
}));
