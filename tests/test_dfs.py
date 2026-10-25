import pytest

from backend.algorithms import bfs, dfs
from backend.graph_utils import ApiError, parse_graph


def make(nodes, edges, directed=False):
    return parse_graph({"directed": directed, "nodes": nodes, "edges": edges})


TREE = make(list("ABCDEFG"), [["A", "B"], ["A", "C"], ["B", "D"], ["B", "E"], ["C", "F"], ["C", "G"]])


def test_dfs_order_on_known_graph():
    assert dfs(TREE, "A")["traversal_order"] == ["A", "B", "D", "E", "C", "F", "G"]


def test_dfs_goes_deep_before_wide():
    # Diamond: BFS gives A B C D, DFS must reach D through B before looking at C.
    g = make(list("ABCD"), [["A", "B"], ["A", "C"], ["B", "D"], ["C", "D"]])
    assert dfs(g, "A")["traversal_order"] == ["A", "B", "D", "C"]
    assert bfs(g, "A")["traversal_order"] == ["A", "B", "C", "D"]


def test_dfs_stack_is_lifo_and_tracks_the_current_path():
    steps = dfs(TREE, "A")["steps"]
    stacks = [s["stack"] for s in steps]
    assert stacks[0] == ["A"]
    assert ["A", "B", "D"] in stacks                       # went deep along A-B-D
    back_d = next(s for s in steps if s["type"] == "backtrack" and s["current"] == "D")
    assert back_d["stack"] == ["A", "B"]                   # D popped from the TOP
    assert steps[-1]["type"] == "done" and steps[-1]["stack"] == []


def test_dfs_backtracks_once_per_visited_node():
    r = dfs(TREE, "A")
    backtracks = [s["current"] for s in r["steps"] if s["type"] == "backtrack"]
    assert sorted(backtracks) == sorted(r["traversal_order"])
    assert backtracks == ["D", "E", "B", "F", "G", "C", "A"]   # post-order


def test_dfs_single_node():
    r = dfs(make(["A"], []), "A")
    assert r["traversal_order"] == ["A"]
    assert [s["type"] for s in r["steps"]] == ["visit", "backtrack", "done"]


def test_dfs_disconnected_component_only():
    g = make(list("ABCD"), [["A", "B"], ["C", "D"]])
    r = dfs(g, "A")
    assert r["traversal_order"] == ["A", "B"]
    assert r["unreachable_nodes"] == ["C", "D"]


def test_dfs_disconnected_entire_graph():
    g = make(list("ABCD"), [["A", "B"], ["C", "D"]])
    r = dfs(g, "A", traverse_all=True)
    assert r["traversal_order"] == list("ABCD")
    assert r["unreachable_nodes"] == []
    assert any(s["type"] == "restart" for s in r["steps"])


def test_dfs_traverse_all_starts_from_chosen_node_first():
    g = make(list("ABCD"), [["A", "B"], ["C", "D"]])
    assert dfs(g, "C", traverse_all=True)["traversal_order"] == ["C", "D", "A", "B"]


def test_dfs_cyclic_graph_terminates():
    g = make(list("ABCD"), [["A", "B"], ["B", "C"], ["C", "D"], ["D", "A"]])
    r = dfs(g, "A")
    assert r["traversal_order"] == list("ABCD")
    assert any(s["type"] == "skip" for s in r["steps"])
    assert len(set(r["traversal_order"])) == 4


def test_dfs_directed():
    g = make(list("ABC"), [["A", "B"], ["B", "C"], ["C", "A"]], directed=True)
    assert dfs(g, "B")["traversal_order"] == ["B", "C", "A"]


def test_dfs_deterministic_neighbour_order():
    g = make(list("ABC"), [["A", "C"], ["A", "B"]])
    assert dfs(g, "A")["traversal_order"] == ["A", "B", "C"]
    assert dfs(g, "A")["steps"] == dfs(g, "A")["steps"]


def test_dfs_matches_recursive_reference():
    # Cross-check the iterative stack version against a plain recursive DFS on a bigger graph.
    nodes = list("ABCDEFGHIJ")
    edges = [["A", "B"], ["A", "C"], ["B", "D"], ["C", "D"], ["D", "E"], ["E", "F"], ["F", "B"],
             ["G", "H"], ["H", "I"], ["I", "G"], ["C", "J"]]
    g = make(nodes, edges)

    seen, out = set(), []

    def rec(u):
        seen.add(u); out.append(u)
        for v in g.adjacency[u]:
            if v not in seen:
                rec(v)

    rec("A")
    assert dfs(g, "A")["traversal_order"] == out


def test_dfs_invalid_start_node():
    with pytest.raises(ApiError) as exc:
        dfs(TREE, "nope")
    assert exc.value.code == "invalid_start_node"
