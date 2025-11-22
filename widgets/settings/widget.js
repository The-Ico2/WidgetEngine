// settings widget.js

(function () {

    let root, grid;
    let manifest, config;

    function initWidget(manifestData) {
        manifest = manifestData;
        config = manifest.config || {};
        const debug = manifest.extra?.debug;

        if (debug) Utils.sendMessage("debug", `Initializing Settings widget "${manifest.name}"`, 10, manifest.name);

        root = document.querySelector(".settings-root");
        if (!root) {
            Utils.sendMessage("error", `[widget:${manifest?.name ?? 'settings'}] Settings widget root element not found`, 4, manifest?.name);
            throw new Error("Widget root not found");
        }
        if (debug) Utils.sendMessage("debug", `[widget:${manifest.name}] Settings root element found`, 5, manifest.name);

        grid = root.querySelector("#widget-grid");
        if (!grid) {
            Utils.sendMessage("error", `[widget:${manifest.name}] Settings widget grid element not found`, 4, manifest.name);
            throw new Error("Widget grid not found");
        }
        if (debug) Utils.sendMessage("debug", `[widget:${manifest.name}] Widget grid element found`, 5, manifest.name);

        try {
            Update.widget(root, manifest);
            if (debug) Utils.sendMessage("debug", `[widget:${manifest.name}] Settings widget updated with manifest data`, 5, manifest.name);
        } catch (e) {
            Utils.sendMessage("error", `[widget:${manifest.name}] Failed to update Settings widget: ${e}`, 4, manifest.name);
            console.error(e);
        }

        try {
            window.Utils.loadSettingsWidgets(grid);
            if (debug) Utils.sendMessage("debug", `[widget:${manifest.name}] Settings widgets dynamically loaded into grid`, 5, manifest.name);
        } catch (e) {
            Utils.sendMessage("error", `[widget:${manifest.name}] Failed to load settings widgets dynamically: ${e}`, 4, manifest.name);
            console.error(e);
        }
    }

    if (manifest?.extra?.debug) {
        Utils.sendMessage("debug", `[widget:${manifest.name}] Settings widget script loaded`, 3, manifest.name);
    }

    window.WidgetInit = initWidget;
})();