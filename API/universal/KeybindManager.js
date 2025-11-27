// keybindManager.js

window.KeybindManager = (() => {
    const keybinds = {}; // runtime callbacks
    let savedKeybinds = {}; // persisted { "Ctrl+Shift+S": "Settings" }

    const normalizeKey = e => {
        let keys = [];
        if (e.ctrlKey) keys.push("Ctrl");
        if (e.altKey) keys.push("Alt");
        if (e.shiftKey) keys.push("Shift");
        keys.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
        return keys.join("+");
    };

    const onKeyDown = e => {
        const key = normalizeKey(e);
        if (keybinds[key]) {
            e.preventDefault();
            keybinds[key]();
        }
    };

    document.addEventListener("keydown", onKeyDown);

    // Load keybinds from JSON (localStorage or backend)
    const loadSaved = async () => {
        try {
            const stored = localStorage.getItem("keybinds");
            if (stored) {
                savedKeybinds = JSON.parse(stored);
                for (const combo in savedKeybinds) {
                    bind(savedKeybinds[combo], combo);
                }
            }
        } catch (e) { Utils.sendMessage && Utils.sendMessage('error', `Failed to load keybinds: ${e}`, 4); }
    };

    // Persist keybinds to JSON
    const save = () => {
        localStorage.setItem("keybinds", JSON.stringify(savedKeybinds));
    };

    const bind = (widgetName, combo) => {
        savedKeybinds[combo] = widgetName;
        KeybindManager.add(combo, async () => {
            const res = await fetch(`${BACKEND_URL}/api/widgets`);
            const widgets = await res.json();
            const widget = widgets.find(w => w.name === widgetName);
            if (!widget) return;

            if (!widget.enabled) {
                widget.enabled = true;
                await Update.manifest(null, widget, widgetName, "enabled", true);
            }

            await Utils.loadWidget(widget, document.getElementById('widget-container'));
        });
        save();
    };

    const unbind = combo => {
        delete savedKeybinds[combo];
        KeybindManager.remove(combo);
        save();
    };

    loadSaved(); // initialize

    return {
        add: (combo, callback) => { keybinds[combo] = callback; },
        remove: combo => { delete keybinds[combo]; },
        clear: () => { for (const k in keybinds) delete keybinds[k]; savedKeybinds = {}; save(); },
        getAll: () => ({ ...savedKeybinds }),
        bind,
        unbind
    };
})();