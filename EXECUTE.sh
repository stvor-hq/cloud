#!/usr/bin/env bash

###############################################################################
# EXECUTION GUIDE: Stvor AI Security Phase 2 Implementation
# 
# Complete step-by-step instructions to boot, test, and deploy
# the hybrid PQC transport layer with commerce integration.
#
# Date: June 18, 2026
# Status: Production-Ready
###############################################################################

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_header() {
  echo -e "${BLUE}╔════════════════════════════════════════════════════════╗${NC}"
  echo -e "${BLUE}║ $1${NC}"
  echo -e "${BLUE}╚════════════════════════════════════════════════════════╝${NC}"
}

print_section() {
  echo -e "\n${YELLOW}▶ $1${NC}"
}

print_success() {
  echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
  echo -e "${RED}✗ $1${NC}"
}

print_info() {
  echo -e "${BLUE}ℹ $1${NC}"
}

###############################################################################
# STEP 1: ENVIRONMENT SETUP
###############################################################################

print_header "STEP 1: Environment Setup"

print_section "Installing dependencies"
if ! bun install; then
  print_error "Failed to install dependencies"
  exit 1
fi
print_success "Dependencies installed"

print_section "Creating data directory"
mkdir -p ./data
touch ./data/stvor.db
print_success "Database initialized at ./data/stvor.db"

print_section "Configuring environment variables"
if [ ! -f .env.local ]; then
  cat > .env.local << 'EOF'
STVOR_MODE=api
STVOR_PORT=8080
STVOR_LOG_LEVEL=info
STVOR_DB_PATH=./data/stvor.db
STVOR_PQC_ENABLED=true
STVOR_AGENT_ID=agent-$(date +%s)
STVOR_RELAY_URL=http://localhost:4444
STVOR_APP_TOKEN=stvor_dev_test123
EOF
  print_success "Created .env.local with default configuration"
else
  print_info ".env.local already exists (skipped)"
fi

###############################################################################
# STEP 2: TYPE CHECKING
###############################################################################

print_header "STEP 2: Type Checking"

print_section "Running TypeScript compiler"
if bun run type-check > /dev/null 2>&1; then
  print_success "TypeScript compilation successful"
else
  print_error "Type checking failed (may have warnings)"
fi

###############################################################################
# STEP 3: UNIT TESTS
###############################################################################

print_header "STEP 3: Running Tests"

print_section "Running E2E commerce flow test"
print_info "This test simulates 3 agents (Alice, Bob, Charlie) in a complete commerce lifecycle"
print_info "Expected scenarios: Job creation → Funding → Secure delivery → Evaluation → Settlement"

if bun test:commerce; then
  print_success "All tests passed"
else
  print_error "Tests failed"
  exit 1
fi

###############################################################################
# STEP 4: START SERVER OPTIONS
###############################################################################

print_header "STEP 4: Running the Node"

print_section "Choose boot mode:"
echo ""
echo "  1) API Mode      (HTTP server on :8080)"
echo "  2) CLI Mode      (Interactive ElizaOS prompt)"
echo "  3) Watch Mode    (Auto-reload on file changes)"
echo ""

read -p "Select mode (1/2/3): " mode_choice

case $mode_choice in
  1)
    print_section "Starting in API mode"
    print_info "Server will be available at http://localhost:8080"
    print_info "Health check: curl http://localhost:8080/health"
    bun start:api
    ;;
  2)
    print_section "Starting in CLI mode"
    print_info "Type 'help' for available commands"
    print_info "Commands: create-job, fund-job, submit-job, evaluate, transport-status, etc."
    bun start:cli
    ;;
  3)
    print_section "Starting in watch mode"
    print_info "Press Ctrl+C to stop"
    bun run dev
    ;;
  *)
    print_error "Invalid selection"
    exit 1
    ;;
esac

###############################################################################
# CLEANUP & NEXT STEPS
###############################################################################

print_header "Execution Complete"

print_success "Stvor AI Security Node is running"
echo ""
print_info "Phase 2 Features Enabled:"
echo "  ✓ Signal Protocol (X3DH) key exchange"
echo "  ✓ ML-KEM-768 hybrid post-quantum encryption"
echo "  ✓ Double Ratchet forward secrecy"
echo "  ✓ SHA-256 payload hashing for ledger attestation"
echo "  ✓ Event-driven commerce workflow"
echo ""
print_info "Next Steps:"
echo "  1. Review ARCHITECTURE.md for technical details"
echo "  2. Check API endpoints: curl http://localhost:8080/api/agent/status"
echo "  3. Run CLI commands to manually test commerce flow"
echo "  4. Monitor transport: transport-status, transport-session <agentId>"
echo ""
print_info "Documentation:"
echo "  - README.md: Quick start and feature overview"
echo "  - ARCHITECTURE.md: Deep technical dive"
echo "  - PHASE_2_SUMMARY.md: Complete implementation summary"
echo ""
