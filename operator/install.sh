#!/usr/bin/env bash
set -euo pipefail

PAIR="${AIGHT_PAIRING_CODE:-${1:-}}"
MODEL="${AIGHT_MODEL:-llama3}"
GATEWAY_URL="${AIGHT_GATEWAY_URL:-https://aight.sbs}"
GPU_LIMIT="${AIGHT_GPU_LIMIT:-auto}"
INSTALL_ROOT="${HOME}/.aight/operator"
REPO_URL="https://github.com/percius47/Aight.git"

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is required. Install Python 3.11+ and rerun this installer." >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "Git is required. Install Git and rerun this installer." >&2
  exit 1
fi

if [ ! -d "${INSTALL_ROOT}/.git" ]; then
  git clone --filter=blob:none --sparse --branch dev "${REPO_URL}" "${INSTALL_ROOT}"
  git -C "${INSTALL_ROOT}" sparse-checkout set operator
else
  git -C "${INSTALL_ROOT}" pull
fi

cd "${INSTALL_ROOT}/operator"

if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi

".venv/bin/python" -m pip install --upgrade pip
".venv/bin/python" -m pip install -r requirements.txt

if [ -z "${PAIR}" ]; then
  read -r -p "Enter Aight pairing code: " PAIR
fi

".venv/bin/python" bootstrap.py --pair "${PAIR}" --model "${MODEL}" --gateway-url "${GATEWAY_URL}" --gpu-limit "${GPU_LIMIT}"
