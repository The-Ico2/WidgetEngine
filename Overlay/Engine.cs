using System.Windows;
using System.Windows.Interop;
using System.Runtime.InteropServices;
using CefSharp;
using CefSharp.Wpf;

namespace WidgetEngine.Overlay
{
    /// <summary>
    /// Overlay engine for transparent, click-through widget rendering
    /// </summary>
    public class Engine
    {
        private ChromiumWebBrowser? _browser;
        private Window? _window;
        private readonly string _backendUrl;
        private IntPtr _hwnd;

        // Windows API constants
        private const int GWL_EXSTYLE = -20;
        private const int WS_EX_LAYERED = 0x00080000;
        private const int WS_EX_TRANSPARENT = 0x00000020;
        private const int WS_EX_TOPMOST = 0x00000008;
        private const int WS_EX_NOACTIVATE = 0x08000000;

        public Engine(string backendUrl = "http://localhost:7070")
        {
            _backendUrl = backendUrl;
            InitializeCef();
        }

        /// <summary>
        /// Initializes CefSharp
        /// </summary>
        private void InitializeCef()
        {
            var settings = new CefSettings
            {
                CachePath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "WidgetEngine", "OverlayCache")
            };

            settings.CefCommandLineArgs.Add("disable-web-security", "1");
            settings.CefCommandLineArgs.Add("allow-file-access-from-files", "1");
            settings.CefCommandLineArgs.Add("enable-transparent-visuals", "1");

            Cef.Initialize(settings);
        }

        /// <summary>
        /// Starts the overlay engine
        /// </summary>
        public void Start()
        {
            var app = new System.Windows.Application();
            
            app.Startup += (s, e) =>
            {
                _window = new Window
                {
                    Title = "WidgetEngine Overlay",
                    WindowStyle = WindowStyle.None,
                    ResizeMode = ResizeMode.NoResize,
                    WindowState = WindowState.Maximized,
                    ShowInTaskbar = false,
                    Topmost = true,
                    AllowsTransparency = true,
                    Background = System.Windows.Media.Brushes.Transparent
                };

                // Set up window handle and transparency
                _window.SourceInitialized += (sender, args) =>
                {
                    var helper = new WindowInteropHelper(_window);
                    _hwnd = helper.Handle;
                    SetupTransparentOverlay();
                };

                _browser = new ChromiumWebBrowser(_backendUrl)
                {
                    HorizontalAlignment = HorizontalAlignment.Stretch,
                    VerticalAlignment = VerticalAlignment.Stretch
                };

                // Make browser background transparent
                _browser.IsBrowserInitializedChanged += (sender, args) =>
                {
                    if (_browser.IsBrowserInitialized)
                    {
                        _browser.GetBrowser().GetHost().WasResized();
                    }
                };

                _window.Content = _browser;
                _window.Show();

                // Inject widget container
                _browser.LoadingStateChanged += (sender, args) =>
                {
                    if (!args.IsLoading)
                    {
                        InjectWidgetContainer();
                    }
                };
            };

            app.Run();
        }

        /// <summary>
        /// Sets up the window as a transparent, click-through overlay
        /// </summary>
        private void SetupTransparentOverlay()
        {
            var extendedStyle = GetWindowLong(_hwnd, GWL_EXSTYLE);
            
            // Make window layered, transparent, topmost, and non-activating
            SetWindowLong(_hwnd, GWL_EXSTYLE, 
                extendedStyle | WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST | WS_EX_NOACTIVATE);

            // Set opacity
            SetLayeredWindowAttributes(_hwnd, 0, 255, LWA_ALPHA);
        }

        /// <summary>
        /// Toggles click-through mode
        /// </summary>
        public void SetClickThrough(bool enabled)
        {
            if (_hwnd == IntPtr.Zero) return;

            var extendedStyle = GetWindowLong(_hwnd, GWL_EXSTYLE);
            
            if (enabled)
            {
                SetWindowLong(_hwnd, GWL_EXSTYLE, extendedStyle | WS_EX_TRANSPARENT);
            }
            else
            {
                SetWindowLong(_hwnd, GWL_EXSTYLE, extendedStyle & ~WS_EX_TRANSPARENT);
            }
        }

        /// <summary>
        /// Injects the widget container and initializes the widget system
        /// </summary>
        private void InjectWidgetContainer()
        {
            if (_browser == null) return;

            var script = @"
                // Set transparent background
                document.body.style.cssText = 'margin: 0; padding: 0; background: transparent; overflow: hidden;';
                
                // Create widget container
                if (!document.getElementById('widget-container')) {
                    const container = document.createElement('div');
                    container.id = 'widget-container';
                    container.style.cssText = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;';
                    document.body.appendChild(container);
                    
                    // Set backend URL for API (port 7070)
                    window.BACKEND_URL = 'http://localhost:7070';
                    // Indicate this engine is the Overlay layer so the client can
                    // request layer-specific manifests (via X-Widget-Layer header).
                    window.WIDGET_LAYER = 'Overlay';
                    
                    // Load universal scripts
                    const scripts = [
                        '/API/universal/WidgetUtils.js',
                        '/API/universal/WidgetWatcher.js',
                        '/API/universal/KeybindManager.js',
                        '/API/universal/Script.js'
                    ];
                    
                    let loadedCount = 0;
                    scripts.forEach(src => {
                        const script = document.createElement('script');
                        script.src = window.BACKEND_URL + src;
                        script.onload = () => {
                            loadedCount++;
                            if (loadedCount === scripts.length) {
                                console.log('All widget scripts loaded');
                            }
                        };
                        document.head.appendChild(script);
                    });
                }
            ";

            _browser.ExecuteScriptAsync(script);
        }

        /// <summary>
        /// Stops the overlay engine
        /// </summary>
        public void Stop()
        {
            _browser?.Dispose();
            _window?.Close();
            Cef.Shutdown();
        }

        // Windows API imports
        [DllImport("user32.dll")]
        private static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

        [DllImport("user32.dll")]
        private static extern int GetWindowLong(IntPtr hWnd, int nIndex);

        [DllImport("user32.dll")]
        private static extern bool SetLayeredWindowAttributes(IntPtr hwnd, uint crKey, byte bAlpha, uint dwFlags);

        private const uint LWA_ALPHA = 0x00000002;
    }
}
