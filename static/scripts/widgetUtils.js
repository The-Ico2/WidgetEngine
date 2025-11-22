// widgetUtils.js
window.ActiveWidgets = {};
// Track deleted widgets to make deleteWidget idempotent (prevents duplicate logs/actions)
window._deletedWidgets = window._deletedWidgets || new Set();
// Diagnostic: warn when any script assigns to `window.WidgetInit` (helps detect globals overwriting)
(function(){
    try {
        if (!window.__widgetInitDiagInstalled) {
            Object.defineProperty(window, '__widgetInitDiagInstalled', { value: true, configurable: false });
            let current = window.WidgetInit;
            Object.defineProperty(window, 'WidgetInit', {
                configurable: true,
                enumerable: true,
                get() { return current; },
                set(fn) {
                    try {
                        try {
                            if (typeof Utils !== 'undefined' && Utils && typeof Utils.sendMessage === 'function') {
                                const name = fn && fn.name ? fn.name : '<anonymous>';
                                Utils.sendMessage('warn', `Diagnostic: window.WidgetInit assigned by a widget script. (${name})`, 6);
                            } else {
                                console.warn('Diagnostic: window.WidgetInit assigned by a widget script.', fn);
                            }
                        } catch (e) {
                            try { console.warn('Diagnostic: window.WidgetInit assigned by a widget script.', fn); } catch (_) {}
                        }
                    } catch (e) {}
                    current = fn;
                }
            });
        }
        } catch (e) {
        // Don't break if defineProperty fails
        try {
            if (typeof Utils !== 'undefined' && Utils && typeof Utils.sendMessage === 'function') {
                Utils.sendMessage('error', `Failed to install WidgetInit diagnostic: ${e}`, 6);
            } else {
                console.error('Failed to install WidgetInit diagnostic:', e);
            }
        } catch (_) {
            try { console.error('Failed to install WidgetInit diagnostic:', e); } catch (_) {}
        }
    }
})();
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
        // Flexible Update.manifest wrapper
        // Supports legacy call shapes used elsewhere in the codebase:
        //  - Update.manifest(name, path, value)
        //  - Update.manifest(null, manifestObj, widgetName, path, value)
        //  - Update.manifest(manifestObj, widgetName, path, value)
        manifest: async function(...args) {
            // Normalize arguments into { name, path, value, manifest }
            let name = null, path = null, value = undefined, manifest = null;

            if (args.length === 3) {
                // (name, path, value)
                [name, path, value] = args;
            } else if (args.length >= 4) {
                // Could be (manifestObj, widgetName, path, value)
                if (typeof args[0] === 'object' && args[0] !== null) {
                    manifest = args[0];
                    name = args[1] || manifest.name;
                    path = args[2];
                    value = args[3];
                }

                // Or (null, manifestObj, widgetName, path, value)
                if (!manifest && args[0] === null && typeof args[1] === 'object' && args[1] !== null) {
                    manifest = args[1];
                    name = args[2] || manifest.name;
                    path = args[3];
                    value = args[4];
                }
            }

            // Basic validation
            if (!name || !path) {
                Utils.sendMessage("error", `Update.manifest called with invalid args: name=${name}, path=${path}`, 4, name || null)
                return;
            }

            // If manifest wasn't provided, try the global cache
            if (!manifest) manifest = window.ActiveWidgets?.[name]?.manifest;
            if (!manifest) {
                Utils.sendMessage("error", `[widget:${name}] Manifest not found`, 4, name)
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
                    const rootEl = document.querySelector(`.widget-root[data-widget="${name}"]`);
                    if (rootEl) {
                        Update.widget(rootEl, manifest);
                    } else {
                        // no root in DOM; skip live update but log debug
                        Utils.sendMessage("debug", `Update.manifest: widget root not found for ${name}, skipping live DOM update`, 3, name);
                    }
                } catch (e) {
                    Utils.sendMessage("warn", `[widget:${name}] Widget live update skipped: ${e}`, 4, name)
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
                    Utils.sendMessage("error", `[widget:${name}] Failed manifest update for ${path}: ${await res.text()}`, 4, name);
            } catch (e) {
                Utils.sendMessage("error", `[widget:${name}] Error updating manifest: ${e}`, 4, name);
            }
        },


        /**
         * Apply manifest changes live to widget DOM.
         * @param {HTMLElement} root - widget root element
         * @param {Object} manifest - full widget manifest
         */
        widget: function(root, manifest) {
            if (!root || !manifest) {
                Utils.sendMessage("debug", `Update.widget skipped: root or manifest missing for ${manifest?.name ?? 'unknown'}`, 3, manifest?.name)
                return;
            }

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

                        // Call onInit immediately if enabled and not yet initialized.
                        // Mark the root as initialized BEFORE calling into the widget init
                        // to prevent re-entrant Update.widget -> onInit -> Update.widget
                        // recursion which can cause stack overflows. If init throws,
                        // revert the flag so future attempts can retry.
                        if (hooks.onInit && !root._initialized) {
                            const initFn = resolveWidgetInit(manifest.name);
                            if (initFn) {
                                try {
                                    root._initialized = true; // prevent re-entrancy
                                    initFn(manifest, root);
                                } catch (e) {
                                    // revert initialized flag on failure and report
                                    root._initialized = false;
                                    Utils.sendMessage("error", `[widget:${manifest.name}] Error during onInit: ${e}`, 4, manifest.name);
                                }
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
                                        Utils.sendMessage("warn", `[widget:${manifest.name}] Unknown lifecycle hook: ${hookName}`, 4, manifest.name);
                                }
                            } catch (e) {
                                Utils.sendMessage("error", `[widget:${manifest.name}] Error during ${hookName}: ${e}`, 4, manifest.name);
                            }
                        };
                        break;

                    default:
                        break;
                }
            } catch (e) {
                Utils.sendMessage("error", `[widget:${manifest?.name ?? 'unknown'}] applyBehaviorRules failed: ${e}`, 4, manifest?.name)
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
                            Utils.sendMessage("warn", `[widget:${root.dataset.widget}] Resizing is disabled for widget`, 2000, root.dataset.widget)
                        }
                        break;
                    }

                    default:
                        Utils.sendMessage("warn", `[widget:${manifest?.name ?? 'unknown'}] Unknown DisplayRules type: ${type}`, 4, manifest?.name)
                        break;
                }
            } catch (e) {
                Utils.sendMessage("error", `[widget:${manifest?.name ?? 'unknown'}] applyDisplayRules failed: ${e}`, 4, manifest?.name)
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
                        Utils.sendMessage("warn", `[widget:${manifest?.name ?? 'unknown'}] Unknown StylingRules type: ${type}`, 4, manifest?.name)
                        break;
                }

            } catch(e) {
                Utils.sendMessage("error", `[widget:${manifest?.name ?? 'unknown'}] applyStylingRules failed: ${e}`, 4, manifest?.name)
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

            } catch (e) {
                Utils.sendMessage("error", `Error updating UniqueConfig: ${e}`, 4, manifest?.name);
            }
        },

    }

    return Apply;
})();

window.Utils = (() => {
    const activeChips = []; // keep track of active messages

    const Utils = {
        // New signature: optional widgetName helps reliably gate messages
        sendMessage: function(type, message, duration = 4, widgetName = null) {
            try {
                // Gate non-essential messages (debug, success, warn/warning)
                // so they only appear when the related widget has debug enabled
                // (`manifest.extra.debug`) or when a global `window.DEBUG_ALL`
                // override is set. `info` and `error` remain visible always.
                const gatedTypes = ["debug", "success", "warn", "warning"];
                if (gatedTypes.includes(type)) {
                    let allowed = false;

                    // Global override
                    if (window.DEBUG_ALL) allowed = true;

                    // If caller provided a widget identifier/object, honor that manifest
                    // Accept either: string widgetName, widget object, or manifest object.
                    let _manifestCandidate = null;
                    if (widgetName) {
                        try {
                            if (typeof widgetName === 'object' && widgetName !== null) {
                                // Could be { name, extra, files } or { manifest: {...} }
                                _manifestCandidate = widgetName.manifest ?? widgetName;
                            } else if (typeof widgetName === 'string') {
                                _manifestCandidate = window.ActiveWidgets?.[widgetName]?.manifest ?? null;
                            }
                        } catch (e) {
                            _manifestCandidate = null;
                        }

                        if (!allowed && _manifestCandidate?.extra?.debug) allowed = true;
                    }

                    // Try to infer widget name from the message text if not allowed yet.
                    if (!allowed && typeof message === 'string') {
                        const patterns = [
                            /\[widget:([^\]]+)\]/i,
                            /Widget\s+"([^\"]+)"/i,
                            /widget\s+"([^\"]+)"/i,
                            /for widget\s+"([^\"]+)"/i,
                            /widget:\s*([^\s,;]+)/i
                        ];
                        for (const p of patterns) {
                            const m = message.match(p);
                            if (m) {
                                const inferred = m[1];
                                const manifest = window.ActiveWidgets?.[inferred]?.manifest;
                                if (manifest?.extra?.debug) {
                                    allowed = true;
                                    break;
                                }
                            }
                        }
                    }

                    // If not allowed by any method, skip showing the message.
                    if (!allowed) return;

                // Mirror messages to developer console using appropriate levels.
                try {
                    const logPrefix = widgetName ? `[widget:${widgetName}] ` : "";
                    const consoleMethods = {
                        error: "error",
                        warn: "warn",
                        warning: "warn",
                        success: "log",
                        info: "info",
                        debug: "debug"
                    };
                    const method = consoleMethods[type] || "log";
                    if (typeof console !== 'undefined' && typeof console[method] === 'function') {
                        console[method](`${logPrefix}${message}`);
                    } else if (typeof console !== 'undefined' && typeof console.log === 'function') {
                        console.log(`${logPrefix}${message}`);
                    }
                } catch (e) {
                    // Keep main flow resilient if console logging fails
                    try { if (typeof console !== 'undefined' && typeof console.error === 'function') console.error(`Utils.sendMessage: console logging failed: ${e}`); } catch (_) {}
                }
                }

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
                    warn: { backgroundColor: "rgba(255,193,7,0.95)", color: "#222" },
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
                    // Cache manifests in window.ActiveWidgets for other utilities to reference
                    try { if (widget && widget.name) window.ActiveWidgets[widget.name] = { manifest: widget }; } catch (e) {}
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

                        if (window.WidgetInit) {
                            // Capture the init function for this widget to avoid global overwrite
                            window.WidgetInitRegistry = window.WidgetInitRegistry || {};
                            try {
                                window.WidgetInitRegistry[widget.name] = window.WidgetInit;
                                window.WidgetInit(widget, widgetRoot);
                            } finally {
                                try { delete window.WidgetInit; } catch (e) { window.WidgetInit = undefined; }
                            }
                        }
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

                // Clear any existing entries to avoid duplication when re-rendering
                if (gridEl) gridEl.innerHTML = "";

                for (const entry of allEntries) {
                    // Cache real widget manifests so SettingsRenderer and Update can access them
                    if (!entry.special && entry.name) {
                        try { window.ActiveWidgets[entry.name] = { manifest: entry }; } catch (e) {}
                    }
                    const box = document.createElement("div");
                    box.className = "widget-box";

                    const title = document.createElement("h3");
                    title.textContent = entry.name;
                    box.appendChild(title);

                    // Add enabled toggle only for real widgets
                    if (!entry.special) {
                        const toggle = document.createElement("div");
                        toggle.className = "widget-toggle";
                        // Some backends provide top-level `enabled`, others nest under behavior.enabled
                        const isEnabled = (typeof entry.enabled !== 'undefined') ? entry.enabled : (entry.behavior?.enabled ?? false);
                        toggle.classList.toggle("enabled", isEnabled);
                        toggle.classList.toggle("disabled", !isEnabled);
                        toggle.textContent = isEnabled ? "Enabled" : "Disabled";

                        toggle.addEventListener("click", async e => {
                            e.stopPropagation();
                            const newState = !toggle.classList.contains("enabled");
                            toggle.classList.toggle("enabled", newState);
                            toggle.classList.toggle("disabled", !newState);
                            toggle.textContent = newState ? "Enabled" : "Disabled";

                            // Keep both shapes in sync for UI convenience
                            entry.enabled = newState;
                            if (entry.behavior) entry.behavior.enabled = newState;

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
                            // ensure panel scrolls to top when opened
                            container.scrollTop = 0;
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
                            // ensure panel scrolls to top when opened
                            container.scrollTop = 0;
                            const closeButton = document.getElementById("settings-panel-content-close");
                            closeButton.addEventListener("click", () => {
                                container.style.display = "none";
                            });
                        } else {
                            Utils.sendMessage("warn", `No settings found for ${entry.name}`, 4, entry.name)
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
                    Utils.sendMessage("debug", `Widget "${widget.name}" is enabled. Creating...`, 30, widget);
                } else {
                    // Case 2: widget exists, debug true, but disabled or missing manifest
                    Utils.sendMessage("debug", `Widget "${widget.name}" is disabled or invalid. Skipping creation.`, 30, widget);
                }
            }


            const basePath = `${BACKEND_URL}/widgets/${widget.name}/`;
            let widgetRoot = null;

            // If caller provided a root element, prefer that
            const existingRoot = container.querySelector && container.querySelector(`.widget-root[data-widget="${widget.name}"]`);
            if (existingRoot) {
                widgetRoot = existingRoot;
                // If we are re-using an existing root, ensure it's not marked deleted
                try { window._deletedWidgets.delete(widget.name); } catch (e) {}
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
                    // New/loaded widget is no longer deleted
                    try { window._deletedWidgets.delete(widget.name); } catch (e) {}
                } else {
                    // If no HTML file, create a basic root
                    widgetRoot = document.createElement("div");
                    widgetRoot.className = "widget-root";
                    widgetRoot.dataset.widget = widget.name;
                    container.appendChild(widgetRoot);
                    // New/created widget is no longer deleted
                    try { window._deletedWidgets.delete(widget.name); } catch (e) {}
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

            // If we loaded the script now, or the script already exists, attempt to call
            // the widget's init function if it registered itself on `window.WidgetInit`.
            try {
                // Use per-widget registry if available (prevents globals overwriting each other)
                const initFn = resolveWidgetInit(widget.name);
                if (initFn && (didLoadScript || scriptExists)) {
                    try { initFn(widget, widgetRoot); } catch (e) { Utils.sendMessage && Utils.sendMessage('error', `WidgetInit for ${widget.name} failed: ${e}`, 4, widget.name); }
                }
            } catch (e) {
                Utils.sendMessage && Utils.sendMessage('error', `Error while attempting to call WidgetInit: ${e}`, 4);
            }

            return widgetRoot;
        },

        deleteWidget: async function(widgetName) {
            /* ---------------- Remove DOM Root ---------------- */
            // Make delete idempotent: if already deleted, skip
            try {
                if (window._deletedWidgets.has(widgetName)) {
                    Utils.sendMessage && Utils.sendMessage('debug', `deleteWidget: '${widgetName}' already removed, skipping.`, 3, widgetName);
                    return;
                }
                window._deletedWidgets.add(widgetName);
            } catch (e) {}

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

            Utils.sendMessage && Utils.sendMessage('info', `Widget '${widgetName}' fully removed (DOM, scripts, styles).`, 4, widgetName);
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

        if (debug) Utils.sendMessage("debug", `Rendering settings for widget "${widgetName}"`, 5, widgetName);

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
            if (debug) Utils.sendMessage("debug", `Updating widget "${widgetName}" - ${section ? section + "." : ""}${key}: ${value}`, 5, widgetName);
            try {
                await Update.manifest(null, manifest, widgetName, section ? `${section}.${key}` : key, value);
                if (debug) Utils.sendMessage("debug", `Update applied successfully for widget "${widgetName}"`, 5, widgetName);
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
                if (debug) Utils.sendMessage("debug", `Toggled "${label}" to ${value}`, 3, widgetName);
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

            const cfgRoot = manifest.config || manifest.unique_config?.style || manifest.unique_config || {};
            for(const [k,v] of Object.entries(cfgRoot)) {
                container.appendChild(renderDynamicField("config",k,v));
            }
        }

        if (debug) Utils.sendMessage("debug", `Settings UI rendered for widget "${widgetName}"`, 5, widgetName);
    }

    return { renderWidgetSettings };
})();

// Helper to resolve a widget's init function from the registry in a case-insensitive way.
function resolveWidgetInit(name) {
    try {
        const registry = window.WidgetInitRegistry || {};
        if (!name) return window.WidgetInit;
        if (registry[name]) return registry[name];
        const lower = name.toLowerCase();
        if (registry[lower]) return registry[lower];
        // fallback: find any key that matches case-insensitively
        for (const k of Object.keys(registry)) {
            if (k.toLowerCase() === lower) return registry[k];
        }
        return window.WidgetInit;
    } catch (e) {
        return window.WidgetInit;
    }
}