using System.Windows;
using CefSharp;
using CefSharp.Wpf;

namespace WidgetEngine.Background
{
    /// <summary>
    /// Background engine for Wallpaper Engine compatibility
    /// Uses CefSharp for rendering widgets in a browser context
    /// </summary>
    public class Engine
    {
        private ChromiumWebBrowser? _browser;
        private Window? _window;
        private readonly string _backendUrl;

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
                CachePath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "WidgetEngine", "Cache")
            };

            // Enable web security (can be disabled for local development)
            settings.CefCommandLineArgs.Add("disable-web-security", "1");
            settings.CefCommandLineArgs.Add("allow-file-access-from-files", "1");

            Cef.Initialize(settings);
        }

        /// <summary>
        /// Starts the background engine
        /// </summary>
        public void Start()
        {
            var app = new System.Windows.Application();
            
            app.Startup += (s, e) =>
            {
                _window = new Window
                {
                    Title = "WidgetEngine Background",
                    WindowStyle = WindowStyle.None,
                    ResizeMode = ResizeMode.NoResize,
                    WindowState = WindowState.Maximized,
                    ShowInTaskbar = false,
                    Topmost = false
                };

                // Make the window sit on the desktop (behind all windows)
                SetAsDesktopWindow(_window);

                _browser = new ChromiumWebBrowser(_backendUrl)
                {
                    HorizontalAlignment = HorizontalAlignment.Stretch,
                    VerticalAlignment = VerticalAlignment.Stretch
                };

                _window.Content = _browser;
                _window.Show();

                // Inject the widget container HTML
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
        /// Sets the window as a desktop background window
        /// </summary>
        private void SetAsDesktopWindow(Window window)
        {
            var helper = new System.Windows.Interop.WindowInteropHelper(window);
            helper.EnsureHandle();
            var hwnd = helper.Handle;

            // Set as child of desktop
            const int GWL_EXSTYLE = -20;
            const int WS_EX_NOACTIVATE = 0x08000000;
            
            SetWindowLong(hwnd, GWL_EXSTYLE, 
                GetWindowLong(hwnd, GWL_EXSTYLE) | WS_EX_NOACTIVATE);
        }

        /// <summary>
        /// Injects the widget container and initializes the widget system
        /// </summary>
        private void InjectWidgetContainer()
        {
            if (_browser == null) return;

            var script = @"
                // Create widget container
                if (!document.getElementById('widget-container')) {
                    const container = document.createElement('div');
                    container.id = 'widget-container';
                    container.style.cssText = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; pointer-events: none;';
                    document.body.appendChild(container);
                    
                    // Set backend URL for API (port 7070)
                    window.BACKEND_URL = 'http://localhost:7070';
                    // Indicate this engine is the Background layer so the client can
                    // request layer-specific manifests (via X-Widget-Layer header).
                    window.WIDGET_LAYER = 'Background';
                    
                    // Load universal scripts
                    const scripts = [
                        '/API/universal/WidgetUtils.js',
                        '/API/universal/WidgetWatcher.js',
                        '/API/universal/KeybindManager.js',
                        '/API/universal/Script.js'
                    ];
                    
                    scripts.forEach(src => {
                        const script = document.createElement('script');
                        script.src = window.BACKEND_URL + src;
                        document.head.appendChild(script);
                    });
                }
            ";

            _browser.ExecuteScriptAsync(script);
        }

        /// <summary>
        /// Stops the background engine
        /// </summary>
        public void Stop()
        {
            _browser?.Dispose();
            _window?.Close();
            Cef.Shutdown();
        }

        // Windows API imports
        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern int GetWindowLong(IntPtr hWnd, int nIndex);
    }
}
