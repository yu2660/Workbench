param([Parameter(Mandatory=$true)][string]$JobPath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$job = Get-Content -LiteralPath $JobPath -Raw -Encoding UTF8 | ConvertFrom-Json
$ppt = $null
$pres = $null
$hadPowerPoint = @(Get-Process POWERPNT -ErrorAction SilentlyContinue).Count -gt 0
$previousSecurity = $null
try {
    $ppt = New-Object -ComObject PowerPoint.Application
    $previousSecurity = $ppt.AutomationSecurity
    $ppt.AutomationSecurity = 3
    if ($job.action -eq 'fixture') {
        $pres = $ppt.Presentations.Add(0)
        $pres.PageSetup.SlideWidth = 960
        $pres.PageSetup.SlideHeight = 540
        for ($i = 1; $i -le 3; $i++) {
            $slide = $pres.Slides.Add($i, 12)
            $box = $slide.Shapes.AddTextbox(1, 60, 90, 800, 100)
            $box.TextFrame.TextRange.Text = "Workbench course slide $i - Select this text"
            $box.TextFrame.TextRange.Font.Size = 28
        }
        $pres.SaveAs([string]$job.source, 24)
    } else {
        $pres = $ppt.Presentations.Open([string]$job.source, 0, 0, 0)
        if ($job.action -eq 'annotate') {
            foreach ($slide in $pres.Slides) {
                for ($i = $slide.Shapes.Count; $i -ge 1; $i--) {
                    if ($slide.Shapes.Item($i).Tags.Item('WORKBENCH') -eq '1') { $slide.Shapes.Item($i).Delete() }
                }
                for ($i = $slide.Comments.Count; $i -ge 1; $i--) {
                    if ($slide.Comments.Item($i).Author -like 'Workbench:*') { $slide.Comments.Item($i).Delete() }
                }
            }
            foreach ($a in $job.annotations) {
                $slide = $pres.Slides.Item([int]$a.page)
                $sw = [double]$pres.PageSetup.SlideWidth
                $sh = [double]$pres.PageSetup.SlideHeight
                $first = $true
                foreach ($r in $a.rects) {
                    $left = [double]$r.x * $sw
                    $top = [double]$r.y * $sh
                    $width = [Math]::Max(1, [double]$r.w * $sw)
                    $height = [Math]::Max(1, [double]$r.h * $sh)
                    if ($a.type -eq 'underline') {
                        $shape = $slide.Shapes.AddLine($left, ($top + $height), ($left + $width), ($top + $height))
                        $shape.Line.ForeColor.RGB = 8560179
                        $shape.Line.Weight = 1.5
                    } elseif ($a.type -eq 'highlight') {
                        $shape = $slide.Shapes.AddShape(1, $left, $top, $width, $height)
                        $shape.Fill.ForeColor.RGB = 65535
                        $shape.Fill.Transparency = 0.55
                        $shape.Line.Visible = 0
                    } else {
                        $shape = $slide.Shapes.AddShape(1, $left, $top, 1, 1)
                        $shape.Fill.Visible = 0
                        $shape.Line.Visible = 0
                        if ($first) { $null = $slide.Comments.Add($left, $top, ('Workbench:' + [string]$a.id), 'WB', [string]$a.text) }
                    }
                    $shape.Tags.Add('WORKBENCH', '1')
                    if ($first) {
                        $raw = ConvertTo-Json -InputObject $a -Depth 15 -Compress
                        $shape.Tags.Add('WBDATA', [BitConverter]::ToString([Text.Encoding]::UTF8.GetBytes($raw)).Replace('-', ''))
                        $first = $false
                    }
                }
            }
            $pres.Save()
        }
    }
    $annotations = @()
    foreach ($slide in $pres.Slides) {
        foreach ($shape in $slide.Shapes) {
            $raw = $shape.Tags.Item('WBDATA')
            if ($raw) {
                $bytes = New-Object byte[] ($raw.Length / 2)
                for ($i = 0; $i -lt $bytes.Length; $i++) { $bytes[$i] = [Convert]::ToByte($raw.Substring($i * 2, 2), 16) }
                $annotations += ([Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json)
            }
        }
    }
    if ($job.output) {
        # Export a clean reading surface; Workbench draws its editable marks itself.
        # This changes only the in-memory presentation, after any requested save.
        foreach ($slide in $pres.Slides) {
            for ($i = $slide.Shapes.Count; $i -ge 1; $i--) {
                if ($slide.Shapes.Item($i).Tags.Item('WORKBENCH') -eq '1') { $slide.Shapes.Item($i).Delete() }
            }
        }
        # SaveAs PDF avoids the optional COM parameter marshalling differences
        # of ExportAsFixedFormat across installed Office versions.
        $pres.SaveAs([string]$job.output, 32)
        $pres.Saved = -1
    }
    @{ total = $pres.Slides.Count; width = $pres.PageSetup.SlideWidth; height = $pres.PageSetup.SlideHeight; annotations = @($annotations) } | ConvertTo-Json -Depth 20 -Compress
} finally {
    if ($pres) { $pres.Close(); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($pres) }
    if ($ppt) {
        if ($null -ne $previousSecurity) { $ppt.AutomationSecurity = $previousSecurity }
        if (-not $hadPowerPoint) { $ppt.Quit() }
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($ppt)
    }
    [GC]::Collect()
}
