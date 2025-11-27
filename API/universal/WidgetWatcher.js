// widgetWatcher.js

const savedManifests = {};

function ensureWidgetRoot(widget) {
    const container = document.getElementById('widget-container');
    if (!container) {
        Utils.sendMessage('error', `Widget container not found`)
        return null;
    }

    return container.querySelector(`.widget-root[data-widget="${widget.name}"]`);
}

async function watchWidgets() {
    try {
        const res = await apiFetch(`${BACKEND_URL}/api/widgets`);
        if (!res.ok) throw new Error("Failed to fetch widgets");
        const widgets = await res.json();

        for (const widgetEntry of widgets) {
            // Prefer layer-specific manifest when available
            let widget = widgetEntry;
            try { widget = await fetchLayeredManifest(widgetEntry.name); } catch (_) { widget = widgetEntry; }

            const saved = savedManifests[widget.name];

            // Skip if identical
            if (saved && JSON.stringify(saved) === JSON.stringify(widget)) continue;

            // Save new snapshot
            savedManifests[widget.name] = widget;

            if (widget.widget_features.behavior.enabled) {
                // Load widget into container (idempotent)
                await Utils.loadWidget(widget, document.getElementById('widget-container'));
            } else {
                Utils.deleteWidget(widget.name);
            }
        }
    } catch (e) {
        Utils.sendMessage('error', `widgetWatcher error: ${e}`);
    }

    setTimeout(watchWidgets, 1000); // check every second
}