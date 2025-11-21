(function () {
    let root, labelEl, displayEl, dateEl;
    let manifest, config;

    function initWidget(manifestData) {
        try {
            manifest = manifestData;
            config = manifest.config || {};

            root = document.querySelector(".template-root");
            if (!root) throw new Error("Widget root not found");


            labelEl = root.querySelector(".widget-label");
            displayEl = root.querySelector(".widget-display");
            dateEl = root.querySelector(".widget-date");

            Update.widget(root, manifest);

            // Initial update
            update();

            // Update at refreshRate
            const rate = config.refreshRate || 1000;
            setInterval(update, rate);

        } catch (e) {
            console.error("Widget failed to initialize:", e);
        }
    }

    function formatDate(date) {
        try {
            const fmt = config.dateFormat || "MM/DD/YYYY";
            const map = {
                YYYY: date.getFullYear(),
                MM: String(date.getMonth() + 1).padStart(2, "0"),
                DD: String(date.getDate()).padStart(2, "0"),
            };
            return fmt.replace(/YYYY|MM|DD/g, m => map[m]);
        } catch (e) {
            console.error("formatDate error:", e);
            return "00/00/0000";
        }
    }

    function update() {
        try {
            const now = new Date();

            // Example time display
            let hours = now.getHours();
            const minutes = String(now.getMinutes()).padStart(2, "0");
            const seconds = String(now.getSeconds()).padStart(2, "0");

            if (!config.use24HourFormat) hours = (hours % 12) || 12;
            hours = String(hours).padStart(2, "0");

            const timeString = config.showSeconds ? `${hours}:${minutes}:${seconds}` : `${hours}:${minutes}`;
            displayEl.textContent = timeString;

            if (config.showDate) dateEl.textContent = formatDate(now);

        } catch (e) {
            console.error("updateWidget error:", e);
        }
    }

    // Expose initialization to widget loader
    window.WidgetInit = initWidget;

})();