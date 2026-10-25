import json

import pytest

from backend import create_app


@pytest.fixture()
def client():
    app = create_app()
    app.config["TESTING"] = True
    return app.test_client()


GRAPH = {"directed": False, "nodes": ["A", "B", "C", "D"], "edges": [["A", "B"], ["A", "C"], ["B", "D"]]}


def payload(**over):
    body = {"algorithm": "bfs", "start_node": "A", "traverse_all": False, "graph": json.loads(json.dumps(GRAPH))}
    body.update(over)
    return body


def post(client, path, body):
    return client.post(path, data=json.dumps(body), content_type="application/json")


# ---------- GET endpoints ----------
def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.get_json() == {"status": "ok", "app": "Graph Traversal Visualizer", "version": "1.0.0"}


def test_algorithms(client):
    data = client.get("/api/algorithms").get_json()
    ids = [a["id"] for a in data["algorithms"]]
    assert ids == ["bfs", "dfs"]
    for a in data["algorithms"]:
        assert a["complexity"] == {"time": "O(V + E)", "auxiliary_space": "O(V)"}
        assert a["description"] and a["data_structure"]


def test_frontend_is_served(client):
    r = client.get("/")
    assert r.status_code == 200 and b"Graph Traversal Visualizer" in r.data
    assert client.get("/static/js/app.js").status_code == 200
    assert client.get("/static/css/style.css").status_code == 200


# ---------- traverse: response format ----------
def test_traverse_bfs_response_format(client):
    r = post(client, "/api/graph/traverse", payload())
    assert r.status_code == 200
    d = r.get_json()
    assert d["algorithm"] == "bfs"
    assert d["start_node"] == "A"
    assert d["traversal_order"] == ["A", "B", "C", "D"]
    assert d["visited_nodes"] == ["A", "B", "C", "D"]
    assert d["unreachable_nodes"] == []
    assert d["total_nodes_visited"] == 4
    assert d["edges_examined"] == 6
    assert d["complexity"]["time"] == "O(V + E)" and d["complexity"]["auxiliary_space"] == "O(V)"
    assert len(d["steps"]) > 0                                     # never an empty list
    assert d["steps"][0]["queue"] == ["A"]
    assert d["adjacency_list"]["A"] == ["B", "C"]


def test_traverse_dfs_response_format(client):
    d = post(client, "/api/graph/traverse", payload(algorithm="dfs")).get_json()
    assert d["traversal_order"] == ["A", "B", "D", "C"]
    assert d["steps"][0]["stack"] == ["A"]
    assert d["steps"][-1]["type"] == "done"


def test_traverse_algorithm_name_is_case_insensitive(client):
    assert post(client, "/api/graph/traverse", payload(algorithm="BFS")).status_code == 200


def test_traverse_disconnected_modes(client):
    g = {"directed": False, "nodes": ["A", "B", "C"], "edges": [["A", "B"]]}
    part = post(client, "/api/graph/traverse", payload(graph=g)).get_json()
    assert part["traversal_order"] == ["A", "B"] and part["unreachable_nodes"] == ["C"]
    full = post(client, "/api/graph/traverse", payload(graph=g, traverse_all=True)).get_json()
    assert full["traversal_order"] == ["A", "B", "C"] and full["unreachable_nodes"] == []


def test_traverse_cyclic_graph_does_not_loop(client):
    g = {"directed": False, "nodes": list("ABC"), "edges": [["A", "B"], ["B", "C"], ["C", "A"]]}
    for algo in ("bfs", "dfs"):
        d = post(client, "/api/graph/traverse", payload(algorithm=algo, graph=g)).get_json()
        assert sorted(d["traversal_order"]) == list("ABC")


# ---------- validate ----------
def test_validate_ok(client):
    r = post(client, "/api/graph/validate", {"graph": GRAPH, "start_node": "A"})
    assert r.status_code == 200
    d = r.get_json()
    assert d["valid"] is True and d["node_count"] == 4 and d["edge_count"] == 3


def test_validate_bad_start(client):
    r = post(client, "/api/graph/validate", {"graph": GRAPH, "start_node": "Q"})
    assert r.status_code == 400 and r.get_json()["error"] == "invalid_start_node"


# ---------- errors ----------
@pytest.mark.parametrize("over,code", [
    ({"algorithm": "dijkstra"}, "invalid_algorithm"),
    ({"algorithm": None}, "invalid_algorithm"),
    ({"start_node": "Z"}, "invalid_start_node"),
    ({"start_node": None}, "invalid_start_node"),
    ({"traverse_all": "yes"}, "invalid_request"),
    ({"graph": {"directed": False, "nodes": [], "edges": []}}, "empty_graph"),
    ({"graph": {"directed": False, "nodes": ["A", "A"], "edges": []}}, "duplicate_node"),
    ({"graph": {"directed": False, "nodes": ["A", "B"], "edges": [["A", "Z"]]}}, "unknown_node_in_edge"),
    ({"graph": {"directed": False, "nodes": ["A", "B"], "edges": [["A"]]}}, "invalid_edge"),
    ({"graph": {"directed": False, "nodes": ["A", "B"], "edges": [["A", "A"]]}}, "self_loop"),
    ({"graph": {"directed": False, "nodes": ["A", "B"], "edges": [["A", "B"], ["B", "A"]]}}, "duplicate_edge"),
    ({"graph": {"directed": "no", "nodes": ["A"], "edges": []}}, "invalid_graph"),
    ({"graph": {"nodes": "ABC"}}, "invalid_graph"),
    ({"graph": [1, 2]}, "invalid_graph"),
    ({"graph": None}, "invalid_graph"),
])
def test_traverse_validation_errors(client, over, code):
    r = post(client, "/api/graph/traverse", payload(**over))
    assert r.status_code == 400
    body = r.get_json()
    assert body["error"] == code and body["message"]


def test_directed_graph_allows_both_directions(client):
    g = {"directed": True, "nodes": ["A", "B"], "edges": [["A", "B"], ["B", "A"]]}
    assert post(client, "/api/graph/traverse", payload(graph=g)).status_code == 200


def test_malformed_json(client):
    r = client.post("/api/graph/traverse", data="{not json", content_type="application/json")
    assert r.status_code == 400 and r.get_json()["error"] == "malformed_json"


def test_empty_body(client):
    r = client.post("/api/graph/traverse", data="", content_type="application/json")
    assert r.status_code == 400 and r.get_json()["error"] == "malformed_json"


def test_body_must_be_object(client):
    r = post(client, "/api/graph/traverse", [1, 2, 3])
    assert r.status_code == 400 and r.get_json()["error"] == "invalid_request"


def test_unsupported_methods(client):
    r = client.get("/api/graph/traverse")
    assert r.status_code == 405 and r.get_json()["error"] == "method_not_allowed"
    r = client.post("/api/health", data="{}", content_type="application/json")
    assert r.status_code == 405
    r = client.delete("/api/algorithms")
    assert r.status_code == 405


def test_unknown_api_route_is_json_404(client):
    r = client.get("/api/nothing-here")
    assert r.status_code == 404 and r.get_json()["error"] == "not_found"
