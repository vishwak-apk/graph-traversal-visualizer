"""REST API routes (all under /api)."""
import json

from flask import Blueprint, jsonify, request

from .algorithms import ALGORITHM_INFO, traverse
from .graph_utils import (ApiError, parse_graph, parse_start_node,
                          parse_traverse_request, require_object)

api = Blueprint("api", __name__, url_prefix="/api")

APP_NAME = "Graph Traversal Visualizer"


def _json_body():
    """Parse the request body; malformed JSON becomes a clean 400 error."""
    raw = request.get_data(as_text=True)
    if not raw.strip():
        raise ApiError("malformed_json", "The request body is empty. Send a JSON object.")
    try:
        return json.loads(raw)
    except ValueError:
        raise ApiError("malformed_json", "The request body is not valid JSON.")


@api.get("/health")
def health():
    return jsonify({"status": "ok", "app": APP_NAME, "version": "1.0.0"})


@api.get("/algorithms")
def algorithms():
    return jsonify({"algorithms": [{"id": key, **info} for key, info in ALGORITHM_INFO.items()]})


@api.post("/graph/validate")
def validate():
    data = require_object(_json_body())
    graph = parse_graph(data.get("graph"))
    start = None
    if data.get("start_node") is not None:
        start = parse_start_node(graph, data.get("start_node"))
    return jsonify({
        "valid": True,
        "directed": graph.directed,
        "node_count": graph.V,
        "edge_count": graph.E,
        "start_node": start,
        "adjacency_list": graph.adjacency,
    })


@api.post("/graph/traverse")
def traverse_graph():
    algorithm, graph, start, traverse_all = parse_traverse_request(_json_body())
    return jsonify(traverse(algorithm, graph, start, traverse_all))


@api.errorhandler(ApiError)
def handle_api_error(err: ApiError):
    return jsonify({"error": err.code, "message": err.message}), err.status
