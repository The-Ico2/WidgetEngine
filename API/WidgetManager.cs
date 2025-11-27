using System.Text.Json;
using System.Threading;
using System.Text.RegularExpressions;
using System.Reflection;
using System.Linq;
using System.Text.Json.Serialization;
using WidgetEngine.Models;

namespace WidgetEngine.API
{
    public class WidgetManager
    {
        private readonly string _widgetsPath;
        private readonly ILogger<WidgetManager>? _logger;
        private readonly Dictionary<string, WidgetManifest> _cachedManifests = new();
        private readonly System.Collections.Concurrent.ConcurrentDictionary<string, object> _fileLocks = new();

        public WidgetManager(IConfiguration configuration, ILogger<WidgetManager>? logger = null)
        {
            _logger = logger;
            var widgetsPath = configuration["WidgetEngine:WidgetsPath"] ?? "Widgets";
            _widgetsPath = Path.Combine(Directory.GetCurrentDirectory(), widgetsPath);
            
            if (!Directory.Exists(_widgetsPath))
            {
                Directory.CreateDirectory(_widgetsPath);
                _logger?.LogWarning("Widgets directory created at {Path}", _widgetsPath);
            }
        }

        /// <summary>
        /// Discovers all widgets in the Widgets folder
        /// </summary>
        public List<WidgetManifest> DiscoverWidgets(string? baseWidgetsPath = null)
        {
            var widgets = new List<WidgetManifest>();
            var widgetsPath = baseWidgetsPath ?? _widgetsPath;

            if (!Directory.Exists(widgetsPath))
            {
                _logger?.LogWarning("Widgets directory not found at {Path}", widgetsPath);
                return widgets;
            }

            foreach (var folder in Directory.GetDirectories(widgetsPath))
            {
                var folderName = Path.GetFileName(folder);
                var manifestPath = Path.Combine(folder, "Manifest.json");

                if (!File.Exists(manifestPath))
                {
                    _logger?.LogDebug("No manifest found for widget folder {Folder}", folderName);
                    continue;
                }

                try
                {
                    // Load the manifest from the correct widgets path (respect baseWidgetsPath)
                    var manifest = LoadManifest(folderName, widgetsPath);
                    if (manifest != null)
                    {
                        manifest.Name = folderName; // Ensure folder name is the internal ID
                        widgets.Add(manifest);
                    }
                }
                catch (Exception ex)
                {
                    _logger?.LogError(ex, "Failed to load manifest for widget {Widget}", folderName);
                }
            }

            return widgets;
        }

        /// <summary>
        /// Loads a widget manifest from disk
        /// </summary>
        public WidgetManifest? LoadManifest(string widgetName, string? baseWidgetsPath = null)
        {
            try
            {
            var widgetsPath = baseWidgetsPath ?? _widgetsPath;
            var manifestPath = Path.Combine(widgetsPath, widgetName, "Manifest.json");

                if (!File.Exists(manifestPath))
                {
                    _logger?.LogWarning("Manifest not found for widget {Widget} at {Path}", widgetName, manifestPath);
                    return null;
                }

                var fileLock = _fileLocks.GetOrAdd(manifestPath, _ => new object());
                string json;
                lock (fileLock)
                {
                    json = File.ReadAllText(manifestPath);
                }
                
                // Remove JSONC comments if present
                json = RemoveJsonComments(json);

                var options = new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true,
                    ReadCommentHandling = JsonCommentHandling.Skip,
                    AllowTrailingCommas = true
                };

                var manifest = JsonSerializer.Deserialize<WidgetManifest>(json, options);
                
                if (manifest != null)
                {
                    _cachedManifests[widgetName] = manifest;
                }

                return manifest;
            }
            catch (Exception ex)
            {
                _logger?.LogError(ex, "Failed to load manifest for {Widget}", widgetName);
                return null;
            }
        }

        /// <summary>
        /// Saves a widget manifest to disk
        /// </summary>
        public bool SaveManifest(string widgetName, WidgetManifest manifest, string? baseWidgetsPath = null)
        {
            try
            {
            var widgetsPath = baseWidgetsPath ?? _widgetsPath;
            var manifestPath = Path.Combine(widgetsPath, widgetName, "Manifest.json");

                // Ensure folder exists for saving
                var folder = Path.GetDirectoryName(manifestPath) ?? Path.Combine(widgetsPath, widgetName);
                if (!Directory.Exists(folder)) Directory.CreateDirectory(folder);

                var options = new JsonSerializerOptions
                {
                    WriteIndented = true,
                    PropertyNamingPolicy = JsonNamingPolicy.CamelCase
                };

                var json = JsonSerializer.Serialize(manifest, options);

                var tempPath = manifestPath + ".tmp";
                var attempts = 0;
                var fileLock = _fileLocks.GetOrAdd(manifestPath, _ => new object());

                // Before writing, check whether the on-disk manifest already matches
                // the canonical serialized form we would write. If it does, skip
                // writing to avoid triggering file-watch loops.
                lock (fileLock)
                {
                    try
                    {
                        if (File.Exists(manifestPath))
                        {
                            var existingRaw = File.ReadAllText(manifestPath);
                            existingRaw = RemoveJsonComments(existingRaw);

                            try
                            {
                                var loadOptions = new JsonSerializerOptions
                                {
                                    PropertyNameCaseInsensitive = true,
                                    ReadCommentHandling = JsonCommentHandling.Skip,
                                    AllowTrailingCommas = true
                                };

                                var existingManifest = JsonSerializer.Deserialize<WidgetManifest>(existingRaw, loadOptions);
                                if (existingManifest != null)
                                {
                                    var canonicalExisting = JsonSerializer.Serialize(existingManifest, options);
                                    if (string.Equals(canonicalExisting, json, StringComparison.Ordinal))
                                    {
                                        // Nothing to change on disk
                                        _cachedManifests[widgetName] = manifest;
                                        _logger?.LogDebug("SaveManifest: no-op for widget {Widget} (content unchanged)", widgetName);
                                        return true;
                                    }
                                }
                            }
                            catch
                            {
                                // If we can't deserialize existing file, fall back to writing
                            }
                        }
                    }
                    catch (Exception ex)
                    {
                        _logger?.LogWarning(ex, "Error checking existing manifest for {Widget}; will attempt write", widgetName);
                    }
                }

                // Perform the write with retries
                while (true)
                {
                    try
                    {
                        lock (fileLock)
                        {
                            File.WriteAllText(tempPath, json);

                            // Try atomic replace; if it fails, fall back to overwrite copy
                            try
                            {
                                File.Replace(tempPath, manifestPath, null);
                            }
                            catch
                            {
                                File.Copy(tempPath, manifestPath, true);
                                File.Delete(tempPath);
                            }
                        }

                        break;
                    }
                    catch (IOException) when (attempts < 8)
                    {
                        attempts++;
                        Thread.Sleep(50 * attempts);
                    }
                }

                // Update cache
                _cachedManifests[widgetName] = manifest;

                // Diagnostic: include thread id so we can trace frequent writes
                _logger?.LogInformation("Saved manifest for widget {Widget} (thread {ThreadId})", widgetName, Environment.CurrentManagedThreadId);
                return true;
            }
            catch (Exception ex)
            {
                _logger?.LogError(ex, "Failed to save manifest for {Widget}", widgetName);
                return false;
            }
        }

        /// <summary>
        /// Updates a specific property in the manifest using dot notation
        /// </summary>
        public void UpdateManifestProperty(WidgetManifest manifest, string path, object? value)
        {
            var keys = path.Split('.');
            object? current = manifest;

            // Navigate to the parent object, creating intermediate objects when needed
            for (int i = 0; i < keys.Length - 1; i++)
            {
                var key = keys[i];

                var property = FindProperty(current, key);

                if (property == null)
                {
                    // Try to handle dictionary properties
                    if (current is Dictionary<string, object> dict)
                    {
                        if (!dict.ContainsKey(key))
                        {
                            dict[key] = new Dictionary<string, object>();
                        }

                        // If the stored value is a JsonElement representing an object, convert it to a dictionary so we can traverse it
                        if (dict[key] is JsonElement je && je.ValueKind == JsonValueKind.Object)
                        {
                            try
                            {
                                var converted = JsonSerializer.Deserialize<Dictionary<string, object>>(je.GetRawText(), new JsonSerializerOptions
                                {
                                    PropertyNameCaseInsensitive = true
                                });
                                if (converted != null)
                                {
                                    dict[key] = converted;
                                }
                            }
                            catch
                            {
                                // leave as-is if conversion fails
                            }
                        }

                        current = dict[key];
                    }
                    else
                    {
                        throw new InvalidOperationException($"Property {key} not found");
                    }
                }
                else
                {
                    var next = property.GetValue(current);
                    if (next == null)
                    {
                        // instantiate missing intermediate object
                        next = Activator.CreateInstance(property.PropertyType);
                        if (next == null)
                        {
                            throw new InvalidOperationException($"Unable to create instance of {property.PropertyType}");
                        }
                        if (property.CanWrite)
                        {
                            property.SetValue(current, next);
                        }
                    }
                    current = next;
                }
            }

            // Set the final property
            var finalKey = keys[^1];
            if (current is Dictionary<string, object> finalDict)
            {
                // If incoming value is a JsonElement, convert to a CLR value first
                if (value is JsonElement incomingJe)
                {
                    object? converted = incomingJe.ValueKind switch
                    {
                        JsonValueKind.String => incomingJe.GetString(),
                        JsonValueKind.Number => (incomingJe.TryGetInt32(out var i) ? (object)i : incomingJe.GetDouble()),
                        JsonValueKind.True or JsonValueKind.False => incomingJe.GetBoolean(),
                        JsonValueKind.Object => JsonSerializer.Deserialize<Dictionary<string, object>>(incomingJe.GetRawText()),
                        JsonValueKind.Array => JsonSerializer.Deserialize<object[]>(incomingJe.GetRawText()),
                        _ => null
                    };

                    finalDict[finalKey] = converted ?? value!;
                }
                else
                {
                    finalDict[finalKey] = value ?? new object();
                }
            }
            else
            {
                var finalProperty = FindProperty(current, finalKey);

                if (finalProperty != null && finalProperty.CanWrite)
                {
                    object? convertedValue = null;

                    // If incoming value is a JsonElement, convert it explicitly to the target type
                    if (value is JsonElement incomingJe)
                    {
                        switch (incomingJe.ValueKind)
                        {
                            case JsonValueKind.True:
                            case JsonValueKind.False:
                                if (finalProperty.PropertyType == typeof(bool) || finalProperty.PropertyType == typeof(bool?))
                                {
                                    convertedValue = incomingJe.GetBoolean();
                                }
                                break;
                            case JsonValueKind.String:
                                if (finalProperty.PropertyType == typeof(string))
                                {
                                    convertedValue = incomingJe.GetString();
                                }
                                else
                                {
                                    // try deserialize to target type
                                    convertedValue = JsonSerializer.Deserialize(incomingJe.GetRawText(), finalProperty.PropertyType);
                                }
                                break;
                            case JsonValueKind.Number:
                                if (finalProperty.PropertyType == typeof(int) || finalProperty.PropertyType == typeof(int?))
                                {
                                    if (incomingJe.TryGetInt32(out var i)) convertedValue = i;
                                }
                                else if (finalProperty.PropertyType == typeof(long) || finalProperty.PropertyType == typeof(long?))
                                {
                                    if (incomingJe.TryGetInt64(out var l)) convertedValue = l;
                                }
                                else if (finalProperty.PropertyType == typeof(double) || finalProperty.PropertyType == typeof(double?))
                                {
                                    convertedValue = incomingJe.GetDouble();
                                }
                                else
                                {
                                    convertedValue = JsonSerializer.Deserialize(incomingJe.GetRawText(), finalProperty.PropertyType);
                                }
                                break;
                            case JsonValueKind.Object:
                            case JsonValueKind.Array:
                                convertedValue = JsonSerializer.Deserialize(incomingJe.GetRawText(), finalProperty.PropertyType);
                                break;
                            case JsonValueKind.Null:
                            case JsonValueKind.Undefined:
                            default:
                                convertedValue = null;
                                break;
                        }
                    }

                    if (convertedValue == null && value != null)
                    {
                        // Fallback to generic converter
                        convertedValue = ConvertValue(value, finalProperty.PropertyType);
                    }

                    finalProperty.SetValue(current, convertedValue);
                }
                else
                {
                    throw new InvalidOperationException($"Property {finalKey} not found or is read-only");
                }
            }
        }

        private PropertyInfo? FindProperty(object? obj, string key)
        {
            if (obj == null) return null;

            var type = obj.GetType();
            var props = type.GetProperties(BindingFlags.Public | BindingFlags.Instance);

            _logger?.LogDebug("FindProperty: searching type {Type} for key '{Key}' (props: {Count})", type.FullName, key, props.Length);

            // Direct name match (case-insensitive)
            var prop = props.FirstOrDefault(p => string.Equals(p.Name, key, StringComparison.OrdinalIgnoreCase));
            if (prop != null) return prop;

            // Match against JsonPropertyName attribute
            foreach (var p in props)
            {
                var attr = p.GetCustomAttribute<JsonPropertyNameAttribute>();
                if (attr != null && string.Equals(attr.Name, key, StringComparison.OrdinalIgnoreCase))
                    return p;
            }

            // Try snake_case -> PascalCase conversion
            var pascal = ToPascalCase(key);
            prop = props.FirstOrDefault(p => string.Equals(p.Name, pascal, StringComparison.OrdinalIgnoreCase));
            if (prop != null) return prop;

            // Try camelCase
            if (pascal.Length > 0)
            {
                var camel = char.ToLowerInvariant(pascal[0]) + pascal.Substring(1);
                prop = props.FirstOrDefault(p => string.Equals(p.Name, camel, StringComparison.OrdinalIgnoreCase));
                if (prop != null) return prop;
            }

            // If nothing matched, log candidate names for debugging
            _logger?.LogDebug("FindProperty: no match for key '{Key}' in type {Type}. Candidates: {Candidates}", key, type.FullName, string.Join(", ", props.Select(p => p.Name + (p.GetCustomAttribute<JsonPropertyNameAttribute>() is JsonPropertyNameAttribute a ? $"(json={a.Name})" : ""))));

            return null;
        }

        private static string ToPascalCase(string input)
        {
            var parts = input.Split(new[] { '_', '-', '.' }, StringSplitOptions.RemoveEmptyEntries);
            return string.Join(string.Empty, parts.Select(p => char.ToUpperInvariant(p[0]) + (p.Length > 1 ? p.Substring(1) : string.Empty)));
        }

        private object? ConvertValue(object? value, Type targetType)
        {
            if (value == null) return null;

            try
            {
                if (targetType == typeof(string))
                    return value.ToString();

                if (targetType == typeof(int))
                    return Convert.ToInt32(value);

                if (targetType == typeof(double))
                    return Convert.ToDouble(value);

                if (targetType == typeof(bool))
                    return Convert.ToBoolean(value);

                if (value is JsonElement jsonElement)
                {
                    return jsonElement.ValueKind switch
                    {
                        JsonValueKind.String => jsonElement.GetString(),
                        JsonValueKind.Number => targetType == typeof(int) ? jsonElement.GetInt32() : jsonElement.GetDouble(),
                        JsonValueKind.True or JsonValueKind.False => jsonElement.GetBoolean(),
                        JsonValueKind.Object => JsonSerializer.Deserialize(jsonElement.GetRawText(), targetType),
                        _ => value
                    };
                }

                return Convert.ChangeType(value, targetType);
            }
            catch
            {
                return value;
            }
        }

        /// <summary>
        /// Removes single-line and multi-line comments from JSON
        /// </summary>
        private string RemoveJsonComments(string json)
        {
            // Remove single-line comments
            json = Regex.Replace(json, @"//.*$", "", RegexOptions.Multiline);
            
            // Remove multi-line comments
            json = Regex.Replace(json, @"/\*.*?\*/", "", RegexOptions.Singleline);
            
            return json;
        }

        /// <summary>
        /// Gets a cached manifest if available
        /// </summary>
        public WidgetManifest? GetCachedManifest(string widgetName)
        {
            return _cachedManifests.TryGetValue(widgetName, out var manifest) ? manifest : null;
        }
    }

    public enum LayerType
    {
        Background,
        Overlay
    }
}
