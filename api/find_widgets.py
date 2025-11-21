# backend/api/find_widgets.py
import os

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
            print(f"[WidgetsAPI] No manifest found in: {folder}")
            continue

        manifest = load_manifest(manifest_path)
        if not manifest:
            continue

        manifest["name"] = folder  # ensure folder name is the internal ID
        widgets.append(manifest)
        print(f"[WidgetsAPI] Registered widget: {folder}")
    return widgets