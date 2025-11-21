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
        window.Utils.loadSettingsWidgets(grid);
    }

    window.WidgetInit = initWidget;
})();

