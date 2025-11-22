// settings widget.js

(function () {

    let root, grid;
    let manifest, config;

    function initWidget(manifestData) {
        manifest = manifestData;
        config = manifest.config || {};
        const debug = manifest.extra?.debug;

        if (debug) Utils.sendMessage("debug", `Initializing Settings widget "${manifest.name}"`, 10);

        root = document.querySelector(".settings-root");
        if (!root) {
            Utils.sendMessage("error", "Settings widget root element not found");
            throw new Error("Widget root not found");
        }
        if (debug) Utils.sendMessage("debug", "Settings root element found", 5);

        grid = root.querySelector("#widget-grid");
        if (!grid) {
            Utils.sendMessage("error", "Settings widget grid element not found");
            throw new Error("Widget grid not found");
        }
        if (debug) Utils.sendMessage("debug", "Widget grid element found", 5);

        try {
            Update.widget(root, manifest);
            if (debug) Utils.sendMessage("debug", "Settings widget updated with manifest data", 5);
        } catch (e) {
            Utils.sendMessage("error", `Failed to update Settings widget: ${e}`);
            console.error(e);
        }

        try {
            window.Utils.loadSettingsWidgets(grid);
            if (debug) Utils.sendMessage("debug", "Settings widgets dynamically loaded into grid", 5);
        } catch (e) {
            Utils.sendMessage("error", `Failed to load settings widgets dynamically: ${e}`);
            console.error(e);
        }
    }

    if (manifest?.extra?.debug) {
        Utils.sendMessage("debug", "Settings widget script loaded", 3);
    }

    window.WidgetInit = initWidget;
})();