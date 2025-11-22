// clock widget.js

(function () {
    let root, displayEl, minutesInput, secondsInput;
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
        const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
        const ss = String(totalSec % 60).padStart(2, '0');
        if (showMs) {
            const msPart = String(Math.floor((ms % 1000) / 10)).padStart(2, '0');
            return `${mm}:${ss}.${msPart}`;
        }
        return `${mm}:${ss}`;
    }

    function updateDisplay() {
        displayEl.textContent = formatTime(remainingMs, config.showMilliseconds);
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
                Utils.sendMessage('info', `[widget:${manifest.name}] Timer finished`, 4, manifest.name);
            }
        }
        updateDisplay();
    }

    function startInterval() {
        if (intervalId) return;
        running = true;
        lastTick = Date.now();
        intervalId = setInterval(tick, config.showMilliseconds ? 50 : 250);
        Utils.sendMessage('info', `[widget:${manifest.name}] Timer started`, 3, manifest.name);
        schedulePersist();
    }

    function stopInterval() {
        running = false;
        if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
        }
        schedulePersist();
    }

    function resetTimer() {
        // Stop any running interval and cancel pending debounced persists
        stopInterval();
        if (_persistTimeout) { try { clearTimeout(_persistTimeout); } catch(e){} _persistTimeout = null; }

        // Reset to configured/default duration
        remainingMs = msFromConfig(manifest.unique_config?.timer || manifest.config || config);
        updateDisplay();
        Utils.sendMessage('info', `[widget:${manifest.name}] Timer reset`, 3, manifest.name);

        // Persist immediately to avoid races where older pending saves overwrite this reset
        try {
            const secs = Math.ceil(Math.max(0, remainingMs) / 1000);
            Update.manifest(null, manifest, manifest.name, "state.remainingSeconds", secs);
            Update.manifest(null, manifest, manifest.name, "state.running", false);
        } catch (e) {
            Utils.sendMessage('warn', `[widget:${manifest?.name}] Immediate persist on reset failed: ${e}`, 4, manifest?.name);
            // Fallback to debounced persist
            schedulePersist(500);
        }
    }

    // Debounced persistence of runtime state into manifest.state
    function schedulePersist(delay = 500) {
        try {
            if (!manifest) return;
            if (_persistTimeout) clearTimeout(_persistTimeout);
            _persistTimeout = setTimeout(() => {
                try {
                    // Persist remaining seconds (rounded up) and running flag
                    const secs = Math.ceil(Math.max(0, remainingMs) / 1000);
                    // Use Update.manifest flexible signature: (null, manifest, widgetName, path, value)
                    Update.manifest(null, manifest, manifest.name, "state.remainingSeconds", secs);
                    Update.manifest(null, manifest, manifest.name, "state.running", running);
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
        config = manifest.config || manifest.unique_config?.timer || manifest.unique_config || {};

        Utils.sendMessage('debug', `Initializing Timer widget "${manifest.name}"`, 8, manifest.name);

        root = rootEl || document.querySelector('.timer-root');
        if (!root) {
            Utils.sendMessage('error', `[widget:${manifest?.name ?? 'timer'}] Timer root element not found`, 4, manifest?.name);
            throw new Error('Timer root element not found');
        }

        displayEl = root.querySelector('#timer-display');
        minutesInput = root.querySelector('#timer-minutes');
        secondsInput = root.querySelector('#timer-seconds');
        startBtn = root.querySelector('#timer-start');
        pauseBtn = root.querySelector('#timer-pause');
        resetBtn = root.querySelector('#timer-reset');

        if (!displayEl) throw new Error('Timer display element missing');

        // Wire up buttons
        startBtn && startBtn.addEventListener('click', () => {
            // set remaining from inputs if currently zero
            if (!running && remainingMs <= 0) {
                const m = Number(minutesInput?.value || 0);
                const s = Number(secondsInput?.value || 0);
                remainingMs = Math.max(0, (Math.floor(m) * 60 + Math.floor(s)) * 1000);
            }
            if (remainingMs <= 0 && config.autoStart === false && !config.countUp) {
                Utils.sendMessage('warn', `[widget:${manifest.name}] Duration is zero; set minutes/seconds or update defaultSeconds`, 4, manifest.name);
                return;
            }
            startInterval();
        });

        pauseBtn && pauseBtn.addEventListener('click', () => {
            stopInterval();
            Utils.sendMessage('info', `[widget:${manifest.name}] Timer paused`, 3, manifest.name);
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
            const persistedSec = manifest.state?.remainingSeconds;
            const persistedRunning = manifest.state?.running;
            if (typeof persistedSec === 'number') {
                remainingMs = Math.max(0, Math.floor(persistedSec * 1000));
            } else {
                remainingMs = msFromConfig(manifest.unique_config?.timer || manifest.config || config);
            }
            running = !!persistedRunning;
        } catch (e) {
            remainingMs = msFromConfig(manifest.unique_config?.timer || manifest.config || config);
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
