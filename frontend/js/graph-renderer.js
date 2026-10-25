/* graph-renderer.js - draws the graph with SVG and handles pointer interaction.
   It only draws and reports clicks; it knows nothing about BFS/DFS. */
(function (global) {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const R = 24;                       // node radius (SVG units)
  const W = 900, H = 560;             // world size: nodes are kept inside this box
  const MIN_GAP = 2 * R + 14;         // minimum centre distance between two nodes

  function svgEl(name, attrs, parent) {
    const e = document.createElementNS(NS, name);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function edgeKey(u, v, directed) {
    if (directed) return u + '>' + v;
    return u < v ? u + '|' + v : v + '|' + u;
  }

  class GraphRenderer {
    /**
     * @param {SVGElement} svg
     * @param {{directed:boolean,nodes:{id:string,x:number,y:number}[],edges:string[][]}} graph  shared, mutable model
     * @param {object} handlers onNodeClick(id), onEdgeClick(key), onBackgroundClick(), onBackgroundDblClick({x,y})
     */
    constructor(svg, graph, handlers) {
      this.svg = svg;
      this.graph = graph;
      this.h = handlers || {};
      this.mode = 'select';
      this.selection = null;           // {type:'node', id} | {type:'edge', key}
      this.edgeSource = null;
      this.startId = null;
      this.state = this._emptyState();
      this.nodeEls = new Map();
      this.edgeEls = new Map();
      this.drag = null;
      this.vb = { x: 0, y: 0, w: W, h: H };

      this._buildSkeleton();
      this._bind();
      this.resetView();
    }

    _emptyState() {
      return { current: null, visited: new Set(), pending: new Set(), edge: null, treeEdges: new Set(), order: new Map() };
    }

    /* ---------- skeleton ---------- */
    _buildSkeleton() {
      const defs = svgEl('defs', null, this.svg);
      const mk = (id, color) => {
        const m = svgEl('marker', { id: id, viewBox: '0 0 12 12', refX: '11', refY: '6', markerWidth: '12', markerHeight: '12', markerUnits: 'userSpaceOnUse', orient: 'auto' }, defs);
        svgEl('path', { d: 'M0,0.5 L12,6 L0,11.5 z', fill: color }, m);
      };
      mk('arrow', '#B9AE98'); mk('arrow-tree', '#3E7A58'); mk('arrow-active', '#F07862'); mk('arrow-selected', '#234E3D');
      const f = svgEl('filter', { id: 'nodeShadow', x: '-30%', y: '-30%', width: '160%', height: '170%' }, defs);
      svgEl('feDropShadow', { dx: '0', dy: '2', stdDeviation: '2.2', 'flood-color': '#234E3D', 'flood-opacity': '.22' }, f);
      this.edgeLayer = svgEl('g', { class: 'edges' }, this.svg);
      this.nodeLayer = svgEl('g', { class: 'nodes' }, this.svg);
    }

    /* ---------- public API ---------- */
    setMode(mode) {
      this.mode = mode;
      this.edgeSource = null;
      this.svg.classList.toggle('mode-edge', mode === 'edge');
      this.sync();
    }
    setSelection(sel) { this.selection = sel; this.sync(); }
    setEdgeSource(id) { this.edgeSource = id; this.sync(); }
    setStart(id) { this.startId = id; this.sync(); }
    setState(partial) { this.state = Object.assign(this._emptyState(), partial || {}); this.sync(); this._raiseActiveEdge(); }
    clearState() { this.setState(null); }

    /* ---------- view: zoom / pan / fit ---------- */
    get aspect() {
      const w = this.svg.clientWidth, hgt = this.svg.clientHeight;
      return w > 0 && hgt > 0 ? hgt / w : H / W;
    }
    _applyView() {
      this.svg.setAttribute('viewBox', [this.vb.x, this.vb.y, this.vb.w, this.vb.h].map(n => +n.toFixed(2)).join(' '));
    }
    _setView(cx, cy, w) {
      w = Math.max(220, Math.min(w, 2400));
      const hgt = w * this.aspect;
      this.vb = { x: cx - w / 2, y: cy - hgt / 2, w: w, h: hgt };
      this._applyView();
    }
    resetView() { this._setView(W / 2, H / 2, W); }
    fit() {
      const nodes = this.graph.nodes;
      if (!nodes.length) return this.resetView();
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      nodes.forEach(n => { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); });
      const pad = 80;
      const bw = x1 - x0 + 2 * pad, bh = y1 - y0 + 2 * pad;
      const w = Math.max(bw, bh / this.aspect, 420);
      this._setView((x0 + x1) / 2, (y0 + y1) / 2, w);
    }
    zoom(factor, centre) {
      const c = centre || { x: this.vb.x + this.vb.w / 2, y: this.vb.y + this.vb.h / 2 };
      const w = Math.max(220, Math.min(this.vb.w * factor, 2400));
      const f = w / this.vb.w;
      const hgt = w * this.aspect;
      this.vb = { x: c.x - (c.x - this.vb.x) * f, y: c.y - (c.y - this.vb.y) * f, w: w, h: hgt };
      this._applyView();
    }
    onResize() { this._setView(this.vb.x + this.vb.w / 2, this.vb.y + this.vb.h / 2, this.vb.w); }

    toSvg(evt) {
      const pt = this.svg.createSVGPoint();
      pt.x = evt.clientX; pt.y = evt.clientY;
      const m = this.svg.getScreenCTM();
      return m ? pt.matrixTransform(m.inverse()) : { x: 0, y: 0 };
    }

    /* ---------- drawing (idempotent reconciliation) ---------- */
    sync() {
      const g = this.graph;
      const ids = new Set(g.nodes.map(n => n.id));
      this.nodeEls.forEach((e, id) => { if (!ids.has(id)) { e.root.remove(); this.nodeEls.delete(id); } });

      const keys = new Set();
      g.edges.forEach(([u, v]) => keys.add(edgeKey(u, v, g.directed)));
      this.edgeEls.forEach((e, k) => { if (!keys.has(k)) { e.root.remove(); this.edgeEls.delete(k); } });

      g.edges.forEach(([u, v]) => {
        const k = edgeKey(u, v, g.directed);
        let e = this.edgeEls.get(k);
        if (!e) e = this._createEdge(k);
        this._updateEdge(e, u, v, k);
      });
      g.nodes.forEach(n => {
        let e = this.nodeEls.get(n.id);
        if (!e) e = this._createNode(n.id);
        this._updateNode(e, n);
      });
    }

    _createEdge(key) {
      const root = svgEl('g', { class: 'edge', 'data-edge': key }, this.edgeLayer);
      const line = svgEl('path', { class: 'line' }, root);
      const hit = svgEl('path', { class: 'hit' }, root);
      const e = { root, line, hit };
      this.edgeEls.set(key, e);
      return e;
    }

    _updateEdge(e, u, v, key) {
      const g = this.graph;
      const a = g.nodes.find(n => n.id === u), b = g.nodes.find(n => n.id === v);
      if (!a || !b) return;
      let dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      const hasReverse = g.directed && g.edges.some(([x, y]) => x === v && y === u);
      let cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      if (hasReverse) { cx += -dy * 38; cy += dx * 38; }          // bow the two opposite arrows apart
      const gap = g.directed ? 3 : 0;
      // end points on the circle borders, aimed at the control point (works for straight lines too)
      const toA = norm(cx - a.x, cy - a.y), toB = norm(cx - b.x, cy - b.y);
      const sx = a.x + toA.x * R, sy = a.y + toA.y * R;
      const ex = b.x + toB.x * (R + gap), ey = b.y + toB.y * (R + gap);
      const d = hasReverse ? `M${sx} ${sy} Q${cx} ${cy} ${ex} ${ey}` : `M${sx} ${sy} L${ex} ${ey}`;
      e.line.setAttribute('d', d);
      e.hit.setAttribute('d', d);

      const st = this.state;
      const active = st.edge === key;
      const tree = st.treeEdges.has(key);
      const selected = !!this.selection && this.selection.type === 'edge' && this.selection.key === key;
      e.root.classList.toggle('is-active', active);
      e.root.classList.toggle('is-tree', tree && !active);
      e.root.classList.toggle('is-selected', selected && !active);
      if (g.directed) {
        const m = active ? 'arrow-active' : selected ? 'arrow-selected' : tree ? 'arrow-tree' : 'arrow';
        e.line.setAttribute('marker-end', `url(#${m})`);
      } else {
        e.line.removeAttribute('marker-end');
      }
    }

    _createNode(id) {
      const root = svgEl('g', { class: 'node', 'data-node': id, tabindex: '-1' }, this.nodeLayer);
      const halo = svgEl('circle', { class: 'halo', r: R + 8 }, root);
      const body = svgEl('circle', { class: 'body', r: R, filter: 'url(#nodeShadow)' }, root);
      const ring = svgEl('circle', { class: 'ring', r: R + 7 }, root);
      const label = svgEl('text', { class: 'label' }, root);
      const badge = svgEl('g', { class: 'badge', transform: `translate(${R * 0.74},${-R * 0.78})` }, root);
      svgEl('circle', { r: 9.5 }, badge);
      const badgeText = svgEl('text', null, badge);
      const tag = svgEl('text', { class: 'start-tag', y: R + 16 }, root);
      tag.textContent = 'start';
      const e = { root, halo, body, ring, label, badge, badgeText, tag };
      this.nodeEls.set(id, e);
      return e;
    }

    _updateNode(e, n) {
      const st = this.state;
      e.root.setAttribute('transform', `translate(${n.x},${n.y})`);
      e.label.textContent = n.id;
      e.label.style.fontSize = n.id.length > 2 ? '12px' : n.id.length > 1 ? '15px' : '';
      const cur = st.current === n.id;
      const pend = st.pending.has(n.id);
      const vis = st.visited.has(n.id);
      e.root.classList.toggle('is-current', cur);
      e.root.classList.toggle('is-pending', pend && !cur);
      e.root.classList.toggle('is-visited', vis && !cur && !pend);
      e.root.classList.toggle('has-order', st.order.has(n.id));
      e.root.classList.toggle('is-start', this.startId === n.id);
      e.root.classList.toggle('is-selected', !!this.selection && this.selection.type === 'node' && this.selection.id === n.id);
      e.root.classList.toggle('is-source', this.edgeSource === n.id);
      const ord = st.order.get(n.id);
      e.badgeText.textContent = ord != null ? String(ord) : '';
    }

    _raiseActiveEdge() {
      this.edgeEls.forEach(e => { if (e.root.classList.contains('is-active')) this.edgeLayer.appendChild(e.root); });
    }

    /* ---------- pointer interaction ---------- */
    _bind() {
      const svg = this.svg;
      svg.addEventListener('pointerdown', e => this._down(e));
      svg.addEventListener('pointermove', e => this._move(e));
      svg.addEventListener('pointerup', e => this._up(e));
      svg.addEventListener('pointercancel', () => this._cancel());
      svg.addEventListener('wheel', e => {
        e.preventDefault();
        this.zoom(e.deltaY < 0 ? 0.88 : 1.14, this.toSvg(e));
      }, { passive: false });
      svg.addEventListener('dblclick', e => {
        // pointer capture redirects e.target to the svg, so hit-test by position instead
        const under = document.elementFromPoint(e.clientX, e.clientY);
        if (under && (under.closest('[data-node]') || under.closest('[data-edge]'))) return;
        if (this.h.onBackgroundDblClick) this.h.onBackgroundDblClick(this.toSvg(e));
      });
    }

    _down(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const nodeEl = e.target.closest('[data-node]');
      const edgeEl = e.target.closest('[data-edge]');
      const p = this.toSvg(e);
      this.drag = { x0: e.clientX, y0: e.clientY, moved: false, pid: e.pointerId };
      if (nodeEl) {
        const id = nodeEl.getAttribute('data-node');
        const n = this.graph.nodes.find(q => q.id === id);
        Object.assign(this.drag, { type: 'node', id, dx: p.x - n.x, dy: p.y - n.y });
      } else if (edgeEl) {
        Object.assign(this.drag, { type: 'edge', key: edgeEl.getAttribute('data-edge') });
      } else {
        Object.assign(this.drag, { type: 'pan', vx: this.vb.x, vy: this.vb.y });
      }
      try { this.svg.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    }

    _move(e) {
      const d = this.drag;
      if (!d || d.pid !== e.pointerId) return;
      if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 4) {
        d.moved = true;
        if (d.type === 'pan') this.svg.classList.add('is-panning');
      }
      if (!d.moved) return;
      if (d.type === 'node' && this.mode === 'select') {
        const p = this.toSvg(e);
        const n = this.graph.nodes.find(q => q.id === d.id);
        if (!n) return;
        let x = clamp(p.x - d.dx, R + 4, W - R - 4), y = clamp(p.y - d.dy, R + 4, H - R - 4);
        // never let two nodes overlap: push this one out of any node it touches
        this.graph.nodes.forEach(o => {
          if (o.id === n.id) return;
          const dist = Math.hypot(x - o.x, y - o.y);
          if (dist < MIN_GAP) {
            const u = dist ? { x: (x - o.x) / dist, y: (y - o.y) / dist } : { x: 1, y: 0 };
            x = o.x + u.x * MIN_GAP; y = o.y + u.y * MIN_GAP;
          }
        });
        n.x = clamp(x, R + 4, W - R - 4); n.y = clamp(y, R + 4, H - R - 4);
        this.sync();
      } else if (d.type === 'pan') {
        const m = this.svg.getScreenCTM();
        const scale = m ? m.a : 1;
        this.vb.x = d.vx - (e.clientX - d.x0) / scale;
        this.vb.y = d.vy - (e.clientY - d.y0) / scale;
        this._applyView();
      }
    }

    _up(e) {
      const d = this.drag;
      if (!d || d.pid !== e.pointerId) return;
      this.drag = null;
      this.svg.classList.remove('is-panning');
      try { this.svg.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      const wasClick = !d.moved || (d.type === 'node' && this.mode === 'edge');
      if (!wasClick) return;
      if (d.type === 'node' && this.h.onNodeClick) this.h.onNodeClick(d.id);
      else if (d.type === 'edge' && this.h.onEdgeClick) this.h.onEdgeClick(d.key);
      else if (d.type === 'pan' && !d.moved && this.h.onBackgroundClick) this.h.onBackgroundClick();
    }

    _cancel() { this.drag = null; this.svg.classList.remove('is-panning'); }
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function norm(x, y) { const l = Math.hypot(x, y) || 1; return { x: x / l, y: y / l }; }

  global.GTV = global.GTV || {};
  global.GTV.GraphRenderer = GraphRenderer;
  global.GTV.edgeKey = edgeKey;
  global.GTV.WORLD = { W, H, R, MIN_GAP };
})(window);
