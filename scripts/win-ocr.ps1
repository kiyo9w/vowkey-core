param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Rest
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$piecesMode = $false
$filePath = $null
foreach ($arg in $Rest) {
    if ($arg -eq "--pieces") {
        $piecesMode = $true
    } elseif (-not $arg.StartsWith("-")) {
        $filePath = $arg
    }
}

if (-not $filePath -or -not (Test-Path -LiteralPath $filePath)) {
    [Console]::Error.WriteLine("usage: vowkey-read [--pieces] FILE")
    exit 1
}

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await-WinRt($WinRtTask, $ResultType) {
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    $netTask.Wait(-1) | Out-Null
    return $netTask.Result
}

[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime] | Out-Null

$resolved = (Resolve-Path -LiteralPath $filePath).Path
$storageFile = Await-WinRt ([Windows.Storage.StorageFile]::GetFileFromPathAsync($resolved)) ([Windows.Storage.StorageFile])
$stream = Await-WinRt ($storageFile.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await-WinRt ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) {
    $lang = New-Object Windows.Globalization.Language("en-US")
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
}
$result = Await-WinRt ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

if (-not $piecesMode) {
    foreach ($line in $result.Lines) {
        Write-Output $line.Text
    }
    exit 0
}

$w = [double][Math]::Max(1, $bitmap.PixelWidth)
$h = [double][Math]::Max(1, $bitmap.PixelHeight)
$pieces = @()
$heights = @()

foreach ($line in $result.Lines) {
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
        x = [Math]::Round($minX / $w, 4)
        y = [Math]::Round($minY / $h, 4)
        w = [Math]::Round(($maxX - $minX) / $w, 4)
        h = [Math]::Round($lh / $h, 4)
    }
}

$lineHeight = 0.0
if ($heights.Count -gt 0) {
    $sorted = $heights | Sort-Object
    $lineHeight = [Math]::Round($sorted[[int][Math]::Floor($sorted.Count / 2)], 2)
}

$payload = @{
    pages = @(
        @{
            index = 0
            aspect = [Math]::Round($w / $h, 4)
            unsure = $(if ($pieces.Count -eq 0) { 1.0 } else { 0.0 })
            lineHeight = $lineHeight
            pieces = $pieces
        }
    )
}
$payload | ConvertTo-Json -Depth 8 -Compress
