# Reads ~/.cpa/query.json (written by the CPA quota tool), queries /v1/usage and
# /v1/quota through the saved loopback proxy, and prints a small JSON summary.
# The API key stays in this process; only numbers reach the mod.
# Kept ASCII-only: Windows PowerShell 5.1 reads a BOM-less script as the ANSI code page.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# Windows PowerShell 5.1 may not offer TLS 1.2 by default.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

function Out-Summary($Value) {
    [Console]::Out.Write(($Value | ConvertTo-Json -Depth 8 -Compress))
}

# UTC with milliseconds (2026-11-01T23:00:00.317Z), a form every Date.parse reads; null when unreadable.
function ConvertTo-Iso($Value) {
    if ($null -eq $Value) { return $null }
    $time = [DateTimeOffset]::MinValue
    if ($Value -is [DateTimeOffset]) { $time = $Value }
    elseif ($Value -is [DateTime]) { $time = [DateTimeOffset]$Value.ToUniversalTime() }
    elseif (-not ($Value -is [string] -and [DateTimeOffset]::TryParse($Value, [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::AssumeUniversal, [ref]$time))) { return $null }
    return $time.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", [Globalization.CultureInfo]::InvariantCulture)
}

function Get-Number($Value) {
    if ($null -eq $Value -or $Value -is [bool] -or $Value -is [string]) { return $null }
    try { $number = [double]$Value } catch { return $null }
    if ([double]::IsNaN($number) -or [double]::IsInfinity($number)) { return $null }
    return $number
}

function Get-Totals($Row) {
    $modern = $null -ne $Row.PSObject.Properties['estimated_cost_usd']
    $cost = Get-Number $(if ($modern) { $Row.estimated_cost_usd } else { $Row.estimated_cost_usd_high })
    $read = Get-Number $Row.cache_read_tokens; $inTokens = Get-Number $Row.input_tokens
    $cache = if ($null -ne $read -and $null -ne $inTokens -and $inTokens -gt 0 -and $read -le $inTokens) { $read / $inTokens * 100 } else { $null }
    $requests = Get-Number $Row.requests; $priced = Get-Number $Row.priced_requests
    return [ordered]@{
        requests = $requests
        failed = Get-Number $Row.failed_requests
        tokens = Get-Number $Row.total_tokens
        cachePct = $cache
        cost = $cost
        approx = ((Get-Number $Row.cache_ttl_unknown_requests) -gt 0) -or (-not $modern -and $Row.estimated_cost_usd_low -ne $Row.estimated_cost_usd_high)
        partial = ($null -ne $priced -and $null -ne $requests -and $priced -lt $requests)
    }
}

# An error code the mod turns into words: http-<status>, or http-0 when nothing answered.
function Get-ErrorCode($Record) {
    $status = 0
    if ($Record.Exception.Response) { $status = [int]$Record.Exception.Response.StatusCode }
    return "http-$status"
}

$path = Join-Path (Join-Path $env:USERPROFILE '.cpa') 'query.json'
try {
    $config = [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8) | ConvertFrom-Json
} catch {
    Out-Summary @{ error = 'no-config' }
    exit 0
}
if ($config.api_key -isnot [string] -or $config.base_url -isnot [string] -or $config.base_url -notmatch '^https://' -or
    $config.proxy_url -isnot [string] -or $config.proxy_url -notmatch '^http://(127\.0\.0\.1|\[::1\]):\d+/?$') {
    Out-Summary @{ error = 'bad-config' }
    exit 0
}
$base = $config.base_url.TrimEnd('/')
if ($base.EndsWith('/v1')) { $base = $base.Substring(0, $base.Length - 3) }
$proxy = $config.proxy_url
$headers = @{ Authorization = 'Bearer ' + $config.api_key; Accept = 'application/json' }

function Invoke-Cpa([string]$Path) {
    return Invoke-RestMethod -Uri ($base + $Path) -Headers $headers -Method Get -Proxy $proxy `
        -UseBasicParsing -MaximumRedirection 0 -TimeoutSec 20
}

$summary = [ordered]@{ proxy = $proxy; usage = $null; usageError = $null; quota = $null; quotaError = $null }

try {
    $data = Invoke-Cpa '/v1/usage?period=overview'
    $windows = @()
    foreach ($row in @($data.windows)) {
        $entry = Get-Totals $row.totals
        $entry.period = [string]$row.period
        $windows += $entry
    }
    $summary.usage = [ordered]@{ asOf = ConvertTo-Iso $data.as_of; windows = $windows }
} catch { $summary.usageError = Get-ErrorCode $_ }

try {
    $data = Invoke-Cpa '/v1/quota'
    $accounts = @(); $index = 0
    foreach ($account in @($data.accounts)) {
        $index++
        $windows = @()
        if ($account.windows) {
            foreach ($row in @($account.windows.PSObject.Properties | Where-Object { $_.Name -cin @('five_hour', 'seven_day') })) {
                $remaining = Get-Number $row.Value.remaining_percent
                if ($null -ne $remaining -and ($remaining -lt 0 -or $remaining -gt 100)) { $remaining = $null }
                $windows += [ordered]@{
                    name = $(if ($row.Name -ceq 'five_hour') { '5h' } else { '7d' })
                    remaining = $remaining
                    resetsAt = ConvertTo-Iso $row.Value.resets_at
                }
            }
        }
        $accounts += [ordered]@{
            label = 'A{0:00}' -f $index
            enabled = $account.enabled -eq $true
            stale = $account.stale -ne $false
            windows = $windows
        }
    }
    $summary.quota = [ordered]@{ checkedAt = ConvertTo-Iso $data.checked_at; accounts = $accounts }
} catch { $summary.quotaError = Get-ErrorCode $_ }

Out-Summary $summary
