# Graph Traversal Visualizer

An interactive learning platform for the **Design and Analysis of Algorithms (DAA)** that shows how **Breadth-First Search (BFS)** and **Depth-First Search (DFS)** explore a graph, one step at a time.

This Project is done by Sri Sai Surya Vishwak Gadepally(92400118494) and Pulicheri Sushanth(92400118445).

You build a graph in the browser, pick an algorithm and a start node, and press **Run traversal**. The browser sends the graph to a **Flask REST API**. The **Python backend runs the real algorithm**, records every step, and returns the steps as JSON. The browser then replays them, with forward, backward, play and pause, on an SVG canvas.

> **Important design rule:** there is **no BFS or DFS code in JavaScript**. Python is the single source of truth; the frontend only draws what the API returns.

---

## 1. Objectives

- Implement BFS and DFS correctly using an **adjacency list**, a **queue** and a **stack**.
- Demonstrate **O(V + E)** time and **O(V)** auxiliary space, and explain *why*.
- Show how **cycles** and **disconnected graphs** are handled using a visited set.
- Build a small but complete **client-server application** with a REST API, validation and automated tests.

## 2. Technologies

| Layer | Technology |
|---|---|
| Frontend | HTML5, CSS3, vanilla JavaScript (ES6+), SVG, Fetch API |
| Backend | Python 3, Flask, Flask-CORS (optional) |
| API | REST, JSON, `GET` and `POST` |
| Tests | pytest |

## 3. Project structure

```
graph-traversal-visualizer/
├── app.py                  # entry point: python app.py
├── requirements.txt
├── pytest.ini
├── README.md
├── backend/
│   ├── __init__.py         # Flask app factory, error handlers, serves the frontend
│   ├── graph_utils.py      # Graph class, adjacency list builder, request validation
│   ├── algorithms.py       # BFS, DFS and the step recorder   <-- the DAA core
│   └── routes.py           # REST endpoints under /api
├── frontend/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── api.js              # fetch() wrapper, error handling
│       ├── graph-renderer.js   # SVG drawing, dragging, zoom/pan
│       ├── playback.js         # step index, play/pause, speed
│       └── app.js              # wires the UI to the API and panels
└── tests/
    ├── test_bfs.py
    ├── test_dfs.py
    └── test_api.py
```

## 4. System architecture

```
 Browser (HTML/CSS/JS + SVG)                         Flask server (one process)
┌───────────────────────────────┐   POST /api/graph/traverse   ┌────────────────────────────┐
│ graph editor  ->  api.js      │ ───────────────────────────► │ routes.py  (validate JSON) │
│ playback.js  <- JSON steps    │ ◄─────────────────────────── │ graph_utils.py (adj. list) │
│ graph-renderer.js (SVG)       │      {order, steps, ...}     │ algorithms.py (BFS / DFS)  │
└───────────────────────────────┘                              └────────────────────────────┘
```

1. The user edits the graph (stored in the browser as `nodes` and `edges`).
2. `api.js` sends `{algorithm, start_node, traverse_all, graph}` as JSON.
3. `routes.py` validates it, `graph_utils.py` builds the adjacency list, `algorithms.py` runs BFS/DFS and records a **snapshot after every step**.
4. The response holds the final order **and** all snapshots. Because each snapshot is complete (current node, queue/stack, visited set, active edge), stepping **backwards** is just showing the previous snapshot.

## 5. Data structures used (and why)

| Need | Structure | Reason |
|---|---|---|
| Store the graph | **Adjacency list** (`dict`: node → list of neighbours) | Scanning all neighbours of all nodes costs O(V + E); uses O(V + E) memory, ideal for sparse graphs |
| BFS frontier | **Queue** (`collections.deque`) | FIFO makes the *oldest* discovered node go first, which gives level-by-level order; `popleft()` is O(1) |
| DFS frontier | **Stack** (Python `list`, `append`/`pop`) | LIFO makes the *newest* node go first, which gives depth-first order; implemented **iteratively** so each step can be recorded |
| Remember seen nodes | **Visited set** (`set`) | O(1) membership test prevents revisiting nodes and infinite loops on cycles |

**Deterministic order:** neighbours are always sorted by the position of the node in the `nodes` list, so the same graph always gives the same traversal.

## 6. Algorithms and pseudocode

### BFS (queue, FIFO)
```
BFS(G, s):
  create empty queue Q and visited set
  mark s visited;  enqueue(Q, s)
  while Q is not empty:
      u ← dequeue(Q)                 // front
      visit(u)
      for each neighbour v of u in G[u]:
          if v not in visited:
              mark v visited         // mark when ENQUEUED so v is never queued twice
              enqueue(Q, v)          // back
```

### DFS (stack, LIFO; iterative with a "next neighbour" pointer per node)
```
DFS(G, s):
  create empty stack S and visited set
  visit(s); mark s visited;  push(S, s)
  while S is not empty:
      u ← top(S)
      if u has an unexplored neighbour v:
          if v not in visited:
              visit(v); mark v visited;  push(S, v)     // go deeper
      else:
          pop(S)                                         // backtrack
```
This produces **exactly the same order as recursive DFS** (a test checks this), but the stack is explicit so the stack contents and the backtracking steps can be shown.

### Disconnected graphs
Two modes (switch in the UI, `traverse_all` in the API):
- **From start node only** (default): visits only the component reachable from the start node; the rest is returned in `unreachable_nodes`.
- **Entire graph**: when the queue/stack empties, the algorithm restarts from the next unvisited node in node-creation order, until all nodes are visited.

### Cycles
Before using a neighbour the algorithm checks the visited set. If the neighbour is already visited/discovered, the edge is **skipped** (shown as a "skip" step). Each node is therefore processed exactly once and the algorithm always terminates.

## 7. Complexity analysis

| Algorithm | Time | Auxiliary space |
|---|---|---|
| BFS | O(V + E) | O(V) |
| DFS | O(V + E) | O(V) |

`V` = number of vertices (nodes), `E` = number of edges.

**Time, O(V + E):** each vertex enters and leaves the queue/stack once → O(V). While handling a vertex we scan only *its own* neighbour list; the lists together contain E entries (directed) or 2E entries (undirected) → O(E). With an adjacency *matrix* we would scan a full row of V cells per vertex, giving O(V²).

**Space, O(V):** the visited set holds ≤ V nodes, and the queue/stack holds ≤ V nodes in the worst case. The adjacency list is the *input*, so it is not counted as auxiliary space. (BFS peaks with the widest level; DFS peaks with the deepest path.)

**Theory vs. runtime:** Big-O describes *growth*. The `runtime_ms` returned by the API is only a stopwatch reading of a tiny input on one computer and is **not** the complexity. `edges_examined` equals `E` for directed graphs and `2E` for undirected graphs, because each undirected edge is seen from both ends.

## 8. REST API

Base URL: `http://127.0.0.1:5000`. All bodies are JSON. Errors look like `{"error": "<code>", "message": "<human readable>"}`.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Status and app name |
| GET | `/api/algorithms` | Algorithms, descriptions, data structures, complexity |
| POST | `/api/graph/validate` | Validate nodes, edges, start node (optional) and settings |
| POST | `/api/graph/traverse` | Run BFS/DFS and return order and steps |

### `POST /api/graph/traverse`

Request:
```json
{
  "algorithm": "bfs",
  "start_node": "A",
  "traverse_all": false,
  "graph": {
    "directed": false,
    "nodes": ["A", "B", "C", "D"],
    "edges": [["A", "B"], ["A", "C"], ["B", "D"]]
  }
}
```

Response (shortened):
```json
{
  "algorithm": "bfs",
  "start_node": "A",
  "traverse_all": false,
  "traversal_order": ["A", "B", "C", "D"],
  "visited_nodes": ["A", "B", "C", "D"],
  "unreachable_nodes": [],
  "total_nodes_visited": 4,
  "edges_examined": 6,
  "adjacency_list": {"A": ["B", "C"], "B": ["A", "D"], "C": ["A"], "D": ["B"]},
  "complexity": {"time": "O(V + E)", "auxiliary_space": "O(V)", "V": 4, "E": 3, "note": "..."},
  "runtime_ms": 0.05,
  "step_count": 12,
  "steps": [
    {"index": 0, "type": "enqueue", "action": "Start: mark A as discovered and enqueue it.",
     "current": null, "edge": null, "data_structure": "queue", "queue": ["A"],
     "pending": ["A"], "visited": [], "edges_examined": 0},
    {"index": 1, "type": "visit", "action": "Dequeue and visit A. Now look at its neighbours: B, C.",
     "current": "A", "edge": null, "data_structure": "queue", "queue": [],
     "pending": [], "visited": ["A"], "edges_examined": 0}
  ]
}
```
Step `type` is one of `enqueue`, `visit`, `skip`, `backtrack`, `restart`, `done`. A DFS step has a `stack` list instead of `queue`.

### Error codes (HTTP 400 unless noted)

| Situation | `error` |
|---|---|
| Algorithm not `bfs`/`dfs` | `invalid_algorithm` |
| No nodes | `empty_graph` |
| Start node missing/unknown | `invalid_start_node` |
| Duplicate node id | `duplicate_node` |
| Edge uses an unknown node | `unknown_node_in_edge` |
| Edge is not a `[from, to]` pair | `invalid_edge` |
| Self-loop / duplicate edge | `self_loop` / `duplicate_edge` |
| Wrong types, bad `graph` object | `invalid_graph`, `invalid_request` |
| Body is not valid JSON | `malformed_json` |
| Wrong HTTP method | `method_not_allowed` (**405**) |
| Unknown `/api/...` route | `not_found` (**404**) |

Example with curl:
```bash
curl -X POST http://127.0.0.1:5000/api/graph/traverse -H "Content-Type: application/json" ^
  -d "{\"algorithm\":\"dfs\",\"start_node\":\"A\",\"graph\":{\"nodes\":[\"A\",\"B\"],\"edges\":[[\"A\",\"B\"]]}}"
```
(on macOS/Linux use `\` instead of `^`).

## 9. Installation and running (Windows)

Requires **Python 3.9+**. Open **PowerShell** in the project folder:

```powershell
cd graph-traversal-visualizer
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Then open **http://127.0.0.1:5000** in your browser. One Flask server serves both the website and the API.

If PowerShell blocks `activate`, run `Set-ExecutionPolicy -Scope Process Bypass` first, or use Command Prompt (`venv\Scripts\activate.bat`).

**macOS / Linux:** `python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt && python3 app.py`

## 10. Running the tests

```powershell
venv\Scripts\activate
python -m pytest -v
```

The suite (59 tests) covers: BFS and DFS order on known graphs, FIFO queue / LIFO stack snapshots, a cross-check of iterative DFS against recursive DFS, single-node, disconnected, cyclic and directed graphs, deterministic neighbour order, invalid start node, invalid edge references, empty graph, duplicate nodes, malformed JSON, unsupported HTTP methods, and the API response format.

## 11. Using the app

- **Add node**: button, or double-click the canvas. **Select** mode lets you drag nodes (they cannot overlap).
- **Add edge**: switch to *Add edge*, click one node then another. (In *Directed* mode the first click is the *from* node.)
- **Delete selected**: click a node or edge, then the button or `Delete` key.
- **Sample graph**: simple, branching, cyclic, disconnected.
- **Run traversal** → playback starts. Use `←` / `→` to step, the speed slider to change pace.
- **Run both & compare** shows the BFS and DFS orders side by side.
- Colours: white = unvisited, amber = current, sage = visited, lavender = in queue/stack, coral = active edge.

## 12. Limitations and future work

- Unweighted graphs only (no edge weights, no Dijkstra).
- Self-loops and parallel edges are rejected; the editor is limited to 30 nodes (the API accepts 200).
- Node positions are set by the user or the sample, with no automatic force-directed layout.
- Ideas: weighted graphs and shortest paths, bidirectional BFS, topological sort and cycle detection built on DFS, step-by-step *recursion* view of DFS, saving/loading graphs, per-step explanations in other languages.

---

## 13. Viva preparation

**What is graph traversal?**
Visiting every node reachable from a start node in a systematic way, exactly once. BFS and DFS are the two basic strategies.

**What is the difference between BFS and DFS?**
BFS explores level by level (all neighbours first) using a **queue**. DFS goes as deep as possible along one path and then backtracks, using a **stack** (or recursion). BFS finds shortest paths (fewest edges) in unweighted graphs; DFS is used for cycle detection, topological sort and backtracking problems.

**Why does BFS use a queue?**
We must process nodes in the order they were discovered: nodes at distance 1 before distance 2, and so on. A queue is first-in-first-out, so older (closer) nodes are always taken before newer (farther) ones.

**Why does DFS use a stack?**
We must always continue from the *most recently discovered* node so we keep going deeper, and return to earlier nodes only when stuck. A stack is last-in-first-out. Recursion works too because the call stack *is* a stack.

**What are V and E?**
V is the number of vertices (nodes), E the number of edges.

**Why is the time complexity O(V + E)?**
Each vertex is put in and taken out of the queue/stack once (V). For each vertex we look at its adjacency list once; all lists together hold E entries (2E if undirected). So the total work is V + E (or V + 2E, which is still O(V + E)).

**How are cycles handled?**
With a visited set. If a neighbour is already visited (or already discovered in BFS), we skip it. Each node is processed once, so cycles can't cause infinite loops.

**Why use an adjacency list?**
It stores only the edges that exist, so memory is O(V + E) and traversal is O(V + E). An adjacency matrix needs O(V²) memory and O(V²) traversal time, which is wasteful for sparse graphs. (A matrix is better only for dense graphs or O(1) "is there an edge u-v?" checks.)

**What is a REST API?**
A way for programs to talk over HTTP using URLs (resources) and standard methods (`GET` to read, `POST` to send data) and usually JSON. It is stateless: each request carries everything the server needs.

**What is the difference between frontend and backend?**
The frontend runs in the browser (HTML/CSS/JS) and handles display and interaction. The backend runs on the server (Python/Flask) and handles the logic and data. Here the backend runs the algorithms and the frontend only draws the results.

**How does the browser communicate with Flask?**
JavaScript's `fetch()` sends an HTTP `POST` request with the graph as JSON to `/api/graph/traverse`. Flask runs the function bound to that URL, and returns a JSON response, which JavaScript turns into the animation.

**How did you test the algorithms?**
With automated pytest tests: known graphs with hand-checked orders, FIFO/LIFO checks on the recorded queue/stack, edge cases (single node, disconnected, cyclic, directed), a comparison of the iterative DFS with a recursive reference DFS, and API tests for correct responses and for every error case.

**Bonus: why is a node marked when it is *enqueued* in BFS, not when it is dequeued?**
Otherwise the same node could be added to the queue several times before it is processed (for example D in a diamond graph), wasting time and breaking the O(V + E) bound.
