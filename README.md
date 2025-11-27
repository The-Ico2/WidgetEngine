# WidgetEngine - C# Edition

A powerful, modular widget framework for Windows with Wallpaper Engine compatibility and overlay support. Converted from Python/Flask to C# ASP.NET Core.

## ⚠️ Development status / Disclaimer

- This project is actively under development.
- The native Windows integration (setting widgets into the desktop background) is not implemented yet.
- The Overlay engine is present in code but is not fully wired into an OS-level overlay — it is not ready for production use.
- Only the web-based preview pages (`http://localhost:7000` and `http://localhost:7001`) reliably work at the moment.

Please treat this repository as a work-in-progress; features, APIs, and on-disk formats may change.

## 🚀 Features

### ✨ Modular Widget System

- Widgets automatically discovered from `Widgets/` folder
- Hot-reload support for widget changes
- JSON/JSONC manifest support with comments
- Widget lifecycle management (onInit, onDestroy, onUpdate)

### 🎮 Dual Rendering Modes

- **Background Mode**: Wallpaper Engine compatible background rendering (native integration incomplete — see Development status above)
- **Overlay Mode**: Transparent, always-on-top widget overlay (native overlay not fully wired; web preview is available)

Note: at present the native Background/Overlay engines exist in code but the supported preview experience is the web preview pages only (ports 7000/7001).

### ⚡ Core APIs

- **WidgetManager**: Widget discovery, loading, and manifest management
- **InputAPI**: Global keyboard shortcuts and keybinding system
- **TimeAPI**: Time-based events (tick, second, minute)
- **AudioAPI**: System audio monitoring and events
- **WatcherAPI**: Real-time widget change detection

### 🎯 Widget Features

- Draggable and resizable widgets
- Per-widget styling and theming
- State persistence
- Settings UI generation from schema
- Event subscriptions (time, audio, keyboard)

## 📁 Project Structure

```bash
WidgetEngine/
├── API/
│   ├── WidgetManager.cs      # Widget discovery and management
│   ├── InputAPI.cs            # Global hotkey system
│   ├── TimeAPI.cs             # Time event system
│   ├── AudioAPI.cs            # Audio monitoring
│   ├── WatcherAPI.cs          # Widget change detection
│   └── universal/             # JavaScript utilities
│       ├── Script.js
│       ├── WidgetUtils.js
│       ├── WidgetWatcher.js
│       └── KeybindManager.js
├── Background/
│   └── Engine.cs              # Wallpaper Engine mode
├── Overlay/
│   └── Engine.cs              # Transparent overlay mode
├── Controllers/
│   └── WidgetController.cs    # REST API endpoints
├── Models/
│   └── WidgetManifest.cs      # Data models
├── Widgets/
│   ├── Clock/                 # Example widgets
│   └── Timer/
├── Program.cs                 # Application entry point
├── appsettings.json          # Configuration
└── WidgetEngine.csproj       # Project file
```

## 🛠️ Installation

### Prerequisites

- .NET 8.0 SDK or later
- Windows OS (for overlay/background features)
- Visual Studio 2022 or VS Code (recommended)

### Setup

1. **Clone or navigate to the project**

  If you don't have the repo locally, clone it:

  ```bash
  git clone https://github.com/The-Ico2/WidgetEngine.git
  cd WidgetEngine
  ```

1. **Restore NuGet packages**

   ```powershell
   dotnet restore
   ```

1. **Build the project**

   ```powershell
   dotnet build
   ```

1. **Run the API server**

   ```powershell
   dotnet run
   ```

The API will be available at `http://localhost:7070`. Background and Overlay engines connect to the API on this port.

## ✅ Quick verification and sample API calls

Follow these steps to verify web previews and to exercise the per-layer enable workflow.

1. Start the app (from repo root):

```powershell
dotnet run --project .\WidgetEngine.csproj
```

1. Open the web previews in a browser:

- Background preview: `http://localhost:7000`
- Overlay preview: `http://localhost:7001`

1. Verify the preview knows its layer (open browser DevTools Console):

```javascript
window.WIDGET_LAYER // should be "Background" or "Overlay"
window.BACKEND_URL  // should be "http://localhost:7070"
```

1. List discovered canonical widgets (from the backend):

PowerShell:

```powershell
Invoke-RestMethod http://localhost:7070/api/widgets | ConvertTo-Json -Depth 4
```

curl:

```bash
curl http://localhost:7070/api/widgets
```

1. Check whether a layer-local manifest exists for a widget (example: `Clock` on Overlay):

PowerShell:

```powershell
Invoke-RestMethod http://localhost:7070/overlay/Clock/manifest.json
# If 404 returned the manifest does not exist in the Overlay layer yet
```

1. Enable a widget for the active layer (the preview will copy the canonical `Manifest.json` into the layer and return the resulting manifest):

PowerShell (enable):

```powershell
Invoke-RestMethod -Method Post -ContentType 'application/json' -Body '{"enabled":true}' http://localhost:7070/api/layer/overlay/widgets/Clock/enable
```

curl (enable):

```bash
curl -X POST -H "Content-Type: application/json" -d '{"enabled":true}' http://localhost:7070/api/layer/overlay/widgets/Clock/enable
```

1. Confirm the manifest was copied into the layer on disk (example for Overlay):

PowerShell:

```powershell
Test-Path .\Overlay\widgets\Clock\Manifest.json
Get-Content .\Overlay\widgets\Clock\Manifest.json -Raw | ConvertFrom-Json | Select-Object -Property widget_features
```

1. Disable the widget (this updates the layer manifest to set `widget_features.behavior.enabled=false` and the frontend will remove the DOM assets):

PowerShell:

```powershell
Invoke-RestMethod -Method Post -ContentType 'application/json' -Body '{"enabled":false}' http://localhost:7070/api/layer/overlay/widgets/Clock/enable
```

1. Notes:

- The Settings hub in the preview will show a widget as enabled only when the layer-local manifest exists and has `widget_features.behavior.enabled = true`.
- The canonical `Widgets/` folder remains the source of truth for widget assets. Layer folders typically contain only `Manifest.json` copies and `widget.json` now only contains `rootVariables`.

## 📦 Widget Development

### Creating a New Widget

1. Create a folder in `Widgets/YourWidget/`
2. Add required files:
   - `Manifest.json` - Widget configuration
   - `widget.html` - Widget HTML structure
   - `widget.css` - Widget styling
   - `widget.js` - Widget logic
   - `Settings.json` - Widget settings (optional)

### Manifest.json Structure

```json
{
  "name": "Clock",
  "id": "clock-widget",
  "description": "Clock Display",
  "original_author": "Ico2",
  "contributor": "",
  "source": "",
  "version": "1.0.0",
  "required_settings": {
    "permissions": {
      "keyboard": false,
      "filesystem": false,
      "network": false,
      "overlay": true,
      "exclusiveHotkeys": false
    },
    "files": {
      "html": "widget.html",
      "css": "widget.css",
      "js": "widget.js",
      "settings": "settings.json"
    }
  },
  "widget_features": {
    "behavior": {
      "enabled": true,
      "draggable": true,
      "clickThrough": false,
      "lifecycle": {
        "onInit": true,
        "onDestroy": true,
        "onSettingsUpdate": true,
        "onFocus": false,
        "onBlur": false,
        "onResize": false
      }
    },
    "display": {
      "position": {
        "x": 405,
        "y": 409,
        "zIndex": 100
      },
      "size": {
        "width": 200,
        "height": 100,
        "scale": 1,
        "resizable": true
      }
    },
    "styling": {
      "useRootVariables": false,
      "font": {
        "family": "Arial",
        "size": "24px",
        "color": "#FFFFFF",
        "widgetScaling": false
      },
      "border": {
        "style": "solid",
        "width": "2px",
        "color": "#FFFFFF"
      },
      "background": {
        "color": "#000000",
        "alpha": 0.2
      },
      "animation": {
        "enabled": false,
        "type": "fade-in",
        "duration": 200
      }
    }
  },
  "unique_config": {
    "clock": {
      "type": "digital",
      "frame_style": "window",
      "use_24_hour_format": true,
      "show_seconds": true,
      "show_date": true,
      "date_format": "MM/DD/YYYY"
    }
  },
  "states": {
    "default": {
      "internal_clock_offset": 0
    },
    "recent": {
      "last_position": {
        "x": 35,
        "y": 431
      },
      "last_scale": 1.0,
      "internal_clock_offset": 0
    },
    "saved": {}
  },
  "extra": {
    "debug": {
      "enabled": false,
      "log_level": 1
    },
    "subscriptions": {
      "on_time_tick": true,
      "on_app_change": false,
      "on_audio_update": false,
      "on_keybind": false
    }
  },
  "settings_schema": {
    "style.type": {
      "label": "Clock Type",
      "type": "select",
      "options": [
        "digital",
        "analog"
      ],
      "placeholder": null,
      "step": null
    },
    "style.frame_style": {
      "label": "Frame Style",
      "type": "select",
      "options": [
        "window",
        "floating"
      ],
      "placeholder": null,
      "step": null
    },
    "style.use_24_hour_format": {
      "label": "Use 24h Format",
      "type": "toggle",
      "options": null,
      "placeholder": null,
      "step": null
    },
    "style.show_seconds": {
      "label": "Show Seconds",
      "type": "toggle",
      "options": null,
      "placeholder": null,
      "step": null
    },
    "style.show_date": {
      "label": "Show Date",
      "type": "toggle",
      "options": null,
      "placeholder": null,
      "step": null
    },
    "style.date_format": {
      "label": "Date Format",
      "type": "text",
      "options": null,
      "placeholder": "MM/DD/YYYY",
      "step": null
    }
  }
}
```

### Widget JavaScript Template

```javascript
(function () {
    let root, manifest, config;

    function initWidget(manifestData, rootEl) {
        manifest = manifestData;
        config = manifest.unique_config;
        root = rootEl;

        // Initialize your widget
        Update.widget(root, manifest);
    }

    // Register the widget
    window.WidgetInitRegistry = window.WidgetInitRegistry || {};
    window.WidgetInitRegistry['MyWidget'] = initWidget;
    window.WidgetInit = initWidget;
})();
```

## 🔌 API Endpoints

### Widget Management

- `GET /api` - API information
- `GET /api/widgets` - List all widgets
- `GET /api/widgets/{name}` - Get widget manifest
- `POST /api/widgets/{name}` - Update entire manifest
- `PATCH /api/widgets/{name}` - Partial manifest update

### Asset Serving

- `GET /api/widgets/{name}/{file}` - Serve widget assets (layer-aware)

## 🎨 Running Different Modes

### API Server Only

```powershell
dotnet run
```

### Background Mode (Wallpaper Engine)

Create a new console app that references WidgetEngine:

```csharp
var engine = new WidgetEngine.Background.Engine("http://localhost:7070");
engine.Start();
```

### Overlay Mode

```csharp
var engine = new WidgetEngine.Overlay.Engine("http://localhost:7070");
engine.Start();
```

## 🔧 Configuration

Edit `appsettings.json`:

```json
{
  "WidgetEngine": {
    "WidgetsPath": "Widgets",
    "Port": 7000,
    "EnableHotReload": true
  }
}
```

## 📋 Widget Lifecycle

1. **Discovery**: WidgetManager scans `Widgets/` folder
2. **Loading**: Manifest parsed and validated
3. **Initialization**: HTML/CSS/JS injected into container
4. **Running**: Widget receives events (time, audio, keyboard)
5. **Updates**: Changes detected by WatcherAPI
6. **Cleanup**: onDestroy called when widget disabled

## 🐛 Debugging

Enable debug mode in widget manifest:

```json
{
  "extra": {
    "debug": {
      "enabled": true,
      "log_level": 1
    }
  }
}
```

Or enable global debugging:

```javascript
window.DEBUG_ALL = true;
```

## 🔐 Security Notes

- Widget assets are sandboxed to their folders
- Path traversal protection enabled
- CORS enabled for local development
- Global hotkeys require explicit permission

## 📝 Migration from Python

Major changes from the original Python/Flask version:

1. **Backend**: Flask → ASP.NET Core Web API
2. **Widget API**: Python functions → C# classes with dependency injection
3. **Manifest Loading**: JSONC-parser → Native C# with regex comment stripping
4. **Hot Reload**: File watcher → Timer-based polling with change detection
5. **Keybinds**: JavaScript-only → C# global hooks + JavaScript frontend
6. **Rendering**: Direct HTML → CefSharp browser embedding

## 🤝 Contributing

Widgets are self-contained - just drop new widget folders into `Widgets/` and they'll be auto-discovered!

Planned improvements:
- Future Steam Workshop integration for easy sharing and discovery of widgets.
- Support for an optional per-widget "install" file (custom install file) to enable one-click installs and declare dependencies or installation hints.

---

**Note**: The JavaScript utilities in `API/universal/` are shared across all widgets and provide the core widget loading, updating, and event handling functionality.
