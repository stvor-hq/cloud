#!/usr/bin/env bash
# Installer for Stvor AI Security demo — one-command setup

set -euo pipefail

GREEN="\033[0;32m"
YELLOW="\033[1;33m"
CYAN="\033[0;36m"
RESET="\033[0m"

NO_INSTALL=0
for arg in "$@"; do
  case "$arg" in
    --no-install) NO_INSTALL=1 ;;
  esac
done

echo -e "${CYAN}Stvor AI Security installer — preparing demo environment...${RESET}"

if [ "$NO_INSTALL" -eq 0 ]; then
  if command -v bun >/dev/null 2>&1; then
    echo -e "${GREEN}Found bun — installing JavaScript dependencies (bun install)...${RESET}"
    bun install || (echo "bun install failed" && exit 1)
  elif command -v npm >/dev/null 2>&1; then
    echo -e "${YELLOW}bun not found, falling back to npm (npm install)...${RESET}"
    npm install || (echo "npm install failed" && exit 1)
  else
    echo -e "${YELLOW}No bun or npm detected. Please install Bun or Node.js + npm and re-run.${RESET}"
    exit 1
  fi
else
  echo -e "${YELLOW}Skipping dependency installation (--no-install).${RESET}"
fi

ENV_FILE=".env"
if [ ! -f "$ENV_FILE" ]; then
  echo -e "${GREEN}Creating default .env file...${RESET}"
  cat > "$ENV_FILE" <<EOF
# Stvor AI Security demo env defaults
STVOR_RELAY_URL=http://localhost:4444
ALICE_TOKEN=stvor_test_alice
BOB_TOKEN=stvor_test_bob
CHARLIE_TOKEN=stvor_test_charlie
NODE_ENV=development
EOF
else
  echo -e "${YELLOW}.env already exists — leaving intact.${RESET}"
fi

echo -e "${CYAN}Attempting to start optional mock relay (if provided by @stvor/sdk)...${RESET}"
if command -v npx >/dev/null 2>&1; then
  if npx --no-install --yes @stvor/sdk --help >/dev/null 2>&1; then
    echo -e "${GREEN}Found @stvor/sdk CLI via npx — launching mock relay in background...${RESET}"
    (npx @stvor/sdk mock-relay >/dev/null 2>&1 &) || true
    sleep 1
    echo -e "${GREEN}Mock relay (optional) started.${RESET}"
  else
    echo -e "${YELLOW}@stvor/sdk CLI not available via npx; demo will run using internal mocks.${RESET}"
  fi
else
  echo -e "${YELLOW}npx not found — skipping mock relay launch.${RESET}"
fi

echo -e "${GREEN}Install complete.${RESET}"
echo -e "Run the demo with: ${CYAN}bun start:demo${RESET}"


# Stvor AI Security — Environment Setup with Stvor SDK
# 
# This script initializes a local development environment for the Secure Agent-to-Agent Node.
# It sets up the database, environment variables, Stvor SDK integration, and validates dependencies.

set -euo pipefail

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║  Stvor AI Security - Environment Setup (Phase 2: PQC Transport) ║"
echo "╚═══════════════════════════════════════════════════════════╝"

# Check Bun installation
if ! command -v bun &> /dev/null; then
  echo "❌ Bun is not installed. Visit https://bun.sh"
  exit 1
fi
echo "✓ Bun installed: $(bun --version)"

# Check Node.js (for type-checking)
if ! command -v node &> /dev/null; then
  echo "⚠ Node.js not found (optional, only needed for type-checking)"
else
  echo "✓ Node.js installed: $(node --version)"
fi

# Create database directory
echo ""
echo "Setting up database..."
mkdir -p ./data
touch ./data/stvor.db
echo "✓ Database initialized: ./data/stvor.db"

# Create environment file if it doesn't exist
if [ ! -f .env.local ]; then
  cat > .env.local << 'EOF'
# Stvor AI Security Environment (Phase 2: PQC Transport)
STVOR_MODE=api
STVOR_PORT=8080
STVOR_LOG_LEVEL=info
STVOR_DB_PATH=./data/stvor.db
STVOR_PQC_ENABLED=true
STVOR_AGENT_ID=agent-$(date +%s)

# Stvor SDK Configuration
STVOR_RELAY_URL=http://localhost:4444
STVOR_APP_TOKEN=stvor_dev_test123

# Optional: API configuration
# STVOR_API_TIMEOUT=30000

# Optional: Feature flags
# STVOR_EXPERIMENTAL_PQC=true
# STVOR_METRICS_ENABLED=true
EOF
  echo "✓ Created .env.local with Stvor SDK config"
else
  echo "✓ .env.local already exists"
fi

# Install dependencies
echo ""
echo "Installing dependencies (including @stvor/sdk)..."
bun install
echo "✓ Dependencies installed"

# Type-check (optional)
echo ""
echo "Type-checking TypeScript..."
if bun run type-check 2>/dev/null; then
  echo "✓ Type check passed"
else
  echo "⚠ Type check had warnings (non-fatal)"
fi

echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║  Setup Complete!                                          ║"
echo "╠═══════════════════════════════════════════════════════════╣"
echo "║  Next steps:                                              ║"
echo "║                                                           ║"
echo "║  CLI Mode:   bun start:cli                                ║"
echo "║  API Mode:   bun start:api  (or bun start)                ║"
echo "║  Watch:      bun run dev                                  ║"
echo "║  Tests:      bun test:commerce                            ║"
echo "║                                                           ║"
echo "║  API runs on http://localhost:8080                        ║"
echo "║  Health check: curl http://localhost:8080/health          ║"
echo "║                                                           ║"
echo "║  PQC Transport:                                           ║"
echo "║  - Signal Protocol (X3DH)                                 ║"
echo "║  - ML-KEM-768 Hybrid Post-Quantum                         ║"
echo "║  - Relay URL: http://localhost:4444                       ║"
echo "╚═══════════════════════════════════════════════════════════╝"
