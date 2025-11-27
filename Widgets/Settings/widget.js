// settings widget.js

(function () {

    let root, grid;
    let manifest, config;

    function initWidget(manifestData, rootEl) {
        manifest = manifestData;
        // config = manifest.unique_config.settings;
        const debug = manifest.extra?.debug.enabled;

        if (debug) Utils.sendMessage("debug", `Initializing Settings widget "${manifest.name}"`, 10, manifest.name);

        // Prefer provided root from loader, otherwise find by selector
        root = rootEl || document.querySelector(".settings-root");
        if (!root) {
            Utils.sendMessage("error", `[widget:${manifest?.name ?? 'settings'}] Settings widget root element not found`, 4, manifest?.name);
            throw new Error("Widget root not found");
        }
        if (debug) Utils.sendMessage("debug", `[widget:${manifest.name}] Settings root element found`, 5, manifest.name);

        grid = root.querySelector("#widget-grid");
        if (!grid) {
            // Debug info to help trace why the expected element is missing
            Utils.sendMessage && Utils.sendMessage('error', `[widget:${manifest?.name}] Settings root element (innerHTML): ${root ? root.innerHTML : '<no root>'}`, 6, manifest?.name);
            Utils.sendMessage("error", `[widget:${manifest.name}] Settings widget grid element not found`, 4, manifest.name);
            throw new Error("Widget grid not found");
        }
        if (debug) Utils.sendMessage("debug", `[widget:${manifest.name}] Widget grid element found`, 5, manifest.name);

        try {
            Update.widget(root, manifest);
            if (debug) Utils.sendMessage("debug", `[widget:${manifest.name}] Settings widget updated with manifest data`, 5, manifest.name);
        } catch (e) {
            Utils.sendMessage("error", `[widget:${manifest.name}] Failed to update Settings widget: ${e}`, 4, manifest.name);
            Utils.sendMessage && Utils.sendMessage('error', `[widget:${manifest?.name}] ${e}`, 4, manifest?.name);
        }

        try {
            window.Utils.loadSettingsWidgets(grid);
            if (debug) Utils.sendMessage("debug", `[widget:${manifest.name}] Settings widgets dynamically loaded into grid`, 5, manifest.name);
        } catch (e) {
            Utils.sendMessage("error", `[widget:${manifest.name}] Failed to load settings widgets dynamically: ${e}`, 4, manifest.name);
            Utils.sendMessage && Utils.sendMessage('error', `[widget:${manifest?.name}] ${e}`, 4, manifest?.name);
        }
    }

    if (manifest?.extra?.debug) {
        Utils.sendMessage("debug", `[widget:${manifest.name}] Settings widget script loaded`, 3, manifest.name);
    }

    (function(){
        try {
            window.WidgetInitRegistry = window.WidgetInitRegistry || {};
            window.WidgetInitRegistry['settings'] = initWidget;
        } catch(e) {}
        try { window.WidgetInit = initWidget; } catch(e) {}
    })();
})();