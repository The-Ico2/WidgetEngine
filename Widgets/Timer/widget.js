// clock widget.js

(function () {
    let root, displayEl, hoursEl, minutesEl, secondsEl, msEl;
    let add30Btn, add1mBtn, add10mBtn, toggleCountup;
    let startBtn, pauseBtn, resetBtn;
    let manifest, config;

    let intervalId = null;
    let remainingMs = 0;
    let running = false;
    let lastTick = 0;
    let _persistTimeout = null;

    function msFromConfig(cfg) {
        const s = Number(cfg?.defaultSeconds ?? 60) || 0;
        return Math.max(0, Math.floor(s * 1000));
    }

    function formatTime(ms, showMs) {
        ms = Math.max(0, Math.floor(ms));
        const totalSec = Math.floor(ms / 1000);
        const hh = String(Math.floor(totalSec / 3600)).padStart(2, '0');
        const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
        const ss = String(totalSec % 60).padStart(2, '0');
        const msPart = String(Math.floor((ms % 1000) / 10)).padStart(2, '0');
        return showMs ? `${hh}:${mm}:${ss}.${msPart}` : `${hh}:${mm}:${ss}`;
    }

    function pad(n, len = 2) { return String(n).padStart(len, '0'); }

    function updateDisplay() {
        // Update the segmented display elements
        if (!displayEl) return;
        const showMs = !!config.showMilliseconds;
        const totalMs = Math.max(0, Math.floor(remainingMs));
        const totalSec = Math.floor(totalMs / 1000);
        const hh = Math.floor(totalSec / 3600);
        const mm = Math.floor((totalSec % 3600) / 60);
        const ss = totalSec % 60;
        const msPart = Math.floor((totalMs % 1000) / 10);

        if (hoursEl) hoursEl.textContent = pad(hh, 2);
        if (minutesEl) minutesEl.textContent = pad(mm, 2);
        if (secondsEl) secondsEl.textContent = pad(ss, 2);
        if (msEl) msEl.textContent = pad(msPart, 2);
    }

    function setSegmentsEditable(editable) {
        const state = !!editable;
        [hoursEl, minutesEl, secondsEl, msEl].forEach(el => {
            if (!el) return;
            el.contentEditable = state ? 'true' : 'false';
            el.classList.toggle('editable', state);
        });
    }

    function parseSegmentsToMs() {
        try {
            const hh = Math.max(0, parseInt(hoursEl?.textContent || '0') || 0);
            const mm = Math.max(0, parseInt(minutesEl?.textContent || '0') || 0);
            const ss = Math.max(0, parseInt(secondsEl?.textContent || '0') || 0);
            const msPart = Math.max(0, parseInt(msEl?.textContent || '0') || 0);
            return ((hh * 3600) + (mm * 60) + ss) * 1000 + (msPart * 10);
        } catch (e) { return 0; }
    }

    function tick() {
        const now = Date.now();
        const elapsed = now - lastTick;
        lastTick = now;
        if (!running) return;
        if (config.countUp) {
            remainingMs += elapsed;
        } else {
            remainingMs -= elapsed;
            if (remainingMs <= 0) {
                remainingMs = 0;
                stopInterval();
                Utils.sendMessage('debug', `[widget:${manifest.name}] Timer finished`, 4, manifest.name);
            }
        }
        updateDisplay();

        // Allow editing only when not running
        setSegmentsEditable(!running);
    }

    function startInterval() {
        if (intervalId) return;
        running = true;
        lastTick = Date.now();
        intervalId = setInterval(tick, config.showMilliseconds ? 50 : 250);
        Utils.sendMessage('debug', `[widget:${manifest.name}] Timer started`, 3, manifest.name);
        schedulePersist();
        setSegmentsEditable(false);
    }

    function stopInterval() {
        running = false;
        if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
        }
        schedulePersist();
        setSegmentsEditable(true);
    }

    function resetTimer() {
        // Stop any running interval and cancel pending debounced persists
        stopInterval();
        if (_persistTimeout) { try { clearTimeout(_persistTimeout); } catch(e){} _persistTimeout = null; }

        // Reset to configured/default duration
        remainingMs = msFromConfig(manifest.unique_config?.timer);
        updateDisplay();
        Utils.sendMessage('debug', `[widget:${manifest.name}] Timer reset`, 3, manifest.name);

        // Persist immediately (sequentially) to avoid races where older pending saves overwrite this reset
        try {
            const secs = Math.ceil(Math.max(0, remainingMs) / 1000);
            (async () => {
                try {
                    await Update.manifest(null, manifest, manifest.name, "states.saved.remainingSeconds", secs);
                    await Update.manifest(null, manifest, manifest.name, "states.saved.running", false);
                } catch (e) {
                    Utils.sendMessage('warn', `[widget:${manifest?.name}] Immediate persist on reset failed: ${e}`, 4, manifest?.name);
                    // Fallback to debounced persist
                    schedulePersist(500);
                }
            })();
        } catch (e) {
            // If something synchronous throws, fallback to debounced persist
            schedulePersist(500);
        }
    }

    // Debounced persistence of runtime state into manifest.state
    function schedulePersist(delay = 500) {
        try {
            if (!manifest) return;
            if (_persistTimeout) clearTimeout(_persistTimeout);
            _persistTimeout = setTimeout(async () => {
                try {
                    // Persist remaining seconds (rounded up) and running flag sequentially
                    const secs = Math.ceil(Math.max(0, remainingMs) / 1000);
                    await Update.manifest(null, manifest, manifest.name, "states.saved.remainingSeconds", secs);
                    await Update.manifest(null, manifest, manifest.name, "states.saved.running", running);
                } catch (e) {
                    Utils.sendMessage('warn', `[widget:${manifest?.name}] Failed to persist timer state: ${e}`, 4, manifest?.name);
                }
            }, delay);
        } catch (e) {
            // best-effort
        }
    }

    function initWidget(manifestData, rootEl) {
        manifest = manifestData;
        config = manifest.unique_config?.timer;
        const debug = manifest.extra?.debug.enabled;
        
        Utils.sendMessage('debug', `Initializing Timer widget "${manifest.name}"`, 8, manifest.name);

        root = rootEl || document.querySelector('.timer-root');
        if (!root) {
            Utils.sendMessage('error', `[widget:${manifest?.name ?? 'timer'}] Timer root element not found`, 4, manifest?.name);
            throw new Error('Timer root element not found');
        }

        displayEl = root.querySelector('#timer-display');
        hoursEl = root.querySelector('#t-hours');
        minutesEl = root.querySelector('#t-minutes');
        secondsEl = root.querySelector('#t-seconds');
        msEl = root.querySelector('#t-ms');
        add30Btn = root.querySelector('#add-30s');
        add1mBtn = root.querySelector('#add-1m');
        add10mBtn = root.querySelector('#add-10m');
        toggleCountup = root.querySelector('#toggle-countup');
        startBtn = root.querySelector('#timer-start');
        pauseBtn = root.querySelector('#timer-pause');
        resetBtn = root.querySelector('#timer-reset');

        if (!displayEl) throw new Error('Timer display element missing');

        const sanitizeSeg = el => {
            if (!el) return;
            // keep only digits, limit lengths
            el.textContent = (el.textContent || '').replace(/[^0-9]/g, '').slice(0, el.id === 't-ms' ? 2 : 3) || '0';
        };

        // When user edits segments, update remainingMs (only when not running)
        [hoursEl, minutesEl, secondsEl, msEl].forEach(el => {
            if (!el) return;
            el.addEventListener('input', () => {
                sanitizeSeg(el);
                if (!running) {
                    remainingMs = parseSegmentsToMs();
                    updateDisplay();
                }
            });
            el.addEventListener('blur', () => { sanitizeSeg(el); if (!running) { remainingMs = parseSegmentsToMs(); updateDisplay(); schedulePersist(300); } });
            el.addEventListener('keypress', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); el.blur(); } });
        });

        // Quick-add buttons
        add30Btn && add30Btn.addEventListener('click', async () => { remainingMs += 30000; updateDisplay(); schedulePersist(); try { await Update.manifest(null, manifest, manifest.name, 'states.saved.remainingSeconds', Math.ceil(remainingMs/1000)); } catch(e){} });
        add1mBtn && add1mBtn.addEventListener('click', async () => { remainingMs += 60000; updateDisplay(); schedulePersist(); try { await Update.manifest(null, manifest, manifest.name, 'states.saved.remainingSeconds', Math.ceil(remainingMs/1000)); } catch(e){} });
        add10mBtn && add10mBtn.addEventListener('click', async () => { remainingMs += 600000; updateDisplay(); schedulePersist(); try { await Update.manifest(null, manifest, manifest.name, 'states.saved.remainingSeconds', Math.ceil(remainingMs/1000)); } catch(e){} });

        // Toggle countUp mode using a button that switches text (persists into unique_config.timer.countUp)
        if (toggleCountup) {
            const setToggleText = () => { toggleCountup.textContent = config.countUp ? 'Count Up' : 'Count Down'; };
            setToggleText();
            toggleCountup.addEventListener('click', async () => {
                config.countUp = !config.countUp;
                setToggleText();
                try { await Update.manifest(null, manifest, manifest.name, 'unique_config.timer.countUp', config.countUp); } catch (e) { Utils.sendMessage('warn', `Failed to persist countUp setting: ${e}`, 4, manifest.name); }
            });
        }

        // Start handler — ensure segments applied and persist running=true
        startBtn && startBtn.addEventListener('click', async () => {
            if (!running && remainingMs <= 0 && !config.countUp) {
                // Try to read from segments
                remainingMs = parseSegmentsToMs();
            }
            if (remainingMs <= 0 && !config.countUp) {
                Utils.sendMessage('warn', `[widget:${manifest.name}] Duration is zero; edit time or use quick-add`, 4, manifest.name);
                return;
            }

            startInterval();
            try {
                await Update.manifest(null, manifest, manifest.name, 'states.saved.running', true);
                await Update.manifest(null, manifest, manifest.name, 'states.saved.remainingSeconds', Math.ceil(Math.max(0, remainingMs) / 1000));
            } catch (e) {
                Utils.sendMessage('warn', `[widget:${manifest?.name}] Failed to persist running state on start: ${e}`, 4, manifest?.name);
            }
        });

        // Pause handler — ensure we persist running=false and remainingSeconds
        pauseBtn && pauseBtn.addEventListener('click', async () => {
            stopInterval();
            Utils.sendMessage('debug', `[widget:${manifest.name}] Timer paused`, 3, manifest.name);
            try {
                await Update.manifest(null, manifest, manifest.name, 'states.saved.remainingSeconds', Math.ceil(Math.max(0, remainingMs) / 1000));
                await Update.manifest(null, manifest, manifest.name, 'states.saved.running', false);
            } catch (e) {
                Utils.sendMessage('warn', `[widget:${manifest?.name}] Failed to persist paused state: ${e}`, 4, manifest?.name);
                // fallback to debounced persist
                schedulePersist();
            }
        });

        resetBtn && resetBtn.addEventListener('click', () => {
            resetTimer();
        });

        // Apply engine display/behavior rules (position, draggable, styling, etc.)
        try {
            Update.widget(root, manifest);
        } catch (e) {
            Utils.sendMessage('debug', `Update.widget failed during init: ${e}`, 4, manifest.name);
        }

        // initialize: prefer persisted state when available
        try {
            const persistedSec = manifest.states.saved?.remainingSeconds;
            const persistedRunning = manifest.states.saved?.running;
            if (typeof persistedSec === 'number') {
                remainingMs = Math.max(0, Math.floor(persistedSec * 1000));
            } else {
                remainingMs = msFromConfig(manifest.unique_config?.timer);
            }
            running = !!persistedRunning;
        } catch (e) {
            remainingMs = msFromConfig(manifest.unique_config?.timer);
            running = false;
        }

        updateDisplay();

        if (running) {
            // If persisted as running, resume interval
            startInterval();
        } else if (config.autoStart) {
            startInterval();
        }

        Utils.sendMessage('debug', `[widget:${manifest.name}] Timer initialized (remainingMs=${remainingMs})`, 6, manifest.name);
    }

    /* ------------------------------ EXPORT ------------------------------ */
    (function(){
        try {
            window.WidgetInitRegistry = window.WidgetInitRegistry || {};
            window.WidgetInitRegistry['Timer'] = initWidget;
            window.WidgetInitRegistry['timer'] = initWidget;
        } catch(e) {}
        try { window.WidgetInit = initWidget; } catch(e) {}
    })();
})();