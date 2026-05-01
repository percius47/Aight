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

function Step([string]$Message) {
    Write-Host "==> $Message"
}

function Resolve-Ollama {
    $command = Get-Command ollama -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $candidates = @(
        (Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"),
        (Join-Path $env:ProgramFiles "Ollama\ollama.exe")
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    return $null
}

function Test-OllamaReady {
    try {
        Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -Method Get -TimeoutSec 3 | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Wait-OllamaReady {
    for ($i = 0; $i -lt 30; $i++) {
        if (Test-OllamaReady) {
            return
        }
        Start-Sleep -Seconds 1
    }

    throw "Ollama was installed but did not become reachable at http://127.0.0.1:11434. Open Ollama or run 'ollama serve', then rerun this command."
}

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    throw "Missing dependency: Python 3.11+. Install Python from https://www.python.org/downloads/windows/ and rerun this command."
}
Step "Python found"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "Missing dependency: Git. Install Git for Windows from https://git-scm.com/download/win and rerun this command."
}
Step "Git found"

$ollamaBin = Resolve-Ollama
if ([string]::IsNullOrWhiteSpace($ollamaBin)) {
    Step "Ollama missing; installing Ollama"
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        winget install --id Ollama.Ollama -e --accept-package-agreements --accept-source-agreements
    } else {
        $ollamaInstaller = Join-Path $env:TEMP "OllamaSetup.exe"
        Invoke-WebRequest -Uri "https://ollama.com/download/OllamaSetup.exe" -OutFile $ollamaInstaller
        Start-Process -FilePath $ollamaInstaller -ArgumentList "/S" -Wait
    }
    $ollamaBin = Resolve-Ollama
    if ([string]::IsNullOrWhiteSpace($ollamaBin)) {
        throw "Ollama install finished, but ollama.exe was not found. Restart the terminal and rerun this command."
    }
} else {
    Step "Ollama found"
}

if (-not (Test-OllamaReady)) {
    Step "Starting Ollama"
    Start-Process -FilePath $ollamaBin -ArgumentList "serve" -WindowStyle Hidden | Out-Null
    Wait-OllamaReady
} else {
    Step "Ollama is running"
}

if (-not (Test-Path $installRoot)) {
    Step "Downloading Aight operator client"
    git clone --filter=blob:none --sparse --branch dev $repoUrl $installRoot
    Push-Location $installRoot
    git sparse-checkout set operator
    Pop-Location
} else {
    Step "Updating Aight operator client"
    Push-Location $installRoot
    git pull
    Pop-Location
}

$operatorDir = Join-Path $installRoot "operator"
$venvDir = Join-Path $operatorDir ".venv"
$binDir = Join-Path $operatorDir "bin"
Push-Location $operatorDir

if (-not (Test-Path $binDir)) {
    New-Item -ItemType Directory -Path $binDir | Out-Null
}

$cloudflaredBin = Join-Path $binDir "cloudflared.exe"
if (-not (Test-Path $cloudflaredBin) -and -not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
    $cloudflaredUrl = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
    Step "cloudflared missing; downloading Cloudflare Quick Tunnel client"
    Invoke-WebRequest -Uri $cloudflaredUrl -OutFile $cloudflaredBin
} else {
    Step "cloudflared found"
}

if (-not (Test-Path $venvDir)) {
    Step "Creating Python virtual environment"
    python -m venv .venv
} else {
    Step "Python virtual environment found"
}

Step "Installing Python dependencies"
& ".\.venv\Scripts\python.exe" -m pip install --upgrade pip
& ".\.venv\Scripts\python.exe" -m pip install -r requirements.txt

if ([string]::IsNullOrWhiteSpace($Pair)) {
    $Pair = Read-Host "Enter Aight pairing code"
}

$cloudflaredArg = if (Test-Path $cloudflaredBin) { $cloudflaredBin } else { "cloudflared" }
Step "Pairing rig with Aight"
& ".\.venv\Scripts\python.exe" bootstrap.py --pair $Pair --model $Model --gateway-url $GatewayUrl --gpu-limit $GpuLimit --cloudflared-bin $cloudflaredArg --ollama-bin $ollamaBin
Pop-Location
