using System;
using System.IO;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;
using WidgetEngine.API;
using WidgetEngine.Models;
using Microsoft.Extensions.Logging;
namespace WidgetEngine.Controllers
{
    [ApiController]
    [Route("api")]
    public class WidgetController : ControllerBase
    {
        private readonly WidgetManager _widgetManager;
        private readonly ILogger<WidgetController> _logger;

        public WidgetController(WidgetManager widgetManager, ILogger<WidgetController> logger)
        {
            _widgetManager = widgetManager;
            _logger = logger;
        }

        [HttpGet]
        public IActionResult GetApiInfo()
        {
            return Ok(new
            {
                name = "Widget Engine API",
                version = "1.0",
                status = "active"
            });
        }

        [HttpGet("widgets")]
        public IActionResult GetWidgets()
        {
            try
            {
                var basePath = GetWidgetsBasePathFromRequest();
                var widgets = _widgetManager.DiscoverWidgets(basePath);
                return Ok(widgets);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to discover widgets");
                return StatusCode(500, new { error = "Failed to discover widgets" });
            }
        }

        [HttpGet("widgets/{widgetName}")]
        public IActionResult GetWidget(string widgetName)
        {
            try
            {
                var basePath = GetWidgetsBasePathFromRequest();
                var manifest = _widgetManager.LoadManifest(widgetName, basePath);
                if (manifest == null)
                {
                    return NotFound(new { error = "Widget not found" });
                }
                return Ok(manifest);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to load manifest for {WidgetName}", widgetName);
                return StatusCode(500, new { error = "Failed to load manifest" });
            }
        }

        [HttpPost("widgets/{widgetName}")]
        public IActionResult UpdateWidget(string widgetName, [FromBody] WidgetManifest updatedManifest)
        {
            try
            {
                if (updatedManifest == null)
                {
                    return BadRequest(new { error = "Invalid JSON payload" });
                }

                var basePath = GetWidgetsBasePathFromRequest();
                var success = _widgetManager.SaveManifest(widgetName, updatedManifest, basePath);
                if (!success)
                {
                    return StatusCode(500, new { error = "Failed to write manifest" });
                }

                var manifest = _widgetManager.LoadManifest(widgetName, basePath);
                return Ok(manifest);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to update widget {WidgetName}", widgetName);
                return StatusCode(500, new { error = $"Failed to update widget: {ex.Message}" });
            }
        }

        [HttpPatch("widgets/{widgetName}")]
        public IActionResult PatchWidget(string widgetName, [FromBody] UpdateRequest request)
        {
            try
            {
                if (string.IsNullOrEmpty(request?.Path))
                {
                    return BadRequest(new { error = "Missing 'path'" });
                }

                if (request.Value == null && !Request.HasFormContentType)
                {
                    return BadRequest(new { error = "Missing 'value'" });
                }
                var basePath = GetWidgetsBasePathFromRequest();

                var manifest = _widgetManager.LoadManifest(widgetName, basePath);
                if (manifest == null)
                {
                    // If we're operating on a layer (Background/Overlay) and the layer doesn't
                    // yet contain a manifest copy, attempt to copy the canonical manifest from
                    // the top-level Widgets folder into the layer and then load it.
                    try
                    {
                        var widgetsRoot = Path.Combine(Directory.GetCurrentDirectory(), "Widgets");
                        var canonicalManifest = Path.Combine(widgetsRoot, widgetName, "Manifest.json");
                        var targetWidgetsRoot = basePath ?? Path.Combine(Directory.GetCurrentDirectory(), "Widgets");
                        var targetWidgetFolder = Path.Combine(targetWidgetsRoot, widgetName);
                        var targetManifest = Path.Combine(targetWidgetFolder, "Manifest.json");

                        if (System.IO.File.Exists(canonicalManifest))
                        {
                            if (!Directory.Exists(targetWidgetFolder)) Directory.CreateDirectory(targetWidgetFolder);
                            System.IO.File.Copy(canonicalManifest, targetManifest, overwrite: false);
                            _logger.LogInformation("Copied canonical manifest for {Widget} into layer folder: {Target}", widgetName, targetManifest);
                            // reload
                            manifest = _widgetManager.LoadManifest(widgetName, basePath);
                        }
                    }
                    catch (Exception exCopy)
                    {
                        _logger.LogWarning(exCopy, "Failed to copy canonical manifest for {Widget} into layer", widgetName);
                    }
                }

                if (manifest == null)
                {
                    return NotFound(new { error = "Widget not found" });
                }

                // Apply the update using dot notation
                _widgetManager.UpdateManifestProperty(manifest, request.Path, request.Value);

                // Save back to disk into the layer-specific folder
                var success = _widgetManager.SaveManifest(widgetName, manifest, basePath);
                if (!success)
                {
                    return StatusCode(500, new { error = "Failed to save manifest" });
                }

                return Ok(new
                {
                    status = "ok",
                    updated = new
                    {
                        path = request.Path,
                        value = request.Value
                    }
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to patch widget {WidgetName}", widgetName);
                return StatusCode(500, new { error = $"Failed to patch widget: {ex.Message}" });
            }
        }

        [HttpGet("widgets/{widgetName}/{*filename}")]
        public IActionResult ServeWidgetAsset(string widgetName, string filename)
        {
            try
            {
                var basePath = GetWidgetsBasePathFromRequest();
                var widgetsPath = basePath ?? Path.Combine(Directory.GetCurrentDirectory(), "Widgets");
                var widgetFolder = Path.Combine(widgetsPath, widgetName);
                var filePath = Path.Combine(widgetFolder, filename);

                // Security check: prevent directory traversal
                var fullWidgetPath = Path.GetFullPath(widgetFolder);
                var fullFilePath = Path.GetFullPath(filePath);

                if (!fullFilePath.StartsWith(fullWidgetPath))
                {
                    return StatusCode(403, new { error = "Forbidden" });
                }

                if (!System.IO.File.Exists(filePath))
                {
                    // If the layer folder did not include the requested asset, fall back
                    // to the canonical top-level Widgets folder so that assets (HTML/CSS/JS/Settings.json)
                    // can be served dynamically without being copied into the layer.
                    var fallbackPath = Path.Combine(Directory.GetCurrentDirectory(), "Widgets", widgetName, filename);
                    if (System.IO.File.Exists(fallbackPath))
                    {
                        filePath = fallbackPath;
                    }
                    else
                    {
                        return NotFound(new { error = "File not found" });
                    }
                }

                // Determine content type
                var provider = new FileExtensionContentTypeProvider();
                if (!provider.TryGetContentType(filename, out var contentType))
                {
                    contentType = "application/octet-stream";
                }

                var fileBytes = System.IO.File.ReadAllBytes(filePath);
                return File(fileBytes, contentType);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to serve asset {Filename} for widget {WidgetName}", filename, widgetName);
                return StatusCode(500, new { error = "Failed to serve file" });
            }
        }

        // Serve a layer-specific manifest path like: /overlay/{widgetName}/manifest.json
        // or /background/{widgetName}/manifest.json. This allows preview/frontends to
        // request the layer-local manifest directly at a predictable URL.
        // Also register an absolute route so requests to the root (e.g. http://localhost:7070/overlay/clock/manifest.json)
        // are supported (the class-level [Route("api")] would otherwise prefix this controller).
        [HttpGet("{layer}/{widgetName}/manifest.json")]
        [HttpGet("~/{layer}/{widgetName}/manifest.json")]
        public IActionResult GetLayerManifest(string layer, string widgetName)
        {
            try
            {
                if (string.IsNullOrEmpty(layer) || string.IsNullOrEmpty(widgetName)) return NotFound();
                var normalized = layer.Trim().ToLowerInvariant();
                string layerFolder;
                if (normalized == "overlay") layerFolder = Path.Combine(Directory.GetCurrentDirectory(), "Overlay", "widgets");
                else if (normalized == "background") layerFolder = Path.Combine(Directory.GetCurrentDirectory(), "Background", "widgets");
                else return NotFound(new { error = "Unknown layer" });

                var widgetFolder = Path.Combine(layerFolder, widgetName);
                var manifestPath = Path.Combine(widgetFolder, "Manifest.json");

                // Security: ensure resolved paths are contained under the layer folder
                var fullLayer = Path.GetFullPath(layerFolder);
                var fullManifest = Path.GetFullPath(manifestPath);
                if (!fullManifest.StartsWith(fullLayer)) return StatusCode(403, new { error = "Forbidden" });

                if (!System.IO.File.Exists(manifestPath))
                {
                    return NotFound(new { error = "Manifest not found" });
                }

                var json = System.IO.File.ReadAllText(manifestPath);
                return Content(json, "application/json");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to serve layer manifest for {Layer}/{WidgetName}", layer, widgetName);
                return StatusCode(500, new { error = "Failed to read manifest" });
            }
        }

        // Toggle enable/disable for a widget on a specific layer.
        // POST /api/layer/{layer}/widgets/{widgetName}/enable  { "enabled": true }
        [HttpPost("layer/{layer}/widgets/{widgetName}/enable")]
        public IActionResult SetWidgetEnabled(string layer, string widgetName, [FromBody] WidgetEngine.Models.EnableRequest req)
        {
            try
            {
                if (string.IsNullOrEmpty(layer) || string.IsNullOrEmpty(widgetName)) return BadRequest(new { error = "Invalid layer or widget" });
                var normalized = layer.Trim().ToLowerInvariant();
                string layerFolder;
                if (normalized == "overlay") layerFolder = Path.Combine(Directory.GetCurrentDirectory(), "Overlay", "widgets");
                else if (normalized == "background") layerFolder = Path.Combine(Directory.GetCurrentDirectory(), "Background", "widgets");
                else return BadRequest(new { error = "Unknown layer" });

                // Ensure layer widgets folder exists
                if (!Directory.Exists(layerFolder)) Directory.CreateDirectory(layerFolder);

                var widgetFolder = Path.Combine(layerFolder, widgetName);
                var manifestPath = Path.Combine(widgetFolder, "Manifest.json");

                // If the manifest copy doesn't exist in the layer, copy the canonical one
                var canonicalManifest = Path.Combine(Directory.GetCurrentDirectory(), "Widgets", widgetName, "Manifest.json");
                if (!Directory.Exists(widgetFolder)) Directory.CreateDirectory(widgetFolder);
                if (!System.IO.File.Exists(manifestPath) && System.IO.File.Exists(canonicalManifest))
                {
                    System.IO.File.Copy(canonicalManifest, manifestPath, overwrite: false);
                }

                // Load the manifest via WidgetManager from the layer path
                var manifest = _widgetManager.LoadManifest(widgetName, layerFolder);
                if (manifest == null)
                {
                    return NotFound(new { error = "Manifest not found" });
                }

                // Update enabled flag
                manifest.WidgetFeatures.Behavior.Enabled = req?.Enabled ?? false;

                var saveOk = _widgetManager.SaveManifest(widgetName, manifest, layerFolder);
                if (!saveOk) return StatusCode(500, new { error = "Failed to save manifest" });

                // Note: deliberate omission of writing an enabled map to layer widget.json.
                // The per-widget enabled state is persisted inside the widget's Manifest.json
                // (widget_features.behavior.enabled). Do not duplicate enabled state in widget.json.

                return Ok(manifest);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to set enabled for {Layer}/{Widget}", layer, widgetName);
                return StatusCode(500, new { error = "Failed to set enabled" });
            }
        }

        // Determine layer-specific widgets path by inspecting host port
        private string? GetWidgetsBasePathFromRequest()
        {
            try
            {
                // First, prefer an explicit preview header so that previews (which talk to the
                // dedicated backend port) can indicate which layer they represent.
                if (HttpContext?.Request?.Headers != null && HttpContext.Request.Headers.ContainsKey("X-Widget-Layer"))
                {
                    var header = (string)HttpContext.Request.Headers["X-Widget-Layer"]; // e.g., "Background" or "Overlay"
                    if (!string.IsNullOrEmpty(header))
                    {
                        var v = header.Trim().ToLowerInvariant();
                        if (v == "overlay") return Path.Combine(Directory.GetCurrentDirectory(), "Overlay", "widgets");
                        if (v == "background") return Path.Combine(Directory.GetCurrentDirectory(), "Background", "widgets");
                    }
                }

                // Fallback: infer based on the request's host port (useful when the client talks to the
                // backend on the same preview port).
                var port = HttpContext?.Request?.Host.Port;
                if (port == 7001)
                {
                    return Path.Combine(Directory.GetCurrentDirectory(), "Overlay", "widgets");
                }
                else if (port == 7000)
                {
                    return Path.Combine(Directory.GetCurrentDirectory(), "Background", "widgets");
                }

                // default to top-level Widgets folder for backward compatibility
                return Path.Combine(Directory.GetCurrentDirectory(), "Widgets");
            }
            catch
            {
                return Path.Combine(Directory.GetCurrentDirectory(), "Widgets");
            }
        }
    }
}
