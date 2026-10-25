import pytest

from backend.algorithms import bfs
from backend.graph_utils import ApiError, parse_graph


def make(nodes, edges, directed=False):
    return parse_graph({"directed": directed, "nodes": nodes, "edges": edges})


TREE = make(list("ABCDEFG"), [["A", "B"], ["A", "C"], ["B", "D"], ["B", "E"], ["C", "F"], ["C", "G"]])


def test_bfs_order_on_known_graph():
    assert bfs(TREE, "A")["traversal_order"] == list("ABCDEFG")


def test_bfs_starting_from_another_node():
    assert bfs(TREE, "B")["traversal_order"] == ["B", "A", "D", "E", "C", "F", "G"]


def test_bfs_queue_is_fifo():
    steps = bfs(TREE, "A")["steps"]
    queues = [s["queue"] for s in steps]
    assert queues[0] == ["A"]                         # start enqueued
    assert ["B"] in queues and ["B", "C"] in queues   # B enqueued before C
    # the front of the queue is always the next node to be visited
    visits = [s["current"] for s in steps if s["type"] == "visit"]
    assert visits == list("ABCDEFG")
    after_b_visit = next(s for s in steps if s["type"] == "visit" and s["current"] == "B")
    assert after_b_visit["queue"] == ["C"]            # B removed from the FRONT


def test_bfs_discovers_nodes_when_enqueued():
    # In the diamond A-B, A-C, B-D, C-D, node D must be queued only once.
    g = make(list("ABCD"), [["A", "B"], ["A", "C"], ["B", "D"], ["C", "D"]])
    r = bfs(g, "A")
    assert r["traversal_order"] == list("ABCD")
    enqueues_of_d = [s for s in r["steps"] if s["type"] == "enqueue" and s["edge"] and s["edge"][1] == "D"]
    assert len(enqueues_of_d) == 1


def test_bfs_single_node():
    r = bfs(make(["A"], []), "A")
    assert r["traversal_order"] == ["A"]
    assert r["unreachable_nodes"] == []
    assert r["edges_examined"] == 0
    assert r["steps"][-1]["type"] == "done"


def test_bfs_disconnected_component_only():
    g = make(list("ABCD"), [["A", "B"], ["C", "D"]])
    r = bfs(g, "A")
    assert r["traversal_order"] == ["A", "B"]
    assert r["unreachable_nodes"] == ["C", "D"]


def test_bfs_disconnected_entire_graph():
    g = make(list("ABCD"), [["A", "B"], ["C", "D"]])
    r = bfs(g, "A", traverse_all=True)
    assert r["traversal_order"] == list("ABCD")
    assert r["unreachable_nodes"] == []
    assert any(s["type"] == "restart" for s in r["steps"])


def test_bfs_cyclic_graph_terminates_and_visits_each_node_once():
    g = make(list("ABCDE"), [["A", "B"], ["B", "C"], ["C", "A"], ["C", "D"], ["D", "E"], ["E", "C"]])
    r = bfs(g, "A")
    assert sorted(r["traversal_order"]) == list("ABCDE")
    assert len(set(r["traversal_order"])) == len(r["traversal_order"])
    assert any(s["type"] == "skip" for s in r["steps"])      # visited tracking skipped back-edges


def test_bfs_directed_respects_direction():
    g = make(list("ABC"), [["A", "B"], ["C", "A"]], directed=True)
    r = bfs(g, "A")
    assert r["traversal_order"] == ["A", "B"]
    assert r["unreachable_nodes"] == ["C"]


def test_bfs_neighbour_order_follows_node_list_not_edge_list():
    g = make(list("ABC"), [["A", "C"], ["A", "B"]])
    assert bfs(g, "A")["traversal_order"] == ["A", "B", "C"]


def test_bfs_is_deterministic():
    a, b = bfs(TREE, "A"), bfs(TREE, "A")
    assert a["steps"] == b["steps"]


def test_bfs_edges_examined_undirected_is_twice_edge_count():
    r = bfs(TREE, "A")
    assert r["edges_examined"] == 2 * TREE.E


def test_bfs_invalid_start_node():
    with pytest.raises(ApiError) as exc:
        bfs(TREE, "Z")
    assert exc.value.code == "invalid_start_node"


def test_graph_edge_with_unknown_node_rejected():
    with pytest.raises(ApiError) as exc:
        make(["A", "B"], [["A", "Z"]])
    assert exc.value.code == "unknown_node_in_edge"


def test_steps_are_populated_and_indexed():
    r = bfs(TREE, "A")
    assert r["step_count"] == len(r["steps"]) > 0
    assert [s["index"] for s in r["steps"]] == list(range(len(r["steps"])))
    for s in r["steps"]:
        assert {"type", "action", "current", "edge", "queue", "pending", "visited"} <= set(s)
