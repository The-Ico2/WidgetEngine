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
                            const name = fn && fn.name ? fn.name : '<anonymous>';
                            const msg = `Diagnostic: window.WidgetInit assigned by a widget script. (${name})`;
                            if (window.Utils && typeof window.Utils.sendMessage === 'function') {
                                try { window.Utils.sendMessage('warn', msg, 6); } catch (_) {}
                            } else {
                                window.__pendingMessages = window.__pendingMessages || [];
                                window.__pendingMessages.push({ type: 'warn', message: msg, duration: 6 });
                            }
                        } catch (e) {
                            // swallow; diagnostics must not throw
                        }
                    current = fn;
                }
            });
        }
            } catch (e) {
            // Don't break if defineProperty fails — diagnostics are best-effort and must not throw
            try {
                const msg = `Failed to install WidgetInit diagnostic: ${e}`;
                if (window.Utils && typeof window.Utils.sendMessage === 'function') {
                    try { window.Utils.sendMessage('error', msg, 6); } catch (_) {}
                } else {
                    window.__pendingMessages = window.__pendingMessages || [];
                    window.__pendingMessages.push({ type: 'error', message: msg, duration: 6 });
                }
            } catch (_) {
                // swallow
            }
    }
})();
// Helper wrapper for all backend fetches that attaches the preview layer header
// when available (so backend can persist layer-specific manifests while running
// on a single dedicated API port).
window.apiFetch = async function(url, options = {}) {
    options = options || {};
    options.headers = options.headers || {};
    try {
        if (window.WIDGET_LAYER) {
            options.headers['X-Widget-Layer'] = window.WIDGET_LAYER;
        }
    } catch (e) {
        // ignore
    }
    return fetch(url, options);
}
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

            // 4. Push update to backend with retries for transient server errors
            try {
                const payload = { path, value };
                const maxRetries = 2;
                let attempt = 0;
                let finalError = null;

                for (; attempt <= maxRetries; attempt++) {
                    try {
                        if (attempt > 0) await new Promise(r => setTimeout(r, 200 * attempt));

                        // Log the outgoing payload to console for debugging
                        try { console.debug(`[Update.manifest] PATCH ${BACKEND_URL}/api/widgets/${name} payload:`, payload); } catch (_) {}

                        const res = await apiFetch(`${BACKEND_URL}/api/widgets/${encodeURIComponent(name)}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(payload)
                        });

                        if (res.ok) {
                            finalError = null;
                            break; // success
                        }

                        // read body for diagnosis
                        let bodyText = '';
                        try { bodyText = await res.text(); } catch (e) { bodyText = `<unable to read response body: ${e}>`; }
                        let parsed = null;
                        try { parsed = JSON.parse(bodyText); } catch (_) { parsed = null; }

                        // If server error, consider retrying
                        if (res.status >= 500 && attempt < maxRetries) {
                            try { console.warn(`[Update.manifest] transient server error status=${res.status}, attempt=${attempt}`, parsed ?? bodyText); } catch (_) {}
                            finalError = { status: res.status, body: parsed ?? bodyText };
                            continue; // retry
                        }

                        // Non-retriable or final attempt failed: surface to user
                        const serverMsg = parsed?.error || parsed?.message || bodyText || `<empty response>`;
                        try { console.error(`[widget:${name}] Manifest update failed (status=${res.status}) payload:`, payload, 'response:', parsed ?? bodyText); } catch (_) {}
                        Utils.sendMessage("error", `[widget:${name}] Failed manifest update for ${path}: ${serverMsg} (status=${res.status})`, 6, name);
                        finalError = { status: res.status, body: parsed ?? bodyText };
                        break;

                    } catch (fetchErr) {
                        // network or other fetch-level error
                        try { console.warn(`[Update.manifest] network/fetch error on attempt ${attempt}:`, fetchErr); } catch (_) {}
                        finalError = fetchErr;
                        if (attempt < maxRetries) continue;
                        Utils.sendMessage("error", `[widget:${name}] Error updating manifest: ${fetchErr}`, 4, name);
                    }
                }

                if (finalError) {
                    // If finalError exists and we didn't already show a message above, log it for diagnosis
                    try { console.debug(`[Update.manifest] finalError for ${name}`, finalError); } catch(_){}
                }

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
            if (manifest.widget_features.behavior) {
                // Enabled
                if ("enabled" in manifest) window.WidgetUpdates.BehaviorRules(root, manifest, {}, "enabled");

                // Draggable
                if ("draggable" in manifest.widget_features.behavior) window.WidgetUpdates.BehaviorRules(root, manifest, {}, "draggable");

                // Click-Through
                if ("clickThrough" in manifest.widget_features.behavior) window.WidgetUpdates.BehaviorRules(root, manifest, {}, "clickThrough");

                // Focusable
                if ("focusable" in manifest.widget_features.behavior) window.WidgetUpdates.BehaviorRules(root, manifest, {}, "focusable");

                // Lifecycle hooks (onInit already handled here)
                if ("lifecycle" in manifest.widget_features.behavior) window.WidgetUpdates.BehaviorRules(root, manifest, {}, "lifecycle");
            }

            // ---------------- Display Rules ----------------
            if (manifest.widget_features.display) {
                // Position
                if (manifest.widget_features.display.position) window.WidgetUpdates.DisplayRules(root, manifest, {}, "position");

                // Size / Scaling
                if (manifest.widget_features.display.size) window.WidgetUpdates.DisplayRules(root, manifest, {}, "size");
            }

            // ---------------- Styling Rules ----------------
            if (manifest.widget_features.styling) {
                window.WidgetUpdates.StylingRules(root, manifest, {}, "useRootVariables");
                window.WidgetUpdates.StylingRules(root, manifest, {}, "font");
                window.WidgetUpdates.StylingRules(root, manifest, {}, "border");
                window.WidgetUpdates.StylingRules(root, manifest, {}, "background");
                window.WidgetUpdates.StylingRules(root, manifest, {}, "animation");
            }

            // ---------------- Unique Config ----------------
            if (manifest.unique_config) {
                for (const key in manifest.unique_config) {
                    if (manifest.unique_config.hasOwnProperty(key)) {
                        window.WidgetUpdates.UniqueConfig(root, manifest, { value: manifest.unique_config[key] }, key);
                    }
                }
            }
        }
    };

    return Update;
})();

window.WidgetUpdates = (() => {
    const WidgetUpdates = {
        BehaviorRules: function(root, manifest, config, type) {
            try {
                switch (type) {
                    // ---------------- Enabled ----------------
                    case "enabled":
                        if (manifest.widget_features?.behavior?.enabled === false) {
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
                        if (!root || !manifest?.widget_features?.display?.position) return;

                        const draggable = manifest.widget_features?.behavior?.draggable ?? false;
                        if (!draggable || root._draggableInitialized) return;

                        // Apply initial position & styling
                        root.style.position = "absolute";
                        root.style.left = manifest.widget_features?.display?.position.x + "px";
                        root.style.top = manifest.widget_features?.display?.position.y + "px";
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
                                await Update.manifest(manifest.name, "widget_features.display.position", { x, y });
                            }, 500);
                        });
                        root._draggableInitialized = true;
                        break;

                    // ---------------- Click-Through ----------------
                    case "clickThrough":
                        if (!root || manifest.widget_features?.behavior?.clickThrough === undefined) return;
                        root.style.pointerEvents = manifest.widget_features?.behavior.clickThrough ? "none" : "auto";
                        value = root.style.pointerEvents

                        break;

                    // ---------------- Focusable ----------------
                    case "focusable":
                        if (!root || manifest.widget_features?.behavior?.focusable === undefined) return;
                        if (manifest.widget_features?.behavior?.focusable) {
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
                        if (!root || !manifest.widget_features?.behavior?.lifecycle) return;

                        const hooks = manifest.widget_features?.behavior?.lifecycle;

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
                if (!root || !manifest?.widget_features?.display) return;

                switch (type) {
                    // ---------------- Position ----------------
                    case "position": {
                        const pos = manifest.widget_features?.display?.position;
                        if (!pos) return;

                        root.style.position = "absolute";
                        root.style.left = pos.x + "px";
                        root.style.top = pos.y + "px";
                        root.style.zIndex = pos.zIndex ?? 0; // default to 0 if undefined
                        break;
                    }

                    // ---------------- Size / Scaling ----------------
                    case "size": {
                        const size = manifest.widget_features?.display?.size;
                        if (!size) return;

                        if (size.resizable) {
                            root.style.width = size.width + "px";
                            root.style.height = size.height + "px";
                            root.style.transform = `scale(${size.scale ?? 1})`;
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
                if (!root || !manifest?.widget_features?.styling) return;
                const styling = manifest?.widget_features?.styling;

                switch (type) {

                    // ---------------- Use Root CSS Variables ----------------
                    case "useRootVariables":
                        // Intentionally do not write to `:root` here. Widgets should only
                        // reference the canonical CSS variables (e.g. var(--font-family)).
                        // The Settings hub "Apply To Root" button is the single writer
                        // for global editable variables. This prevents a widget from
                        // clobbering global values when it re-renders.
                        break;
                        break;


                    // ---------------- Font ----------------
                    case "font":
                        if (styling.font) {
                            if (styling.useRootVariables) {
                                // Reference canonical variables from :root — do not write to :root here.
                                root.style.fontFamily = `var(--font-family)`;
                                root.style.fontSize = `var(--font-size)`;
                                root.style.color = `var(--font-color)`;
                            } else {
                                root.style.fontFamily = styling.font.family;
                                root.style.color = styling.font.color;
                                if (styling.font.widgetScaling && manifest?.widget_features?.display?.size) {
                                    const scale = manifest?.widget_features?.display?.size?.scale ?? 1;
                                    const baseFontSize = parseInt(styling.font.size) || 24;
                                    root.style.fontSize = (config.fontSizeScaling ? baseFontSize * scale : baseFontSize) + "px";
                                } else {
                                    root.style.fontSize = styling.font.size;
                                }
                            }
                        }
                        break;

                    // ---------------- Border ----------------
                    case "border":
                        if (styling.border) {
                            if (styling.useRootVariables) {
                                // Reference border values from :root
                                root.style.borderStyle = `var(--border-style)`;
                                root.style.borderWidth = `var(--border-width)`;
                                root.style.borderColor = `var(--border-color)`;
                                root.style.borderRadius = `var(--border-radius)`;
                            } else {
                                root.style.borderStyle = styling.border.style;
                                root.style.borderWidth = styling.border.width;
                                root.style.borderColor = styling.border.color;
                                root.style.borderRadius = styling.border.radius;
                            }
                        }
                        break;

                    // ---------------- Background ----------------
                    case "background":
                        if (styling.background) {
                            if (styling.useRootVariables) {
                                // Reference global background variables from :root
                                root.style.backgroundColor = `rgba(var(--bg-rgb), var(--bg-alpha))`;
                            } else {
                                const bgColor = styling.background.color || "#000000";
                                const alpha = styling.background.alpha ?? 1;
                                root.style.backgroundColor = `rgba(${hexToRgb(bgColor)}, ${alpha})`;
                            }
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
                let target = manifest?.unique_config;

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

    return WidgetUpdates;
})();

window.Utils = (() => {
    const activeChips = []; // keep track of active messages

    const Utils = {
        // New signature: optional widgetName helps reliably gate messages
        sendMessage: function(type, message, duration = 4, widgetName = null) {
            try {
                // Gate non-essential messages (debug, success, warn/warning)
                // so they only appear when the related widget has debug enabled
                // (`manifest.extra.debug.enabled`) or when a global `window.DEBUG_ALL`
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

                        if (!allowed && _manifestCandidate?.extra?.debug?.enabled) allowed = true;
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
                                if (manifest?.extra?.debug?.enabled) {
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
                const widgets = await apiFetch(`${BACKEND_URL}/api/widgets`).then(r => r.json());

                const loadScript = (src, name) => new Promise((resolve, reject) => {
                    const s = document.createElement("script");
                    s.src = src;
                    s.dataset.widget = name
                    s.onload = resolve;
                    s.onerror = reject;
                    document.body.appendChild(s);
                });

                for (const widgetEntry of widgets) {
                    // For each discovered widget, attempt to load the layer-specific manifest
                    let widget = widgetEntry;
                    try {
                        const layerManifest = await fetchLayeredManifest(widgetEntry.name);
                        if (layerManifest) widget = layerManifest;
                    } catch (e) {
                        // fall back to the discovered manifest
                    }
                    // Cache manifests in window.ActiveWidgets for other utilities to reference
                    try { 
                        if (widget && widget.name) {
                            window.ActiveWidgets[widget.name] = { manifest: widget }
                        } 
                    } catch (e) {}
                    if (!widget.widget_features?.behavior?.enabled) continue;

                    const basePath = `${BACKEND_URL}/api/widgets/${widget.name}/`;

                    /* ---------------- Inject CSS ---------------- */
                    if (widget.required_settings.files.css) {
                        const link = document.createElement("link");
                        link.rel = "stylesheet";
                        link.href = basePath + widget.required_settings.files.css;
                        document.head.appendChild(link);
                    }

                    /* ---------------- Inject HTML ---------------- */
                    let widgetRoot = null;
                    if (widget.required_settings.files.html) {
                        const html = await apiFetch(basePath + widget.required_settings.files.html).then(r => r.text());
                        const temp = document.createElement("div");
                        temp.innerHTML = html.trim();
                        widgetRoot = temp.firstElementChild;
                        widgetRoot.classList.add("widget-root");
                        widgetRoot.dataset.widget = widget.name;

                        container.appendChild(widgetRoot);
                    }

                    /* ---------------- Inject JS ---------------- */
                        if (widget.required_settings.files.js) {
                        if (Array.isArray(widget.required_settings.files.js)) {
                            for (const jsFile of widget.required_settings.files.js) {
                                await loadScript(basePath + jsFile, widget.name);
                            }
                        } else {
                            await loadScript(basePath + widget.required_settings.files.js, widget.name);
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
                        // Apply live manifest->DOM updates and attach settings button overlay
                        try {
                            if (widgetRoot) {
                                Update.widget(widgetRoot, widget);
                                Utils.attachSettingsButton(widget.name);
                            }
                        } catch (e) {
                            Utils.sendMessage('warn', `Post-load widget update failed for ${widget.name}: ${e}`, 4, widget.name);
                        }
                    }
                }

            } catch (e) {
                Utils.sendMessage("error", `applyDisplayRules failed: ${e}`)
            }
        },
        
        loadSettingsWidgets: async function(gridEl) {
            try {
                // Fetch all real widgets from the canonical Widgets folder (do not send X-Widget-Layer)
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

                    // For real widgets, clicking the box toggles enabled/disabled
                    if (!entry.special) {
                                // reflect initial state with CSS class
                                // Prefer the layer-local manifest when available; if no layer manifest exists
                                // the widget should be shown as disabled (even if canonical manifest has enabled=true).
                                let isEnabled = false;
                                try {
                                    const layerManifest = await fetchLayerManifestOnly(entry.name);
                                    if (layerManifest) {
                                        isEnabled = !!(layerManifest.widget_features?.behavior?.enabled ?? false);
                                        // cache the layer manifest for later use
                                        window.ActiveWidgets[entry.name] = { manifest: layerManifest };
                                    } else {
                                        // No layer manifest -> treat as disabled
                                        isEnabled = false;
                                        // still cache the canonical manifest for reference
                                        window.ActiveWidgets[entry.name] = { manifest: entry };
                                    }
                                } catch (e) {
                                    // fallback: be conservative and show disabled
                                    isEnabled = false;
                                    window.ActiveWidgets[entry.name] = { manifest: entry };
                                }
                                if (!isEnabled) box.classList.add('widget-box-disabled');
                        box.addEventListener('click', async (e) => {
                            e.stopPropagation();
                            try {
                                        const currentlyEnabled = !(box.classList.contains('widget-box-disabled'));
                                        const newState = !currentlyEnabled;
                                        // update UI immediately
                                        box.classList.toggle('widget-box-disabled', !newState);

                                        // Keep both shapes in sync for UI convenience
                                        entry.enabled = newState;
                                        if (entry.widget_features?.behavior) entry.widget_features.behavior.enabled = newState;

                                        try {
                                            // If running inside a preview with a known layer, call the explicit layer-enable API
                                            if (window.WIDGET_LAYER) {
                                                const layer = window.WIDGET_LAYER.toString().trim().toLowerCase();
                                                const url = `${BACKEND_URL}/api/layer/${layer}/widgets/${encodeURIComponent(entry.name)}/enable`;
                                                const r = await fetch(url, {
                                                    method: 'POST',
                                                    headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify({ enabled: newState })
                                                });
                                                if (!r.ok) throw new Error(`Enable API failed (status=${r.status})`);
                                                const updatedManifest = await r.json();
                                                // Load or remove from DOM based on new state using the returned manifest
                                                if (newState) {
                                                    await Utils.loadWidget(updatedManifest, document.getElementById('widget-container'));
                                                    window.ActiveWidgets[entry.name] = { manifest: updatedManifest };
                                                    // Ensure the settings button is attached even if widget init mutated the DOM
                                                    try { Utils.attachSettingsButton(entry.name); } catch (_) {}
                                                } else {
                                                    await Utils.deleteWidget(entry.name);
                                                }
                                            } else {
                                                // Fallback for non-preview contexts: patch manifest via Update.manifest
                                                if (newState) {
                                                    await Utils.loadWidget(entry, document.getElementById('widget-container'));
                                                } else {
                                                    await Utils.deleteWidget(entry.name);
                                                }
                                                await Update.manifest(entry.name, "widget_features.behavior.enabled", newState);
                                            }
                                        } catch (e) {
                                            // revert UI state on failure
                                            box.classList.toggle('widget-box-disabled', currentlyEnabled);
                                            entry.enabled = currentlyEnabled;
                                            if (entry.widget_features?.behavior) entry.widget_features.behavior.enabled = currentlyEnabled;
                                            throw e;
                                        }
                            } catch (err) {
                                Utils.sendMessage('error', `Failed toggling widget ${entry.name}: ${err}`, 4, entry.name);
                            }
                        });
                    }

                    // Action buttons for hub: Open (open overlay on widget) and Highlight (scroll/flash)
                    const actions = document.createElement('div');
                    actions.className = 'widget-actions';

                    if (entry.special && entry.modulePath) {
                        // For special modules, clicking the box opens the module view inside the hub
                        if (entry.modulePath === 'styling') {
                            box.addEventListener('click', async () => {
                                const container = document.getElementById('settings-panel-content');
                                container.style.display = 'block';
                                // Render global styling editor inside the hub
                                try {
                                    await SettingsRenderer.renderGlobalStyling(container);
                                } catch (err) {
                                    Utils.sendMessage('error', `Failed to render global styling: ${err}`, 4);
                                }
                                container.scrollTop = 0;
                            });
                        } else {
                            box.addEventListener("click", async () => {
                                const container = document.getElementById("settings-panel-content");
                                container.style.display = "block";
                                    const html = await apiFetch(`${BACKEND_URL}/api/widgets/settings/module/${entry.modulePath}/settings.html`).then(r => r.text());
                                container.innerHTML = html;
                                container.scrollTop = 0;
                                const closeButton = document.getElementById("settings-panel-content-close");
                                if (closeButton) closeButton.addEventListener("click", () => { container.style.display = "none"; });
                            });
                        }
                    } else {
                        // Regular widget actions
                        const openBtn = document.createElement('button');
                        openBtn.className = 'widget-action-open';
                        openBtn.textContent = 'Open';
                        openBtn.title = 'Open settings on widget';
                        openBtn.addEventListener('click', async (e) => {
                            e.stopPropagation();
                            try { await Utils.openWidgetSettings(entry.name); } catch (err) { Utils.sendMessage('error', `Cannot open settings for ${entry.name}: ${err}`, 4, entry.name); }
                        });

                        const highlightBtn = document.createElement('button');
                        highlightBtn.className = 'widget-action-highlight';
                        highlightBtn.textContent = 'Highlight';
                        highlightBtn.title = 'Scroll to and highlight widget';
                        highlightBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            try {
                                const rootEl = document.querySelector(`.widget-root[data-widget="${entry.name}"]`);
                                if (rootEl) {
                                    rootEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                    const prev = rootEl.style.boxShadow;
                                    rootEl.style.boxShadow = '0 0 0 4px rgba(255,255,0,0.9)';
                                    setTimeout(() => { rootEl.style.boxShadow = prev; }, 1200);
                                } else {
                                    Utils.sendMessage('warn', `Widget ${entry.name} not currently in DOM`, 3, entry.name);
                                }
                            } catch (err) {
                                Utils.sendMessage('error', `Highlight failed: ${err}`, 4, entry.name);
                            }
                        });

                        actions.appendChild(openBtn);
                        
                        // Root variables toggle button (per-widget)
                        const rootVarsBtn = document.createElement('button');
                        rootVarsBtn.className = 'widget-action-rootvars';
                        rootVarsBtn.textContent = 'Root Vars';
                        rootVarsBtn.title = 'Enable root variables for this widget';
                        rootVarsBtn.addEventListener('click', async (e) => {
                            e.stopPropagation();
                            try {
                                // toggle current value by reading active manifest if available
                                const manifest = window.ActiveWidgets?.[entry.name]?.manifest;
                                const current = manifest?.widget_features?.styling?.useRootVariables ?? false;
                                const newVal = !current;
                                await Update.manifest(entry.name, 'widget_features.styling.useRootVariables', newVal);
                                Utils.sendMessage('success', `${entry.name}: useRootVariables set to ${newVal}`, 3, entry.name);
                            } catch (err) {
                                Utils.sendMessage('error', `Failed to toggle root vars for ${entry.name}: ${err}`, 4, entry.name);
                            }
                        });
                        actions.appendChild(rootVarsBtn);
                        actions.appendChild(highlightBtn);
                    }

                    box.appendChild(actions);

                    if (gridEl) gridEl.appendChild(box);
                }

            } catch (e) {
                Utils.sendMessage("error", `Utils: loadSettingsWidgets failed: ${e}`)
            }
        },
        
        loadWidget: async function(widget, container = document.body) {
            if (widget?.extra?.debug?.enabled) {
                if (widget.widget_features.behavior?.enabled && widget.required_settings.files) {
                    // Case 1: widget exists, debug true, enabled, has manifest JSON
                    Utils.sendMessage("debug", `Widget "${widget.name}" is enabled. Creating...`, 30, widget);
                } else {
                    // Case 2: widget exists, debug true, but disabled or missing manifest
                    Utils.sendMessage("debug", `Widget "${widget.name}" is disabled or invalid. Skipping creation.`, 30, widget);
                }
            }


                // Ensure we are using the layer-specific manifest when available
                let manifest = widget;
                try {
                    if (!manifest || !manifest.widget_features) {
                        manifest = await fetchLayeredManifest(widget.name);
                    } else {
                        // attempt to refresh from layer manifest to pick up overrides
                        try { manifest = await fetchLayeredManifest(widget.name); } catch (_) {}
                    }
                } catch (e) {
                    // fallback to provided widget object
                    manifest = widget;
                }

                const basePath = `${BACKEND_URL}/api/widgets/${widget.name}/`;
            let widgetRoot = null;

            // If caller provided a root element, prefer that
            const existingRoot = container.querySelector && container.querySelector(`.widget-root[data-widget="${widget.name}"]`);
            if (existingRoot) {
                widgetRoot = existingRoot;
                // If we are re-using an existing root, ensure it's not marked deleted
                try { window._deletedWidgets.delete(widget.name); } catch (e) {}
            }

            // Load CSS (always safe to append; browser ignores duplicates but we could guard if needed)
            if (widget.required_settings.files.css) {
                const cssId = `widget-style-${widget.name}`;
                if (!document.querySelector(`link#${cssId}`)) {
                    const link = document.createElement("link");
                    link.id = cssId;
                    link.rel = "stylesheet";
                    link.href = basePath + widget.required_settings.files.css;
                    document.head.appendChild(link);
                }
            }

            // Load HTML only if root doesn't exist or is empty
            if (!widgetRoot || widgetRoot.children.length === 0) {
                    if (widget.required_settings.files.html) {
                    const html = await apiFetch(basePath + widget.required_settings.files.html).then(r => r.text());
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
            if (widget.required_settings.files.js && !scriptExists) {
                const loadScript = src => new Promise((resolve, reject) => {
                    const s = document.createElement("script");
                    s.src = src;
                    s.dataset.widget = widget.name;
                    s.onload = resolve;
                    s.onerror = reject;
                    document.body.appendChild(s);
                });

                if (Array.isArray(widget.required_settings.files.js)) {
                    for (const jsFile of widget.required_settings.files.js) {
                        await loadScript(basePath + jsFile);
                    }
                } else {
                    await loadScript(basePath + widget.required_settings.files.js);
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

        // Add a small settings button overlay to each widget root that opens
        // the settings panel built from `/widgets/<name>/Settings.json`.
        attachSettingsButton: function(widgetName) {
            try {
                const root = document.querySelector(`.widget-root[data-widget="${widgetName}"]`);
                if (!root) return;

                // Ensure only one settings button per root
                if (root.querySelector('.widget-settings-btn')) return;

                const btn = document.createElement('button');
                btn.className = 'widget-settings-btn';
                btn.textContent = '⋮';
                btn.title = 'Widget settings';
                Object.assign(btn.style, {
                    position: 'absolute',
                    right: '6px',
                    top: '6px',
                    width: '28px',
                    height: '28px',
                    borderRadius: '4px',
                    border: 'none',
                    background: 'rgba(0,0,0,0.35)',
                    color: '#fff',
                    cursor: 'pointer',
                    display: 'none',
                    zIndex: 1000,
                    pointerEvents: 'auto'
                });

                // Show on hover
                root.addEventListener('mouseenter', () => { btn.style.display = 'block'; });
                root.addEventListener('mouseleave', () => { btn.style.display = 'none'; });

                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    // open settings panel for this widget via helper
                    try {
                        await Utils.openWidgetSettings(widgetName);
                    } catch (err) {
                        Utils.sendMessage('error', `Failed to open settings for ${widgetName}: ${err}`, 4, widgetName);
                    }
                });

                root.style.position = root.style.position || 'absolute';
                root.appendChild(btn);
            } catch (e) {
                console.error('attachSettingsButton failed', e);
            }
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

        // Open the settings panel over a widget by name (reusable by hub and attach button)
        openWidgetSettings: async function(widgetName) {
            const root = document.querySelector(`.widget-root[data-widget="${widgetName}"]`);
            if (!root) throw new Error(`Widget root not found for ${widgetName}`);

            let panel = document.getElementById('settings-panel');
            if (!panel) {
                panel = document.createElement('div');
                panel.id = 'settings-panel';
                Object.assign(panel.style, {
                    position: 'fixed',
                    width: '360px',
                    minHeight: '300px',
                    maxHeight: '90vh',
                    overflow: 'auto',
                    background: '#111',
                    color: '#fff',
                    padding: '12px',
                    borderRadius: '8px',
                    boxShadow: '0 6px 24px rgba(0,0,0,0.6)',
                    zIndex: 100000,
                    transformOrigin: 'top left'
                });
                const close = document.createElement('button');
                close.textContent = '✕';
                Object.assign(close.style, { position: 'absolute', right: '8px', top: '8px', background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer' });
                close.addEventListener('click', () => panel.remove());
                const content = document.createElement('div');
                content.id = 'settings-panel-content';
                content.style.marginTop = '28px';
                panel.appendChild(close);
                panel.appendChild(content);
                document.body.appendChild(panel);
            }

            const contentEl = document.getElementById('settings-panel-content');
            if (contentEl) {
                // Helper: compute and apply position/size based on widget rect
                const applyPosition = () => {
                    try {
                        const rect = root.getBoundingClientRect();
                        const viewportW = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
                        const viewportH = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);

                        // Responsive width: between 280 and 600, prefer 90% of widget width
                        const preferredWidth = Math.round(rect.width * 0.9) || 360;
                        const desiredWidth = Math.min(600, Math.max(280, preferredWidth));

                        // Height scales with widget height but at least 300px, and not more than 90vh
                        const desiredHeight = Math.min(Math.round(viewportH * 0.9), Math.max(300, Math.round(rect.height * 0.9)));

                        let left = Math.round(rect.left + window.scrollX);
                        if (left + desiredWidth > viewportW - 10) {
                            left = Math.max(10, Math.round(rect.right + window.scrollX - desiredWidth));
                        }

                        let top = Math.round(rect.top + window.scrollY);
                        if (top + desiredHeight > viewportH - 10) {
                            top = Math.max(10, viewportH - desiredHeight - 10 + window.scrollY);
                        }

                        panel.style.left = `${left}px`;
                        panel.style.top = `${top}px`;
                        panel.style.width = `${desiredWidth}px`;
                        panel.style.height = `${desiredHeight}px`;
                    } catch (e) {
                        // fallback positioning
                        panel.style.right = '20px';
                        panel.style.top = '20px';
                        panel.style.minHeight = '300px';
                    }
                };

                // Add listeners to keep the panel positioned when the window scrolls/resizes
                if (!panel._widgetSettingsListenersAttached) {
                    const onWindowChange = () => {
                        try { applyPosition(); } catch (e) {}
                    };
                    window.addEventListener('resize', onWindowChange);
                    // Use capture to catch scroll events in nested scrollable containers as well
                    window.addEventListener('scroll', onWindowChange, true);
                    // store cleanup references
                    panel._widgetSettingsCleanup = () => {
                        window.removeEventListener('resize', onWindowChange);
                        window.removeEventListener('scroll', onWindowChange, true);
                        panel._widgetSettingsListenersAttached = false;
                    };
                    panel._widgetSettingsListenersAttached = true;
                }

                // Call applyPosition immediately and render
                try { applyPosition(); } catch (e) {}

                try {
                    await SettingsRenderer.renderWidgetSettings(widgetName, contentEl);
                } catch (err) {
                    Utils.sendMessage('error', `Failed to render settings for ${widgetName}: ${err}`, 4, widgetName);
                }

                // Ensure close button performs cleanup
                const closeBtn = panel.querySelector('button');
                if (closeBtn) {
                    // replace existing handler to perform cleanup when panel removed
                    closeBtn.onclick = () => {
                        try { if (panel._widgetSettingsCleanup) panel._widgetSettingsCleanup(); } catch (e) {}
                        panel.remove();
                    };
                }
            }
            return panel;
        },
    };

    // Flush any diagnostic messages queued before Utils was available
    try {
        if (window.__pendingMessages && Array.isArray(window.__pendingMessages)) {
            for (const m of window.__pendingMessages) {
                try { Utils.sendMessage(m.type, m.message, m.duration, m.widgetName); } catch (_) {}
            }
            window.__pendingMessages = [];
        }
    } catch (_) {}

    return Utils;
})();

window.SettingsRenderer = (() => {
    const renderWidgetSettings = async (widgetName, container) => {
        container.innerHTML = "";

        let manifest;
        try {
            manifest = await fetchLayeredManifest(widgetName);
        } catch (e) {
            Utils.sendMessage("error", `Failed to load manifest for widget "${widgetName}": ${e}`);
            return;
        }

        const debug = manifest.extra?.debug?.enabled;

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

        // Apply an update to the manifest using Update.manifest simplified signature
        async function applyUpdate(path, value) {
            if (debug) Utils.sendMessage("debug", `Updating widget "${widgetName}" - ${path}: ${value}`, 5, widgetName);
            try {
                await Update.manifest(widgetName, path, value);
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

        // Render a field according to a Settings.json descriptor
        function renderFieldFromDesc(desc) {
            // desc: { key: 'widget_features.styling.border.radius', label: 'Border Radius', type: 'number'|"color"|"text"|"boolean"|"select", options: [...] }
            const key = desc.key;
            const labelText = desc.label || key;
            const type = desc.type || 'text';
            const currentValue = getValueByPath(manifest, key);

            if (type === 'boolean') return toggle(labelText, !!currentValue, v => applyUpdate(key, v));

            if (type === 'number') {
                const el = document.createElement('input'); el.type = 'number'; el.value = currentValue ?? (desc.default ?? 0);
                el.onchange = () => applyUpdate(key, Number(el.value));
                return field(labelText, el);
            }

            if (type === 'color') {
                const el = document.createElement('input'); el.type = 'color'; el.value = currentValue || (desc.default || '#000000');
                el.onchange = () => applyUpdate(key, el.value);
                return field(labelText, el);
            }

            if (type === 'select') {
                const sel = document.createElement('select');
                for (const opt of (desc.options || [])) {
                    const o = document.createElement('option'); o.value = opt.value ?? opt; o.textContent = opt.label ?? opt.value ?? opt;
                    if (String(o.value) === String(currentValue)) o.selected = true;
                    sel.appendChild(o);
                }
                sel.onchange = () => applyUpdate(key, sel.value);
                return field(labelText, sel);
            }

            // fallback to text input
            const el = document.createElement('input'); el.type = 'text'; el.value = currentValue ?? (desc.default ?? '');
            el.onchange = () => applyUpdate(key, el.value);
            return field(labelText, el);
        }

        // Utility: get nested value by dot path
        function getValueByPath(obj, path) {
            if (!path) return undefined;
            const parts = path.split('.');
            let cur = obj;
            for (const p of parts) {
                if (cur == null) return undefined;
                cur = cur[p];
            }
            return cur;
        }

        // Try to load Settings.json from widget directory and render fields from it
        try {
            const settingsRes = await apiFetch(`${BACKEND_URL}/api/widgets/${encodeURIComponent(widgetName)}/Settings.json`);
            if (settingsRes.ok) {
                const settingsDesc = await settingsRes.json();
                // Expecting either an array of field descriptors or an object with fields array
                const fields = Array.isArray(settingsDesc) ? settingsDesc : (settingsDesc.fields || []);
                if (fields.length > 0) {
                    for (const f of fields) {
                        try {
                            const el = renderFieldFromDesc(f);
                            container.appendChild(el);
                        } catch (e) {
                            Utils.sendMessage('warn', `Failed to render field ${f.key} for ${widgetName}: ${e}`, 4, widgetName);
                        }
                    }
                    if (debug) Utils.sendMessage('debug', `Settings.json driven UI rendered for ${widgetName}`, 5, widgetName);
                    return { rendered: 'settings.json' };
                }
            }
        } catch (e) {
            if (debug) Utils.sendMessage('debug', `No Settings.json for ${widgetName} or failed to parse: ${e}`, 5, widgetName);
        }

        // -------------------- FALLBACK: render default UI if no Settings.json --------------------
        if (debug) Utils.sendMessage('debug', `Falling back to default settings UI for ${widgetName}`, 3, widgetName);

        // size (legacy)
        const sizeHeader = document.createElement("h3");
        sizeHeader.textContent = "Size";
        container.appendChild(sizeHeader);

        container.appendChild(field("Width", (() => {
            const inp = document.createElement("input"); inp.type="number"; inp.value = manifest.size?.width ?? 0; inp.onchange=()=>applyUpdate('widget_features.display.size.width',Number(inp.value)); return inp;
        })()));

        container.appendChild(field("Height", (() => {
            const inp = document.createElement("input"); inp.type="number"; inp.value = manifest.size?.height ?? 0; inp.onchange=()=>applyUpdate('widget_features.display.size.height',Number(inp.value)); return inp;
        })()));

        container.appendChild(field("Scale", (() => {
            const inp = document.createElement("input"); inp.type="number"; inp.step="0.1"; inp.value=manifest.size?.scale ?? 1; inp.onchange=()=>applyUpdate('widget_features.display.size.scale',Number(inp.value)); return inp;
        })()));

        // drag / click
        container.appendChild(toggle("Draggable", manifest.widget_features?.behavior?.draggable ?? false, v=>applyUpdate('widget_features.behavior.draggable',v)));
        container.appendChild(toggle("Click-Through", manifest.widget_features?.behavior?.clickThrough ?? false, v=>applyUpdate('widget_features.behavior.clickThrough',v)));

        // position
        const posHeader = document.createElement("h3");
        posHeader.textContent = "Position";
        container.appendChild(posHeader);

        container.appendChild(field("X", (() => { const inp=document.createElement("input"); inp.type="number"; inp.value=manifest.widget_features?.display?.position?.x ?? 0; inp.onchange=()=>applyUpdate('widget_features.display.position.x',Number(inp.value)); return inp;})()));
        container.appendChild(field("Y", (() => { const inp=document.createElement("input"); inp.type="number"; inp.value=manifest.widget_features?.display?.position?.y ?? 0; inp.onchange=()=>applyUpdate('widget_features.display.position.y',Number(inp.value)); return inp;})()));

        // config
        const cfgHeader = document.createElement("h3");
        cfgHeader.textContent = "Configuration";
        container.appendChild(cfgHeader);

        const cfgRoot = manifest.unique_config || {};
        for(const [k,v] of Object.entries(cfgRoot)) {
            // renderDynamicField behavior: choose control by value type
            if (typeof v === 'boolean') container.appendChild(toggle(k, v, val => applyUpdate(`unique_config.${k}`, val)));
            else if (typeof v === 'number') {
                const inp = document.createElement('input'); inp.type='number'; inp.value = v; inp.onchange = ()=>applyUpdate(`unique_config.${k}`, Number(inp.value)); container.appendChild(field(k, inp));
            } else if (typeof v === 'string' && v.startsWith('#')) {
                const inp = document.createElement('input'); inp.type='color'; inp.value = v; inp.onchange = ()=>applyUpdate(`unique_config.${k}`, inp.value); container.appendChild(field(k, inp));
            } else {
                const inp = document.createElement('input'); inp.type='text'; inp.value = v; inp.onchange = ()=>applyUpdate(`unique_config.${k}`, inp.value); container.appendChild(field(k, inp));
            }
        }

        if (debug) Utils.sendMessage("debug", `Settings UI rendered for widget "${widgetName}"`, 5, widgetName);
    }

    return { renderWidgetSettings };
})();

// Add a global styling renderer for the Settings hub
window.SettingsRenderer.renderGlobalStyling = async function(container) {
    container.innerHTML = '';
    // Load the settings descriptor for global styling
    try {
    const res = await apiFetch(`${BACKEND_URL}/api/widgets/settings/Settings.json`);
    if (!res.ok) throw new Error('Failed to load global settings descriptor');
    const desc = await res.json();
        const fields = Array.isArray(desc) ? desc : (desc.fields || []);

        const header = document.createElement('h2');
        header.textContent = 'General Styling';
        container.appendChild(header);

        // Button to apply current values to all widgets
        const applyAllRow = document.createElement('div');
        applyAllRow.style.display = 'flex';
        applyAllRow.style.gap = '8px';
        applyAllRow.style.marginBottom = '8px';

        const applyAllBtn = document.createElement('button');
        applyAllBtn.textContent = 'Apply To All Widgets';
        applyAllBtn.style.padding = '6px 10px';
        applyAllBtn.style.borderRadius = '6px';
        applyAllBtn.onclick = async () => {
            // collect current values from the form inputs
            const inputs = container.querySelectorAll('[data-setting-key]');
            const updates = [];
            inputs.forEach(inp => {
                const key = inp.dataset.settingKey;
                let value = inp.value;
                if (inp.type === 'checkbox') value = inp.checked;
                else if (inp.type === 'number') value = Number(inp.value);
                updates.push({ key, value });
            });
            // Apply each update to every active widget via Update.manifest
            const names = Object.keys(window.ActiveWidgets || {});
            for (const u of updates) {
                for (const name of names) {
                    try { await Update.manifest(name, u.key, u.value); } catch (e) { console.warn('ApplyToAll failed', e); }
                }
            }
            Utils.sendMessage('success', 'Applied settings to all widgets', 3);
        };

        // Button: enable root variables for all widgets
        const enableRootAllBtn = document.createElement('button');
        enableRootAllBtn.textContent = 'Enable Root Vars For All';
        enableRootAllBtn.style.padding = '6px 10px';
        enableRootAllBtn.style.borderRadius = '6px';
        enableRootAllBtn.onclick = async () => {
            const names = Object.keys(window.ActiveWidgets || {});
            for (const name of names) {
                try { await Update.manifest(name, 'widget_features.styling.useRootVariables', true); } catch (e) { console.warn('EnableRootAll failed', e); }
            }
            Utils.sendMessage('success', 'Enabled root variables for all widgets', 3);
        };

        // Add a button to apply current values to :root (make them editable globals)
        const applyRootBtn = document.createElement('button');
        applyRootBtn.textContent = 'Apply To Root (Make Editable)';
        applyRootBtn.style.padding = '6px 10px';
        applyRootBtn.style.borderRadius = '6px';
        applyRootBtn.onclick = async () => {
            const inputs = container.querySelectorAll('[data-setting-key]');
            for (const inp of inputs) {
                const key = inp.dataset.settingKey;
                let value = inp.value;
                if (inp.type === 'checkbox') value = inp.checked;
                else if (inp.type === 'number') value = Number(inp.value);

                // map descriptor key -> CSS var name
                switch (key) {
                    case 'widget_features.styling.font.family':
                        document.documentElement.style.setProperty('--font-family', value);
                        break;
                    case 'widget_features.styling.font.size':
                        document.documentElement.style.setProperty('--font-size', value);
                        break;
                    case 'widget_features.styling.font.color':
                        document.documentElement.style.setProperty('--font-color', value);
                        break;
                    case 'widget_features.styling.border.style':
                        document.documentElement.style.setProperty('--border-style', value);
                        break;
                    case 'widget_features.styling.border.width':
                        document.documentElement.style.setProperty('--border-width', value + (typeof value === 'number' ? 'px' : ''));
                        break;
                    case 'widget_features.styling.border.color':
                        document.documentElement.style.setProperty('--border-color', value);
                        break;
                    case 'widget_features.styling.border.radius':
                        document.documentElement.style.setProperty('--border-radius', value + (typeof value === 'number' ? 'px' : ''));
                        break;
                    case 'widget_features.styling.background.color':
                        // convert hex -> r,g,b
                        const rgb = (function(h){ h=h.replace(/^#/, ''); if (h.length===3) h=h.split('').map(c=>c+c).join(''); const i=parseInt(h,16); return `${(i>>16)&255}, ${(i>>8)&255}, ${i&255}`; })(value);
                        document.documentElement.style.setProperty('--bg-rgb', rgb);
                        break;
                    case 'widget_features.styling.background.alpha':
                        document.documentElement.style.setProperty('--bg-alpha', String(value));
                        break;
                    default:
                        // ignore other keys for root application
                        break;
                }
            }
            Utils.sendMessage('success', 'Applied values to :root (editable)', 3);
        };

        applyAllRow.appendChild(applyAllBtn);
        applyAllRow.appendChild(enableRootAllBtn);
        applyAllRow.appendChild(applyRootBtn);
        container.appendChild(applyAllRow);

        function fieldRow(labelText, inputEl) {
            const row = document.createElement('div');
            row.className = 'setting-row';
            const lbl = document.createElement('label'); lbl.textContent = labelText; lbl.style.display = 'block'; lbl.style.marginBottom = '4px';
            inputEl.style.marginBottom = '10px';
            row.appendChild(lbl);
            row.appendChild(inputEl);
            return row;
        }

        for (const f of fields) {
            const key = f.key;
            const label = f.label || key;
            let input;
            const sampleVal = getComputedStyle(document.documentElement).getPropertyValue(`--${key.replace(/\./g,'-')}`) || '';

            switch (f.type) {
                case 'boolean':
                    input = document.createElement('input'); input.type = 'checkbox'; input.checked = !!f.default; break;
                case 'number':
                    input = document.createElement('input'); input.type = 'number'; input.step = f.step ?? 1; input.value = f.default ?? 0; break;
                case 'color':
                    input = document.createElement('input'); input.type = 'color'; input.value = f.default || '#000000'; break;
                default:
                    input = document.createElement('input'); input.type = 'text'; input.value = f.default ?? '';
            }
            input.dataset.settingKey = key;

            const row = fieldRow(label, input);
            container.appendChild(row);
        }

        // small note
        const note = document.createElement('div'); note.style.fontSize = '12px'; note.style.opacity = '0.8'; note.textContent = 'Use "Apply To All Widgets" to push these values into every widget manifest.';
        container.appendChild(note);

    } catch (e) {
        Utils.sendMessage('error', `Failed to render global styling: ${e}`, 4);
    }
};

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

// Try to fetch a manifest from the layer-specific manifest URL first
// e.g. /overlay/<widget>/manifest.json, falling back to the API endpoint
async function fetchLayeredManifest(widgetName) {
    // Try layer path when available
    try {
        if (window.WIDGET_LAYER) {
            const layer = window.WIDGET_LAYER.toString().trim().toLowerCase();
            const layerUrl = `${BACKEND_URL}/${layer}/${encodeURIComponent(widgetName)}/manifest.json`;
            try {
                const r = await fetch(layerUrl);
                if (r.ok) return await r.json();
            } catch (e) {
                // ignore and fall back
            }
        }
    } catch (e) {
        // ignore
    }

    // Fallback to API manifest (this will include X-Widget-Layer header when available)
    const res = await apiFetch(`${BACKEND_URL}/api/widgets/${encodeURIComponent(widgetName)}`);
    if (!res.ok) throw new Error(`Failed to load manifest for "${widgetName}" (status=${res.status})`);
    return await res.json();
}

// Try to fetch only the layer-local manifest and return null if not present
async function fetchLayerManifestOnly(widgetName) {
    try {
        if (window.WIDGET_LAYER) {
            const layer = window.WIDGET_LAYER.toString().trim().toLowerCase();
            const layerUrl = `${BACKEND_URL}/${layer}/${encodeURIComponent(widgetName)}/manifest.json`;
            try {
                const r = await fetch(layerUrl);
                if (r.ok) return await r.json();
                if (r.status === 404) return null;
            } catch (e) {
                return null;
            }
        }
    } catch (e) {
        return null;
    }
    return null;
}