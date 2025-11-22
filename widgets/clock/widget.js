// clock widget.js

(function () {
    let root, timeEl, dateEl;
    let manifest, config;

    function initWidget(manifestData) {
        manifest = manifestData;
        config = manifest.config || {};
        const debug = manifest.extra?.debug;

        if (debug) Utils.sendMessage("debug", `Initializing Clock widget "${manifest.name}"`, 10);

        root = document.querySelector(".clock-root");
        if (!root) {
            Utils.sendMessage("error", "Clock root element not found");
            throw new Error("Clock root element not found");
        }
        if (debug) Utils.sendMessage("debug", "Clock root element found", 5);

        timeEl = root.querySelector(".clock-time");
        if (!timeEl) {
            Utils.sendMessage("error", "Time element not found in clock widget");
            throw new Error("Time element not found in clock widget");
        }

        dateEl = root.querySelector(".clock-date");
        if (!dateEl) {
            Utils.sendMessage("error", "Date element not found in clock widget");
            throw new Error("Date element not found in clock widget");
        }

        if (debug) Utils.sendMessage("debug", "Time and Date elements successfully located", 5);

        try {
            Update.widget(root, manifest);
            if (debug) Utils.sendMessage("debug", "Clock widget updated with manifest data", 5);
        } catch (e) {
            Utils.sendMessage("error", `Failed to update widget: ${e}`);
            console.error(e);
        }

        // updates clock time and date every second
        update();
        setInterval(update, 1000);
        if (debug) Utils.sendMessage("debug", "Clock update interval started", 5);
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

            if (config.showDate ?? true) {
                dateEl.textContent = Utils.formatDate(now, config);
            }

            if (manifest.extra?.debug) {
                Utils.sendMessage(
                    "debug",
                    `Clock updated: ${timeEl.textContent}${config.showDate ? " | " + dateEl.textContent : ""}`,
                    2
                );
            }
        } catch (e) {
            Utils.sendMessage("error", `Clock update failed: ${e}`);
            console.error("update failed", e);
        }
    }

    /* ------------------------------ EXPORT ------------------------------ */
    window.WidgetInit = initWidget;
})();
