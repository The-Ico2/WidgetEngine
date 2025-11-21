(function () {
    let root, timeEl, dateEl;
    let manifest, config;

    function initWidget(manifestData) {
        manifest = manifestData;
        config = manifest.config || {};
        root = document.querySelector(".clock-root");
        if (!root) throw new Error("Clock root element not found");

        timeEl = root.querySelector(".clock-time");
        if (!timeEl) throw new Error("Time element not found in clock widget");

        dateEl = root.querySelector(".clock-date");
        if (!dateEl) throw new Error("Date element not found in clock widget");


        Update.widget(root, manifest /* plus any other data that needs pushed to the function*/);

        // updates clock time and date every second
        update(); setInterval(update, 1000);
    }

    /* ------------------------------ CLOCK UPDATE ------------------------------ */
    function update() {
        try {
            const now = new Date();
            let hours = now.getHours();
            const minutes = String(now.getMinutes()).padStart(2,"0");
            const seconds = String(now.getSeconds()).padStart(2,"0");

            if (!config.use24HourFormat) hours = (hours % 12) || 12;
            hours = String(hours).padStart(2,"0");

            timeEl.textContent = (config.showSeconds ? `${hours}:${minutes}:${seconds}` : `${hours}:${minutes}`);
            if (config.showDate ?? true) dateEl.textContent = Utils.formatDate(now, config);
        } catch(e) {
            console.error("update failed", e);
        }
    }

    /* ------------------------------ EXPORT ------------------------------ */
    window.WidgetInit = initWidget;
})();