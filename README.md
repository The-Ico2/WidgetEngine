# 📦 WidgetEngine

A modular, extensible widget framework for building dynamic, interactive desktop overlays and UI systems.

WidgetEngine is designed to make it easy to build **widgets, modules, and settings pages** that automatically load, render, and communicate with a backend service. Its architecture is intentionally simple, flexible, and scalable—allowing developers to drop in new widgets or modules without modifying core code.

---

# 🚀 Features

### 🧩 Modular Widget System

* Widgets live in `/widgets/<widgetName>/`
* Each widget may contain:

  * `manifest.jsonc` – widget metadata
  * `widget.html` – front-end UI
  * `settings.html` – settings UI (optional)
  * `widget.js` – widget script
  * Any additional asset files

Widgets are automatically discovered and rendered at runtime.

---

### ⚙️ Dynamic Settings System

WidgetEngine includes a built-in Settings widget capable of loading:

* Regular widget settings pages
* Special **modules** inside `widget/settings/module/*`, such as:

  * Keybind settings
  * Styling settings
  * Future extension modules

Modules behave exactly like widgets from the user's perspective—they appear as pages inside the Settings UI.

---

### ⌨️ Global Keybind Engine

* Keybinds use a combination system (up to 3 keys)
* Supports modifiers: `CTRL`, `SHIFT`, `ALT`
* Fully configurable from the Settings widget
* Automatically saves to backend via `Update.keybind(action, keys)`

---

### 🖥️ Clean Frontend Renderer

* A unified widget grid (`#widget-grid`)
* Loads widgets based on manifest definitions
* Supports dynamic injection of HTML, CSS, JS
* Includes widget-level lifecycle hooks (optional)

---

### 🔌 Lightweight Backend Integration

The backend supplies:

* Widget manifests
* Settings JSON
* Asset endpoints
* Keybind persistence
* Event emitters / internal messaging

The frontend communicates with `BACKEND_URL` to dynamically request widget data.

---

# 📁 Folder Structure

```
WidgetEngine/
│
├── widgets/
│   ├── settings/
│   │   ├── widget.html
│   │   ├── settings.html
│   │   ├── manifest.jsonc
│   │   └── module/
│   │       ├── keybinds/
│   │       │   └── settings.html
│   │       ├── styling/
│   │       │   └── settings.html
│   │       └── … (future modules)
│   │
│   ├── clock/
│   │   ├── widget.html
│   │   ├── widget.js
│   │   └── manifest.jsonc
│   │
│   └── … (more widgets)
│
├── static/
│   ├── scripts/
│   │   ├── index.js
│   │   ├── widgetLoader.js
│   │   ├── widgetUtils.js
│   │   ├── settingsRenderer.js
│   │   └── keybindEngine.js
│   └── styles/
│       └── index.css
│
├── api/
│   ├── api_routes.py
│   ├── find_widgets.py
│   └── json_parser.py
│
├── templates/
│   └── index.html
│
├── requirements.txt
└── start.py
```

---

# 📜 Widget Format

Each widget has a `manifest.jsonc`:

```jsonc
{
    // ───────────────────────────────────────────────────────────────
    // Basic Widget Metadata
    // ───────────────────────────────────────────────────────────────
    "name": "Clock",                          
    "id": "clock-widget",                               // unique, lowercase identifier (recommended)
    "description": "Clock Display",
    "author": "Ico2",
    "version": "1.0.0",
    "enabled": true,


    // ───────────────────────────────────────────────────────────────
    // Backend Behavior & Permissions
    // ───────────────────────────────────────────────────────────────
    "permissions": {
        "keyboard": false,                       // needs global key events?
        "filesystem": false,                     // needs file I/O?
        "network": false,                        // needs HTTP requests?
        "overlay": true,                         // appears above applications
        "exclusiveHotkeys": false                // can override global hotkeys?
    },


    // ───────────────────────────────────────────────────────────────
    // Files + Asset Bundles
    // ───────────────────────────────────────────────────────────────
    "files": {
        "html": "widget.html",
        "css": "widget.css",
        "js": "widget.js",
        "settings": "settings.html",

        // Optional additional assets (images, sounds, JSON, etc.)
        "assets": [
            "assets/clock-background.png",
            "assets/tick.wav"
        ]
    },


    // ───────────────────────────────────────────────────────────────
    // Widget Behavior & Interaction
    // ───────────────────────────────────────────────────────────────
    "behavior": {
        "draggable": true,
        "resizable": false,
        "clickThrough": false,
        "focusable": false,

        // Whether WidgetEngine should reload the widget when settings change
        "hotReload": true,

        // Lifecycle hooks WidgetEngine will call on widget.js
        "lifecycle": {
            "onInit": true,                     // widget.js exports: init(config)
            "onDestroy": true,                  // widget.js exports: destroy()
            "onSettingsUpdate": true,           // widget.js exports: update(config)
            "onFocus": false,                   // widget.js exports: focus()
            "onBlur": false,                    // widget.js exports: blur()
            "onResize": false                   // widget.js exports: resize(w,h)
        }
    },


    // ───────────────────────────────────────────────────────────────
    // Layout + Display Rules
    // ───────────────────────────────────────────────────────────────
    "display": {
        "position": {
            "x": 35,
            "y": 431
        },
        "size": {
            "width": 200,
            "height": 100,
            "scale": 1.0,
            "adjustable": false
        },

        "monitor": "primary",            // "primary", index number, or "all"
        "zIndex": 10,                    // layering inside WidgetEngine

        // Layout mode for floating/mobile widgets
        "anchor": "top-left"             // center, bottom-right, custom, etc.
    },


    // ───────────────────────────────────────────────────────────────
    // Root-Level Styling / Theming
    // ───────────────────────────────────────────────────────────────
    "general_style": {
        "useRootVariables": true,

        "font": {
            "family": "Arial",
            "size": "24px",
            "color": "#FFFFFF"
        },
        "border": {
            "style": "solid",
            "width": "2px",
            "color": "#FFFFFF"
        },
        "background": {
            "color": "#000000",
            "alpha": 0.20
        },

        "animation": {
            "enabled": false,
            "type": "fade-in",           // expand, drop, zoom, etc.
            "duration": 200              // ms
        }
    },


    // ───────────────────────────────────────────────────────────────
    // Widget-Specific Config (User editable)
    // ───────────────────────────────────────────────────────────────
    "unique_config": {
        "style": {
            "type": "digital",            // "digital" | "analog"
            "frameStyle": "window",       // "window" | "floating"
            "use24HourFormat": false,
            "showSeconds": true,
            "showDate": true,
            "dateFormat": "MM/DD/YYYY"
        }
    },


    // ───────────────────────────────────────────────────────────────
    // Settings Schema (auto-build UI)
    // ───────────────────────────────────────────────────────────────
    // This allows WidgetEngine to generate settings UI dynamically
    "settings_schema": {
        "style.type": {
            "label": "Clock Type",
            "type": "select",
            "options": ["digital", "analog"]
        },
        "style.use24HourFormat": {
            "label": "Use 24h Format",
            "type": "toggle"
        },
        "style.showSeconds": {
            "label": "Show Seconds",
            "type": "toggle"
        },
        "style.showDate": {
            "label": "Show Date",
            "type": "toggle"
        },
        "style.dateFormat": {
            "label": "Date Format",
            "type": "text",
            "placeholder": "MM/DD/YYYY"
        }
    },


    // ───────────────────────────────────────────────────────────────
    // Internal Widget State (saved/restored automatically)
    // ───────────────────────────────────────────────────────────────
    "state": {
        "lastPosition": { "x": 35, "y": 431 },
        "lastScale": 1.0,
        "internalClockOffset": 0
    },


    // Default state if no saved data exists
    "default_state": {
        "internalClockOffset": 0
    },


    // ───────────────────────────────────────────────────────────────
    // Event Subscriptions (WidgetEngine emits)
    // ───────────────────────────────────────────────────────────────
    "subscriptions": {
        "onTimeTick": true,               // fires every second
        "onAppChange": false,             // active window changed
        "onAudioUpdate": false,           // audio volume/input change
        "onKeybind": false                // special keybind events
    }
}
```

Widgets can optionally include settings pages—if present, they appear automatically inside the Settings widget.

---

# ⚙️ Settings Modules

Modules that are **part of the Settings widget itself** live here:

```
/widgets/settings/module/<moduleName>/settings.html
```

They are registered inside the Settings widget manifest as:

```jsonc
{
  "modules": [
    { "name": "Keybinds", "modulePath": "keybinds", "special": true },
    { "name": "Styling",  "modulePath": "styling",  "special": true }
  ]
}
```

WidgetEngine treats them like independent settings pages, but they are managed by the Settings widget, not the global widget registry.

---

# 🔧 Frontend Rendering Flow

1. `widgetLoader.js` fetches all manifests
2. A widget entry is created in the grid
3. Clicking a widget panel loads its settings page
4. Settings pages fetch HTML and inject into the content panel
5. Keybinds and other modules update backend configuration via a unified API

---

# ⌨️ Keybind Input System

WidgetEngine includes a custom combo listener capable of detecting:

* Up to **three keys simultaneously**
* Multiple modifiers + one primary key
* Automatically formatted output:
  `CTRL + SHIFT + W`

It normalizes `Control`, `Shift`, and `Alt` into uppercase labels for UI consistency.

---

# 🔄 Update API (Frontend → Backend)

Example usage:

```js
Update.keybind("settings.open", "CTRL + SHIFT + W");
Update.setting("clock.format", "24h");
Update.widgetPosition("clock", { x: 200, y: 40 });
```

The backend is responsible for persistence and validation.

---

# 📦 Installation

> ⚠️ This section is generic until we finalize your packaging method
> (Currently assumes: Node backend + static frontend)

```
git clone https://github.com/yourname/WidgetEngine
cd WidgetEngine
npm install
npm start
```

Frontend will be available at:

```
http://127.0.0.1:7000/
```

---

# 🧱 Building Widgets

To create a new widget:

1. Add folder inside `/widgets/yourWidget/`
2. Create:

   * `manifest.jsonc`
   * `widget.html`
   * `widget.js`
   * `settings.html` (optional, but recommended)
3. Reload WidgetEngine — it auto-discovers everything.

WidgetEngine requires **ZERO code changes** for new widgets.

---

# 💬 Contributing

We welcome contributions! You can:

* Add new widgets
* Improve settings modules
* Enhance core loading utilities
* Extend keybind recognition
* Fix bugs or submit issues
