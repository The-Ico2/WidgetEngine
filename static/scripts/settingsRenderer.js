window.SettingsRenderer = {
    async renderWidgetSettings(widgetName, container) {

        container.innerHTML = "";

        // Load manifest
        const manifest = await fetch(`${BACKEND_URL}/api/widgets/${widgetName}`).then(r => r.json());

        const title = document.createElement("h2");
        title.textContent = manifest.label;
        container.appendChild(title);

        // Loop through fields and generate UI
        const section = document.createElement("div");
        section.className = "settings-section";

        function field(label, element) {
            const wrap = document.createElement("div");
            wrap.className = "setting-row";

            const lbl = document.createElement("label");
            lbl.textContent = label;

            wrap.appendChild(lbl);
            wrap.appendChild(element);
            return wrap;
        }

        //
        // SIZE
        //
        let sizeHeader = document.createElement("h3");
        sizeHeader.textContent = "Size";
        container.appendChild(sizeHeader);

        // width
        const wInput = document.createElement("input");
        wInput.type = "number";
        wInput.value = manifest.size.width;
        wInput.onchange = () => update("size", "width", Number(wInput.value));
        container.appendChild(field("Width", wInput));

        // height
        const hInput = document.createElement("input");
        hInput.type = "number";
        hInput.value = manifest.size.height;
        hInput.onchange = () => update("size", "height", Number(hInput.value));
        container.appendChild(field("Height", hInput));

        // scale
        const scaleInput = document.createElement("input");
        scaleInput.type = "number";
        scaleInput.step = "0.1";
        scaleInput.value = manifest.size.scale;
        scaleInput.onchange = () => update("size", "scale", Number(scaleInput.value));
        container.appendChild(field("Scale", scaleInput));

        //
        // DRAG/CLICK
        //
        const dragToggle = toggle("Draggable", manifest.draggable, v => update(null, "draggable", v));
        const clickToggle = toggle("Click-Through", manifest["click-through"], v => update(null, "click-through", v));
        container.appendChild(dragToggle);
        container.appendChild(clickToggle);

        //
        // POSITION
        //
        let posHeader = document.createElement("h3");
        posHeader.textContent = "Position";
        container.appendChild(posHeader);

        const xInput = document.createElement("input");
        xInput.type = "number";
        xInput.value = manifest.position.x;
        xInput.onchange = () => update("position", "x", Number(xInput.value));
        container.appendChild(field("X", xInput));

        const yInput = document.createElement("input");
        yInput.type = "number";
        yInput.value = manifest.position.y;
        yInput.onchange = () => update("position", "y", Number(yInput.value));
        container.appendChild(field("Y", yInput));

        //
        // CONFIG
        //
        let cfgHeader = document.createElement("h3");
        cfgHeader.textContent = "Configuration";
        container.appendChild(cfgHeader);

        for (const [key, val] of Object.entries(manifest.config)) {
            container.appendChild(renderDynamicField("config", key, val));
        }

        //
        // Save to backend
        //
        async function update(section, key, value) {
            console.log("UPDATE:", widgetName, section, key, value);
            await Update.manifest(null, manifest, widgetName, section ? `${section}.${key}` : key, value);
        }

        function toggle(label, value, cb) {
            const el = document.createElement("div");
            el.className = "setting-toggle";
            el.textContent = label + ": " + (value ? "ON" : "OFF");

            el.onclick = () => {
                value = !value;
                el.textContent = label + ": " + (value ? "ON" : "OFF");
                cb(value);
            };
            return el;
        }

        function renderDynamicField(section, key, value) {

            // boolean toggle
            if (typeof value === "boolean") {
                return toggle(key, value, v => update("config", key, v));
            }

            // number input
            if (typeof value === "number") {
                const el = document.createElement("input");
                el.type = "number";
                el.value = value;
                el.onchange = () => update("config", key, Number(el.value));
                return field(key, el);
            }

            // color picker
            if (typeof value === "string" && value.startsWith("#")) {
                const el = document.createElement("input");
                el.type = "color";
                el.value = value;
                el.onchange = () => update("config", key, el.value);
                return field(key, el);
            }

            // text input fallback
            const el = document.createElement("input");
            el.type = "text";
            el.value = value;
            el.onchange = () => update("config", key, el.value);
            return field(key, el);
        }
    }
};