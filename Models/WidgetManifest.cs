using System.Text.Json.Serialization;

namespace WidgetEngine.Models
{
    public class WidgetManifest
    {
        [JsonPropertyName("name")]
        public string Name { get; set; } = string.Empty;

        [JsonPropertyName("id")]
        public string Id { get; set; } = string.Empty;

        [JsonPropertyName("description")]
        public string Description { get; set; } = string.Empty;

        [JsonPropertyName("original_author")]
        public string? OriginalAuthor { get; set; }

        [JsonPropertyName("contributor")]
        public string? Contributor { get; set; }

        [JsonPropertyName("version")]
        public string Version { get; set; } = "1.0.0";

        [JsonPropertyName("required_settings")]
        public RequiredSettings RequiredSettings { get; set; } = new();

        [JsonPropertyName("widget_features")]
        public WidgetFeatures WidgetFeatures { get; set; } = new();

        [JsonPropertyName("unique_config")]
        public Dictionary<string, object> UniqueConfig { get; set; } = new();

        [JsonPropertyName("states")]
        public WidgetStates States { get; set; } = new();

        [JsonPropertyName("extra")]
        public ExtraSettings Extra { get; set; } = new();

        // `settings_schema` replaced by per-widget Settings.json files. No longer used.
    }

    public class RequiredSettings
    {
        [JsonPropertyName("permissions")]
        public Permissions Permissions { get; set; } = new();

        [JsonPropertyName("files")]
        public WidgetFiles Files { get; set; } = new();
    }

    public class Permissions
    {
        [JsonPropertyName("keyboard")]
        public bool Keyboard { get; set; }

        [JsonPropertyName("filesystem")]
        public bool Filesystem { get; set; }

        [JsonPropertyName("network")]
        public bool Network { get; set; }

        [JsonPropertyName("overlay")]
        public bool Overlay { get; set; }

        [JsonPropertyName("exclusiveHotkeys")]
        public bool ExclusiveHotkeys { get; set; }
    }

    public class WidgetFiles
    {
        [JsonPropertyName("html")]
        public string Html { get; set; } = string.Empty;

        [JsonPropertyName("css")]
        public string Css { get; set; } = string.Empty;

        [JsonPropertyName("js")]
        public string Js { get; set; } = string.Empty;

        [JsonPropertyName("settings")]
        public string? Settings { get; set; }
    }

    public class WidgetFeatures
    {
        [JsonPropertyName("behavior")]
        public BehaviorSettings Behavior { get; set; } = new();

        [JsonPropertyName("display")]
        public DisplaySettings Display { get; set; } = new();

        [JsonPropertyName("styling")]
        public StylingSettings Styling { get; set; } = new();
    }

    public class BehaviorSettings
    {
        [JsonPropertyName("enabled")]
        public bool Enabled { get; set; } = true;

        [JsonPropertyName("draggable")]
        public bool Draggable { get; set; }

        [JsonPropertyName("clickThrough")]
        public bool ClickThrough { get; set; }

        [JsonPropertyName("lifecycle")]
        public LifecycleHooks Lifecycle { get; set; } = new();
    }

    public class LifecycleHooks
    {
        [JsonPropertyName("onInit")]
        public bool OnInit { get; set; }

        [JsonPropertyName("onDestroy")]
        public bool OnDestroy { get; set; }

        [JsonPropertyName("onSettingsUpdate")]
        public bool OnSettingsUpdate { get; set; }

        [JsonPropertyName("onFocus")]
        public bool OnFocus { get; set; }

        [JsonPropertyName("onBlur")]
        public bool OnBlur { get; set; }

        [JsonPropertyName("onResize")]
        public bool OnResize { get; set; }
    }

    public class DisplaySettings
    {
        [JsonPropertyName("position")]
        public Position Position { get; set; } = new();

        [JsonPropertyName("size")]
        public Size Size { get; set; } = new();
    }

    public class Position
    {
        [JsonPropertyName("x")]
        public int X { get; set; }

        [JsonPropertyName("y")]
        public int Y { get; set; }

        [JsonPropertyName("zIndex")]
        public int ZIndex { get; set; } = 100;
    }

    public class Size
    {
        [JsonPropertyName("width")]
        public int Width { get; set; } = 200;

        [JsonPropertyName("height")]
        public int Height { get; set; } = 100;

        [JsonPropertyName("scale")]
        public double Scale { get; set; } = 1.0;

        [JsonPropertyName("resizable")]
        public bool Resizable { get; set; }
    }

    public class StylingSettings
    {
        [JsonPropertyName("useRootVariables")]
        public bool UseRootVariables { get; set; }

        [JsonPropertyName("font")]
        public FontSettings Font { get; set; } = new();

        [JsonPropertyName("border")]
        public BorderSettings Border { get; set; } = new();

        [JsonPropertyName("background")]
        public BackgroundSettings Background { get; set; } = new();

        [JsonPropertyName("animation")]
        public AnimationSettings Animation { get; set; } = new();
    }

    public class FontSettings
    {
        [JsonPropertyName("family")]
        public string Family { get; set; } = "Arial";

        [JsonPropertyName("size")]
        public string Size { get; set; } = "24px";

        [JsonPropertyName("color")]
        public string Color { get; set; } = "#FFFFFF";

        [JsonPropertyName("widgetScaling")]
        public bool WidgetScaling { get; set; }
    }

    public class BorderSettings
    {
        [JsonPropertyName("style")]
        public string Style { get; set; } = "solid";

        [JsonPropertyName("width")]
        public string Width { get; set; } = "2px";

        [JsonPropertyName("color")]
        public string Color { get; set; } = "#FFFFFF";

        [JsonPropertyName("radius")]
        public string? Radius { get; set; }
    }

    public class BackgroundSettings
    {
        [JsonPropertyName("color")]
        public string Color { get; set; } = "#000000";

        [JsonPropertyName("alpha")]
        public double Alpha { get; set; } = 0.2;
    }

    public class AnimationSettings
    {
        [JsonPropertyName("enabled")]
        public bool Enabled { get; set; }

        [JsonPropertyName("type")]
        public string Type { get; set; } = "fade-in";

        [JsonPropertyName("duration")]
        public int Duration { get; set; } = 200;
    }

    public class WidgetStates
    {
        [JsonPropertyName("default")]
        public Dictionary<string, object> Default { get; set; } = new();

        [JsonPropertyName("recent")]
        public Dictionary<string, object> Recent { get; set; } = new();

        [JsonPropertyName("saved")]
        public Dictionary<string, object> Saved { get; set; } = new();
    }

    public class ExtraSettings
    {
        [JsonPropertyName("debug")]
        public DebugSettings Debug { get; set; } = new();

        [JsonPropertyName("subscriptions")]
        public Subscriptions Subscriptions { get; set; } = new();
    }

    public class DebugSettings
    {
        [JsonPropertyName("enabled")]
        public bool Enabled { get; set; }

        [JsonPropertyName("log_level")]
        public int LogLevel { get; set; } = 1;
    }

    public class Subscriptions
    {
        [JsonPropertyName("on_time_tick")]
        public bool OnTimeTick { get; set; }

        [JsonPropertyName("on_app_change")]
        public bool OnAppChange { get; set; }

        [JsonPropertyName("on_audio_update")]
        public bool OnAudioUpdate { get; set; }

        [JsonPropertyName("on_keybind")]
        public bool OnKeybind { get; set; }
    }

    // `SettingSchema` removed; per-widget `Settings.json` will provide UI descriptions.

    public class UpdateRequest
    {
        [JsonPropertyName("path")]
        public string Path { get; set; } = string.Empty;

        [JsonPropertyName("value")]
        public object? Value { get; set; }
    }

    public class EnableRequest
    {
        [JsonPropertyName("enabled")]
        public bool Enabled { get; set; }
    }
}
