"""Graph representation and request validation.

The graph is stored as an ADJACENCY LIST: a dict mapping every node to the
list of its neighbours.  Neighbours are always ordered by the position of the
node in the input ``nodes`` list, so the same graph always gives the same
traversal order (deterministic).
"""
from __future__ import annotations

from dataclasses import dataclass

MAX_NODES = 200
MAX_EDGES = 2000
MAX_ID_LENGTH = 32
SUPPORTED_ALGORITHMS = ("bfs", "dfs")


class ApiError(Exception):
    """An error that is reported to the client as a JSON message."""

    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


@dataclass
class Graph:
    directed: bool
    nodes: list          # node ids in input order
    edges: list          # list of (u, v) tuples
    adjacency: dict      # node -> list of neighbours (ordered)

    @property
    def V(self) -> int:
        return len(self.nodes)

    @property
    def E(self) -> int:
        return len(self.edges)


def build_adjacency_list(nodes, edges, directed):
    """Build the adjacency list.  O(V + E) time, O(V + E) space."""
    adjacency = {n: [] for n in nodes}
    for u, v in edges:
        adjacency[u].append(v)
        if not directed:
            adjacency[v].append(u)
    position = {n: i for i, n in enumerate(nodes)}
    for n in adjacency:
        adjacency[n].sort(key=position.__getitem__)   # deterministic order
    return adjacency


def parse_graph(raw) -> Graph:
    """Validate the ``graph`` object of a request and build a Graph."""
    if not isinstance(raw, dict):
        raise ApiError("invalid_graph", "'graph' must be an object with 'nodes' and 'edges'.")

    directed = raw.get("directed", False)
    if not isinstance(directed, bool):
        raise ApiError("invalid_graph", "'graph.directed' must be true or false.")

    nodes = raw.get("nodes")
    edges = raw.get("edges", [])
    if not isinstance(nodes, list):
        raise ApiError("invalid_graph", "'graph.nodes' must be a list of node ids.")
    if not isinstance(edges, list):
        raise ApiError("invalid_graph", "'graph.edges' must be a list of [from, to] pairs.")
    if len(nodes) == 0:
        raise ApiError("empty_graph", "The graph is empty. Add at least one node before running a traversal.")
    if len(nodes) > MAX_NODES:
        raise ApiError("graph_too_large", f"A graph can have at most {MAX_NODES} nodes.")
    if len(edges) > MAX_EDGES:
        raise ApiError("graph_too_large", f"A graph can have at most {MAX_EDGES} edges.")

    seen = set()
    for n in nodes:
        if not isinstance(n, str) or not n.strip():
            raise ApiError("invalid_node", f"Node ids must be non-empty strings (got {n!r}).")
        if len(n) > MAX_ID_LENGTH:
            raise ApiError("invalid_node", f"Node id {n[:10]!r}... is longer than {MAX_ID_LENGTH} characters.")
        if n in seen:
            raise ApiError("duplicate_node", f"Duplicate node id {n!r}. Every node id must be unique.")
        seen.add(n)

    clean_edges = []
    seen_edges = set()
    for e in edges:
        if not isinstance(e, (list, tuple)) or len(e) != 2 or not all(isinstance(x, str) for x in e):
            raise ApiError("invalid_edge", f"Each edge must be a [from, to] pair of node ids (got {e!r}).")
        u, v = e
        for end in (u, v):
            if end not in seen:
                raise ApiError("unknown_node_in_edge",
                               f"Edge [{u!r}, {v!r}] references node {end!r}, which is not in the graph.")
        if u == v:
            raise ApiError("self_loop", f"Edge [{u!r}, {v!r}] is a self-loop, which is not supported.")
        key = (u, v) if directed else tuple(sorted((u, v)))
        if key in seen_edges:
            raise ApiError("duplicate_edge", f"Duplicate edge between {u!r} and {v!r}.")
        seen_edges.add(key)
        clean_edges.append((u, v))

    return Graph(directed, list(nodes), clean_edges, build_adjacency_list(nodes, clean_edges, directed))


def require_object(data):
    if not isinstance(data, dict):
        raise ApiError("invalid_request", "The request body must be a JSON object.")
    return data


def parse_start_node(graph: Graph, start):
    if start is None or not isinstance(start, str) or start not in graph.adjacency:
        raise ApiError("invalid_start_node",
                       f"Start node {start!r} is not in the graph. Choose one of: {', '.join(graph.nodes)}.")
    return start


def parse_traverse_request(data):
    """Return (algorithm, graph, start_node, traverse_all) or raise ApiError."""
    data = require_object(data)
    algorithm = data.get("algorithm")
    if not isinstance(algorithm, str) or algorithm.lower() not in SUPPORTED_ALGORITHMS:
        raise ApiError("invalid_algorithm",
                       f"Unsupported algorithm {algorithm!r}. Use one of: {', '.join(SUPPORTED_ALGORITHMS)}.")
    traverse_all = data.get("traverse_all", False)
    if not isinstance(traverse_all, bool):
        raise ApiError("invalid_request", "'traverse_all' must be true or false.")
    graph = parse_graph(data.get("graph"))
    start = parse_start_node(graph, data.get("start_node"))
    return algorithm.lower(), graph, start, traverse_all
