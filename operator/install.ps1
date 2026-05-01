param(
    [string]$Pair,
    [string]$Model = "llama3",
    [string]$GatewayUrl = "https://aight.sbs",
    [string]$GpuLimit = "auto"
)

$ErrorActionPreference = "Stop"
$Pair = if ([string]::IsNullOrWhiteSpace($Pair)) { $env:AIGHT_PAIRING_CODE } else { $Pair }
$GatewayUrl = if ([string]::IsNullOrWhiteSpace($env:AIGHT_GATEWAY_URL)) { $GatewayUrl } else { $env:AIGHT_GATEWAY_URL }
$Model = if ([string]::IsNullOrWhiteSpace($env:AIGHT_MODEL)) { $Model } else { $env:AIGHT_MODEL }
$GpuLimit = if ([string]::IsNullOrWhiteSpace($env:AIGHT_GPU_LIMIT)) { $GpuLimit } else { $env:AIGHT_GPU_LIMIT }
$installRoot = Join-Path $HOME ".aight\operator"
$repoUrl = "https://github.com/percius47/Aight.git"

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    throw "Python is required. Install Python 3.11+ and rerun this installer."
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "Git is required. Install Git for Windows and rerun this installer."
}

if (-not (Test-Path $installRoot)) {
    git clone --filter=blob:none --sparse --branch dev $repoUrl $installRoot
    Push-Location $installRoot
    git sparse-checkout set operator
    Pop-Location
} else {
    Push-Location $installRoot
    git pull
    Pop-Location
}

$operatorDir = Join-Path $installRoot "operator"
$venvDir = Join-Path $operatorDir ".venv"
Push-Location $operatorDir

if (-not (Test-Path $venvDir)) {
    python -m venv .venv
}

& ".\.venv\Scripts\python.exe" -m pip install --upgrade pip
& ".\.venv\Scripts\python.exe" -m pip install -r requirements.txt

if ([string]::IsNullOrWhiteSpace($Pair)) {
    $Pair = Read-Host "Enter Aight pairing code"
}

& ".\.venv\Scripts\python.exe" bootstrap.py --pair $Pair --model $Model --gateway-url $GatewayUrl --gpu-limit $GpuLimit
Pop-Location
