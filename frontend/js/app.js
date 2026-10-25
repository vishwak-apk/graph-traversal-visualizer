/* app.js - wires the UI together: graph editing, API calls, playback, panels.
   NOTE: there is deliberately NO BFS/DFS code here. All traversal results come from the Flask API. */
(function () {
  'use strict';

  const { api, GraphRenderer, Playback, edgeKey, WORLD } = window.GTV;
  const { W, H, R, MIN_GAP } = WORLD;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const MAX_UI_NODES = 30;

  /* ---------------------------------------------------------------- state */
  const state = {
    graph: { directed: false, nodes: [], edges: [] },   // nodes: {id,x,y}   edges: [from,to]
    selection: null,
    mode: 'select',
    algorithm: 'bfs',
    start: null,
    traverseAll: false,
    result: null,
    loading: false,
  };

  /* ---------------------------------------------------------------- sample graphs (layout + edges only) */
  const SAMPLES = {
    simple: {
      nodes: { A: [450, 70], B: [280, 200], C: [620, 200], D: [190, 370], E: [370, 370], F: [530, 370], G: [710, 370] },
      edges: [['A', 'B'], ['A', 'C'], ['B', 'D'], ['B', 'E'], ['C', 'F'], ['C', 'G']],
    },
    branching: {
      nodes: { A: [450, 60], B: [220, 190], C: [450, 190], D: [680, 190], E: [110, 350], F: [300, 350], G: [450, 350], H: [600, 350], I: [770, 350], J: [300, 500] },
      edges: [['A', 'B'], ['A', 'C'], ['A', 'D'], ['B', 'E'], ['B', 'F'], ['C', 'G'], ['D', 'H'], ['D', 'I'], ['F', 'J']],
    },
    cyclic: {
      nodes: { A: [450, 100], B: [615, 195], C: [615, 385], D: [450, 480], E: [285, 385], F: [285, 195], G: [450, 290], H: [790, 120] },
      edges: [['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'E'], ['E', 'F'], ['F', 'A'], ['A', 'G'], ['G', 'D'], ['B', 'H']],
    },
    disconnected: {
      nodes: { A: [110, 160], B: [260, 80], C: [280, 270], D: [430, 380], E: [600, 120], F: [760, 200], G: [650, 330], H: [800, 470] },
      edges: [['A', 'B'], ['B', 'C'], ['A', 'C'], ['C', 'D'], ['E', 'F'], ['F', 'G']],
    },
  };

  /* ---------------------------------------------------------------- elements */
  const el = {
    svg: $('#graphSvg'), wrap: $('#canvasWrap'), empty: $('#canvasEmpty'), hint: $('#canvasHint'),
    toolSelect: $('#toolSelect'), toolEdge: $('#toolEdge'), addNode: $('#btnAddNode'), del: $('#btnDelete'),
    directed: $('#directedToggle'), sample: $('#sampleSelect'), clear: $('#btnClear'),
    zoomIn: $('#btnZoomIn'), zoomOut: $('#btnZoomOut'), fit: $('#btnFit'),
    algoBtns: $$('[data-algo].segmented button, .segmented [data-algo]'),
    start: $('#startSelect'), setStart: $('#btnSetStart'), mode: $('#modeToggle'), modeNote: $('#modeNote'),
    run: $('#btnRun'), status: $('#status'), apiBadge: $('#apiBadge'),
    pbAlgo: $('#pbAlgo'), pbStep: $('#pbStep'), pbProgress: $('#pbProgress'), pbBar: $('#pbProgressBar'), pbAction: $('#pbAction'),
    reset: $('#btnReset'), prev: $('#btnPrev'), play: $('#btnPlay'), next: $('#btnNext'),
    speed: $('#speed'), speedLabel: $('#speedLabel'),
    pbCurrent: $('#pbCurrent'), pbStructLabel: $('#pbStructLabel'), pbStruct: $('#pbStruct'), pbVisited: $('#pbVisited'), pbOrder: $('#pbOrder'),
    adj: $('#adjList'), summary: $('#summary'), compare: $('#btnCompare'), compareOut: $('#compareOut'),
    liveVE: $('#liveVE'), liveWork: $('#liveWork'), liveRuntime: $('#liveRuntime'),
  };
  const ALGO_NAMES = { bfs: 'Breadth-First Search', dfs: 'Depth-First Search' };

  /* ---------------------------------------------------------------- tiny DOM helper (text only: no innerHTML for data) */
  function h(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') n.className = attrs[k]; else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    }
    kids.flat().forEach(k => { if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k))); });
    return n;
  }
  const clear = n => { while (n.firstChild) n.removeChild(n.firstChild); };

  /* ---------------------------------------------------------------- renderer + playback */
  const renderer = new GraphRenderer(el.svg, state.graph, {
    onNodeClick: id => onNodeClick(id),
    onEdgeClick: key => selectEdge(key),
    onBackgroundClick: () => { if (state.mode === 'edge') { renderer.setEdgeSource(null); hint(); } select(null); },
    onBackgroundDblClick: p => addNode(p.x, p.y),
  });

  const playback = new Playback({
    onChange: idx => applyStep(idx),
    onPlayState: playing => {
      el.play.classList.toggle('is-playing', playing);
      el.play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    },
  });

  /* ---------------------------------------------------------------- status / hints */
  function setStatus(kind, html) {
    el.status.dataset.kind = kind;
    clear(el.status);
    if (typeof html === 'string') el.status.textContent = html; else el.status.append(html);
  }
  let hintTimer = null;
  function hint(msg, alert) {
    clearTimeout(hintTimer);
    el.hint.classList.toggle('is-alert', !!alert);
    if (msg) {
      el.hint.textContent = msg;
      if (alert) hintTimer = setTimeout(() => hint(), 3500);
      return;
    }
    el.hint.textContent = state.mode === 'edge'
      ? (state.graph.directed ? 'Add edge: click the FROM node, then the TO node. Click the first node again to cancel.'
                              : 'Add edge: click one node, then another to connect them. Click the first node again to cancel.')
      : 'Drag nodes to move them. Click a node or edge to select it. Scroll to zoom, drag the background to pan.';
  }

  /* ---------------------------------------------------------------- graph editing */
  function nextNodeId() {
    const used = new Set(state.graph.nodes.map(n => n.id));
    for (let i = 0; i < 26; i++) { const id = String.fromCharCode(65 + i); if (!used.has(id)) return id; }
    let k = 27; while (used.has('N' + k)) k++;
    return 'N' + k;
  }

  /** Choose a free spot: maximise the distance to the nearest node (with a small pull towards the centre). */
  function freeSpot() {
    const ns = state.graph.nodes;
    if (!ns.length) return { x: W / 2, y: H / 2 };
    let best = null, bestScore = -Infinity;
    for (let x = 60; x <= W - 60; x += 30) {
      for (let y = 60; y <= H - 60; y += 30) {
        const nearest = Math.min(...ns.map(n => Math.hypot(n.x - x, n.y - y)));
        const score = Math.min(nearest, 170) - 0.06 * Math.hypot(x - W / 2, y - H / 2);
        if (nearest >= MIN_GAP + 16 && score > bestScore) { bestScore = score; best = { x, y }; }
      }
    }
    return best;
  }

  function addNode(x, y) {
    if (state.graph.nodes.length >= MAX_UI_NODES) { hint('The editor is limited to ' + MAX_UI_NODES + ' nodes to keep the graph readable.', true); return; }
    let p = (x == null) ? freeSpot() : { x: Math.max(R + 4, Math.min(W - R - 4, x)), y: Math.max(R + 4, Math.min(H - R - 4, y)) };
    if (!p || state.graph.nodes.some(n => Math.hypot(n.x - p.x, n.y - p.y) < MIN_GAP)) {
      p = freeSpot();
      if (!p) { hint('No free space left on the canvas. Remove a node first.', true); return; }
    }
    const id = nextNodeId();
    state.graph.nodes.push({ id, x: p.x, y: p.y });
    if (!state.start) state.start = id;
    graphChanged();
    select({ type: 'node', id });
  }

  function hasEdge(u, v) {
    return state.graph.edges.some(([a, b]) => (a === u && b === v) || (!state.graph.directed && a === v && b === u));
  }

  function addEdge(u, v) {
    if (u === v) { hint('Pick two different nodes. Self-loops are not supported.', true); return false; }
    if (hasEdge(u, v)) { hint('That edge already exists.', true); return false; }
    state.graph.edges.push([u, v]);
    graphChanged();
    return true;
  }

  function removeSelected() {
    const s = state.selection;
    if (!s) return;
    if (s.type === 'node') {
      state.graph.nodes = state.graph.nodes.filter(n => n.id !== s.id);
      state.graph.edges = state.graph.edges.filter(([a, b]) => a !== s.id && b !== s.id);
      if (state.start === s.id) state.start = state.graph.nodes.length ? state.graph.nodes[0].id : null;
    } else {
      state.graph.edges = state.graph.edges.filter(([a, b]) => edgeKey(a, b, state.graph.directed) !== s.key);
    }
    state.selection = null;
    graphChanged();
    select(null);
  }

  function setDirected(flag) {
    state.graph.directed = flag;
    if (!flag) {                                  // an undirected graph cannot hold both A->B and B->A
      const seen = new Set();
      state.graph.edges = state.graph.edges.filter(([a, b]) => {
        const k = edgeKey(a, b, false);
        if (seen.has(k)) return false;
        seen.add(k); return true;
      });
    }
    state.selection = null;
    graphChanged();
    select(null);
    hint();
  }

  function loadSample(name) {
    const s = SAMPLES[name];
    if (!s) return;
    state.graph.directed = false;
    el.directed.checked = false;
    state.graph.nodes = Object.keys(s.nodes).map(id => ({ id, x: s.nodes[id][0], y: s.nodes[id][1] }));
    state.graph.edges = s.edges.map(e => e.slice());
    state.start = state.graph.nodes[0].id;
    state.selection = null;
    graphChanged();
    select(null);
    renderer.resetView();
    el.sample.value = '';
    if (name === 'disconnected') {
      el.mode.checked = false; state.traverseAll = false; updateModeNote();
      setStatus('idle', 'Disconnected sample loaded. Run from A to see which nodes are unreachable, or switch on "Traverse entire graph".');
    } else {
      setStatus('idle', 'Sample graph loaded. Choose BFS or DFS and press Run traversal.');
    }
  }

  function clearGraph() {
    state.graph.nodes = []; state.graph.edges = []; state.start = null; state.selection = null;
    graphChanged();
    select(null);
    renderer.resetView();
    setStatus('idle', 'Graph cleared. Add nodes to start again.');
  }

  /* ---------------------------------------------------------------- selection and clicks */
  function select(sel) {
    state.selection = sel;
    renderer.setSelection(sel);
    el.del.disabled = !sel;
    el.setStart.disabled = !(sel && sel.type === 'node' && sel.id !== state.start);
  }
  function selectEdge(key) {
    if (state.mode === 'edge') return;
    select({ type: 'edge', key });
  }
  function onNodeClick(id) {
    if (state.mode === 'edge') {
      if (!renderer.edgeSource) { renderer.setEdgeSource(id); hint('Now click the ' + (state.graph.directed ? 'TO' : 'second') + ' node (first: ' + id + ').'); return; }
      if (renderer.edgeSource === id) { renderer.setEdgeSource(null); hint(); return; }
      const from = renderer.edgeSource;
      renderer.setEdgeSource(null);
      if (addEdge(from, id)) hint('Edge ' + from + (state.graph.directed ? ' → ' : ' — ') + id + ' added.');
      return;
    }
    select({ type: 'node', id });
  }
  function setMode(mode) {
    state.mode = mode;
    el.toolSelect.classList.toggle('is-active', mode === 'select');
    el.toolEdge.classList.toggle('is-active', mode === 'edge');
    el.toolSelect.setAttribute('aria-pressed', String(mode === 'select'));
    el.toolEdge.setAttribute('aria-pressed', String(mode === 'edge'));
    renderer.setMode(mode);
    hint();
  }

  /* ---------------------------------------------------------------- after any structural change */
  function graphChanged() {
    invalidateResult();
    renderer.setStart(state.start);
    renderer.sync();
    refreshStartSelect();
    renderAdjacency();
    const n = state.graph.nodes.length;
    el.empty.hidden = n > 0;
    el.liveVE.textContent = 'V = ' + n + ', E = ' + state.graph.edges.length;
    el.liveWork.textContent = String(n + state.graph.edges.length);
  }

  function refreshStartSelect() {
    clear(el.start);
    if (!state.graph.nodes.length) el.start.append(h('option', { value: '' }, 'No nodes'));
    state.graph.nodes.forEach(n => el.start.append(h('option', { value: n.id }, n.id)));
    if (state.start) el.start.value = state.start;
  }

  function renderAdjacency() {
    clear(el.adj);
    const g = state.graph;
    if (!g.nodes.length) { el.adj.append(h('p', { class: 'empty' }, 'The graph has no nodes yet.')); return; }
    const pos = new Map(g.nodes.map((n, i) => [n.id, i]));
    g.nodes.forEach(n => {
      const nb = [];
      g.edges.forEach(([a, b]) => { if (a === n.id) nb.push(b); else if (!g.directed && b === n.id) nb.push(a); });
      nb.sort((p, q) => pos.get(p) - pos.get(q));
      el.adj.append(h('div', { class: 'row', 'data-node': n.id }, h('b', null, n.id), h('span', null, '→'), h('span', { class: 'nb' }, '[' + nb.join(', ') + ']')));
    });
  }

  /* ---------------------------------------------------------------- traversal result lifecycle */
  function invalidateResult() {
    if (!state.result && !playback.hasSteps) { return; }
    state.result = null;
    playback.clear();
    renderer.clearState();
    renderSummary();
    clear(el.compareOut);
    el.liveRuntime.textContent = 'run a traversal';
    setStatus('idle', 'The graph changed, so the previous traversal was cleared. Press Run traversal again.');
  }

  function buildPayload(algorithm) {
    const g = state.graph;
    return {
      algorithm,
      start_node: state.start,
      traverse_all: state.traverseAll,
      graph: { directed: g.directed, nodes: g.nodes.map(n => n.id), edges: g.edges.map(e => e.slice()) },
    };
  }

  async function runTraversal() {
    if (state.loading) return;                       // prevent repeated submissions
    state.loading = true;
    el.run.classList.add('is-loading'); el.run.disabled = true;
    el.run.querySelector('span').textContent = 'Running…';
    setStatus('loading', 'Sending the graph to the Flask API…');
    try {
      const result = await api.traverse(buildPayload(state.algorithm));
      state.result = result;
      playback.load(result.steps);
      renderSummary();
      el.liveRuntime.textContent = result.runtime_ms + ' ms (backend, ' + result.total_nodes_visited + ' nodes)';
      setStatus('success', result.algorithm.toUpperCase() + ' finished: ' + result.step_count + ' steps recorded, ' +
        result.total_nodes_visited + ' of ' + result.total_nodes + ' nodes visited.');
      playback.play();
    } catch (err) {
      state.result = null;
      const offline = err.code === 'backend_unavailable';
      setStatus('error', (offline ? '' : 'The API rejected the graph: ') + err.message);
      if (offline) setApiBadge('offline');
    } finally {
      state.loading = false;
      el.run.classList.remove('is-loading'); el.run.disabled = false;
      el.run.querySelector('span').textContent = 'Run traversal';
    }
  }

  /* ---------------------------------------------------------------- applying a step to graph + panel */
  function applyStep(idx) {
    const res = state.result;
    const steps = playback.steps;
    const n = steps.length;
    const has = n > 0;

    el.reset.disabled = !has; el.prev.disabled = !has || idx < 0; el.next.disabled = !has || idx >= n - 1; el.play.disabled = !has;
    el.pbStep.textContent = 'Step ' + (idx + 1) + ' / ' + n;
    const pct = has ? Math.round(((idx + 1) / n) * 100) : 0;
    el.pbProgress.style.width = pct + '%';
    el.pbBar.setAttribute('aria-valuenow', String(pct));

    if (!has || !res) {
      renderer.clearState();
      el.pbAlgo.textContent = state.algorithm.toUpperCase();
      el.pbAction.textContent = 'Run a traversal to see its steps here.';
      el.pbCurrent.textContent = '—';
      setStructLabel(state.algorithm);
      [el.pbStruct, el.pbVisited, el.pbOrder].forEach(c => { clear(c); c.append(h('span', { class: 'none' }, 'nothing yet')); });
      markAdjacency(null);
      return;
    }

    const algo = res.algorithm;
    el.pbAlgo.textContent = algo.toUpperCase();
    setStructLabel(algo);

    if (idx < 0) {
      renderer.setState({});
      el.pbAction.textContent = 'Ready. Press Play or Step forward to begin. Every step comes from the backend.';
      el.pbCurrent.textContent = '—';
      [el.pbStruct, el.pbVisited, el.pbOrder].forEach(c => { clear(c); c.append(h('span', { class: 'none' }, 'empty')); });
      markAdjacency(null);
      return;
    }

    const s = steps[idx];
    const structure = s[s.data_structure];
    const order = new Map(s.visited.map((id, i) => [id, i + 1]));

    // tree edges: edges that discovered a node, up to and including this step
    const tree = new Set();
    for (let i = 0; i <= idx; i++) {
      const t = steps[i];
      if (t.edge && (t.type === 'enqueue' || t.type === 'visit')) tree.add(edgeKey(t.edge[0], t.edge[1], res.directed));
    }
    renderer.setState({
      current: s.current,
      visited: new Set(s.visited),
      pending: new Set(s.pending),
      edge: s.edge ? edgeKey(s.edge[0], s.edge[1], res.directed) : null,
      treeEdges: tree,
      order,
    });

    el.pbAction.textContent = s.action;
    el.pbCurrent.textContent = s.current || '—';

    // queue / stack chips (the tag marks the end that will be used next)
    clear(el.pbStruct);
    if (!structure.length) el.pbStruct.append(h('span', { class: 'none' }, 'empty'));
    structure.forEach((id, i) => {
      const isNext = algo === 'bfs' ? i === 0 : i === structure.length - 1;
      el.pbStruct.append(h('span', { class: 'chip c-pending' }, isNext ? h('span', { class: 'tag' }, algo === 'bfs' ? 'front' : 'top') : null, id));
    });

    // visited (node order) and sequence (visit order)
    const pos = new Map(state.graph.nodes.map((nd, i) => [nd.id, i]));
    clear(el.pbVisited);
    if (!s.visited.length) el.pbVisited.append(h('span', { class: 'none' }, 'none yet'));
    s.visited.slice().sort((a, b) => pos.get(a) - pos.get(b)).forEach(id =>
      el.pbVisited.append(h('span', { class: 'chip ' + (id === s.current ? 'c-current' : 'c-visited') }, id)));
    clear(el.pbOrder);
    if (!s.visited.length) el.pbOrder.append(h('span', { class: 'none' }, 'none yet'));
    s.visited.forEach((id, i) => {
      if (i) el.pbOrder.append(h('span', { class: 'arrow' }, '→'));
      el.pbOrder.append(h('span', { class: 'chip' }, h('small', null, i + 1), id));
    });
    markAdjacency(s.current);
  }

  function setStructLabel(algo) {
    el.pbStructLabel.textContent = algo === 'bfs' ? 'Queue (front → back)' : 'Stack (bottom → top)';
  }
  function markAdjacency(id) {
    $$('.row', el.adj).forEach(r => r.classList.toggle('is-current', r.getAttribute('data-node') === id));
  }

  /* ---------------------------------------------------------------- summary + compare */
  function renderSummary() {
    clear(el.summary);
    const r = state.result;
    if (!r) {
      el.summary.append(h('p', { class: 'empty' }, 'No traversal yet. Press ', h('b', null, 'Run traversal'), ' to see the order, counts and unreachable nodes.'));
      return;
    }
    const row = (k, v) => h('div', null, h('dt', null, k), h('dd', null, v));
    el.summary.append(
      h('dl', null,
        row('Algorithm', r.algorithm_name),
        row('Data structure', r.data_structure.split(' - ')[0]),
        row('Mode', r.traverse_all ? 'Entire graph' : 'From start node only'),
        row('Start node', r.start_node),
        row('Nodes visited', r.total_nodes_visited + ' / ' + r.total_nodes),
        row('Edges examined', String(r.edges_examined)),
        row('Unreachable', r.unreachable_nodes.length ? r.unreachable_nodes.join(', ') : 'none'),
        row('Backend runtime', r.runtime_ms + ' ms')),
      h('p', { class: 'order' }, r.traversal_order.join(' → ')),
      h('p', { class: 'note' }, 'Theory: O(V + E) = O(' + r.complexity.V + ' + ' + r.complexity.E + '). The measured time above only describes this tiny input on this machine.' +
        (r.unreachable_nodes.length ? ' Some nodes are unreachable from ' + r.start_node + '. Enable "Traverse entire graph" to cover them.' : '')));
  }

  async function compareBoth() {
    if (state.loading) return;
    el.compare.disabled = true;
    clear(el.compareOut);
    el.compareOut.append(h('p', { class: 'muted' }, 'Running both through the API…'));
    try {
      const [b, d] = await Promise.all([api.traverse(buildPayload('bfs')), api.traverse(buildPayload('dfs'))]);
      clear(el.compareOut);
      const row = (label, mine, other) => {
        const chips = h('div', { class: 'chips' });
        mine.forEach((id, i) => chips.append(h('span', { class: 'chip ' + (id !== other[i] ? 'diff ' : '') + 'c-visited' }, id)));
        return h('div', { class: 'cmp-row' }, h('span', null, label), chips);
      };
      const same = b.traversal_order.join() === d.traversal_order.join();
      el.compareOut.append(
        row('BFS (queue)', b.traversal_order, d.traversal_order),
        row('DFS (stack)', d.traversal_order, b.traversal_order),
        h('p', { class: 'muted' }, same
          ? 'Same order here: this graph is too simple to separate them. Try the branching or cyclic sample.'
          : 'BFS finishes each level before going deeper; DFS follows one branch to the end first.'));
    } catch (err) {
      clear(el.compareOut);
      el.compareOut.append(h('p', { class: 'status', 'data-kind': 'error' }, err.message));
    } finally {
      el.compare.disabled = false;
    }
  }

  /* ---------------------------------------------------------------- controls wiring */
  function setAlgorithm(algo) {
    state.algorithm = algo;
    $$('.segmented [data-algo]').forEach(b => {
      const on = b.dataset.algo === algo;
      b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', String(on));
    });
    if (state.result) invalidateResult();
    applyStep(-1);
  }
  function updateModeNote() {
    el.modeNote.textContent = state.traverseAll
      ? 'Entire graph: after the start node\'s component, the algorithm restarts from the next unvisited node (in creation order) until every node is visited.'
      : 'From start node only: visits just the component reachable from the start node; other nodes are reported as unreachable.';
  }

  el.toolSelect.addEventListener('click', () => setMode('select'));
  el.toolEdge.addEventListener('click', () => setMode('edge'));
  el.addNode.addEventListener('click', () => addNode());
  el.del.addEventListener('click', removeSelected);
  el.directed.addEventListener('change', () => setDirected(el.directed.checked));
  el.sample.addEventListener('change', () => loadSample(el.sample.value));
  el.clear.addEventListener('click', clearGraph);
  el.zoomIn.addEventListener('click', () => renderer.zoom(0.8));
  el.zoomOut.addEventListener('click', () => renderer.zoom(1.25));
  el.fit.addEventListener('click', () => renderer.fit());
  $$('.segmented [data-algo]').forEach(b => b.addEventListener('click', () => setAlgorithm(b.dataset.algo)));
  el.start.addEventListener('change', () => { state.start = el.start.value || null; invalidateResult(); renderer.setStart(state.start); select(state.selection); });
  el.setStart.addEventListener('click', () => {
    if (state.selection && state.selection.type === 'node') {
      state.start = state.selection.id; refreshStartSelect(); invalidateResult(); renderer.setStart(state.start); select(state.selection);
    }
  });
  el.mode.addEventListener('change', () => { state.traverseAll = el.mode.checked; updateModeNote(); invalidateResult(); });
  el.run.addEventListener('click', runTraversal);
  el.compare.addEventListener('click', compareBoth);

  el.reset.addEventListener('click', () => playback.reset());
  el.prev.addEventListener('click', () => playback.prev());
  el.next.addEventListener('click', () => { playback.pause(); playback.next(); });
  el.play.addEventListener('click', () => playback.toggle());
  el.speed.addEventListener('input', () => { playback.setSpeed(el.speed.value); el.speedLabel.textContent = el.speed.value + '×'; });

  document.addEventListener('keydown', e => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { if (state.selection) { e.preventDefault(); removeSelected(); } }
    else if (e.key === 'ArrowRight' && playback.hasSteps) { e.preventDefault(); playback.pause(); playback.next(); }
    else if (e.key === 'ArrowLeft' && playback.hasSteps) { e.preventDefault(); playback.prev(); }
    else if (e.key === 'Escape') { renderer.setEdgeSource(null); select(null); hint(); }
  });

  new ResizeObserver(() => renderer.onResize()).observe(el.wrap);

  /* ---------------------------------------------------------------- page chrome */
  const navToggle = $('#navToggle'), navLinks = $('#navLinks');
  navToggle.addEventListener('click', () => {
    const open = navLinks.classList.toggle('is-open');
    navToggle.setAttribute('aria-expanded', String(open));
  });
  navLinks.addEventListener('click', e => { if (e.target.tagName === 'A') { navLinks.classList.remove('is-open'); navToggle.setAttribute('aria-expanded', 'false'); } });

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { threshold: .12 });
    $$('.reveal').forEach(n => io.observe(n));
  } else { $$('.reveal').forEach(n => n.classList.add('in')); }

  // comparison tabs (static teaching content)
  const CMP = {
    structure: { bfs: 'A QUEUE (FIFO). The node that was discovered first is processed first, which forces the level-by-level order.', dfs: 'A STACK (LIFO), or recursion. The most recently discovered node is explored next, which forces the "go deep first" order.' },
    order: { bfs: 'Visits all nodes at distance 1 from the start, then distance 2, and so on: A, B, C, D, E, F in the example.', dfs: 'Follows a branch to a dead end, backtracks, then tries the next branch: A, B, D, E, C, F in the example.' },
    best: { bfs: 'Shortest path in unweighted graphs, nearest-neighbour searches, level-order problems.', dfs: 'Cycle detection, topological sort, maze solving, exhaustive search with backtracking.' },
    memory: { bfs: 'The queue can hold a whole level, so it is worst on wide graphs (up to O(V)).', dfs: 'The stack holds the current path, so it is worst on long, deep graphs (up to O(V)).' },
  };
  function showCompare(topic) {
    const body = $('#cmpBody'); clear(body);
    body.append(
      h('div', { class: 'cmp-col bfs' }, h('h4', null, h('span', { class: 'pill pill-forest' }, 'BFS')), h('p', null, CMP[topic].bfs)),
      h('div', { class: 'cmp-col dfs' }, h('h4', null, h('span', { class: 'pill pill-coral' }, 'DFS')), h('p', null, CMP[topic].dfs)));
  }
  $$('#cmpTabs button').forEach(b => b.addEventListener('click', () => {
    $$('#cmpTabs button').forEach(x => { const on = x === b; x.classList.toggle('is-active', on); x.setAttribute('aria-pressed', String(on)); });
    showCompare(b.dataset.topic);
  }));
  showCompare('structure');

  /* ---------------------------------------------------------------- API health + algorithm info */
  function setApiBadge(kind) {
    el.apiBadge.dataset.state = kind;
    el.apiBadge.querySelector('span').textContent = kind === 'online' ? 'Flask API online' : kind === 'offline' ? 'API offline: run python app.py' : 'Checking API…';
  }
  async function bootApi() {
    try {
      await api.health();
      setApiBadge('online');
      const info = await api.algorithms();
      info.algorithms.forEach(a => {                       // fill the complexity table from the backend
        const row = $('.cx-table tr[data-algo="' + a.id + '"]');
        if (!row) return;
        row.querySelector('[data-field="time"]').textContent = a.complexity.time;
        row.querySelector('[data-field="auxiliary_space"]').textContent = a.complexity.auxiliary_space;
      });
    } catch (err) {
      setApiBadge('offline');
      setStatus('error', err.message);
    }
  }

  /* ---------------------------------------------------------------- init */
  updateModeNote();
  applyStep(-1);
  loadSample('simple');
  setStatus('idle', 'A sample graph is loaded. Choose BFS or DFS and press Run traversal. The Flask backend computes every step.');
  hint();
  bootApi();

  // handy for debugging in the console / automated checks
  window.GTV.debug = { state, playback, renderer };
})();
