using System.Collections.Concurrent;
using System.Text.Json;
using WidgetEngine.Models;

namespace WidgetEngine.API
{
    /// <summary>
    /// Monitors widget manifest changes and triggers updates
    /// </summary>
    public class WatcherAPI
    {
        private readonly ILogger<WatcherAPI>? _logger;
        private readonly WidgetManager _widgetManager;
        private readonly System.Timers.Timer _watchTimer;
        private readonly ConcurrentDictionary<string, string> _manifestSnapshots = new();
        private readonly ConcurrentDictionary<string, WatcherSubscription> _subscriptions = new();

        public delegate Task ManifestChangeHandler(string widgetName, WidgetManifest manifest, ChangeType changeType);

        public enum ChangeType
        {
            Created,
            Updated,
            Deleted,
            Enabled,
            Disabled
        }

        public class WatcherSubscription
        {
            public string WidgetName { get; set; } = string.Empty;
            public ManifestChangeHandler? OnChange { get; set; }
            public bool Enabled { get; set; } = true;
        }

        public WatcherAPI(WidgetManager widgetManager, ILogger<WatcherAPI>? logger = null)
        {
            _logger = logger;
            _widgetManager = widgetManager;

            // Watch for changes every second
            _watchTimer = new System.Timers.Timer(1000);
            _watchTimer.Elapsed += async (s, e) => await WatchForChanges();
            _watchTimer.AutoReset = true;
            _watchTimer.Start();

            _logger?.LogInformation("WatcherAPI initialized with 1-second polling interval");
        }

        /// <summary>
        /// Subscribes to changes for a specific widget
        /// </summary>
        public void Subscribe(string widgetName, ManifestChangeHandler onChange)
        {
            var subscription = new WatcherSubscription
            {
                WidgetName = widgetName,
                OnChange = onChange,
                Enabled = true
            };

            _subscriptions[widgetName] = subscription;
            _logger?.LogInformation("Subscribed to changes for widget {Widget}", widgetName);
        }

        /// <summary>
        /// Unsubscribes from widget changes
        /// </summary>
        public void Unsubscribe(string widgetName)
        {
            if (_subscriptions.TryRemove(widgetName, out _))
            {
                _logger?.LogInformation("Unsubscribed from changes for widget {Widget}", widgetName);
            }
        }

        /// <summary>
        /// Starts the watcher
        /// </summary>
        public void Start()
        {
            if (!_watchTimer.Enabled)
            {
                _watchTimer.Start();
                _logger?.LogInformation("WatcherAPI started");
            }
        }

        /// <summary>
        /// Stops the watcher
        /// </summary>
        public void Stop()
        {
            if (_watchTimer.Enabled)
            {
                _watchTimer.Stop();
                _logger?.LogInformation("WatcherAPI stopped");
            }
        }

        private async Task WatchForChanges()
        {
            try
            {
                // Monitor only layer-specific manifest folders (Overlay and Background). Do not watch the canonical Widgets folder.
                var layers = new[] { (name: "overlay", path: Path.Combine(Directory.GetCurrentDirectory(), "Overlay", "widgets")),
                                     (name: "background", path: Path.Combine(Directory.GetCurrentDirectory(), "Background", "widgets")) };

                var currentKeys = new HashSet<string>();

                foreach (var (layerName, path) in layers)
                {
                    if (!Directory.Exists(path)) continue;

                    var currentWidgets = _widgetManager.DiscoverWidgets(path);

                    foreach (var widget in currentWidgets)
                    {
                        // Use a composite key to track per-layer state so same widget in both layers is distinct
                        var compositeKey = $"{layerName}:{widget.Name}";
                        currentKeys.Add(compositeKey);

                        var serialized = SerializeManifest(widget);

                        if (!_manifestSnapshots.TryGetValue(compositeKey, out var previousSnapshot))
                        {
                            // New widget detected in layer
                            _manifestSnapshots[compositeKey] = serialized;
                            await NotifyChange(widget.Name, widget, ChangeType.Created);
                            _logger?.LogInformation("New widget detected in {Layer}: {Widget}", layerName, widget.Name);
                        }
                        else if (previousSnapshot != serialized)
                        {
                            _manifestSnapshots[compositeKey] = serialized;

                            var previousManifest = DeserializeManifest(previousSnapshot);
                            var wasEnabled = previousManifest?.WidgetFeatures?.Behavior?.Enabled ?? false;
                            var isEnabled = widget.WidgetFeatures?.Behavior?.Enabled ?? false;

                            if (wasEnabled != isEnabled)
                            {
                                await NotifyChange(widget.Name, widget, isEnabled ? ChangeType.Enabled : ChangeType.Disabled);
                            }
                            else
                            {
                                await NotifyChange(widget.Name, widget, ChangeType.Updated);
                            }

                            _logger?.LogDebug("Widget updated in {Layer}: {Widget}", layerName, widget.Name);
                        }
                    }
                }

                // Remove snapshots that no longer exist
                var previousKeys = _manifestSnapshots.Keys.ToList();
                foreach (var prevKey in previousKeys)
                {
                    if (!currentKeys.Contains(prevKey))
                    {
                        _manifestSnapshots.TryRemove(prevKey, out _);
                        var parts = prevKey.Split(':', 2);
                        var prevWidgetName = parts.Length > 1 ? parts[1] : prevKey;
                        var emptyManifest = new WidgetManifest { Name = prevWidgetName };
                        await NotifyChange(prevWidgetName, emptyManifest, ChangeType.Deleted);
                        _logger?.LogInformation("Widget deleted (layer): {Widget}", prevWidgetName);
                    }
                }
            }
            catch (Exception ex)
            {
                _logger?.LogError(ex, "Error watching for widget changes");
            }
        }

        private async Task NotifyChange(string widgetName, WidgetManifest manifest, ChangeType changeType)
        {
            var tasks = new List<Task>();

            // Notify specific widget subscriptions
            if (_subscriptions.TryGetValue(widgetName, out var subscription) && 
                subscription.Enabled && subscription.OnChange != null)
            {
                tasks.Add(Task.Run(async () =>
                {
                    try
                    {
                        await subscription.OnChange(widgetName, manifest, changeType);
                    }
                    catch (Exception ex)
                    {
                        _logger?.LogError(ex, "Error in change handler for widget {Widget}", widgetName);
                    }
                }));
            }

            // Notify global subscriptions (widgetName = "*")
            if (_subscriptions.TryGetValue("*", out var globalSubscription) && 
                globalSubscription.Enabled && globalSubscription.OnChange != null)
            {
                tasks.Add(Task.Run(async () =>
                {
                    try
                    {
                        await globalSubscription.OnChange(widgetName, manifest, changeType);
                    }
                    catch (Exception ex)
                    {
                        _logger?.LogError(ex, "Error in global change handler");
                    }
                }));
            }

            await Task.WhenAll(tasks);
        }

        private string SerializeManifest(WidgetManifest manifest)
        {
            try
            {
                return JsonSerializer.Serialize(manifest, new JsonSerializerOptions
                {
                    WriteIndented = true,
                    PropertyNamingPolicy = JsonNamingPolicy.CamelCase
                });
            }
            catch
            {
                return string.Empty;
            }
        }

        private WidgetManifest? DeserializeManifest(string json)
        {
            try
            {
                return JsonSerializer.Deserialize<WidgetManifest>(json);
            }
            catch
            {
                return null;
            }
        }

        public void Dispose()
        {
            _watchTimer?.Stop();
            _watchTimer?.Dispose();
        }
    }
}
