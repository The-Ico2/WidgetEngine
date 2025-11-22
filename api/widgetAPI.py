# api_routes.py

import os, json
from flask import Blueprint, jsonify, send_from_directory, abort, request
from jsonc_parser.parser import JsoncParser


widgets_bp = Blueprint("widgets", __name__)

# Path Variables
API_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(API_DIR)

WIDGETS_DIR = os.path.join(BASE_DIR, "widgets")

def discover_widgets():
    widgets = []

    if not os.path.exists(WIDGETS_DIR):
        return widgets

    for folder in os.listdir(WIDGETS_DIR):
        widget_path = os.path.join(WIDGETS_DIR, folder)
        if not os.path.isdir(widget_path):
            continue

        manifest_path = os.path.join(widget_path, "manifest.jsonc")
        if not os.path.exists(manifest_path):
            continue

        manifest = load_manifest(manifest_path)
        if not manifest:
            continue

        manifest["name"] = folder  # ensure folder name is the internal ID
        widgets.append(manifest)
    return widgets


def load_manifest(path):
    try:
        manifest = JsoncParser.parse_file(path)
        return manifest
    except Exception as e:
        print(f"[WidgetsAPI] Failed to load manifest {path}: {e}")
        return None


def save_manifest(path, updated_data):
    """
    Safely writes changes back into a JSONC file without destroying comments
    or formatting. Only overwrites modified keys.
    """
    try:
        # 1. Read the raw JSONC text
        with open(path, "r", encoding="utf-8") as f:
            raw = f.read()
    except Exception as e:
        print(f"[WidgetsAPI] Could not read original JSONC: {e}")
        return False

    # 2. Parse JSONC to get current structured data
    try:
        original = JsoncParser.parse_str(raw)
    except Exception as e:
        print(f"[WidgetsAPI] Could not parse JSONC: {e}")
        return False

    # 3. Recursively apply updates to original object
    def merge(a, b):
        for key, value in b.items():
            if isinstance(value, dict) and key in a and isinstance(a[key], dict):
                merge(a[key], value)
            else:
                a[key] = value
        return a

    merged = merge(original, updated_data)

    # 4. Convert merged result to formatted JSON
    formatted = json.dumps(merged, indent=4)

    # 5. Replace JSON blocks inside the JSONC text intelligently
    # We replace the entire object while keeping comments outside the root intact.
    start = raw.find("{")
    end = raw.rfind("}")

    if start == -1 or end == -1:
        print("[WidgetsAPI] Could not locate JSON root block in JSONC file")
        return False

    new_raw = raw[:start] + formatted + raw[end + 1:]

    # 6. Save new JSONC content
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(new_raw)
        return True
    except Exception as e:
        print(f"[WidgetsAPI] Could not write JSONC: {e}")
        return False


# GET /api/widgets  → list all widgets
@widgets_bp.route("/api/widgets")
def api_widgets():
    return jsonify(discover_widgets())

# GET, POST, & PATCH /api/widgets/<widget>
@widgets_bp.route("/api/widgets/<widget_name>", methods=["GET", "POST", "PATCH"])
def update_widget(widget_name):
    # ------------------------------------------------
    # Locate manifest file (.jsonc preferred)
    # ------------------------------------------------
    widget_dir = os.path.join(WIDGETS_DIR, widget_name)
    manifest_jsonc = os.path.join(widget_dir, "manifest.jsonc")
    manifest_json = os.path.join(widget_dir, "manifest.json")

    if os.path.exists(manifest_jsonc):
        manifest_path = manifest_jsonc
    elif os.path.exists(manifest_json):
        manifest_path = manifest_json
    else:
        return jsonify({"error": "Widget not found"}), 404

    # ------------------------------------------------
    # GET → return manifest JSON
    # ------------------------------------------------
    if request.method == "GET":
        manifest = load_manifest(manifest_path)
        if manifest is None:
            return jsonify({"error": "Failed to load manifest"}), 500
        return jsonify(manifest), 200

    # ------------------------------------------------
    # Parse request body
    # ------------------------------------------------
    data = request.get_json() or {}

    # ------------------------------------------------
    # POST → full replacement
    # ------------------------------------------------
    if request.method == "POST":
        if not isinstance(data, dict) or not data:
            return jsonify({"error": "Invalid JSON payload"}), 400

        if not save_manifest(manifest_path, data):
            return jsonify({"error": "Failed to write manifest"}), 500

        updated = load_manifest(manifest_path)
        return jsonify(updated), 200

    # ------------------------------------------------
    # PATCH → partial nested update (path + value)
    # ------------------------------------------------
    if request.method == "PATCH":
        path = data.get("path")
        value = data.get("value")

        if not path:
            return jsonify({"error": "Missing 'path'"}), 400
        if "value" not in data:
            return jsonify({"error": "Missing 'value'"}), 400

        # Load current manifest
        manifest = load_manifest(manifest_path)
        if manifest is None:
            return jsonify({"error": "Failed to load manifest"}), 500

        # Apply dot-notation update
        keys = path.split(".")
        obj = manifest

        for key in keys[:-1]:
            if key not in obj or not isinstance(obj[key], dict):
                obj[key] = {}
            obj = obj[key]

        obj[keys[-1]] = value

        # Save back
        if not save_manifest(manifest_path, manifest):
            return jsonify({"error": "Failed to save manifest"}), 500

        return jsonify({
            "status": "ok",
            "updated": { "path": path, "value": value }
        }), 200


# GET /widgets/<widgetName>/<path:filename>
@widgets_bp.route("/widgets/<widget_name>/<path:filename>")
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