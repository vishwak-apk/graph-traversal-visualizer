"""BFS and DFS with full step-by-step execution recording.

Both algorithms are written the way they are taught in a DAA course; the only
extra work is the ``_Trace`` recorder, which stores a snapshot of the
algorithm's state after every meaningful action.  The frontend replays those
snapshots, so forward/backward playback needs no algorithm code in JavaScript.

Neighbour order is the order of the input ``nodes`` list (see graph_utils), so
results are deterministic.
"""
from __future__ import annotations

import time
from collections import deque

from .graph_utils import ApiError, Graph

ALGORITHM_INFO = {
    "bfs": {
        "name": "Breadth-First Search",
        "short": "BFS",
        "description": "Explores the graph level by level: first the start node, then all of its "
                       "neighbours, then their neighbours, and so on.",
        "data_structure": "Queue (FIFO)",
        "supporting_structures": ["Visited / discovered set"],
        "complexity": {"time": "O(V + E)", "auxiliary_space": "O(V)"},
        "use_cases": ["Shortest path in an unweighted graph", "Level-order traversal",
                      "Finding connected components", "Peer-to-peer / social-network 'degrees of separation'"],
    },
    "dfs": {
        "name": "Depth-First Search",
        "short": "DFS",
        "description": "Follows one path as deep as possible, then backtracks to the most recent node "
                       "that still has unexplored neighbours.",
        "data_structure": "Stack (LIFO) - iterative, with one 'next neighbour' pointer per node",
        "supporting_structures": ["Visited set"],
        "complexity": {"time": "O(V + E)", "auxiliary_space": "O(V)"},
        "use_cases": ["Cycle detection", "Topological sorting", "Maze solving / backtracking",
                      "Finding connected components"],
    },
}


class _Trace:
    """Records a snapshot of the algorithm state after every step."""

    def __init__(self, algorithm: str):
        self.struct_name = "queue" if algorithm == "bfs" else "stack"
        self.steps = []
        self.order = []            # nodes in the order they were visited
        self.edges_examined = 0

    def add(self, type_, action, structure, current=None, edge=None, pending=None):
        self.steps.append({
            "index": len(self.steps),
            "type": type_,                       # enqueue | visit | skip | backtrack | restart | done
            "action": action,                    # human-readable explanation
            "current": current,                  # node being processed (highlighted amber)
            "edge": list(edge) if edge else None,  # edge being examined (highlighted coral)
            "data_structure": self.struct_name,
            self.struct_name: list(structure),   # "queue": [...]  or  "stack": [...]
            "pending": list(structure if pending is None else pending),  # nodes shown lavender
            "visited": list(self.order),         # visit order so far
            "edges_examined": self.edges_examined,
        })


def _check_start(graph: Graph, start):
    if start not in graph.adjacency:
        raise ApiError("invalid_start_node", f"Start node {start!r} is not in the graph.")


def _roots(graph: Graph, start, traverse_all):
    """Start node first; with traverse_all, then every other node in input order."""
    if traverse_all:
        return [start] + [n for n in graph.nodes if n != start]
    return [start]


def bfs(graph: Graph, start: str, traverse_all: bool = False) -> dict:
    _check_start(graph, start)
    t0 = time.perf_counter()
    trace = _Trace("bfs")
    adj = graph.adjacency
    discovered = set()        # marked when ENQUEUED, so a node is never queued twice
    queue = deque()

    first = True
    for root in _roots(graph, start, traverse_all):
        if root in discovered:
            continue
        discovered.add(root)
        queue.append(root)
        if first:
            trace.add("enqueue", f"Start: mark {root} as discovered and enqueue it.", queue, edge=None)
        else:
            trace.add("restart", f"Previous component finished. {root} is still unvisited, "
                                 f"so restart BFS from {root} (enqueue it).", queue)
        first = False

        while queue:
            u = queue.popleft()                          # FIFO: take from the front
            trace.order.append(u)
            trace.add("visit", f"Dequeue and visit {u}. Now look at its neighbours: "
                               f"{', '.join(adj[u]) if adj[u] else 'none'}.", queue, current=u)
            for v in adj[u]:
                trace.edges_examined += 1
                if v not in discovered:
                    discovered.add(v)
                    queue.append(v)                      # FIFO: add at the back
                    trace.add("enqueue", f"Edge {u}→{v}: {v} is new. Mark it discovered and add {v} to the queue.",
                              queue, current=u, edge=(u, v))
                else:
                    trace.add("skip", f"Edge {u}→{v}: {v} was already discovered, so skip it "
                                      f"(this is how cycles are handled).", queue, current=u, edge=(u, v))

    trace.add("done", f"Queue is empty. BFS visited {len(trace.order)} node(s).", [])
    return _result("bfs", graph, start, traverse_all, trace, t0)


def dfs(graph: Graph, start: str, traverse_all: bool = False) -> dict:
    _check_start(graph, start)
    t0 = time.perf_counter()
    trace = _Trace("dfs")
    adj = graph.adjacency
    visited = set()
    next_index = {n: 0 for n in graph.nodes}   # next neighbour to try for each node
    stack = []

    def pending(current):
        return [n for n in stack if n != current]

    first = True
    for root in _roots(graph, start, traverse_all):
        if root in visited:
            continue
        visited.add(root)
        trace.order.append(root)
        stack.append(root)
        if first:
            trace.add("visit", f"Start: visit {root}, mark it visited and push it on the stack.",
                      stack, current=root, pending=pending(root))
        else:
            trace.add("restart", f"Previous component finished. {root} is still unvisited, so restart "
                                 f"DFS from {root} (visit and push it).", stack, current=root, pending=pending(root))
        first = False

        while stack:
            u = stack[-1]                                  # LIFO: look at the top
            i = next_index[u]
            if i < len(adj[u]):
                v = adj[u][i]
                next_index[u] += 1
                trace.edges_examined += 1
                if v not in visited:
                    visited.add(v)
                    trace.order.append(v)
                    stack.append(v)                        # go deeper
                    trace.add("visit", f"Edge {u}→{v}: {v} is unvisited. Visit {v} and push it "
                                       f"on the stack (go deeper).", stack, current=v, edge=(u, v),
                              pending=pending(v))
                else:
                    trace.add("skip", f"Edge {u}→{v}: {v} is already visited, so skip it "
                                      f"(this is how cycles are handled).", stack, current=u, edge=(u, v),
                              pending=pending(u))
            else:
                stack.pop()                                # nothing left here: backtrack
                where = f"back to {stack[-1]}" if stack else "- the stack is empty for this component"
                trace.add("backtrack", f"All neighbours of {u} are explored. Pop {u} and backtrack {where}.",
                          stack, current=u, pending=list(stack))

    trace.add("done", f"Stack is empty. DFS visited {len(trace.order)} node(s).", [])
    return _result("dfs", graph, start, traverse_all, trace, t0)


def _result(algorithm, graph: Graph, start, traverse_all, trace: _Trace, t0) -> dict:
    visited_set = set(trace.order)
    info = ALGORITHM_INFO[algorithm]
    return {
        "algorithm": algorithm,
        "algorithm_name": info["name"],
        "start_node": start,
        "traverse_all": traverse_all,
        "mode": "entire graph (restarts from unvisited nodes)" if traverse_all
                else "component reachable from the start node",
        "directed": graph.directed,
        "traversal_order": list(trace.order),
        "visited_nodes": list(trace.order),
        "unreachable_nodes": [n for n in graph.nodes if n not in visited_set],
        "total_nodes": graph.V,
        "total_edges": graph.E,
        "total_nodes_visited": len(trace.order),
        "edges_examined": trace.edges_examined,
        "data_structure": info["data_structure"],
        "adjacency_list": graph.adjacency,
        "steps": trace.steps,
        "step_count": len(trace.steps),
        "complexity": {
            **info["complexity"],
            "V": graph.V,
            "E": graph.E,
            "note": "Theoretical worst-case bounds. 'runtime_ms' below is only a measurement of this small input.",
        },
        "runtime_ms": round((time.perf_counter() - t0) * 1000, 4),
    }


TRAVERSALS = {"bfs": bfs, "dfs": dfs}


def traverse(algorithm: str, graph: Graph, start: str, traverse_all: bool = False) -> dict:
    return TRAVERSALS[algorithm](graph, start, traverse_all)
