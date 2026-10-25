"""Flask application factory: serves the REST API and the frontend."""
import os

from flask import Flask, jsonify, request, send_from_directory

from .graph_utils import ApiError
from .routes import api

FRONTEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))


def create_app() -> Flask:
    app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="/static")
    app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0      # always serve fresh files while developing
    app.config["JSON_SORT_KEYS"] = False
    app.json.sort_keys = False

    try:                                              # CORS is only needed if the frontend is hosted elsewhere
        from flask_cors import CORS
        CORS(app, resources={r"/api/*": {"origins": "*"}})
    except ImportError:                               # pragma: no cover
        pass

    app.register_blueprint(api)

    @app.get("/")
    def index():
        return send_from_directory(FRONTEND_DIR, "index.html")

    def _wants_json():
        return request.path.startswith("/api")

    @app.errorhandler(ApiError)
    def api_error(err):
        return jsonify({"error": err.code, "message": err.message}), err.status

    @app.errorhandler(404)
    def not_found(err):
        if _wants_json():
            return jsonify({"error": "not_found", "message": f"No API endpoint at {request.path}."}), 404
        return err

    @app.errorhandler(405)
    def method_not_allowed(err):
        if _wants_json():
            allowed = ", ".join(sorted(err.valid_methods or []))
            return jsonify({"error": "method_not_allowed",
                            "message": f"{request.method} is not allowed here. Allowed: {allowed}."}), 405
        return err

    @app.errorhandler(500)
    def server_error(err):
        if _wants_json():
            return jsonify({"error": "server_error", "message": "Unexpected server error."}), 500
        return err

    return app
