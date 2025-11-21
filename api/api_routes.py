import os

from flask import Blueprint, jsonify, send_from_directory, abort, request
from json_parser import save_manifest, load_manifest
from find_widgets import discover_widgets

api = Blueprint("api", __name__)

# Path Variables
API_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(API_DIR)

WIDGETS_DIR = os.path.join(BASE_DIR, "widgets")


# GET /api/widgets  → list all widgets
@api.route("/api/widgets")
def api_widgets():
    return jsonify(discover_widgets())

# POST /api/widgets/<widget_name> → update manifest
@api.route("/api/widgets/<widget_name>", methods=["POST"])
def update_widget_manifest(widget_name):
    folder = os.path.join(WIDGETS_DIR, widget_name)
    manifest_path_json = os.path.join(folder, "manifest.json")
    manifest_path_jsonc = os.path.join(folder, "manifest.jsonc")

    if os.path.exists(manifest_path_json):
        manifest_path = manifest_path_json
    elif os.path.exists(manifest_path_jsonc):
        manifest_path = manifest_path_jsonc
    else:
        abort(404, "Widget not found")

    data = request.get_json()
    if not data:
        abort(400, "Invalid JSON payload")

    # Use your JSONC-safe writer
    if not save_manifest(manifest_path, data):
        abort(500, "Failed to write manifest")

    updated = load_manifest(manifest_path)
    return jsonify(updated), 200

# PATCH /api/widgets/<widget>/<setting> → update single setting
@api.route("/api/widgets/<widget>/<setting>", methods=["PATCH", "OPTIONS"])
def update_widget_setting(widget, setting):
    if request.method == "OPTIONS":
        return ("", 204)

    widget_dir = os.path.join(WIDGETS_DIR, widget)
    manifest_jsonc = os.path.join(widget_dir, "manifest.jsonc")
    manifest_json = os.path.join(widget_dir, "manifest.json")

    if os.path.exists(manifest_jsonc):
        manifest_path = manifest_jsonc
    elif os.path.exists(manifest_json):
        manifest_path = manifest_json
    else:
        return jsonify({"error": "Widget not found"}), 404

    manifest = load_manifest(manifest_path)
    if manifest is None:
        return jsonify({"error": "Failed to load manifest"}), 500

    data = request.json or {}

    # ----------------------------------------------------
    # SPECIAL CASE: POSITION USES {x,y} NOT {value}
    # ----------------------------------------------------
    if setting == "position":
        if "x" not in data or "y" not in data:
            return jsonify({"error": "Missing x/y"}), 400

        manifest["position"] = {
            "x": int(data["x"]),
            "y": int(data["y"])
        }

        if not save_manifest(manifest_path, manifest):
            return jsonify({"error": "Failed to save JSONC"}), 500

        return jsonify({
            "status": "ok",
            "updated": manifest["position"]
        }), 200

    # ----------------------------------------------------
    # GENERAL SETTING: requires {value: ...}
    # ----------------------------------------------------
    if "value" not in data:
        return jsonify({"error": "Missing 'value' field"}), 400

    # Setting must exist in manifest
    if setting not in manifest:
        return jsonify({
            "error": f"Setting '{setting}' not found",
            "alert": True
        }), 400

    manifest[setting] = data["value"]

    if not save_manifest(manifest_path, manifest):
        return jsonify({"error": "Failed to save JSONC"}), 500

    return jsonify({
        "status": "ok",
        "updated": manifest[setting]
    }), 200

# GET /widgets/<widgetName>/<path:filename>
@api.route("/widgets/<widget_name>/<path:filename>")
def serve_widget_assets(widget_name, filename):
    folder = os.path.join(WIDGETS_DIR, widget_name)

    if not os.path.isdir(folder):
        abort(404, "Widget not found")

    file_path = os.path.join(folder, filename)

    # Security: prevent escaping folder
    if not os.path.realpath(file_path).startswith(os.path.realpath(folder)):
        abort(403, "Forbidden")

    if not os.path.exists(file_path):
        abort(404, "File not found")

    return send_from_directory(folder, filename)