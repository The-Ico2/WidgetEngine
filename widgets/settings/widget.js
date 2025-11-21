// settings widget.js

(function () {

    let root, grid;
    let manifest, config;

    function initWidget(manifestData) {
        manifest = manifestData;
        config = manifest.config || {};

        root = document.querySelector(".settings-root");
        if (!root) throw new Error("Widget root not found");
        
        grid = root.querySelector("#widget-grid");
        if (!grid) throw new Error("Widget grid not found");

        Update.widget(root, manifest);

        // Use Utils to load all widgets dynamically
        window.Utils.loadSettingsWidgets(grid, openWidgetSettings);
    }

    /* ---------------------------
       Open widget-specific settings
    --------------------------- */

    async function openWidgetSettings(widgetName) {
        if (widgetName === "Keybinds") {
            const { renderKeybindMenu } = await import('./extra/Keybinds/renderMenu.js');
            const container = document.getElementById("settings-panel-content");
            renderKeybindMenu(container);
        }
    }


    function openWidgetSettings(widgetName) {
        if (widgetName === "Root Variables") {
            console.log("Open Root Variables panel");
        } else if (widgetName === "General Settings") {
            console.log("Open General Settings panel");
        } else {
            console.log(`Open settings for widget: ${widgetName}`);
        }
    }

    function update() {
        // No periodic update needed for settings widget
    }

    window.WidgetInit = initWidget;
})();

