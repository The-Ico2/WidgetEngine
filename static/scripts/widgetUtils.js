// widgetUtils.js
window.ActiveWidgets = {};
const widgetContainer = document.getElementById('widget-container')
if (!widgetContainer) {
    Utils.sendMessage("error", `#widget-container not found!`)
}
window.Update = (() => {
    const Update = {
        /**
         * Update manifest and push changes to backend.
         * Supports nested keys in dot notation (e.g., "unique_config.style.use24HourFormat").
         * All API calls go through this method.
         * @param {string} name - full widget manifest
         * @param {string} path - widget id/name
         * @param {object} value - dot-path key to update
         */
        manifest: async function(name, path, value) {
            if (!name || !path) return;

            // 1. Get manifest from your global widget cache
            const manifest = window.ActiveWidgets?.[name]?.manifest;
            if (!manifest) {
                Utils.sendMessage("error", `Manifest for ${name} not found`)
                return;
            }

            // 2. Apply update locally using dot-notation
            const keys = path.split(".");
            let target = manifest;
            for (let i = 0; i < keys.length - 1; i++) {
                if (!(keys[i] in target)) target[keys[i]] = {};
                target = target[keys[i]];
            }
            target[keys[keys.length - 1]] = value;

            // 3. Apply DOM update if widget is currently rendered
            if (window.Update?.widget) {
                try {
                    Update.widget(null, manifest);  
                } catch (e) {
                    Utils.sendMessage("warn", `Widget live update skipped: ${e}`)
                }
            }

            // 4. Push update to backend
            try {
                const res = await fetch(`${BACKEND_URL}/api/widgets/${encodeURIComponent(name)}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ path, value })
                });

                if (!res.ok)
                    Utils.sendMessage("error", `Failed manifest update for ${name}/${path}: ${await res.text()}`);
            } catch (e) {
                Utils.sendMessage("error", `Error updating manifest for '${name}': ${e}`);
            }
        },


        /**
         * Apply manifest changes live to widget DOM.
         * @param {HTMLElement} root - widget root element
         * @param {Object} manifest - full widget manifest
         */
        widget: function(root, manifest) {
            if (!root || !manifest) return;

            // ---------------- Behavior Rules ----------------
            if (manifest.behavior) {
                // Enabled
                if ("enabled" in manifest) window.Apply.BehaviorRules(root, manifest, {}, "enabled");

                // Draggable
                if ("draggable" in manifest.behavior) window.Apply.BehaviorRules(root, manifest, {}, "draggable");

                // Click-Through
                if ("clickThrough" in manifest.behavior) window.Apply.BehaviorRules(root, manifest, {}, "clickThrough");

                // Focusable
                if ("focusable" in manifest.behavior) window.Apply.BehaviorRules(root, manifest, {}, "focusable");

                // Lifecycle hooks (onInit already handled here)
                if ("lifecycle" in manifest.behavior) window.Apply.BehaviorRules(root, manifest, {}, "lifecycle");
            }

            // ---------------- Display Rules ----------------
            if (manifest.display) {
                // Position
                if (manifest.display.position) window.Apply.DisplayRules(root, manifest, {}, "position");

                // Size / Scaling
                if (manifest.display.size) window.Apply.DisplayRules(root, manifest, {}, "size");
            }

            // ---------------- Styling Rules ----------------
            if (manifest.styling) {
                window.Apply.StylingRules(root, manifest, {}, "useRootVariables");
                window.Apply.StylingRules(root, manifest, {}, "font");
                window.Apply.StylingRules(root, manifest, {}, "border");
                window.Apply.StylingRules(root, manifest, {}, "background");
                window.Apply.StylingRules(root, manifest, {}, "animation");
            }

            // ---------------- Unique Config ----------------
            if (manifest.unique_config) {
                for (const key in manifest.unique_config) {
                    if (manifest.unique_config.hasOwnProperty(key)) {
                        window.Apply.UniqueConfig(root, manifest, { value: manifest.unique_config[key] }, key);
                    }
                }
            }
        }
    };

    return Update;
})();

window.Apply = (() => {
    const Apply = {
        BehaviorRules: function(root, manifest, config, type) {
            try {
                switch (type) {
                    // ---------------- Enabled ----------------
                    case "enabled":
                        if (manifest.enabled === false) {
                            if (root && root.parentNode) root.remove();
                            return null;
                        }

                        if (!root) {
                            root = document.createElement("div");
                            root.className = "widget-root";
                            root.dataset.widget = manifest.name;
                            widgetContainer.appendChild(root);
                        }

                        return root;

                    // ---------------- Draggable ----------------
                    case "draggable":
                        if (!root || !manifest?.display?.position) return;

                        const draggable = manifest.behavior?.draggable ?? false;
                        if (!draggable || root._draggableInitialized) return;

                        // Apply initial position & styling
                        root.style.position = "absolute";
                        root.style.left = manifest.display.position.x + "px";
                        root.style.top = manifest.display.position.y + "px";
                        root.style.cursor = "grab";

                        let offsetX = 0, offsetY = 0, dragging = false;
                        let timeoutId = null;

                        // Start drag
                        root.addEventListener("mousedown", e => {
                            dragging = true;
                            offsetX = e.clientX - root.offsetLeft;
                            offsetY = e.clientY - root.offsetTop;
                            root.style.cursor = "grabbing";
                            if (timeoutId) clearTimeout(timeoutId);
                        });

                        // Dragging
                        document.addEventListener("mousemove", e => {
                            if (!dragging) return;
                            root.style.left = e.clientX - offsetX + "px";
                            root.style.top = e.clientY - offsetY + "px";
                        });

                        // End drag & update manifest (debounced)
                        document.addEventListener("mouseup", async () => {
                            if (!dragging) return;
                            dragging = false;
                            root.style.cursor = "grab";

                            if (timeoutId) clearTimeout(timeoutId);
                            timeoutId = setTimeout(async () => {
                                const x = parseInt(root.style.left);
                                const y = parseInt(root.style.top);
                                await Update.manifest(manifest.name, "display.position", { x, y });
                            }, 500);
                        });
                        root._draggableInitialized = true;
                        break;

                    // ---------------- Click-Through ----------------
                    case "clickThrough":
                        if (!root || manifest.behavior?.clickThrough === undefined) return;
                        root.style.pointerEvents = manifest.behavior.clickThrough ? "none" : "auto";
                        value = root.style.pointerEvents

                        break;

                    // ---------------- Focusable ----------------
                    case "focusable":
                        if (!root || manifest.behavior?.focusable === undefined) return;
                        if (manifest.behavior.focusable) {
                            root.tabIndex = 0;
                            root.addEventListener("focus", () => {
                                if (window.WidgetFocus) window.WidgetFocus(manifest.name);
                            });
                            root.addEventListener("blur", () => {
                                if (window.WidgetBlur) window.WidgetBlur(manifest.name);
                            });
                        } else {
                            root.removeAttribute("tabIndex");
                        }
                        
                        break;

                    // ---------------- Lifecycle ----------------
                    case "lifecycle":
                        if (!root || !manifest.behavior?.lifecycle) return;

                        const hooks = manifest.behavior.lifecycle;

                        // Call onInit immediately if enabled and not yet initialized
                        if (hooks.onInit && window.WidgetInit && !root._initialized) {
                            try {
                                window.WidgetInit(manifest, root);
                                root._initialized = true; // mark as initialized
                            } catch (e) {
                                Utils.sendMessage("error", `Error during onInit for widget ${manifest.name}: ${e}`);
                            }
                        }

                        // Provide helper to call other lifecycle hooks externally
                        root._callLifecycleHook = async function(hookName, config) {
                            if (!hooks[hookName]) return;

                            try {
                                switch (hookName) {
                                    case "onDestroy":
                                        if (window.WidgetDestroy) await window.WidgetDestroy(manifest, root);
                                        break;
                                    case "onSettingsUpdate":
                                        if (window.WidgetUpdate) await window.WidgetUpdate(manifest, config);
                                        break;
                                    case "onFocus":
                                        if (window.WidgetFocus) await window.WidgetFocus(manifest, root);
                                        break;
                                    case "onBlur":
                                        if (window.WidgetBlur) await window.WidgetBlur(manifest, root);
                                        break;
                                    case "onResize":
                                        if (window.WidgetResize) await window.WidgetResize(manifest, root, config.width, config.height);
                                        break;
                                    default:
                                        Utils.sendMessage("warn", `Unknown lifecycle hook: ${hookName}`);
                                }
                            } catch (e) {
                                Utils.sendMessage("error", `Error during ${hookName} for widget ${manifest.name}: ${e}`);
                            }
                        };
                        break;

                    default:
                        break;
                }
            } catch (e) {
                Utils.sendMessage("error", `applyBehaviorRules failed: ${e}`)
            }
        },

        DisplayRules: function(root, manifest, config, type) {
            try {
                if (!root || !manifest?.display) return;

                switch (type) {
                    // ---------------- Position ----------------
                    case "position": {
                        const pos = manifest.display.position;
                        if (!pos) return;

                        root.style.position = "absolute";
                        root.style.left = pos.x + "px";
                        root.style.top = pos.y + "px";
                        root.style.zIndex = pos.zIndex ?? 0; // default to 0 if undefined
                        break;
                    }

                    // ---------------- Size / Scaling ----------------
                    case "size": {
                        const size = manifest.display.size;
                        if (!size) return;

                        if (size.resizable) {
                            root.style.width = size.width + "px";
                            root.style.height = size.height + "px";
                            root.style.transform = `scale(${size.scale ?? 1})`;

                            // Apply font scaling if enabled
                            const fontScaling = manifest.general_style?.font?.widgetScaling;
                            if (fontScaling) {
                                const baseFontSize = config.fontSize ?? 24;
                                root.style.fontSize = config.fontSizeScaling
                                    ? baseFontSize * (size.scale ?? 1) + "px"
                                    : baseFontSize + "px";
                            }
                        } else {
                            Utils.sendMessage("warn", `Resizing is disabled for widget: ${root.dataset.widget}`, 2000)
                        }
                        break;
                    }

                    default:
                        Utils.sendMessage("warn", `Unknown DisplayRules type: ${type}`)
                        break;
                }
            } catch (e) {
                Utils.sendMessage("error", `applyDisplayRules failed: ${e}`)
            }
        },

        StylingRules: function(root, manifest, config, type) {
            try {
                if (!root || !manifest?.styling) return;
                const styling = manifest.styling;

                switch (type) {

                    // ---------------- Use Root CSS Variables ----------------
                    case "useRootVariables":
                        if (styling.useRootVariables) {
                            // Example: set CSS variables for easy theming
                            root.style.setProperty("--widget-font-family", styling.font.family);
                            root.style.setProperty("--widget-font-size", styling.font.size);
                            root.style.setProperty("--widget-font-color", styling.font.color);
                            root.style.setProperty("--widget-border-style", styling.border.style);
                            root.style.setProperty("--widget-border-width", styling.border.width);
                            root.style.setProperty("--widget-border-color", styling.border.color);
                            root.style.setProperty("--widget-bg-color", styling.background.color);
                            root.style.setProperty("--widget-bg-alpha", styling.background.alpha);
                        }
                        break;

                    // ---------------- Font ----------------
                    case "font":
                        if (styling.font) {
                            root.style.fontFamily = styling.font.family;
                            root.style.color = styling.font.color;
                            
                            // If widgetScaling is enabled, scale font size according to DisplayRules
                            if (styling.font.widgetScaling && manifest.display?.size) {
                                const scale = manifest.display.size.scale ?? 1;
                                const baseFontSize = parseInt(styling.font.size) || 24;
                                root.style.fontSize = (config.fontSizeScaling 
                                    ? baseFontSize * scale 
                                    : baseFontSize) + "px";
                            } else {
                                root.style.fontSize = styling.font.size;
                            }
                        }
                        break;

                    // ---------------- Border ----------------
                    case "border":
                        if (styling.border) {
                            root.style.borderStyle = styling.border.style;
                            root.style.borderWidth = styling.border.width;
                            root.style.borderColor = styling.border.color;
                        }
                        break;

                    // ---------------- Background ----------------
                    case "background":
                        if (styling.background) {
                            const bgColor = styling.background.color || "#000000";
                            const alpha = styling.background.alpha ?? 1;
                            root.style.backgroundColor = `rgba(${hexToRgb(bgColor)}, ${alpha})`;
                        }
                        break;

                    // ---------------- Animation ----------------
                    case "animation":
                        if (styling.animation && styling.animation.enabled) {
                            root.style.transition = `all ${styling.animation.duration ?? 200}ms`;
                            switch (styling.animation.type) {
                                case "fade-in":
                                    root.style.opacity = 0;
                                    requestAnimationFrame(() => root.style.opacity = 1);
                                    break;
                                case "expand":
                                    root.style.transform = "scale(0)";
                                    requestAnimationFrame(() => root.style.transform = "scale(1)");
                                    break;
                                // Add other animation types as needed
                                default:
                                    break;
                            }
                        }
                        break;

                    default:
                        Utils.sendMessage("warn", `Unknown StylingRules type: ${type}`)
                        break;
                }

            } catch(e) {
                Utils.sendMessage("error", `applyStylingRules failed: ${e}`)
            }

            // ---------------- Helper ----------------
            function hexToRgb(hex) {
                hex = hex.replace(/^#/, '');
                if (hex.length === 3) {
                    hex = hex.split('').map(h => h + h).join('');
                }
                const intVal = parseInt(hex, 16);
                const r = (intVal >> 16) & 255;
                const g = (intVal >> 8) & 255;
                const b = intVal & 255;
                return `${r}, ${g}, ${b}`;
            }
        },


        UniqueConfig: function(root, manifest, config, type) {
            try {
                if (!manifest?.unique_config) return;

                // type will represent the key or nested path, e.g., "style.showSeconds"
                const keys = type.split(".");
                let target = manifest.unique_config;

                // Traverse to the final property
                for (let i = 0; i < keys.length - 1; i++) {
                    if (!(keys[i] in target)) {
                        Utils.sendError(`UniqueConfig key not found: ${keys.slice(0, i + 1).join(".")}`);
                        return;
                    }
                    target = target[keys[i]];
                }

                const finalKey = keys[keys.length - 1];
                if (!(finalKey in target)) {
                    Utils.sendError(`UniqueConfig key not found: ${type}`);
                    return;
                }

                // Update the value
                target[finalKey] = config.value;

                console.log(`UniqueConfig updated: ${type} =`, config.value);

            } catch (e) {
                Utils.sendError(`Error updating UniqueConfig: ${e}`);
            }
        },

    }

    return Apply;
})();

window.Utils = (() => {
    const activeChips = []; // keep track of active messages

    const Utils = {
        sendMessage: function(type, message, duration = 4) {
            try {
                const chip = document.createElement("div");
                chip.className = `msg-chip msg-${type}`;
                chip.textContent = message;

                // -------------------------
                // Built-in fallback styling
                // -------------------------
                const baseStyle = {
                    position: "fixed",
                    right: "20px",
                    padding: "10px 15px",
                    borderRadius: "6px",
                    color: "#fff",
                    fontFamily: "Inter, sans-serif",
                    fontSize: "14px",
                    boxShadow: "0 2px 10px rgba(0,0,0,0.25)",
                    zIndex: 99999,
                    opacity: 0,
                    transition: "opacity 0.25s ease, transform 0.25s ease",
                    transform: "translateY(10px)"
                };

                const typeStyles = {
                    error:   { backgroundColor: "rgba(220,53,69,0.95)" },    
                    warning: { backgroundColor: "rgba(255,193,7,0.95)", color: "#222" },
                    success: { backgroundColor: "rgba(40,167,69,0.95)" },
                    info:    { backgroundColor: "rgba(23,162,184,0.95)" },
                    debug:   { backgroundColor: "rgba(108,117,125,0.95)" }
                };

                Object.assign(chip.style, baseStyle, typeStyles[type] || typeStyles.info);

                // Compute vertical offset based on existing chips
                const spacing = 10; // px between messages
                let bottomOffset = 20;
                activeChips.forEach(c => {
                    bottomOffset += c.offsetHeight + spacing;
                });
                chip.style.bottom = bottomOffset + "px";

                document.body.appendChild(chip);
                activeChips.push(chip);

                // Fade in
                requestAnimationFrame(() => {
                    chip.style.opacity = 1;
                    chip.style.transform = "translateY(0)";
                });

                // Fade out + remove
                setTimeout(() => {
                    chip.style.opacity = 0;
                    chip.style.transform = "translateY(10px)";
                    chip.addEventListener("transitionend", () => {
                        chip.remove();
                        const index = activeChips.indexOf(chip);
                        if (index !== -1) activeChips.splice(index, 1);
                        // adjust positions of remaining chips
                        let offset = 20;
                        activeChips.forEach(c => {
                            c.style.bottom = offset + "px";
                            offset += c.offsetHeight + spacing;
                        });
                    });
                }, duration * 1000);

            } catch (e) {
                console.error(`Utils.sendMessage failed: ${e}`);
            }
        },

        loadDOMWidgets: async function(container = document.body) {
            try {
                const widgets = await fetch(`${BACKEND_URL}/api/widgets`).then(r => r.json());

                const loadScript = (src, name) => new Promise((resolve, reject) => {
                    const s = document.createElement("script");
                    s.src = src;
                    s.dataset.widget = name
                    s.onload = resolve;
                    s.onerror = reject;
                    document.body.appendChild(s);
                });

                for (const widget of widgets) {
                    if (!widget.enabled) continue;

                    const basePath = `${BACKEND_URL}/widgets/${widget.name}/`;

                    /* ---------------- Inject CSS ---------------- */
                    if (widget.files.css) {
                        const link = document.createElement("link");
                        link.rel = "stylesheet";
                        link.href = basePath + widget.files.css;
                        document.head.appendChild(link);
                    }

                    /* ---------------- Inject HTML ---------------- */
                    let widgetRoot = null;
                    if (widget.files.html) {
                        const html = await fetch(basePath + widget.files.html).then(r => r.text());
                        const temp = document.createElement("div");
                        temp.innerHTML = html.trim();
                        widgetRoot = temp.firstElementChild;
                        widgetRoot.classList.add("widget-root");
                        widgetRoot.dataset.widget = widget.name;

                        container.appendChild(widgetRoot);
                    }

                    /* ---------------- Inject JS ---------------- */
                    if (widget.files.js) {
                        if (Array.isArray(widget.files.js)) {
                            for (const jsFile of widget.files.js) {
                                await loadScript(basePath + jsFile, widget.name);
                            }
                        } else {
                            await loadScript(basePath + widget.files.js, widget.name);
                        }

                        if (window.WidgetInit) window.WidgetInit(widget, widgetRoot);
                    }
                }

            } catch (e) {
                Utils.sendMessage("error", `applyDisplayRules failed: ${e}`)
            }
        },
        
        loadSettingsWidgets: async function(gridEl) {
            try {
                // Fetch all real widgets from backend
                const res = await fetch(`${BACKEND_URL}/api/widgets`);
                if (!res.ok) throw new Error("Failed to fetch widgets from backend");
                const widgetList = await res.json();

                // Define special modules of the Settings Widget
                const modules = [
                    { name: "General Styling", path: "styling" },
                    { name: "Keybinds", path: "keybinds" }
                ];

                // Combine widgets + modules for display in the settings panel grid
                const allEntries = [
                    ...widgetList,
                    ...modules.map(m => ({ name: m.name, special: true, modulePath: m.path }))
                ];

                // if (gridEl) gridEl.innerHTML = "";

                for (const entry of allEntries) {
                    const box = document.createElement("div");
                    box.className = "widget-box";

                    const title = document.createElement("h3");
                    title.textContent = entry.name;
                    box.appendChild(title);

                    // Add enabled toggle only for real widgets
                    if (!entry.special) {
                        const toggle = document.createElement("div");
                        toggle.className = "widget-toggle";
                        toggle.classList.toggle("enabled", entry.enabled);
                        toggle.classList.toggle("disabled", !entry.enabled);
                        toggle.textContent = entry.enabled ? "Enabled" : "Disabled";

                        toggle.addEventListener("click", async e => {
                            e.stopPropagation();
                            const newState = !toggle.classList.contains("enabled");
                            toggle.classList.toggle("enabled", newState);
                            toggle.classList.toggle("disabled", !newState);
                            toggle.textContent = newState ? "Enabled" : "Disabled";

                            entry.enabled = newState;

                            if (newState) {
                                await Utils.loadWidget(entry, document.getElementById('widget-container'));
                            } else {
                                await Utils.deleteWidget(entry.name);
                            }

                            await Update.manifest(entry.name, "behavior.enabled", newState);
                        });

                        box.appendChild(toggle);
                    }

                    // Click handler for loading settings into panel
                    box.addEventListener("click", async () => {
                        const container = document.getElementById("settings-panel-content");
                        container.style.display = "block";

                        // Special modules inside Settings Widget
                        if (entry.special && entry.modulePath) {
                            const html = await fetch(`${BACKEND_URL}/widgets/settings/module/${entry.modulePath}/settings.html`)
                                .then(r => r.text());
                            container.innerHTML = html;
                            const closeButton = document.getElementById("settings-panel-content-close");
                            closeButton.addEventListener("click", () => {
                                container.style.display = "none";
                            });
                        }
                        // Regular widgets
                        else if (!entry.special && entry.files?.settings) {
                            const html = await fetch(`${BACKEND_URL}/widgets/${entry.name}/${entry.files.settings}`)
                                .then(r => r.text());
                            container.innerHTML = html;
                            const closeButton = document.getElementById("settings-panel-content-close");
                            closeButton.addEventListener("click", () => {
                                container.style.display = "none";
                            });
                        } else {
                            Utils.sendMessage("warn", `No settings found for ${entry.name}`)
                        }
                    });

                    if (gridEl) gridEl.appendChild(box);
                }

            } catch (e) {
                Utils.sendMessage("error", `Utils: loadSettingsWidgets failed: ${e}`)
            }
        },
        
        loadWidget: async function(widget, container = document.body) {
            if (widget?.extra?.debug) {
                if (widget.behavior?.enabled && widget.files) {
                    // Case 1: widget exists, debug true, enabled, has manifest JSON
                    Utils.sendMessage("debug", `Widget "${widget.name}" is enabled. Creating...`, 30);
                } else {
                    // Case 2: widget exists, debug true, but disabled or missing manifest
                    Utils.sendMessage("debug", `Widget "${widget.name}" is disabled or invalid. Skipping creation.`, 30);
                }
            }


            const basePath = `${BACKEND_URL}/widgets/${widget.name}/`;
            let widgetRoot = null;

            // If caller provided a root element, prefer that
            const existingRoot = container.querySelector && container.querySelector(`.widget-root[data-widget="${widget.name}"]`);
            if (existingRoot) {
                widgetRoot = existingRoot;
            }

            // Load CSS (always safe to append; browser ignores duplicates but we could guard if needed)
            if (widget.files.css) {
                const cssId = `widget-style-${widget.name}`;
                if (!document.querySelector(`link#${cssId}`)) {
                    const link = document.createElement("link");
                    link.id = cssId;
                    link.rel = "stylesheet";
                    link.href = basePath + widget.files.css;
                    document.head.appendChild(link);
                }
            }

            // Load HTML only if root doesn't exist or is empty
            if (!widgetRoot || widgetRoot.children.length === 0) {
                if (widget.files.html) {
                    const html = await fetch(basePath + widget.files.html).then(r => r.text());
                    const temp = document.createElement("div");
                    temp.innerHTML = html.trim();

                    widgetRoot = temp.firstElementChild;
                    if (!widgetRoot) return null;

                    widgetRoot.classList.add("widget-root");
                    widgetRoot.dataset.widget = widget.name;

                    container.appendChild(widgetRoot);
                } else {
                    // If no HTML file, create a basic root
                    widgetRoot = document.createElement("div");
                    widgetRoot.className = "widget-root";
                    widgetRoot.dataset.widget = widget.name;
                    container.appendChild(widgetRoot);
                }
            } else {
                // widgetRoot exists — ensure it has class & dataset
                widgetRoot.classList.add("widget-root");
                widgetRoot.dataset.widget = widget.name;
            }

            // Load JS only if not already loaded (we mark script with data-widget)
            const scriptExists = !!document.querySelector(`script[data-widget="${widget.name}"]`);
            let didLoadScript = false;
            if (widget.files.js && !scriptExists) {
                const loadScript = src => new Promise((resolve, reject) => {
                    const s = document.createElement("script");
                    s.src = src;
                    s.dataset.widget = widget.name;
                    s.onload = resolve;
                    s.onerror = reject;
                    document.body.appendChild(s);
                });

                if (Array.isArray(widget.files.js)) {
                    for (const jsFile of widget.files.js) {
                        await loadScript(basePath + jsFile);
                    }
                } else {
                    await loadScript(basePath + widget.files.js);
                }
                didLoadScript = true;
            }

            return widgetRoot;
        },

        deleteWidget: async function(widgetName) {
            /* ---------------- Remove DOM Root ---------------- */
            const root = document.querySelector(`.widget-root[data-widget="${widgetName}"]`);
            if (root) {
                root.remove();
            }

            /* ---------------- Remove Script Tags ---------------- */
            const scripts = document.querySelectorAll(`script[data-widget="${widgetName}"]`);
            for (const s of scripts) {
                s.remove();
            }

            /* ---------------- Remove Stylesheet LINK Tags ---------------- */
            const styleLink = document.querySelector(`link#widget-style-${widgetName}`);
            if (styleLink) {
                styleLink.remove();
            }

            /* ---------------- Remove Inline <style> Blocks ---------------- */
            const inlineStyles = document.querySelectorAll(`style[data-widget="${widgetName}"]`);
            for (const st of inlineStyles) {
                st.remove();
            }

            console.log(`Widget '${widgetName}' fully removed (DOM, scripts, styles).`);
        },

        formatDate: function(date, config) {
            try {
                const fmt = config.dateFormat || "MM/DD/YYYY";
                const map = {
                    YYYY: date.getFullYear(),
                    MM: String(date.getMonth() + 1).padStart(2, "0"),
                    DD: String(date.getDate()).padStart(2, "0")
                };
                return fmt.replace(/YYYY|MM|DD/g, matched => map[matched]);
            } catch(e) {
                Utils.sendMessage("error", `formatDate failed: ${e}`)
                return "00/00/0000";
            }
        },

        waitForRoot: function(selector, callback, retries = 10, delay = 50) {
            const root = document.querySelector(selector);
            if (root) {
                callback(root);
            } else if (retries > 0) {
                setTimeout(() => Utils.waitForRoot(selector, callback, retries - 1, delay), delay);
            } else {
                Utils.sendMessage("error", `root element not found after waiting`)
            }
        },
    };

    return Utils;
})();

window.SettingsRenderer = (() => {
    const renderWidgetSettings = async (widgetName, container) => {
        container.innerHTML = "";

        let manifest;
        try {
            const res = await fetch(`${BACKEND_URL}/api/widgets/${widgetName}`);
            if (!res.ok) throw new Error(`Failed to load manifest for "${widgetName}"`);
            manifest = await res.json();
        } catch (e) {
            Utils.sendMessage("error", `Failed to load manifest for widget "${widgetName}": ${e}`);
            return;
        }

        const debug = manifest.extra?.debug;

        if (debug) Utils.sendMessage("debug", `Rendering settings for widget "${widgetName}"`, 5);

        container.innerHTML = `<h2>${manifest.label || manifest.name} Settings</h2>`;

        // Helper to create label + element row
        function field(label, element) {
            const wrap = document.createElement("div");
            wrap.className = "setting-row";

            const lbl = document.createElement("label");
            lbl.textContent = label;

            wrap.appendChild(lbl);
            wrap.appendChild(element);
            return wrap;
        }

        // -------------------- DYNAMIC FIELDS --------------------
        async function update(section, key, value) {
            if (debug) Utils.sendMessage("debug", `Updating widget "${widgetName}" - ${section ? section + "." : ""}${key}: ${value}`, 5);
            try {
                await Update.manifest(null, manifest, widgetName, section ? `${section}.${key}` : key, value);
                if (debug) Utils.sendMessage("debug", `Update applied successfully for widget "${widgetName}"`, 5);
            } catch (e) {
                Utils.sendMessage("error", `Failed to update widget "${widgetName}": ${e}`);
            }
        }

        function toggle(label, value, cb) {
            const el = document.createElement("div");
            el.className = "setting-toggle";
            el.textContent = label + ": " + (value ? "ON" : "OFF");

            el.onclick = () => {
                value = !value;
                el.textContent = label + ": " + (value ? "ON" : "OFF");
                if (debug) Utils.sendMessage("debug", `Toggled "${label}" to ${value}`, 3);
                cb(value);
            };
            return el;
        }

        function renderDynamicField(section, key, value) {
            // boolean toggle
            if (typeof value === "boolean") return toggle(key, value, v => update("config", key, v));
            // number input
            if (typeof value === "number") {
                const el = document.createElement("input");
                el.type = "number";
                el.value = value;
                el.onchange = () => update("config", key, Number(el.value));
                return field(key, el);
            }
            // color picker
            if (typeof value === "string" && value.startsWith("#")) {
                const el = document.createElement("input");
                el.type = "color";
                el.value = value;
                el.onchange = () => update("config", key, el.value);
                return field(key, el);
            }
            // text input fallback
            const el = document.createElement("input");
            el.type = "text";
            el.value = value;
            el.onchange = () => update("config", key, el.value);
            return field(key, el);
        }

        // -------------------- RENDER DEFAULT DYNAMIC UI --------------------
        if (!manifest.files?.settings) {
            // size
            const sizeHeader = document.createElement("h3");
            sizeHeader.textContent = "Size";
            container.appendChild(sizeHeader);

            container.appendChild(field("Width", (() => {
                const inp = document.createElement("input"); inp.type="number"; inp.value = manifest.size.width; inp.onchange=()=>update("size","width",Number(inp.value)); return inp;
            })()));

            container.appendChild(field("Height", (() => {
                const inp = document.createElement("input"); inp.type="number"; inp.value = manifest.size.height; inp.onchange=()=>update("size","height",Number(inp.value)); return inp;
            })()));

            container.appendChild(field("Scale", (() => {
                const inp = document.createElement("input"); inp.type="number"; inp.step="0.1"; inp.value=manifest.size.scale; inp.onchange=()=>update("size","scale",Number(inp.value)); return inp;
            })()));

            // drag / click
            container.appendChild(toggle("Draggable", manifest.draggable, v=>update(null,"draggable",v)));
            container.appendChild(toggle("Click-Through", manifest["click-through"], v=>update(null,"click-through",v)));

            // position
            const posHeader = document.createElement("h3");
            posHeader.textContent = "Position";
            container.appendChild(posHeader);

            container.appendChild(field("X", (() => { const inp=document.createElement("input"); inp.type="number"; inp.value=manifest.position.x; inp.onchange=()=>update("position","x",Number(inp.value)); return inp;})()));
            container.appendChild(field("Y", (() => { const inp=document.createElement("input"); inp.type="number"; inp.value=manifest.position.y; inp.onchange=()=>update("position","y",Number(inp.value)); return inp;})()));

            // config
            const cfgHeader = document.createElement("h3");
            cfgHeader.textContent = "Configuration";
            container.appendChild(cfgHeader);

            for(const [k,v] of Object.entries(manifest.config)) {
                container.appendChild(renderDynamicField("config",k,v));
            }
        }

        if (debug) Utils.sendMessage("debug", `Settings UI rendered for widget "${widgetName}"`, 5);
    }

    return { renderWidgetSettings };
})();