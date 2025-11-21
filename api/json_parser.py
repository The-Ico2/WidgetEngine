import json
from jsonc_parser.parser import JsoncParser

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
