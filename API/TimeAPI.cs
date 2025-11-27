using System.Collections.Concurrent;

namespace WidgetEngine.API
{
    /// <summary>
    /// Manages time-based events and subscriptions for widgets
    /// </summary>
    public class TimeAPI
    {
        private readonly ILogger<TimeAPI>? _logger;
        private readonly ConcurrentDictionary<string, TimeSubscription> _subscriptions = new();
        private readonly System.Timers.Timer _tickTimer;
        private readonly System.Timers.Timer _secondTimer;
        private readonly System.Timers.Timer _minuteTimer;

        public delegate Task TimeTickHandler(DateTime time);

        public class TimeSubscription
        {
            public string WidgetName { get; set; } = string.Empty;
            public TimeTickHandler? OnTick { get; set; }
            public TimeTickHandler? OnSecond { get; set; }
            public TimeTickHandler? OnMinute { get; set; }
            public bool Enabled { get; set; } = true;
        }

        public TimeAPI(ILogger<TimeAPI>? logger = null)
        {
            _logger = logger;

            // High-frequency tick timer (100ms for millisecond displays)
            _tickTimer = new System.Timers.Timer(100);
            _tickTimer.Elapsed += async (s, e) => await BroadcastTick();
            _tickTimer.AutoReset = true;
            _tickTimer.Start();

            // Second timer
            _secondTimer = new System.Timers.Timer(1000);
            _secondTimer.Elapsed += async (s, e) => await BroadcastSecond();
            _secondTimer.AutoReset = true;
            _secondTimer.Start();

            // Minute timer
            _minuteTimer = new System.Timers.Timer(60000);
            _minuteTimer.Elapsed += async (s, e) => await BroadcastMinute();
            _minuteTimer.AutoReset = true;
            _minuteTimer.Start();

            _logger?.LogInformation("TimeAPI initialized with tick timers");
        }

        /// <summary>
        /// Subscribes a widget to time events
        /// </summary>
        public void Subscribe(string widgetName, TimeTickHandler? onTick = null, 
            TimeTickHandler? onSecond = null, TimeTickHandler? onMinute = null)
        {
            var subscription = new TimeSubscription
            {
                WidgetName = widgetName,
                OnTick = onTick,
                OnSecond = onSecond,
                OnMinute = onMinute,
                Enabled = true
            };

            _subscriptions[widgetName] = subscription;
            _logger?.LogInformation("Widget {Widget} subscribed to time events", widgetName);
        }

        /// <summary>
        /// Unsubscribes a widget from time events
        /// </summary>
        public void Unsubscribe(string widgetName)
        {
            if (_subscriptions.TryRemove(widgetName, out _))
            {
                _logger?.LogInformation("Widget {Widget} unsubscribed from time events", widgetName);
            }
        }

        /// <summary>
        /// Enables or disables a subscription
        /// </summary>
        public void SetSubscriptionEnabled(string widgetName, bool enabled)
        {
            if (_subscriptions.TryGetValue(widgetName, out var subscription))
            {
                subscription.Enabled = enabled;
            }
        }

        /// <summary>
        /// Gets the current time in various formats
        /// </summary>
        public TimeInfo GetCurrentTime()
        {
            var now = DateTime.Now;
            return new TimeInfo
            {
                DateTime = now,
                Unix = new DateTimeOffset(now).ToUnixTimeSeconds(),
                UnixMs = new DateTimeOffset(now).ToUnixTimeMilliseconds(),
                Formatted24h = now.ToString("HH:mm:ss"),
                Formatted12h = now.ToString("hh:mm:ss tt"),
                Date = now.ToString("yyyy-MM-dd"),
                Time = now.ToString("HH:mm:ss"),
                Hour = now.Hour,
                Minute = now.Minute,
                Second = now.Second,
                Millisecond = now.Millisecond
            };
        }

        private async Task BroadcastTick()
        {
            var now = DateTime.Now;
            var tasks = new List<Task>();

            foreach (var subscription in _subscriptions.Values.Where(s => s.Enabled && s.OnTick != null))
            {
                tasks.Add(Task.Run(async () =>
                {
                    try
                    {
                        await subscription.OnTick!(now);
                    }
                    catch (Exception ex)
                    {
                        _logger?.LogError(ex, "Error in tick handler for widget {Widget}", subscription.WidgetName);
                    }
                }));
            }

            await Task.WhenAll(tasks);
        }

        private async Task BroadcastSecond()
        {
            var now = DateTime.Now;
            var tasks = new List<Task>();

            foreach (var subscription in _subscriptions.Values.Where(s => s.Enabled && s.OnSecond != null))
            {
                tasks.Add(Task.Run(async () =>
                {
                    try
                    {
                        await subscription.OnSecond!(now);
                    }
                    catch (Exception ex)
                    {
                        _logger?.LogError(ex, "Error in second handler for widget {Widget}", subscription.WidgetName);
                    }
                }));
            }

            await Task.WhenAll(tasks);
        }

        private async Task BroadcastMinute()
        {
            var now = DateTime.Now;
            var tasks = new List<Task>();

            foreach (var subscription in _subscriptions.Values.Where(s => s.Enabled && s.OnMinute != null))
            {
                tasks.Add(Task.Run(async () =>
                {
                    try
                    {
                        await subscription.OnMinute!(now);
                    }
                    catch (Exception ex)
                    {
                        _logger?.LogError(ex, "Error in minute handler for widget {Widget}", subscription.WidgetName);
                    }
                }));
            }

            await Task.WhenAll(tasks);
        }

        public void Dispose()
        {
            _tickTimer?.Stop();
            _tickTimer?.Dispose();
            _secondTimer?.Stop();
            _secondTimer?.Dispose();
            _minuteTimer?.Stop();
            _minuteTimer?.Dispose();
        }
    }

    public class TimeInfo
    {
        public DateTime DateTime { get; set; }
        public long Unix { get; set; }
        public long UnixMs { get; set; }
        public string Formatted24h { get; set; } = string.Empty;
        public string Formatted12h { get; set; } = string.Empty;
        public string Date { get; set; } = string.Empty;
        public string Time { get; set; } = string.Empty;
        public int Hour { get; set; }
        public int Minute { get; set; }
        public int Second { get; set; }
        public int Millisecond { get; set; }
    }
}
