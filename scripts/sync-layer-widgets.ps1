<#
.SYNOPSIS
    Copy widgets into a layer-specific widgets folder and generate a layer manifest `widget.json`.

.DESCRIPTION
    This script copies widget directories from the top-level `Widgets/` folder into a
    layer folder (e.g., `Background/widgets` or `Overlay/widgets`). It also generates
    a `widget.json` file in the target folder that contains two top-level properties:
      - `rootVariables`: object mapping canonical CSS variable names to values (parsed
          from `wwwroot/index.css` when available)
      - `enabled`: map of widgetName -> boolean indicating whether the widget is enabled

.PARAMETER Layer
    The target layer folder name (e.g., Background or Overlay). If omitted, both
    `Background` and `Overlay` will be processed.

.EXAMPLE
    # Sync all widgets into the Background layer and generate widget.json
    ./scripts/sync-layer-widgets.ps1 -Layer Background

.EXAMPLE
    # Sync both layers (Background & Overlay)
    ./scripts/sync-layer-widgets.ps1
#>

[CmdletBinding()]
param(
    [Parameter(Position=0, Mandatory=$false)]
    [ValidateSet('Background','Overlay')]
    [string]$Layer,
    [Parameter(Mandatory=$false)]
    [switch]$FullCopy
)

function Get-RootCssVariables {
    param([string]$indexCssPath)
    $vars = @{}
    if (-not (Test-Path $indexCssPath)) { return $vars }

    $content = Get-Content $indexCssPath -Raw
    # crude parse: find --name: value; lines
    foreach ($m in [regex]::Matches($content, "--([a-zA-Z0-9\-]+)\s*:\s*([^;]+);")) {
        $name = $m.Groups[1].Value
        $val = $m.Groups[2].Value.Trim()
        $vars["--$name"] = $val
    }
    return $vars
}

function Build-EnabledMap {
    param([string]$widgetsRoot)
    $map = @{}
    if (-not (Test-Path $widgetsRoot)) { return $map }
    Get-ChildItem -Path $widgetsRoot -Directory | ForEach-Object {
        $wName = $_.Name
        $manifestPath = Join-Path $_.FullName 'Manifest.json'
        $enabled = $true
        if (Test-Path $manifestPath) {
            try {
                $m = Get-Content $manifestPath -Raw | ConvertFrom-Json -ErrorAction Stop
                if ($m.widget_features -and $m.widget_features.behavior -and $m.widget_features.behavior.enabled -ne $null) {
                    $enabled = [bool]$m.widget_features.behavior.enabled
                }
            } catch { }
        }
        $map[$wName] = $enabled
    }
    return $map
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$widgetsRoot = Join-Path $repoRoot 'Widgets'
$indexCss = Join-Path $repoRoot 'wwwroot\index.css'

$layers = @()
if ($Layer) { $layers = @($Layer) } else { $layers = @('Background','Overlay') }

foreach ($L in $layers) {
    $targetWidgets = Join-Path $repoRoot "$L\widgets"

    Write-Host "Preparing layer: $L -> $targetWidgets"

    # Ensure target exists
    if (-not (Test-Path $targetWidgets)) { New-Item -ItemType Directory -Path $targetWidgets -Force | Out-Null }

    # Clear existing widget folders in the layer and copy fresh
    Get-ChildItem -Path $targetWidgets -Force -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_.PSIsContainer) { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
        else { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }
    }

    # Copy widgets (by default only copy Manifest.json to persist enabled state).
    if (Test-Path $widgetsRoot) {
        Get-ChildItem -Path $widgetsRoot -Directory | ForEach-Object {
            $src = $_.FullName
            $dst = Join-Path $targetWidgets $_.Name
            if (-not (Test-Path $dst)) { New-Item -ItemType Directory -Path $dst -Force | Out-Null }

            if ($FullCopy) {
                Copy-Item -Path $src\* -Destination $dst -Recurse -Force
            } else {
                # Only copy Manifest.json so enabling/disabling persists per-layer
                $manifestSrc = Join-Path $src 'Manifest.json'
                if (Test-Path $manifestSrc) {
                    Copy-Item -Path $manifestSrc -Destination (Join-Path $dst 'Manifest.json') -Force
                }
            }
        }
    } else {
        Write-Warning "Widgets folder not found at $widgetsRoot"
    }

    # Build widget.json: only include rootVariables (enabled state is stored per-widget Manifest.json)
    $rootVars = Get-RootCssVariables -indexCssPath $indexCss

    $manifest = [PSCustomObject]@{
        rootVariables = $rootVars
    }

    $outPath = Join-Path $targetWidgets 'widget.json'
    $manifest | ConvertTo-Json -Depth 10 | Out-File -FilePath $outPath -Encoding UTF8
    Write-Host "Wrote $outPath"
}

Write-Host "Done. Run with -Layer Background or -Layer Overlay to only sync one layer."
