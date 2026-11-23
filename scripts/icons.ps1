$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$mojiIcons = Join-Path (Split-Path -Parent $PSScriptRoot) 'extension/icons'
New-Item -ItemType Directory -Path $mojiIcons -Force | Out-Null
foreach ($mojiSize in @(16,32,48,128)) {
  $mojiBitmap = [System.Drawing.Bitmap]::new($mojiSize, $mojiSize)
  $mojiGraphics = [System.Drawing.Graphics]::FromImage($mojiBitmap)
  $mojiGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $mojiGraphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $mojiGraphics.Clear([System.Drawing.Color]::FromArgb(0,122,255))
  $mojiFont = [System.Drawing.Font]::new('Microsoft YaHei', [single]($mojiSize * 0.62), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $mojiBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255,255,255))
  $mojiFormat = [System.Drawing.StringFormat]::new()
  $mojiFormat.Alignment = [System.Drawing.StringAlignment]::Center
  $mojiFormat.LineAlignment = [System.Drawing.StringAlignment]::Center
  $mojiRect = [System.Drawing.RectangleF]::new(0, 0, $mojiSize, $mojiSize)
  $mojiGraphics.DrawString([string][char]0x58A8, $mojiFont, $mojiBrush, $mojiRect, $mojiFormat)
  $mojiBitmap.Save((Join-Path $mojiIcons "$mojiSize.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $mojiFormat.Dispose(); $mojiBrush.Dispose(); $mojiFont.Dispose(); $mojiGraphics.Dispose(); $mojiBitmap.Dispose()
}
