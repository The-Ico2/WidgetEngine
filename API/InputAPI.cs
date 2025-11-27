using System.Runtime.InteropServices;
using System.Collections.Concurrent;

namespace WidgetEngine.API
{
    /// <summary>
    /// Manages global keyboard shortcuts and keybindings for widgets
    /// </summary>
    public class InputAPI
    {
        private readonly ILogger<InputAPI>? _logger;
        private readonly ConcurrentDictionary<string, KeybindAction> _keybinds = new();
        private readonly ConcurrentDictionary<string, string> _savedKeybinds = new();
        private IntPtr _hookId = IntPtr.Zero;
        private LowLevelKeyboardProc? _hookCallback;

        // Windows API constants
        private const int WH_KEYBOARD_LL = 13;
        private const int WM_KEYDOWN = 0x0100;
        private const int WM_SYSKEYDOWN = 0x0104;

        // Key modifiers
        [Flags]
        public enum KeyModifiers
        {
            None = 0,
            Alt = 1,
            Control = 2,
            Shift = 4,
            Win = 8
        }

        public delegate void KeybindAction();

        public InputAPI(ILogger<InputAPI>? logger = null)
        {
            _logger = logger;
            LoadSavedKeybinds();
            SetupGlobalHook();
        }

        /// <summary>
        /// Registers a keybind with a callback action
        /// </summary>
        public bool RegisterKeybind(string combo, KeybindAction action, string? widgetName = null)
        {
            try
            {
                var normalizedCombo = NormalizeCombo(combo);
                _keybinds[normalizedCombo] = action;
                
                if (!string.IsNullOrEmpty(widgetName))
                {
                    _savedKeybinds[normalizedCombo] = widgetName;
                    SaveKeybinds();
                }

                _logger?.LogInformation("Registered keybind: {Combo} for {Widget}", normalizedCombo, widgetName ?? "system");
                return true;
            }
            catch (Exception ex)
            {
                _logger?.LogError(ex, "Failed to register keybind {Combo}", combo);
                return false;
            }
        }

        /// <summary>
        /// Unregisters a keybind
        /// </summary>
        public bool UnregisterKeybind(string combo)
        {
            try
            {
                var normalizedCombo = NormalizeCombo(combo);
                _keybinds.TryRemove(normalizedCombo, out _);
                _savedKeybinds.TryRemove(normalizedCombo, out _);
                SaveKeybinds();
                
                _logger?.LogInformation("Unregistered keybind: {Combo}", normalizedCombo);
                return true;
            }
            catch (Exception ex)
            {
                _logger?.LogError(ex, "Failed to unregister keybind {Combo}", combo);
                return false;
            }
        }

        /// <summary>
        /// Gets all registered keybinds
        /// </summary>
        public Dictionary<string, string> GetAllKeybinds()
        {
            return new Dictionary<string, string>(_savedKeybinds);
        }

        /// <summary>
        /// Clears all keybinds
        /// </summary>
        public void ClearAllKeybinds()
        {
            _keybinds.Clear();
            _savedKeybinds.Clear();
            SaveKeybinds();
            _logger?.LogInformation("Cleared all keybinds");
        }

        /// <summary>
        /// Normalizes a key combination string (e.g., "Ctrl+Shift+S")
        /// </summary>
        private string NormalizeCombo(string combo)
        {
            var parts = combo.Split(new[] { '+', ' ' }, StringSplitOptions.RemoveEmptyEntries)
                            .Select(p => p.Trim())
                            .Select(p => p switch
                            {
                                "Control" or "Ctrl" or "CTRL" => "Ctrl",
                                "Shift" or "SHIFT" => "Shift",
                                "Alt" or "ALT" => "Alt",
                                "Win" or "Windows" or "WIN" => "Win",
                                _ => p.ToUpper()
                            })
                            .OrderBy(p => p switch
                            {
                                "Ctrl" => 1,
                                "Alt" => 2,
                                "Shift" => 3,
                                "Win" => 4,
                                _ => 5
                            })
                            .ToList();

            return string.Join("+", parts);
        }

        /// <summary>
        /// Loads saved keybinds from persistent storage
        /// </summary>
        private void LoadSavedKeybinds()
        {
            try
            {
                var keybindsPath = Path.Combine(Directory.GetCurrentDirectory(), "keybinds.json");
                if (File.Exists(keybindsPath))
                {
                    var json = File.ReadAllText(keybindsPath);
                    var saved = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, string>>(json);
                    
                    if (saved != null)
                    {
                        foreach (var kvp in saved)
                        {
                            _savedKeybinds[kvp.Key] = kvp.Value;
                        }
                    }
                    
                    _logger?.LogInformation("Loaded {Count} saved keybinds", saved?.Count ?? 0);
                }
            }
            catch (Exception ex)
            {
                _logger?.LogError(ex, "Failed to load saved keybinds");
            }
        }

        /// <summary>
        /// Saves keybinds to persistent storage
        /// </summary>
        private void SaveKeybinds()
        {
            try
            {
                var keybindsPath = Path.Combine(Directory.GetCurrentDirectory(), "keybinds.json");
                var json = System.Text.Json.JsonSerializer.Serialize(_savedKeybinds, new System.Text.Json.JsonSerializerOptions
                {
                    WriteIndented = true
                });
                File.WriteAllText(keybindsPath, json);
            }
            catch (Exception ex)
            {
                _logger?.LogError(ex, "Failed to save keybinds");
            }
        }

        /// <summary>
        /// Sets up the global keyboard hook for Windows
        /// </summary>
        private void SetupGlobalHook()
        {
            try
            {
                _hookCallback = HookCallback;
                _hookId = SetHook(_hookCallback);
                _logger?.LogInformation("Global keyboard hook installed");
            }
            catch (Exception ex)
            {
                _logger?.LogError(ex, "Failed to setup global keyboard hook");
            }
        }

        private IntPtr SetHook(LowLevelKeyboardProc proc)
        {
            using var curProcess = System.Diagnostics.Process.GetCurrentProcess();
            using var curModule = curProcess.MainModule;
            if (curModule != null)
            {
                return SetWindowsHookEx(WH_KEYBOARD_LL, proc, GetModuleHandle(curModule.ModuleName), 0);
            }
            return IntPtr.Zero;
        }

        private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

        private IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0 && (wParam == (IntPtr)WM_KEYDOWN || wParam == (IntPtr)WM_SYSKEYDOWN))
            {
                int vkCode = Marshal.ReadInt32(lParam);
                var key = ((System.Windows.Forms.Keys)vkCode).ToString();
                
                var combo = BuildCurrentCombo(key);
                
                if (_keybinds.TryGetValue(combo, out var action))
                {
                    try
                    {
                        Task.Run(() => action?.Invoke());
                        return (IntPtr)1; // Suppress the key
                    }
                    catch (Exception ex)
                    {
                        _logger?.LogError(ex, "Error executing keybind action for {Combo}", combo);
                    }
                }
            }
            return CallNextHookEx(_hookId, nCode, wParam, lParam);
        }

        private string BuildCurrentCombo(string key)
        {
            var parts = new List<string>();
            
            if ((System.Windows.Forms.Control.ModifierKeys & System.Windows.Forms.Keys.Control) != 0)
                parts.Add("Ctrl");
            if ((System.Windows.Forms.Control.ModifierKeys & System.Windows.Forms.Keys.Alt) != 0)
                parts.Add("Alt");
            if ((System.Windows.Forms.Control.ModifierKeys & System.Windows.Forms.Keys.Shift) != 0)
                parts.Add("Shift");
            
            parts.Add(key.ToUpper());
            
            return string.Join("+", parts);
        }

        public void Dispose()
        {
            if (_hookId != IntPtr.Zero)
            {
                UnhookWindowsHookEx(_hookId);
                _hookId = IntPtr.Zero;
            }
        }

        // Windows API imports
        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool UnhookWindowsHookEx(IntPtr hhk);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr GetModuleHandle(string lpModuleName);
    }
}
