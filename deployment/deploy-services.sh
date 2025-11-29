#!/bin/bash

# Deploy all supporting services (OG Proxy and AsciiDoctor) on remote server
# This script should be run on your remote server
# Usage: ./deploy-services.sh [path-to-wikistr-repo]
# Example: ./deploy-services.sh /root/wikistr

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

REPO_PATH="${1:-}"

echo -e "${GREEN}🚀 Deploying OG Proxy and AsciiDoctor services${NC}"
echo

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker is not running. Please start Docker first.${NC}"
    exit 1
fi

# Check if repository path was provided (optional - only needed for volume mounts)
USE_VOLUMES=false
if [ -n "${REPO_PATH}" ]; then
    # Check if repository path exists
    if [ ! -d "${REPO_PATH}" ]; then
        echo -e "${YELLOW}⚠️  Repository path not found: ${REPO_PATH}${NC}"
        echo -e "${YELLOW}   Continuing without volume mounts (files are in the Docker image)${NC}"
        USE_VOLUMES=false
    elif [ ! -f "${REPO_PATH}/deployment/proxy-server.js" ] || [ ! -f "${REPO_PATH}/deployment/asciidoctor-server.rb" ]; then
        echo -e "${YELLOW}⚠️  Required files not found in repository path${NC}"
        echo -e "${YELLOW}   Continuing without volume mounts (files are in the Docker image)${NC}"
        USE_VOLUMES=false
    else
        USE_VOLUMES=true
        echo -e "${BLUE}ℹ️  Using volume mounts for easy script updates${NC}"
    fi
else
    echo -e "${BLUE}ℹ️  No repository path provided - using files from Docker image${NC}"
    echo -e "${BLUE}   (To enable volume mounts for easy updates, provide: ./deploy-services.sh /path/to/wikistr)${NC}"
fi
echo

# Deploy OG Proxy
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}📦 Deploying OG Proxy on port 8090${NC}"
echo

# Pull or build OG Proxy image
if docker images --format '{{.Repository}}:{{.Tag}}' | grep -q "^silberengel/wikistr:latest-og-proxy$"; then
    echo -e "  ${BLUE}✓${NC} OG Proxy image already exists locally"
else
    echo -e "  ${BLUE}📥 Pulling OG Proxy image from Docker Hub...${NC}"
    if ! docker pull silberengel/wikistr:latest-og-proxy 2>/dev/null; then
        if [ "$USE_VOLUMES" = true ] && [ -n "${REPO_PATH}" ]; then
            echo -e "  ${YELLOW}⚠️  Image not found on Docker Hub, building from repository...${NC}"
            docker build -f "${REPO_PATH}/deployment/Dockerfile.og-proxy" -t silberengel/wikistr:latest-og-proxy "${REPO_PATH}"
        else
            echo -e "  ${RED}❌ Image not found on Docker Hub and no repository path provided${NC}"
            echo -e "  ${YELLOW}   Please provide repository path: ./deploy-services.sh /path/to/wikistr${NC}"
            exit 1
        fi
    fi
fi

# Stop and remove existing OG Proxy container
if docker ps -a --format '{{.Names}}' | grep -q "^og-proxy$"; then
    echo -e "  ${BLUE}🛑 Stopping existing OG Proxy container...${NC}"
    docker stop og-proxy > /dev/null 2>&1 || true
    echo -e "  ${BLUE}🗑️  Removing existing OG Proxy container...${NC}"
    docker rm og-proxy > /dev/null 2>&1 || true
fi

# Run OG Proxy container
echo -e "  ${BLUE}🚀 Starting OG Proxy container...${NC}"
if [ "$USE_VOLUMES" = true ]; then
    docker run -d \
      --name og-proxy \
      --restart always \
      -p 127.0.0.1:8090:8090 \
      -v "${REPO_PATH}/deployment/proxy-server.js:/app/deployment/proxy-server.js:ro" \
      -e PROXY_PORT=8090 \
      -e PROXY_ALLOW_ORIGIN="https://*.imwald.eu" \
      -e PROXY_TIMEOUT_MS=30000 \
      --dns 8.8.8.8 \
      --dns 8.8.4.4 \
      --dns 1.1.1.1 \
      silberengel/wikistr:latest-og-proxy
else
    docker run -d \
      --name og-proxy \
      --restart always \
      -p 127.0.0.1:8090:8090 \
      -e PROXY_PORT=8090 \
      -e PROXY_ALLOW_ORIGIN="https://*.imwald.eu" \
      -e PROXY_TIMEOUT_MS=30000 \
      --dns 8.8.8.8 \
      --dns 8.8.4.4 \
      --dns 1.1.1.1 \
      silberengel/wikistr:latest-og-proxy
fi

echo -e "  ${GREEN}✓${NC} OG Proxy container started"

# Wait and health check OG Proxy
sleep 2
if curl -f "http://localhost:8090/healthz" > /dev/null 2>&1; then
    echo -e "  ${GREEN}✓${NC} OG Proxy health check passed"
else
    echo -e "  ${YELLOW}⚠${NC} OG Proxy health check failed, but container is running"
fi

echo

# Deploy AsciiDoctor
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}📦 Deploying AsciiDoctor on port 8091${NC}"
echo

# Pull or build AsciiDoctor image
if docker images --format '{{.Repository}}:{{.Tag}}' | grep -q "^silberengel/wikistr:latest-asciidoctor$"; then
    echo -e "  ${BLUE}✓${NC} AsciiDoctor image already exists locally"
else
    echo -e "  ${BLUE}📥 Pulling AsciiDoctor image from Docker Hub...${NC}"
    if ! docker pull silberengel/wikistr:latest-asciidoctor 2>/dev/null; then
        if [ "$USE_VOLUMES" = true ] && [ -n "${REPO_PATH}" ]; then
            echo -e "  ${YELLOW}⚠️  Image not found on Docker Hub, building from repository...${NC}"
            docker build -f "${REPO_PATH}/deployment/Dockerfile.asciidoctor" -t silberengel/wikistr:latest-asciidoctor "${REPO_PATH}"
        else
            echo -e "  ${RED}❌ Image not found on Docker Hub and no repository path provided${NC}"
            echo -e "  ${YELLOW}   Please provide repository path: ./deploy-services.sh /path/to/wikistr${NC}"
            exit 1
        fi
    fi
fi

# Stop and remove existing AsciiDoctor container
if docker ps -a --format '{{.Names}}' | grep -q "^asciidoctor$"; then
    echo -e "  ${BLUE}🛑 Stopping existing AsciiDoctor container...${NC}"
    docker stop asciidoctor > /dev/null 2>&1 || true
    echo -e "  ${BLUE}🗑️  Removing existing AsciiDoctor container...${NC}"
    docker rm asciidoctor > /dev/null 2>&1 || true
fi

# Run AsciiDoctor container
echo -e "  ${BLUE}🚀 Starting AsciiDoctor container...${NC}"
if [ "$USE_VOLUMES" = true ]; then
    docker run -d \
      --name asciidoctor \
      --restart always \
      -p 127.0.0.1:8091:8091 \
      -v "${REPO_PATH}/deployment/asciidoctor-server.rb:/app/deployment/asciidoctor-server.rb:ro" \
      -e ASCIIDOCTOR_PORT=8091 \
      -e ASCIIDOCTOR_ALLOW_ORIGIN="https://*.imwald.eu" \
      -e BUNDLE_PATH=/app/deployment/vendor/bundle \
      silberengel/wikistr:latest-asciidoctor
else
    docker run -d \
      --name asciidoctor \
      --restart always \
      -p 127.0.0.1:8091:8091 \
      -e ASCIIDOCTOR_PORT=8091 \
      -e ASCIIDOCTOR_ALLOW_ORIGIN="https://*.imwald.eu" \
      -e BUNDLE_PATH=/app/deployment/vendor/bundle \
      silberengel/wikistr:latest-asciidoctor
fi

echo -e "  ${GREEN}✓${NC} AsciiDoctor container started"

# Wait and health check AsciiDoctor
sleep 3
if curl -f "http://localhost:8091/healthz" > /dev/null 2>&1; then
    echo -e "  ${GREEN}✓${NC} AsciiDoctor health check passed"
else
    echo -e "  ${YELLOW}⚠${NC} AsciiDoctor health check failed, but container is running"
fi

echo
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo
echo -e "${GREEN}✅ All services deployed successfully!${NC}"
echo
echo -e "${BLUE}📋 Deployment Summary:${NC}"
echo -e "  • OG Proxy: http://localhost:8090 (container: og-proxy)"
echo -e "  • AsciiDoctor: http://localhost:8091 (container: asciidoctor)"
echo
echo -e "${BLUE}💡 Next Steps:${NC}"
echo -e "  1. Configure Apache to proxy /sites/ to http://127.0.0.1:8090/sites/"
echo -e "  2. Configure Apache to proxy /asciidoctor/ to http://127.0.0.1:8091/"
echo -e "  3. See REMOTE_SERVER_DEPLOYMENT.md for Apache configuration details"
echo
if [ "$USE_VOLUMES" = false ]; then
    echo -e "${BLUE}ℹ️  Note: Running without volume mounts.${NC}"
    echo -e "${BLUE}   To update scripts without rebuilding, provide repository path:${NC}"
    echo -e "${BLUE}   ./deploy-services.sh /path/to/wikistr${NC}"
fi
echo
echo -e "${BLUE}💡 Useful Commands:${NC}"
echo -e "  View OG Proxy logs:    docker logs -f og-proxy"
echo -e "  View AsciiDoctor logs: docker logs -f asciidoctor"
echo -e "  Restart services:      docker restart og-proxy asciidoctor"
echo -e "  Stop services:         docker stop og-proxy asciidoctor"
echo
echo -e "${GREEN}🎉 Deployment complete!${NC}"

