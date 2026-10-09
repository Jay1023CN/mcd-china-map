param([switch]$NoBrowser)
# Windows PowerShell 5.1; no Python, Node.js, admin rights or HTTP.sys registration.
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$port = 8765
$url = "http://127.0.0.1:$port/index.html"
$listener = New-Object Net.Sockets.TcpListener -ArgumentList ([Net.IPAddress]::Loopback), $port
$utf8 = New-Object Text.UTF8Encoding -ArgumentList $false
$ascii = [Text.Encoding]::ASCII

function Send-Response {
    param($Stream, [int]$Status, [string]$Reason, [string]$Type, [byte[]]$Body, [bool]$HeadOnly)
    $headers = "HTTP/1.1 $Status $Reason`r`nContent-Type: $Type`r`nContent-Length: $($Body.Length)`r`nConnection: close`r`nCache-Control: no-store`r`nX-Content-Type-Options: nosniff`r`nReferrer-Policy: no-referrer`r`n`r`n"
    $bytes = $ascii.GetBytes($headers)
    $Stream.Write($bytes, 0, $bytes.Length)
    if (-not $HeadOnly -and $Body.Length -gt 0) { $Stream.Write($Body, 0, $Body.Length) }
    $Stream.Flush()
}

function Mime-Type {
    param([string]$Path)
    switch ([IO.Path]::GetExtension($Path).ToLowerInvariant()) {
        '.html' { return 'text/html; charset=utf-8' }
        '.css'  { return 'text/css; charset=utf-8' }
        '.js'   { return 'text/javascript; charset=utf-8' }
        '.json' { return 'application/json; charset=utf-8' }
        '.svg'  { return 'image/svg+xml; charset=utf-8' }
        '.txt'  { return 'text/plain; charset=utf-8' }
        '.png'  { return 'image/png' }
        '.jpg'  { return 'image/jpeg' }
        '.jpeg' { return 'image/jpeg' }
        '.webp' { return 'image/webp' }
        '.ttf'  { return 'font/ttf' }
        '.woff' { return 'font/woff' }
        '.woff2' { return 'font/woff2' }
        default { return 'application/octet-stream' }
    }
}

if (-not [IO.File]::Exists((Join-Path $projectRoot 'index.html'))) {
    Write-Host 'index.html was not found. Extract the complete project folder first.' -ForegroundColor Red
    exit 1
}

try {
    # Exclusive bind: if any program already owns this port, do not open its page.
    $listener.Server.ExclusiveAddressUse = $true
    $listener.Start()
} catch {
    Write-Host "Port $port is already in use, or the local server could not start." -ForegroundColor Red
    Write-Host 'Close the earlier launcher window and try again. No browser was opened.'
    $listener.Stop()
    exit 1
}

Write-Host 'MaiMai China Map - local only' -ForegroundColor Yellow
Write-Host $url
Write-Host 'Keep this window open. Close it or press Ctrl+C to stop the local server.'
Write-Host 'The fixed URL keeps this browser profile connected to the same journal.'
if (-not $NoBrowser) {
    try { Start-Process $url } catch { Write-Host 'Open the URL above in your browser.' }
}

try {
    while ($true) {
        # Polling makes Ctrl+C responsive even when no browser is connecting.
        if (-not $listener.Pending()) { Start-Sleep -Milliseconds 100; continue }
        $client = $listener.AcceptTcpClient()
        $stream = $null
        try {
            $client.ReceiveTimeout = 5000
            $client.SendTimeout = 5000
            $stream = $client.GetStream()
            $request = New-Object Collections.Generic.List[byte]
            $complete = $false
            while ($request.Count -lt 16384) {
                $value = $stream.ReadByte()
                if ($value -lt 0) { break }
                $request.Add([byte]$value)
                $count = $request.Count
                if ($count -ge 4 -and $request[$count-4] -eq 13 -and $request[$count-3] -eq 10 -and $request[$count-2] -eq 13 -and $request[$count-1] -eq 10) {
                    $complete = $true
                    break
                }
            }
            if (-not $complete) {
                Send-Response $stream 400 'Bad Request' 'text/plain; charset=utf-8' ($utf8.GetBytes('Invalid or oversized request.')) $false
                continue
            }
            $lines = $ascii.GetString($request.ToArray()) -split "`r`n"
            $parts = $lines[0] -split ' '
            if ($parts.Length -ne 3 -or $parts[2] -notmatch '^HTTP/1\.[01]$') {
                Send-Response $stream 400 'Bad Request' 'text/plain; charset=utf-8' ($utf8.GetBytes('Invalid request.')) $false
                continue
            }
            $headOnly = $parts[0] -eq 'HEAD'
            if ($parts[0] -ne 'GET' -and -not $headOnly) {
                Send-Response $stream 405 'Method Not Allowed' 'text/plain; charset=utf-8' ($utf8.GetBytes('Only GET and HEAD are available.')) $false
                continue
            }
            # Reject other hosts, including DNS rebinding into this loopback port.
            $hosts = @($lines | Where-Object { $_ -match '^Host:' })
            if ($hosts.Count -ne 1 -or $hosts[0] -notmatch '^Host:\s*127\.0\.0\.1:8765\s*$') {
                Send-Response $stream 400 'Bad Request' 'text/plain; charset=utf-8' ($utf8.GetBytes('Use the fixed 127.0.0.1 URL.')) $headOnly
                continue
            }
            $path = [Uri]::UnescapeDataString(($parts[1] -split '\?', 2)[0])
            if ($path -eq '/') { $path = '/index.html' }
            # Public runtime files only; never serve private/, .env or source secrets.
            $allowed = $path -eq '/index.html' -or $path -eq '/docs/china-demo.html' -or $path.StartsWith('/assets/') -or $path.StartsWith('/web/')
            $segments = $path -split '/'
            $unsafe = -not $path.StartsWith('/') -or $path.Contains('\') -or $path.Contains(':') -or $path -match '[\x00-\x1f]' -or @($segments | Where-Object { $_ -eq '..' -or $_ -eq '.' -or $_.StartsWith('.') }).Count -gt 0
            if (-not $allowed -or $unsafe) {
                Send-Response $stream 404 'Not Found' 'text/plain; charset=utf-8' ($utf8.GetBytes('Not found.')) $headOnly
                continue
            }
            $localPath = [IO.Path]::GetFullPath((Join-Path $projectRoot ($path.Substring(1).Replace('/', [IO.Path]::DirectorySeparatorChar))))
            $rootPrefix = $projectRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
            if (-not $localPath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase) -or -not [IO.File]::Exists($localPath)) {
                Send-Response $stream 404 'Not Found' 'text/plain; charset=utf-8' ($utf8.GetBytes('Not found.')) $headOnly
                continue
            }
            # A junction/symlink inside an allowed folder must not expose another path.
            $cursor = Get-Item -LiteralPath $localPath
            $linked = $false
            while ($null -ne $cursor -and $cursor.FullName -ne $projectRoot) {
                if (($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { $linked = $true; break }
                if ($cursor -is [IO.FileInfo]) { $cursor = $cursor.Directory } else { $cursor = $cursor.Parent }
            }
            if ($linked) {
                Send-Response $stream 404 'Not Found' 'text/plain; charset=utf-8' ($utf8.GetBytes('Linked files are not available.')) $headOnly
                continue
            }
            $body = [IO.File]::ReadAllBytes($localPath)
            Send-Response $stream 200 'OK' (Mime-Type $localPath) $body $headOnly
        } catch {
            # Keep listening after a browser cancels a request; never print request data.
        } finally {
            if ($null -ne $stream) { $stream.Dispose() }
            $client.Close()
        }
    }
} finally {
    $listener.Stop()
}
