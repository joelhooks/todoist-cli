#!/usr/bin/env bash
# todoist-cli installer
# curl -fsSL https://raw.githubusercontent.com/joelhooks/todoist-cli/main/install.sh | bash
set -euo pipefail

REPO="joelhooks/todoist-cli"
INSTALL_DIR="${TODOIST_CLI_DIR:-/usr/local/bin}"

# Detect platform
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$OS" in
  darwin) OS="darwin" ;;
  linux)  OS="linux" ;;
  *) echo "Unsupported OS: $OS" >&2; exit 1 ;;
esac

case "$ARCH" in
  x86_64|amd64) ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

BINARY="todoist-cli-${OS}-${ARCH}"
echo "Installing todoist-cli for ${OS}/${ARCH}..."

# Get latest release URL
DOWNLOAD_URL=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
  | grep "browser_download_url.*${BINARY}" \
  | cut -d '"' -f 4)

if [ -z "$DOWNLOAD_URL" ]; then
  echo "Error: No binary found for ${OS}/${ARCH}" >&2
  echo "Available at: https://github.com/${REPO}/releases" >&2
  exit 1
fi

# Download
TMP=$(mktemp)
echo "Downloading ${DOWNLOAD_URL}..."
curl -fsSL "$DOWNLOAD_URL" -o "$TMP"
chmod +x "$TMP"

# Install
if [ -w "$INSTALL_DIR" ]; then
  mv "$TMP" "${INSTALL_DIR}/todoist-cli"
else
  echo "Installing to ${INSTALL_DIR} (requires sudo)..."
  sudo mv "$TMP" "${INSTALL_DIR}/todoist-cli"
fi

echo ""
echo "✓ todoist-cli installed to ${INSTALL_DIR}/todoist-cli"
echo ""
echo "Set your API token:"
echo "  export TODOIST_API_TOKEN=<token from https://app.todoist.com/app/settings/integrations/developer>"
echo ""
echo "Or use agent-secrets:"
echo "  secrets add todoist_api_token"
echo ""
echo "Verify:"
echo "  todoist-cli help"
