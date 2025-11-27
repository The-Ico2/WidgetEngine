// clock widget.js

(function () {
    let root, timeEl, dateEl;
    let manifest, config;

    function initWidget(manifestData, rootEl) {
        manifest = manifestData;
        // Prefer explicit `config`, then nested `unique_config.style` (common),
        // then `unique_config` as a fallback.
        config = manifest.unique_config.clock;

        Utils.sendMessage("debug", `Initializing Clock widget "${manifest.name}"`, 10, manifest.name);

        // Prefer the provided root element (passed by loader). Fallback to querySelector.
        root = rootEl || document.querySelector(".clock-root");
        if (!root) {
            Utils.sendMessage("error", `[widget:${manifest?.name ?? 'clock'}] Clock root element not found`, 4, manifest?.name);
            throw new Error("Clock root element not found");
        }
        Utils.sendMessage("debug", `[widget:${manifest.name}] Clock root element found`, 5, manifest.name);

        timeEl = root.querySelector(".clock-time") || document.getElementById("clock-time");
        if (!timeEl) {
            Utils.sendMessage("error", `[widget:${manifest.name}] Time element not found in clock widget`, 4, manifest.name);
            throw new Error("Time element not found in clock widget");
        }

        dateEl = root.querySelector(".clock-date") || document.getElementById("clock-date");
        if (!dateEl) {
            Utils.sendMessage("error", `[widget:${manifest.name}] Date element not found in clock widget`, 4, manifest.name);
            throw new Error("Date element not found in clock widget");
        }

        Utils.sendMessage("debug", `[widget:${manifest.name}] Time and Date elements successfully located`, 5, manifest.name);

        try {
            Update.widget(root, manifest);
            Utils.sendMessage("debug", `[widget:${manifest.name}] Clock widget updated with manifest data`, 5, manifest.name);
        } catch (e) {
            Utils.sendMessage("error", `[widget:${manifest.name}] Failed to update widget: ${e}`, 4, manifest.name);
            Utils.sendMessage && Utils.sendMessage('error', `[widget:${manifest?.name}] ${e}`, 4, manifest?.name);
        }

        // updates clock time and date every second
        update();
        setInterval(update, 1000);
        Utils.sendMessage("debug", `[widget:${manifest.name}] Clock update interval started`, 5, manifest.name);
    }

    /* ------------------------------ CLOCK UPDATE ------------------------------ */
    function update() {
        try {
            const now = new Date();
            let hours = now.getHours();
            const minutes = String(now.getMinutes()).padStart(2, "0");
            const seconds = String(now.getSeconds()).padStart(2, "0");

            if (!config.use24HourFormat) hours = (hours % 12) || 12;
            hours = String(hours).padStart(2, "0");

            timeEl.textContent = config.showSeconds ? `${hours}:${minutes}:${seconds}` : `${hours}:${minutes}`;

            if (config.showDate ?? true) dateEl.textContent = Utils.formatDate(now, config);

        } catch (e) {
            Utils.sendMessage("error", `Clock update failed: ${e}`, 4, manifest?.name);
        }
    }

    /* ------------------------------ EXPORT ------------------------------ */
    (function(){
        // Register into per-widget registry for robust init handling
        try {
            window.WidgetInitRegistry = window.WidgetInitRegistry || {};
            window.WidgetInitRegistry['Clock'] = initWidget;
            window.WidgetInitRegistry['clock'] = initWidget;
        } catch(e) {}
        // Keep legacy global for compatibility
        try { window.WidgetInit = initWidget; } catch(e) {}
    })();
})();