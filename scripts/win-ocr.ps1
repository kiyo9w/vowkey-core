param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Rest
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$mode = "text"
$filePath = $null
foreach ($arg in $Rest) {
    if ($arg -eq "--pieces") {
        $mode = "pieces"
    } elseif ($arg -eq "--classify") {
        $mode = "classify"
    } elseif ($arg -eq "--form") {
        $mode = "form"
    } elseif ($arg -eq "--front") {
        $mode = "front"
    } elseif (-not $arg.StartsWith("-")) {
        $filePath = $arg
    }
}

if ($mode -eq "front") {
    Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class VkWinFront {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
"@
    $hwnd = [VkWinFront]::GetForegroundWindow()
    $sb = New-Object System.Text.StringBuilder 1024
    [VkWinFront]::GetWindowText($hwnd, $sb, $sb.Capacity) | Out-Null
    $procId = [uint32]0
    [VkWinFront]::GetWindowThreadProcessId($hwnd, [ref]$procId) | Out-Null
    $appName = ""
    $exePath = ""
    try {
        $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if ($null -ne $proc) {
            $appName = $proc.ProcessName
            $exePath = $proc.Path
        }
    } catch {}
    @{
        app = $appName
        bundleId = $appName
        windowTitle = $sb.ToString()
        url = ""
        filePath = ""
        exePath = $exePath
        hwnd = "$hwnd"
    } | ConvertTo-Json -Compress
    exit 0
}

if (-not $filePath -or -not (Test-Path -LiteralPath $filePath)) {
    [Console]::Error.WriteLine("usage: vowkey-read [--pieces|--classify|--form|--front] FILE")
    exit 1
}

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
$asTaskAction = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction'
})[0]

function Await-WinRt($WinRtTask, $ResultType) {
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    $netTask.Wait(-1) | Out-Null
    return $netTask.Result
}

function Await-WinRtAction($WinRtAction) {
    $netTask = $asTaskAction.Invoke($null, @($WinRtAction))
    $netTask.Wait(-1) | Out-Null
}

[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Pdf.PdfPageRenderOptions, Windows.Data.Pdf, ContentType = WindowsRuntime] | Out-Null

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) {
    $lang = New-Object Windows.Globalization.Language("en-US")
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
}

function Read-SoftwareBitmap($bitmap, $pageIndex) {
    $result = Await-WinRt ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    $w = [double][Math]::Max(1, $bitmap.PixelWidth)
    $h = [double][Math]::Max(1, $bitmap.PixelHeight)
    $pieces = @()
    $heights = @()
    $linesText = @()
    foreach ($line in $result.Lines) {
        $linesText += $line.Text
        if ($line.Words.Count -eq 0) { continue }
        $minX = [double]::PositiveInfinity
        $minY = [double]::PositiveInfinity
        $maxX = 0.0
        $maxY = 0.0
        foreach ($word in $line.Words) {
            $r = $word.BoundingRect
            if ($r.X -lt $minX) { $minX = $r.X }
            if ($r.Y -lt $minY) { $minY = $r.Y }
            if (($r.X + $r.Width) -gt $maxX) { $maxX = $r.X + $r.Width }
            if (($r.Y + $r.Height) -gt $maxY) { $maxY = $r.Y + $r.Height }
        }
        $lh = $maxY - $minY
        $heights += $lh
        $pieces += @{
            text = $line.Text
            page = $pageIndex
            x = [Math]::Round($minX / $w, 4)
            y = [Math]::Round($minY / $h, 4)
            w = [Math]::Round(($maxX - $minX) / $w, 4)
            h = [Math]::Round($lh / $h, 4)
            confidence = 0.9
        }
    }
    $lineHeight = 0.0
    if ($heights.Count -gt 0) {
        $sorted = $heights | Sort-Object
        $lineHeight = [Math]::Round($sorted[[int][Math]::Floor($sorted.Count / 2)], 2)
    }
    return @{
        index = $pageIndex
        width = $w
        height = $h
        aspect = [Math]::Round($w / $h, 4)
        unsure = $(if ($pieces.Count -eq 0) { 1.0 } else { 0.0 })
        lineHeight = $lineHeight
        pieces = $pieces
        linesText = $linesText
    }
}

$resolved = (Resolve-Path -LiteralPath $filePath).Path
$storageFile = Await-WinRt ([Windows.Storage.StorageFile]::GetFileFromPathAsync($resolved)) ([Windows.Storage.StorageFile])
$ext = [System.IO.Path]::GetExtension($resolved).ToLowerInvariant()

$pagesOut = @()
$allPieces = @()
$allText = @()

if ($ext -eq ".pdf") {
    $pdfDoc = Await-WinRt ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($storageFile)) ([Windows.Data.Pdf.PdfDocument])
    $maxPages = [Math]::Min([int]$pdfDoc.PageCount, 12)
    for ($i = 0; $i -lt $maxPages; $i++) {
        $page = $pdfDoc.GetPage([uint32]$i)
        $memStream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
        $opts = New-Object Windows.Data.Pdf.PdfPageRenderOptions
        $opts.DestinationWidth = [uint32][Math]::Max(1400, [int]($page.Size.Width * 2.0))
        Await-WinRtAction ($page.RenderWithOptionsToStreamAsync($memStream, $opts))
        $memStream.Seek(0)
        $decoder = Await-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($memStream)) ([Windows.Graphics.Imaging.BitmapDecoder])
        $bitmap = Await-WinRt ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
        $pInfo = Read-SoftwareBitmap $bitmap $i
        $pagesOut += @{
            index = $pInfo.index
            aspect = $pInfo.aspect
            unsure = $pInfo.unsure
            lineHeight = $pInfo.lineHeight
            pieces = $pInfo.pieces
        }
        $allPieces += $pInfo.pieces
        $allText += $pInfo.linesText
        $page.Dispose()
        $memStream.Dispose()
    }
} else {
    $stream = Await-WinRt ($storageFile.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await-WinRt ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $pInfo = Read-SoftwareBitmap $bitmap 0
    $pagesOut += @{
        index = 0
        aspect = $pInfo.aspect
        unsure = $pInfo.unsure
        lineHeight = $pInfo.lineHeight
        pieces = $pInfo.pieces
    }
    $allPieces += $pInfo.pieces
    $allText += $pInfo.linesText
    $stream.Dispose()
}

if ($mode -eq "text") {
    foreach ($line in $allText) {
        Write-Output $line
    }
    exit 0
}

if ($mode -eq "classify") {
    $blankCount = 0
    foreach ($p in $allPieces) {
        if ($p.text -match "____|\[\s*\]|□|Please fill|Application|申請書|届書|Tờ khai") {
            $blankCount++
        }
    }
    $kind = $(if ($blankCount -ge 2) { "form" } else { "document" })
    @{
        kind = $kind
        interactiveFieldCount = 0
        pageCount = $pagesOut.Count
    } | ConvertTo-Json -Compress
    exit 0
}

if ($mode -eq "form") {
    $fields = @()
    foreach ($p in $allPieces) {
        if ($p.text -match "[:：]\s*$") {
            $clean = ($p.text -replace "[:：]\s*$", "").Trim()
            if ($clean.Length -gt 0 -and ($p.x + $p.w + 0.08) -lt 0.96) {
                $sx = [Math]::Round($p.x + $p.w + 0.015, 4)
                $sw = [Math]::Round(0.95 - $sx, 4)
                $fields += @{
                    key = "box:$($p.page):$sx`:$($p.y):$sw`:$($p.h)"
                    name = ""
                    tooltip = ""
                    label = $clean
                    type = "text"
                    maxLength = 0
                    options = @()
                }
            }
        }
    }
    @{
        pageCount = $pagesOut.Count
        interactive = $false
        fields = $fields
    } | ConvertTo-Json -Depth 6 -Compress
    exit 0
}

@{
    text = ($allText -join "`n")
    pageCount = $pagesOut.Count
    pages = $pagesOut
    pieces = $allPieces
} | ConvertTo-Json -Depth 8 -Compress
