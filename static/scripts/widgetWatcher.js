// widgetWatcher.js

const savedManifests = {};

function ensureWidgetRoot(widget) {
    const container = document.getElementById('widget-container');
    if (!container) {
        console.error('Widget container not found');
        return null;
    }

    return container.querySelector(`.widget-root[data-widget="${widget.name}"]`);
}

async function watchWidgets() {
    try {
        const res = await fetch(`${BACKEND_URL}/api/widgets`);
        if (!res.ok) throw new Error("Failed to fetch widgets");
        const widgets = await res.json();

        for (const widget of widgets) {
            const saved = savedManifests[widget.name];

            // If identical, skip
            if (saved && JSON.stringify(saved) === JSON.stringify(widget)) {
                continue;
            }

            // save new manifest snapshot
            savedManifests[widget.name] = widget;

            const root = ensureWidgetRoot(widget);

            if (widget.enabled) {
                // If root exists and script already loaded, just apply update.
                const scriptExists = !!document.querySelector(`script[data-widget="${widget.name}"]`);

                // Load or update the widget via the single utility function
                // Utils.loadWidget is idempotent now — it will not double-inject scripts or HTML
                const widgetRoot = await Utils.loadWidget(widget, document.getElementById('widget-container'));

                // If widget already loaded (script already present), apply manifest update directly
                if (scriptExists && widgetRoot) {
                    Update.widget(widgetRoot, widget);
                }
            } else {
                // widget disabled → remove root if present
                Utils.deleteWidget(widget.name);
            }
        }
    } catch (err) {
        console.error("widgetWatcher error:", err);
    }

    setTimeout(watchWidgets, 1000); // check every second
}
