#!/usr/bin/env bash
set -euo pipefail

PAIR="${AIGHT_PAIRING_CODE:-${1:-}}"
MODEL="${AIGHT_MODEL:-${2:-llama3}}"
GATEWAY_URL="${AIGHT_GATEWAY_URL:-http://3.7.107.134:8787}"
GPU_LIMIT="${AIGHT_GPU_LIMIT:-auto}"
INSTALL_ROOT="${HOME}/.aight/operator"
REPO_URL="https://github.com/percius47/Aight.git"

step() {
  echo "==> $1"
}

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is required. Install Python 3.11+ and rerun this installer." >&2
  exit 1
fi
step "Python found"

if ! command -v git >/dev/null 2>&1; then
  echo "Git is required. Install Git and rerun this installer." >&2
  exit 1
fi
step "Git found"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required to install Aight dependencies. Install curl and rerun this installer." >&2
  exit 1
fi
step "curl found"

resolve_ollama() {
  if command -v ollama >/dev/null 2>&1; then
    command -v ollama
    return
  fi
  if [ -x "/Applications/Ollama.app/Contents/Resources/ollama" ]; then
    echo "/Applications/Ollama.app/Contents/Resources/ollama"
    return
  fi
}

test_ollama_ready() {
  curl -fsS "http://127.0.0.1:11434/api/tags" >/dev/null 2>&1
}

wait_ollama_ready() {
  for _ in $(seq 1 30); do
    if test_ollama_ready; then
      return 0
    fi
    sleep 1
  done
  echo "Ollama was installed but did not become reachable at http://127.0.0.1:11434. Run 'ollama serve', then rerun this command." >&2
  exit 1
}

OLLAMA_BIN="$(resolve_ollama || true)"
if [ -z "${OLLAMA_BIN}" ]; then
  step "Ollama missing; installing Ollama"
  OS="$(uname -s)"
  case "${OS}" in
    Linux)
      curl -fsSL https://ollama.com/install.sh | sh
      ;;
    Darwin)
      if command -v brew >/dev/null 2>&1; then
        brew install ollama
      else
        TMP_DIR="$(mktemp -d)"
        curl -L "https://ollama.com/download/Ollama-darwin.zip" -o "${TMP_DIR}/Ollama.zip"
        unzip -q "${TMP_DIR}/Ollama.zip" -d "${TMP_DIR}"
        cp -R "${TMP_DIR}/Ollama.app" "/Applications/Ollama.app"
        rm -rf "${TMP_DIR}"
      fi
      ;;
    *)
      echo "Unsupported platform for automatic Ollama install: ${OS}" >&2
      exit 1
      ;;
  esac
  OLLAMA_BIN="$(resolve_ollama || true)"
  if [ -z "${OLLAMA_BIN}" ]; then
    echo "Ollama install finished, but the ollama command was not found. Restart the terminal and rerun this command." >&2
    exit 1
  fi
else
  step "Ollama found"
fi

if ! test_ollama_ready; then
  step "Starting Ollama"
  "${OLLAMA_BIN}" serve >/tmp/aight-ollama.log 2>&1 &
  wait_ollama_ready
else
  step "Ollama is running"
fi

if [ ! -d "${INSTALL_ROOT}/.git" ]; then
  step "Downloading Aight operator client"
  git clone --filter=blob:none --sparse --branch dev "${REPO_URL}" "${INSTALL_ROOT}"
  git -C "${INSTALL_ROOT}" sparse-checkout set operator
else
  step "Updating Aight operator client"
  git -C "${INSTALL_ROOT}" pull
fi

cd "${INSTALL_ROOT}/operator"
mkdir -p bin

CLOUDFLARED_BIN="${PWD}/bin/cloudflared"
if [ ! -x "${CLOUDFLARED_BIN}" ] && ! command -v cloudflared >/dev/null 2>&1; then
  OS="$(uname -s)"
  ARCH="$(uname -m)"
  case "${OS}-${ARCH}" in
    Linux-x86_64) CLOUDFLARED_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64" ;;
    Linux-aarch64|Linux-arm64) CLOUDFLARED_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64" ;;
    Darwin-x86_64) CLOUDFLARED_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz" ;;
    Darwin-arm64) CLOUDFLARED_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz" ;;
    *) echo "Unsupported platform for automatic cloudflared install: ${OS}-${ARCH}" >&2; exit 1 ;;
  esac

  step "cloudflared missing; downloading Cloudflare Quick Tunnel client"
  if [[ "${CLOUDFLARED_URL}" == *.tgz ]]; then
    TMP_DIR="$(mktemp -d)"
    curl -L "${CLOUDFLARED_URL}" -o "${TMP_DIR}/cloudflared.tgz"
    tar -xzf "${TMP_DIR}/cloudflared.tgz" -C "${TMP_DIR}"
    cp "${TMP_DIR}/cloudflared" "${CLOUDFLARED_BIN}"
    rm -rf "${TMP_DIR}"
  else
    curl -L "${CLOUDFLARED_URL}" -o "${CLOUDFLARED_BIN}"
  fi
  chmod +x "${CLOUDFLARED_BIN}"
fi

if [ ! -x "${CLOUDFLARED_BIN}" ] && command -v cloudflared >/dev/null 2>&1; then
  CLOUDFLARED_BIN="$(command -v cloudflared)"
else
  step "cloudflared found"
fi

if [ ! -d ".venv" ]; then
  step "Creating Python virtual environment"
  python3 -m venv .venv
else
  step "Python virtual environment found"
fi

step "Installing Python dependencies"
".venv/bin/python" -m pip install --upgrade pip
".venv/bin/python" -m pip install -r requirements.txt

if [ -z "${PAIR}" ]; then
  read -r -p "Enter Aight pairing code: " PAIR
fi

step "Pairing rig with Aight"
".venv/bin/python" bootstrap.py --pair "${PAIR}" --model "${MODEL}" --gateway-url "${GATEWAY_URL}" --gpu-limit "${GPU_LIMIT}" --cloudflared-bin "${CLOUDFLARED_BIN}" --ollama-bin "${OLLAMA_BIN}"
