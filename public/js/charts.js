// Luxe Imports - Motor de gráficos SVG en vanilla JS.
// Sin dependencias externas ni CDN: cumple la CSP estricta (script-src 'self').
// Los datos se leen desde el atributo data-chart (JSON) de cada contenedor,
// nunca desde JS inline, y todas las etiquetas provienen del servidor.
(function () {
    'use strict';

    const NS = 'http://www.w3.org/2000/svg';
    const PALETTE = ['#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6', '#ec4899',
        '#14b8a6', '#eab308', '#f97316', '#6366f1', '#84cc16', '#06b6d4'];

    function svgEl(tag, attrs) {
        const el = document.createElementNS(NS, tag);
        for (const k in attrs) el.setAttribute(k, attrs[k]);
        return el;
    }

    function fmt(n) {
        return new Intl.NumberFormat('es-ES').format(Math.round(n));
    }

    // --- Tooltip compartido ---
    function getTooltip() {
        let t = document.querySelector('.chart-tooltip');
        if (!t) {
            t = document.createElement('div');
            t.className = 'chart-tooltip';
            document.body.appendChild(t);
        }
        return t;
    }
    function showTip(html, ev) {
        const t = getTooltip();
        t.innerHTML = html;
        t.style.opacity = '1';
        t.style.left = (ev.pageX + 14) + 'px';
        t.style.top = (ev.pageY + 14) + 'px';
    }
    function hideTip() {
        const t = document.querySelector('.chart-tooltip');
        if (t) t.style.opacity = '0';
    }

    function legend(items) {
        const wrap = document.createElement('div');
        wrap.className = 'chart-legend';
        items.forEach(it => {
            const span = document.createElement('span');
            span.className = 'legend-item';
            const swatch = document.createElement('i');
            swatch.style.background = it.color;
            span.appendChild(swatch);
            span.appendChild(document.createTextNode(it.label));
            wrap.appendChild(span);
        });
        return wrap;
    }

    // --- Gráfico de líneas ---
    function lineChart(container, cfg) {
        const W = 640, H = 300, pad = { t: 20, r: 20, b: 40, l: 64 };
        const labels = cfg.labels || [];
        const series = cfg.series || [];
        const allVals = series.reduce((a, s) => a.concat(s.values), []);
        const max = Math.max(1, ...allVals);
        const step = (W - pad.l - pad.r) / Math.max(1, labels.length - 1);
        const scaleY = v => H - pad.b - (v / max) * (H - pad.t - pad.b);

        const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img' });

        for (let i = 0; i <= 4; i++) {
            const val = max * i / 4;
            const y = scaleY(val);
            svg.appendChild(svgEl('line', { x1: pad.l, y1: y, x2: W - pad.r, y2: y, class: 'chart-gridline' }));
            const tx = svgEl('text', { x: pad.l - 10, y: y + 4, class: 'chart-axis', 'text-anchor': 'end' });
            tx.textContent = fmt(val);
            svg.appendChild(tx);
        }

        labels.forEach((lb, i) => {
            const tx = svgEl('text', { x: pad.l + step * i, y: H - pad.b + 20, class: 'chart-axis', 'text-anchor': 'middle' });
            tx.textContent = lb;
            svg.appendChild(tx);
        });

        series.forEach(s => {
            let d = '';
            s.values.forEach((v, i) => {
                d += (i === 0 ? 'M' : 'L') + (pad.l + step * i) + ' ' + scaleY(v) + ' ';
            });
            svg.appendChild(svgEl('path', {
                d: d.trim(), fill: 'none', stroke: s.color, 'stroke-width': 2.5,
                'stroke-linejoin': 'round', 'stroke-linecap': 'round'
            }));
            s.values.forEach((v, i) => {
                const c = svgEl('circle', { cx: pad.l + step * i, cy: scaleY(v), r: 4, fill: s.color, class: 'chart-point' });
                c.addEventListener('mousemove', ev => showTip(`<strong>${s.name}</strong><br>${labels[i]}: ${fmt(v)} €`, ev));
                c.addEventListener('mouseleave', hideTip);
                svg.appendChild(c);
            });
        });

        container.appendChild(svg);
        container.appendChild(legend(series.map(s => ({ label: s.name, color: s.color }))));
    }

    // --- Gráfico de barras ---
    function barChart(container, cfg) {
        const W = 640, H = 300, pad = { t: 20, r: 20, b: 40, l: 64 };
        const labels = cfg.labels || [];
        const values = cfg.values || [];
        const color = cfg.color || PALETTE[0];
        const max = Math.max(1, ...values);
        const gap = (W - pad.l - pad.r) / Math.max(1, labels.length);
        const bw = gap * 0.6;
        const scaleY = v => H - pad.b - (v / max) * (H - pad.t - pad.b);

        const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img' });

        for (let i = 0; i <= 4; i++) {
            const val = max * i / 4;
            const y = scaleY(val);
            svg.appendChild(svgEl('line', { x1: pad.l, y1: y, x2: W - pad.r, y2: y, class: 'chart-gridline' }));
            const tx = svgEl('text', { x: pad.l - 10, y: y + 4, class: 'chart-axis', 'text-anchor': 'end' });
            tx.textContent = fmt(val);
            svg.appendChild(tx);
        }

        labels.forEach((lb, i) => {
            const x = pad.l + gap * i + (gap - bw) / 2;
            const y = scaleY(values[i]);
            const h = Math.max(0, (H - pad.b) - y);
            const rect = svgEl('rect', { x, y, width: bw, height: h, rx: 4, fill: color, class: 'chart-bar' });
            rect.addEventListener('mousemove', ev => showTip(`${lb}: ${fmt(values[i])} €`, ev));
            rect.addEventListener('mouseleave', hideTip);
            svg.appendChild(rect);
            const tx = svgEl('text', { x: pad.l + gap * i + gap / 2, y: H - pad.b + 20, class: 'chart-axis', 'text-anchor': 'middle' });
            tx.textContent = lb;
            svg.appendChild(tx);
        });

        container.appendChild(svg);
    }

    // --- Gráfico circular (doughnut) ---
    function doughnutChart(container, cfg) {
        const size = 260, cx = size / 2, cy = size / 2, r = 90, sw = 38;
        const segments = (cfg.segments || []).filter(s => s.value > 0);
        const total = segments.reduce((a, s) => a + s.value, 0);
        const circ = 2 * Math.PI * r;

        const svg = svgEl('svg', { viewBox: `0 0 ${size} ${size}`, class: 'chart-svg chart-doughnut', role: 'img' });

        if (total === 0) {
            svg.appendChild(svgEl('circle', { cx, cy, r, fill: 'none', stroke: 'rgba(255,255,255,0.08)', 'stroke-width': sw }));
        }

        let offset = 0;
        segments.forEach((s, i) => {
            const frac = s.value / total;
            const len = frac * circ;
            const color = s.color || PALETTE[i % PALETTE.length];
            const seg = svgEl('circle', {
                cx, cy, r, fill: 'none', stroke: color, 'stroke-width': sw,
                'stroke-dasharray': `${len} ${circ - len}`, 'stroke-dashoffset': -offset,
                transform: `rotate(-90 ${cx} ${cy})`, class: 'chart-seg'
            });
            seg.addEventListener('mousemove', ev => showTip(`<strong>${s.label}</strong><br>${fmt(s.value)} € (${(frac * 100).toFixed(1)}%)`, ev));
            seg.addEventListener('mouseleave', hideTip);
            svg.appendChild(seg);
            offset += len;
        });

        const numText = svgEl('text', { x: cx, y: cy - 2, class: 'chart-center-num', 'text-anchor': 'middle' });
        numText.textContent = fmt(total) + ' €';
        const labelText = svgEl('text', { x: cx, y: cy + 18, class: 'chart-center-label', 'text-anchor': 'middle' });
        labelText.textContent = cfg.centerLabel || 'Total';
        svg.appendChild(numText);
        svg.appendChild(labelText);

        const wrap = document.createElement('div');
        wrap.className = 'chart-doughnut-wrap';
        wrap.appendChild(svg);
        wrap.appendChild(legend(segments.map((s, i) => ({
            label: `${s.label} · ${fmt(s.value)} €`,
            color: s.color || PALETTE[i % PALETTE.length]
        }))));
        container.appendChild(wrap);
    }

    function init() {
        document.querySelectorAll('[data-chart]').forEach(container => {
            let cfg;
            try {
                cfg = JSON.parse(container.dataset.chart);
            } catch (e) {
                return;
            }
            container.innerHTML = '';
            const type = container.dataset.chartType || 'line';
            if (type === 'line') lineChart(container, cfg);
            else if (type === 'bar') barChart(container, cfg);
            else if (type === 'doughnut') doughnutChart(container, cfg);
        });
    }

    if (document.readyState !== 'loading') init();
    else document.addEventListener('DOMContentLoaded', init);
})();
