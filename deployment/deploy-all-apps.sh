#!/bin/bash

# Deploy all Wikistr applications locally
# Deploys wikistr, biblestr, quranstr, torahstr, and og-proxy
# Version: v4.2

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

VERSION="v4.2"

echo -e "${GREEN}🚀 Deploying all Wikistr applications v${VERSION}${NC}"
echo

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker is not running. Please start Docker first.${NC}"
    exit 1
fi

# Stop and remove existing containers if they exist
echo -e "${BLUE}🧹 Cleaning up existing containers...${NC}"
for container in wikistr biblestr quranstr torahstr og-proxy; do
    if docker ps -a --format '{{.Names}}' | grep -q "^${container}$"; then
        echo -e "  Stopping and removing ${container}..."
        docker stop "${container}" > /dev/null 2>&1 || true
        docker rm "${container}" > /dev/null 2>&1 || true
    fi
done

echo -e "${GREEN}✅ Cleanup complete${NC}"
echo

# Create Docker network for container communication
echo -e "${BLUE}🌐 Creating Docker network...${NC}"
NETWORK_NAME="wikistr-network"
if ! docker network ls --format '{{.Name}}' | grep -q "^${NETWORK_NAME}$"; then
    docker network create ${NETWORK_NAME}
    echo -e "  ${GREEN}✓${NC} Network '${NETWORK_NAME}' created"
else
    echo -e "  ${GREEN}✓${NC} Network '${NETWORK_NAME}' already exists"
fi
echo

# Deploy applications
echo -e "${BLUE}📦 Deploying applications...${NC}"

# OG Proxy on port 8090 (deploy first so other containers can connect to it)
echo -e "  Deploying og-proxy on port 8090..."
# Get the absolute path to the parent directory (wikistr root)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARENT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

docker run -d \
  --name og-proxy \
  --network ${NETWORK_NAME} \
  -p 8090:8090 \
  -v "${PARENT_DIR}:/app:ro" \
  -w /app \
  -e PROXY_ALLOW_ORIGIN="*" \
  node:20-alpine \
  node deployment/proxy-server.js
echo -e "  ${GREEN}✓${NC} og-proxy running on http://localhost:8090"

# Wikistr on port 8080
echo -e "  Deploying wikistr on port 8080..."
docker run -d --name wikistr --network ${NETWORK_NAME} -p 8080:80 silberengel/wikistr:latest-wikistr
echo -e "  ${GREEN}✓${NC} wikistr running on http://localhost:8080"

# Biblestr on port 8081
echo -e "  Deploying biblestr on port 8081..."
docker run -d --name biblestr --network ${NETWORK_NAME} -p 8081:80 silberengel/wikistr:latest-biblestr
echo -e "  ${GREEN}✓${NC} biblestr running on http://localhost:8081"

# Quranstr on port 8082
echo -e "  Deploying quranstr on port 8082..."
docker run -d --name quranstr --network ${NETWORK_NAME} -p 8082:80 silberengel/wikistr:latest-quranstr
echo -e "  ${GREEN}✓${NC} quranstr running on http://localhost:8082"

# Torahstr on port 8083
echo -e "  Deploying torahstr on port 8083..."
docker run -d --name torahstr --network ${NETWORK_NAME} -p 8083:80 silberengel/wikistr:latest-torahstr
echo -e "  ${GREEN}✓${NC} torahstr running on http://localhost:8083"

echo
echo -e "${GREEN}✅ All applications deployed successfully!${NC}"
echo
echo -e "${BLUE}📋 Access URLs:${NC}"
echo -e "  • Wikistr:  http://localhost:8080"
echo -e "  • Biblestr: http://localhost:8081"
echo -e "  • Quranstr: http://localhost:8082"
echo -e "  • Torahstr: http://localhost:8083"
echo -e "  • OG Proxy: http://localhost:8090"
echo
echo -e "${BLUE}💡 Management commands:${NC}"
echo -e "  # View logs"
echo -e "  docker logs -f wikistr"
echo -e "  docker logs -f biblestr"
echo -e "  docker logs -f quranstr"
echo -e "  docker logs -f torahstr"
echo -e "  docker logs -f og-proxy"
echo
echo -e "  # Stop all"
echo -e "  docker stop wikistr biblestr quranstr torahstr og-proxy"
echo
echo -e "  # Remove all"
echo -e "  docker rm wikistr biblestr quranstr torahstr og-proxy"
echo
echo -e "${GREEN}🎉 Deployment complete!${NC}"

