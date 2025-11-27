using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using WidgetEngine.API;

namespace WidgetEngine
{
    public class Program
    {
        public static void Main(string[] args)
        {
            var builder = WebApplication.CreateBuilder(args);

            // Add services to the container
            builder.Services.AddControllers();
            builder.Services.AddEndpointsApiExplorer();
            builder.Services.AddCors(options =>
            {
                options.AddDefaultPolicy(policy =>
                {
                    policy.AllowAnyOrigin()
                          .AllowAnyMethod()
                          .AllowAnyHeader();
                });
            });

            // Register singleton services
            builder.Services.AddSingleton<WidgetManager>();
            builder.Services.AddSingleton<TimeAPI>();
            builder.Services.AddSingleton<AudioAPI>();
            builder.Services.AddSingleton<InputAPI>();
            builder.Services.AddSingleton<WatcherAPI>();

            // Configure Kestrel to listen on three ports:
            // - Background preview: 7000
            // - Overlay preview:    7001
            // - Backend API:        7070
            try
            {
                builder.WebHost.ConfigureKestrel(options =>
                {
                    options.ListenLocalhost(7000);
                    options.ListenLocalhost(7001);
                    options.ListenLocalhost(7070);
                });
            }
            catch
            {
                // Ignore if Kestrel configuration cannot be modified in the current environment
            }

            var app = builder.Build();

            // Configure the HTTP request pipeline
            // Swagger / OpenAPI tooling removed for now to keep the minimal runtime dependencies.

            app.UseCors();

            // Route preview ports (7000 & 7001) to a lightweight static preview site so
            // you can open Background/Overlay in the browser for preview. The preview
            // will rewrite the `index.html` on-the-fly to set `window.BACKEND_URL` to the
            // backend API (7070) so the preview UI talks to the single backend.

            app.MapWhen(ctx => ctx.Connection.LocalPort == 7000 || ctx.Connection.LocalPort == 7001, previewApp =>
            {
                // Serve static assets from wwwroot for previews
                var fileProvider = new Microsoft.Extensions.FileProviders.PhysicalFileProvider(
                    Path.Combine(Directory.GetCurrentDirectory(), "wwwroot"));

                previewApp.Use(async (ctx, next) =>
                {
                    // Rewrite root index to inject backend URL that points to 7070
                    if (ctx.Request.Path == "/" || ctx.Request.Path == "/index.html")
                    {
                        var indexPath = Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", "index.html");
                        if (System.IO.File.Exists(indexPath))
                        {
                            var content = await System.IO.File.ReadAllTextAsync(indexPath);
                            // Replace dynamic origin assignment with fixed backend URL and inject the preview layer
                            var layerName = ctx.Connection.LocalPort == 7000 ? "Background" : "Overlay";
                            content = content.Replace("window.BACKEND_URL = window.location.origin;", $"window.BACKEND_URL = 'http://localhost:7070';\nwindow.WIDGET_LAYER = '{layerName}';");
                            ctx.Response.ContentType = "text/html";
                            await ctx.Response.WriteAsync(content);
                            return;
                        }
                    }
                    await next();
                });

                previewApp.UseStaticFiles(new Microsoft.AspNetCore.Builder.StaticFileOptions
                {
                    FileProvider = fileProvider,
                    ServeUnknownFileTypes = true
                });
            });

            // Serve API universal scripts under /API for all ports
            app.UseFileServer(new Microsoft.AspNetCore.Builder.FileServerOptions
            {
                FileProvider = new Microsoft.Extensions.FileProviders.PhysicalFileProvider(
                    Path.Combine(Directory.GetCurrentDirectory(), "API")),
                RequestPath = "/API",
                EnableDirectoryBrowsing = false
            });

            app.UseRouting();
            app.UseAuthorization();
            app.MapControllers();

            // Serve index.html at root only for preview ports (7000 & 7001).
            // The backend API port (7070) should not serve the preview UI.
            app.MapGet("/", async context =>
            {
                var localPort = context.Connection.LocalPort;
                if (localPort == 7000 || localPort == 7001)
                {
                    context.Response.ContentType = "text/html";
                    var indexPath = Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", "index.html");
                    if (File.Exists(indexPath))
                    {
                        // If the MapWhen preview middleware already handled the rewrite, it will have returned.
                        // Here we still read and rewrite the index to inject backend URL + layer for preview ports.
                        var content = await File.ReadAllTextAsync(indexPath);
                        var layerName = localPort == 7000 ? "Background" : "Overlay";
                        content = content.Replace("window.BACKEND_URL = window.location.origin;", $"window.BACKEND_URL = 'http://localhost:7070';\nwindow.WIDGET_LAYER = '{layerName}';");
                        context.Response.ContentType = "text/html";
                        await context.Response.WriteAsync(content);
                    }
                    else
                    {
                        context.Response.StatusCode = 404;
                        await context.Response.WriteAsync("index.html not found");
                    }
                }
                else
                {
                    // For the API/Backend port, do not return the UI index.
                    context.Response.StatusCode = 404;
                    await context.Response.WriteAsync("Not Found");
                }
            });

            // Install global handlers to capture unhandled exceptions from background threads
            AppDomain.CurrentDomain.UnhandledException += (s, e) =>
            {
                var ex = e.ExceptionObject as Exception;
                var logger = app.Services.GetService<ILoggerFactory>()?.CreateLogger("Global");
                if (ex != null)
                    logger?.LogCritical(ex, "Unhandled exception (AppDomain)");
                else
                    logger?.LogCritical("Unhandled exception object: {Obj}", e.ExceptionObject);
            };

            TaskScheduler.UnobservedTaskException += (s, e) =>
            {
                var logger = app.Services.GetService<ILoggerFactory>()?.CreateLogger("Global");
                logger?.LogCritical(e.Exception, "Unobserved task exception");
                e.SetObserved();
            };

            try
            {
                app.Run();
            }
            catch (Exception ex)
            {
                var logger = app.Services.GetService<ILoggerFactory>()?.CreateLogger("Program");
                logger?.LogCritical(ex, "Host terminated unexpectedly");
                throw;
            }
        }
    }
}
