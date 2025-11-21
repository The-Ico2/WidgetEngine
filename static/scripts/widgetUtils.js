// widgetUtils.js

window.Update = (() => {
    const Update = {
        /**
         * Update manifest and push changes to backend.
         * Handles nested keys via dot notation.
         * @param {HTMLElement} root - widget root element
         * @param {Object} manifest - widget manifest object
         * @param {string} widget - widget name
         * @param {string} setting - setting key (supports nested: "config.fontColor")
         * @param {*} value - new value
         */
        // ALL API CALLS MUST GO THROUGH UPDATE.MANIFEST
        manifest: async function(root, manifest, widget, setting, value) {
            if (!manifest || !root || !widget || !setting) return;

            // Apply nested update to manifest
            const keys = setting.split(".");
            let target = manifest;
            for (let i = 0; i < keys.length - 1; i++) {
                if (!(keys[i] in target)) target[keys[i]] = {};
                target = target[keys[i]];
            }
            target[keys[keys.length - 1]] = value;

            // Apply update to widget live
            this.widget(root, manifest);

            // Prepare body for PATCH
            let bodyData;
            if (setting === "position" && typeof value === "object" && "x" in value && "y" in value) {
                bodyData = { x: value.x, y: value.y };
            } else {
                bodyData = { value };
            }

            // Push change to backend
            try {
                console.log(`Attempting to update '${widget} Widget' '${setting}' to`, value);
                const res = await fetch(`${BACKEND_URL}/api/widgets/${encodeURIComponent(widget)}/${encodeURIComponent(setting)}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(bodyData)
                });
                if (res.ok) console.log(`Successfully updated '${widget} Widget' '${setting}'`);
                else console.error(`Failed to update '${widget} Widget' '${setting}':`, await res.text());
            } catch (err) {
                console.error(`Error updating '${widget}' '${setting}':`, err);
            }
        },

        /**
         * Apply manifest to widget DOM live.
         * Works for any setting in manifest. Calls Utils.apply* for standard updates.
         * @param {HTMLElement} root - widget root element
         * @param {Object} manifest - widget manifest object
         */
        widget: function(root, manifest) {
            if (!root || !manifest) return;

            // ENABLED STATE: create/remove DOM element
            if ("enabled" in manifest) {
                if (manifest.enabled) {
                    if (!root.parentElement) document.body.appendChild(root);
                    root.style.display = "block";
                } else {
                    if (root.parentElement) root.remove();
                }
            }

            // POSITION: runtime position (one-off)
            if (manifest.position) {
                window.Utils.applyPosition(root, manifest);
            }

            // CLICK-THROUGH
            if ("click-through" in manifest) {
                root.style.pointerEvents = manifest["click-through"] ? "none" : "auto";
            }

            // POSITION + DRAGGABLE combined
            if ("position" in manifest) {
                // Always apply runtime position
                // If draggable, also enable dragging with delayed update
                window.Utils.applyDraggablePosition(root, manifest, { draggable: !!manifest.draggable });
            }

            // SIZE & SCALING
            if (manifest.size || manifest.config) {
                window.Utils.applySizeAndScaling(root, manifest, manifest.config || {});
            }

            // VISUAL CONFIG
            if (manifest.config) {
                window.Utils.applyVisualConfig(root, manifest.config, manifest);
            }

            // FUTURE-PROOF: additional settings can be added and handled here as needed
        }
    };

    return Update;
})();

window.SettingsRenderer = (() => {

    const renderWidgetSettings = async (widgetName, container) => {
        try {
            // Fetch manifest to get the settings.html path
            const res = await fetch(`${BACKEND_URL}/api/widgets/${widgetName}`);
            if (!res.ok) throw new Error(`Failed to load manifest for ${widgetName}`);
            const manifest = await res.json();

            if (!manifest.files || !manifest.files.settings) {
                container.innerHTML = `<p>No settings page available for ${widgetName}</p>`;
                return;
            }

            container.innerHTML = `<h2>${manifest.label || manifest.name} Settings</h2>`;

            // Fetch the widget's settings.html
            const htmlRes = await fetch(`${BACKEND_URL}/widgets/${widgetName}/${manifest.files.settings}`);
            if (!htmlRes.ok) throw new Error(`Failed to load settings.html for ${widgetName}`);
            const html = await htmlRes.text();

            const settingsContainer = document.createElement("div");
            settingsContainer.innerHTML = html;
            container.appendChild(settingsContainer);

        } catch (err) {
            console.error(`Error rendering settings for widget ${widgetName}:`, err);
            container.innerHTML = `<p>Error loading settings for ${widgetName}</p>`;
        }
    };

    return { renderWidgetSettings };
})();


window.Utils = (() => {
    const Utils = {
        /* ------------------------------ POSITION ------------------------------ */
        applyPosition: function(root, manifest) {
            try {
                const pos = manifest.position || { x: 40, y: 40 };
                root.style.left = pos.x + "px";
                root.style.top = pos.y + "px";
                root.style.position = "absolute";
            } catch (e) {
                console.error("applyPosition failed", e);
            }
        },

        /* ------------------------------ SIZE & SCALING ------------------------------ */
        applySizeAndScaling: function(root, manifest, config) {
            try {
                const s = manifest.size || { width: 200, height: 100, scale: 1.0 };
                root.style.width = s.width + "px";
                root.style.height = s.height + "px";
                root.style.transform = `scale(${s.scale})`;

                const fontSize = config.fontSize || 24;
                root.style.fontSize = config.fontSizeScaling ? fontSize * s.scale + "px" : fontSize + "px";
            } catch(e) {
                console.error("applySizeAndScaling failed", e);
            }
        },

        /* ------------------------------ VISUAL CONFIG ------------------------------ */
        applyVisualConfig: function(root, config, manifest) {
            try {
                if (config.useRootVariables) {
                    root.style.color = `var(--font=color, ${config.fontColor || "#FFF"})`;
                    root.style.fontFamily = `var(--font-family, ${config.font || "Arial"})`;
                } else {
                    root.style.color = config.fontColor || "#FFF";
                    root.style.fontFamily = config.font || "Arial";
                }

                root.style.backgroundColor = config.backgroundColor || "rgba(0,0,0,0.5)";
            } catch(e) {
                console.error("applyVisualConfig failed", e);
            }
        },

        /* ------------------------------ POINTER EVENTS ------------------------------ */
        applyPointerRules: function(root, manifest) {
            try {
                root.style.pointerEvents = manifest["click-through"] ? "none" : "auto";
            } catch(e) {
                console.error("applyPointerRules failed", e);
            }
        },

        /* ------------------------------ DRAGGING & POSITIONING ------------------------------ */
        applyDraggablePosition: function(root, manifest, options = { draggable: true }) {
            if (!root || !manifest || !manifest.position) return;

            // Always apply position
            root.style.left = manifest.position.x + "px";
            root.style.top = manifest.position.y + "px";
            root.style.position = "absolute";

            if (!options.draggable) return; // exit if only applying position

            if (root._draggableInitialized) return;

            let offsetX = 0, offsetY = 0, dragging = false;
            let timeoutId = null;

            root.addEventListener("mousedown", e => {
                dragging = true;
                offsetX = e.clientX - root.offsetLeft;
                offsetY = e.clientY - root.offsetTop;
                if (timeoutId) clearTimeout(timeoutId); // reset patch timer
            });

            document.addEventListener("mousemove", e => {
                if (!dragging) return;
                root.style.left = e.clientX - offsetX + "px";
                root.style.top = e.clientY - offsetY + "px";
            });

            document.addEventListener("mouseup", async () => {
                if (!dragging) return;
                dragging = false;

                // Delay patching to manifest by 5s
                if (timeoutId) clearTimeout(timeoutId);
                timeoutId = setTimeout(async () => {
                    const x = parseInt(root.style.left);
                    const y = parseInt(root.style.top);

                    Update.manifest(root, manifest, manifest.name, "position", { x, y });
                }, 5000);
            });

            root._draggableInitialized = true;
        },

        /* ------------------------------ ENABLED STATE ------------------------------ */
        applyEnabled: function(root, manifest, containerEl) {
            if (manifest.enabled === false) {
                // Remove element if exists
                if (root && root.parentNode) root.remove();
                return null;
            }

            // Enabled: create element if not exists
            if (!root) {
                root = document.createElement("div");
                root.className = "widget-root";
                root.dataset.widget = manifest.name;

                // Append to container
                if (containerEl) containerEl.appendChild(root);
            }

            return root; // return the created/found root for further updates
        },

        /* ------------------------------ LOAD ALL ENABLED WIDGETS INTO DOM ------------------------------ */
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

            } catch (err) {
                console.error("Utils: loadDOMWidgets failed", err);
            }
        },
        
        /* ------------------------------ LOAD WIDGETS FOR SETTINGS PANEL ------------------------------ */
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

                            await Update.manifest(null, entry, entry.name, "enabled", newState);
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
                            console.warn(`No settings found for ${entry.name}`);
                        }
                    });

                    if (gridEl) gridEl.appendChild(box);
                }

            } catch (err) {
                console.error("Utils: loadSettingsWidgets failed", err);
            }
        },
        
        /* ------------------------------ LOAD SINGLE WIDGET ------------------------------ */
        loadWidget: async function(widget, container = document.body) {
            if (!widget || !widget.enabled) return null;

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
            try {
                if (window.WidgetInit && (scriptExists || didLoadScript)) {
                    // some widgets expect to be initialized only once; it's OK to call again if idempotent
                    window.WidgetInit(widget, widgetRoot);
                } else if (!widget.files.js && window.WidgetInit) {
                    // widgets without JS but that rely on a shared WidgetInit — call it
                    window.WidgetInit(widget, widgetRoot);
                }
            } catch (e) {
                console.error("Error calling WidgetInit:", e);
            }

            return widgetRoot;
        },


        /* ------------------------------ DELETE SINGLE WIDGET ------------------------------ */
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

        /* ------------------------------ DATE FORMATTER ------------------------------ */
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
                console.error("formatDate failed", e);
                return "00/00/0000";
            }
        },

        /* ------------------------------ WAIT FOR ROOT ------------------------------ */
        waitForRoot: function(selector, callback, retries = 10, delay = 50) {
            const root = document.querySelector(selector);
            if (root) {
                callback(root);
            } else if (retries > 0) {
                setTimeout(() => Utils.waitForRoot(selector, callback, retries - 1, delay), delay);
            } else {
                console.error("root element not found after waiting");
            }
        },
    };

    return Utils;
})();