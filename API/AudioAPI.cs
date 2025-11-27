using System.Collections.Concurrent;
using System.Runtime.InteropServices;

namespace WidgetEngine.API
{
    /// <summary>
    /// Manages audio events and system audio monitoring for widgets
    /// </summary>
    public class AudioAPI
    {
        private readonly ILogger<AudioAPI>? _logger;
        private readonly ConcurrentDictionary<string, AudioSubscription> _subscriptions = new();
        private readonly System.Timers.Timer _monitorTimer;
        private float _lastVolume = -1;
        private bool _lastMuteState = false;

        public delegate Task AudioEventHandler(AudioInfo info);

        public class AudioSubscription
        {
            public string WidgetName { get; set; } = string.Empty;
            public AudioEventHandler? OnVolumeChange { get; set; }
            public AudioEventHandler? OnMuteChange { get; set; }
            public AudioEventHandler? OnDeviceChange { get; set; }
            public bool Enabled { get; set; } = true;
        }

        public AudioAPI(ILogger<AudioAPI>? logger = null)
        {
            _logger = logger;

            // Monitor audio changes every 500ms
            _monitorTimer = new System.Timers.Timer(500);
            _monitorTimer.Elapsed += async (s, e) => await MonitorAudioChanges();
            _monitorTimer.AutoReset = true;
            _monitorTimer.Start();

            _logger?.LogInformation("AudioAPI initialized with monitoring timer");
        }

        /// <summary>
        /// Subscribes a widget to audio events
        /// </summary>
        public void Subscribe(string widgetName, AudioEventHandler? onVolumeChange = null,
            AudioEventHandler? onMuteChange = null, AudioEventHandler? onDeviceChange = null)
        {
            var subscription = new AudioSubscription
            {
                WidgetName = widgetName,
                OnVolumeChange = onVolumeChange,
                OnMuteChange = onMuteChange,
                OnDeviceChange = onDeviceChange,
                Enabled = true
            };

            _subscriptions[widgetName] = subscription;
            _logger?.LogInformation("Widget {Widget} subscribed to audio events", widgetName);
        }

        /// <summary>
        /// Unsubscribes a widget from audio events
        /// </summary>
        public void Unsubscribe(string widgetName)
        {
            if (_subscriptions.TryRemove(widgetName, out _))
            {
                _logger?.LogInformation("Widget {Widget} unsubscribed from audio events", widgetName);
            }
        }

        /// <summary>
        /// Gets current audio information
        /// </summary>
        public AudioInfo GetCurrentAudioInfo()
        {
            try
            {
                var volume = GetSystemVolume();
                var isMuted = GetSystemMute();

                return new AudioInfo
                {
                    Volume = volume,
                    IsMuted = isMuted,
                    Timestamp = DateTime.Now
                };
            }
            catch (Exception ex)
            {
                _logger?.LogError(ex, "Failed to get audio info");
                return new AudioInfo
                {
                    Volume = 0,
                    IsMuted = false,
                    Timestamp = DateTime.Now
                };
            }
        }

        /// <summary>
        /// Sets the system volume (0.0 to 1.0)
        /// </summary>
        public bool SetSystemVolume(float volume)
        {
            try
            {
                volume = Math.Clamp(volume, 0f, 1f);
                // Implementation would use Windows Core Audio API
                _logger?.LogInformation("System volume set to {Volume}", volume);
                return true;
            }
            catch (Exception ex)
            {
                _logger?.LogError(ex, "Failed to set system volume");
                return false;
            }
        }

        /// <summary>
        /// Sets the system mute state
        /// </summary>
        public bool SetSystemMute(bool mute)
        {
            try
            {
                // Implementation would use Windows Core Audio API
                _logger?.LogInformation("System mute set to {Mute}", mute);
                return true;
            }
            catch (Exception ex)
            {
                _logger?.LogError(ex, "Failed to set system mute");
                return false;
            }
        }

        private async Task MonitorAudioChanges()
        {
            try
            {
                var currentVolume = GetSystemVolume();
                var currentMute = GetSystemMute();
                var audioInfo = new AudioInfo
                {
                    Volume = currentVolume,
                    IsMuted = currentMute,
                    Timestamp = DateTime.Now
                };

                // Check for volume changes
                if (Math.Abs(currentVolume - _lastVolume) > 0.01f)
                {
                    _lastVolume = currentVolume;
                    await BroadcastVolumeChange(audioInfo);
                }

                // Check for mute changes
                if (currentMute != _lastMuteState)
                {
                    _lastMuteState = currentMute;
                    await BroadcastMuteChange(audioInfo);
                }
            }
            catch (Exception ex)
            {
                _logger?.LogError(ex, "Error monitoring audio changes");
            }
        }

        private async Task BroadcastVolumeChange(AudioInfo info)
        {
            var tasks = new List<Task>();

            foreach (var subscription in _subscriptions.Values.Where(s => s.Enabled && s.OnVolumeChange != null))
            {
                tasks.Add(Task.Run(async () =>
                {
                    try
                    {
                        await subscription.OnVolumeChange!(info);
                    }
                    catch (Exception ex)
                    {
                        _logger?.LogError(ex, "Error in volume change handler for widget {Widget}", subscription.WidgetName);
                    }
                }));
            }

            await Task.WhenAll(tasks);
        }

        private async Task BroadcastMuteChange(AudioInfo info)
        {
            var tasks = new List<Task>();

            foreach (var subscription in _subscriptions.Values.Where(s => s.Enabled && s.OnMuteChange != null))
            {
                tasks.Add(Task.Run(async () =>
                {
                    try
                    {
                        await subscription.OnMuteChange!(info);
                    }
                    catch (Exception ex)
                    {
                        _logger?.LogError(ex, "Error in mute change handler for widget {Widget}", subscription.WidgetName);
                    }
                }));
            }

            await Task.WhenAll(tasks);
        }

        private float GetSystemVolume()
        {
            // Placeholder - would use Windows Core Audio API (NAudio library recommended)
            // For now, return a mock value
            return 0.5f;
        }

        private bool GetSystemMute()
        {
            // Placeholder - would use Windows Core Audio API
            return false;
        }

        public void Dispose()
        {
            _monitorTimer?.Stop();
            _monitorTimer?.Dispose();
        }
    }

    public class AudioInfo
    {
        public float Volume { get; set; }
        public bool IsMuted { get; set; }
        public DateTime Timestamp { get; set; }
        public string? DeviceName { get; set; }
    }
}
