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

VERSION="v5.3.0"

echo -e "${GREEN}🚀 Deploying all Wikistr applications version ${VERSION}${NC}"
echo

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker is not running. Please start Docker first.${NC}"
    exit 1
fi

# Stop and remove existing containers if they exist
echo -e "${BLUE}🧹 Cleaning up existing containers...${NC}"
for container in wikistr biblestr quranstr torahstr og-proxy asciidoctor; do
    if docker ps -a --format '{{.Names}}' | grep -q "^${container}$"; then
        echo -e "  Stopping and removing ${container}..."
        docker stop "${container}" > /dev/null 2>&1 || true
        docker rm "${container}" > /dev/null 2>&1 || true
    fi
done
# Also clean up docker-compose containers (they have different names like deployment_og-proxy_1)
for container in deployment_og-proxy_1 deployment_asciidoctor_1; do
    if docker ps -a --format '{{.Names}}' | grep -q "^${container}$"; then
        echo -e "  Stopping and removing ${container}..."
        docker stop "${container}" > /dev/null 2>&1 || true
        docker rm "${container}" > /dev/null 2>&1 || true
    fi
done
# Also check for any container using port 8090 or 8091
if docker ps --format '{{.Names}}\t{{.Ports}}' | grep -q ":8090->"; then
    CONTAINER_8090=$(docker ps --format '{{.Names}}\t{{.Ports}}' | grep ":8090->" | awk '{print $1}' | head -1)
    if [ -n "$CONTAINER_8090" ] && [ "$CONTAINER_8090" != "og-proxy" ]; then
        echo -e "  Stopping container using port 8090: ${CONTAINER_8090}..."
        docker stop "${CONTAINER_8090}" > /dev/null 2>&1 || true
        docker rm "${CONTAINER_8090}" > /dev/null 2>&1 || true
    fi
fi
if docker ps --format '{{.Names}}\t{{.Ports}}' | grep -q ":8091->"; then
    CONTAINER_8091=$(docker ps --format '{{.Names}}\t{{.Ports}}' | grep ":8091->" | awk '{print $1}' | head -1)
    if [ -n "$CONTAINER_8091" ] && [ "$CONTAINER_8091" != "asciidoctor" ]; then
        echo -e "  Stopping container using port 8091: ${CONTAINER_8091}..."
        docker stop "${CONTAINER_8091}" > /dev/null 2>&1 || true
        docker rm "${CONTAINER_8091}" > /dev/null 2>&1 || true
    fi
fi

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

# Check if port 8090 is already in use and stop any container using it
if docker ps --format '{{.Names}}\t{{.Ports}}' | grep -q ":8090->"; then
    CONTAINER_USING_PORT=$(docker ps --format '{{.Names}}\t{{.Ports}}' | grep ":8090->" | awk '{print $1}' | head -1)
    if [ -n "$CONTAINER_USING_PORT" ]; then
        echo -e "    Stopping existing container using port 8090: ${CONTAINER_USING_PORT}..."
        docker stop "${CONTAINER_USING_PORT}" > /dev/null 2>&1 || true
        docker rm "${CONTAINER_USING_PORT}" > /dev/null 2>&1 || true
    fi
fi

# Check if image exists, if not build it
if ! docker images --format '{{.Repository}}:{{.Tag}}' | grep -q "silberengel/wikistr:latest-og-proxy"; then
    echo -e "    Building og-proxy image..."
    docker build -f "${PARENT_DIR}/deployment/Dockerfile.og-proxy" -t silberengel/wikistr:latest-og-proxy "${PARENT_DIR}"
fi

docker run -d \
  --name og-proxy \
  --restart always \
  --network ${NETWORK_NAME} \
  -p 127.0.0.1:8090:8090 \
  -v "${PARENT_DIR}/deployment/proxy-server.js:/app/deployment/proxy-server.js:ro" \
  -w /app/deployment \
  -e PROXY_PORT=8090 \
  -e PROXY_ALLOW_ORIGIN="*" \
  -e PROXY_TIMEOUT_MS=30000 \
  --dns 8.8.8.8 \
  --dns 8.8.4.4 \
  --dns 1.1.1.1 \
  silberengel/wikistr:latest-og-proxy
echo -e "  ${GREEN}✓${NC} og-proxy running on http://localhost:8090"

# AsciiDoctor Server on port 8091 (mapped from container port 4567)
echo -e "  Deploying asciidoctor on port 8091..."
# Check if image exists, if not build it
if ! docker images --format '{{.Repository}}:{{.Tag}}' | grep -q "silberengel/wikistr:latest-asciidoctor"; then
    echo -e "    Building asciidoctor image..."
    docker build -f "${PARENT_DIR}/deployment/Dockerfile.asciidoctor" -t silberengel/wikistr:latest-asciidoctor "${PARENT_DIR}"
fi
# AsciiDoctor: Don't mount the deployment directory to avoid read-only filesystem issues
# Mount only the server script for easy updates without rebuild
# Gems are installed in vendor/bundle in the image, so Gemfile.lock won't be accessed
docker run -d \
  --name asciidoctor \
  --restart always \
  --network ${NETWORK_NAME} \
  -p 127.0.0.1:8091:8091 \
  -v "${PARENT_DIR}/deployment/asciidoctor-server.rb:/app/deployment/asciidoctor-server.rb:ro" \
  -w /app/deployment \
  -e ASCIIDOCTOR_PORT=8091 \
  -e ASCIIDOCTOR_ALLOW_ORIGIN="*" \
  -e BUNDLE_PATH=/app/deployment/vendor/bundle \
  silberengel/wikistr:latest-asciidoctor
echo -e "  ${GREEN}✓${NC} asciidoctor running on http://localhost:8091"

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

# Health check function
check_health() {
    local url=$1
    local name=$2
    local max_attempts=30
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if curl -s -f -o /dev/null -w "%{http_code}" "$url" > /dev/null 2>&1; then
            return 0
        fi
        sleep 1
        attempt=$((attempt + 1))
    done
    return 1
}

# Wait a moment for containers to start
echo -e "${BLUE}⏳ Waiting for services to start...${NC}"
sleep 3

# Health checks
echo -e "${BLUE}🏥 Checking service health...${NC}"
echo

# Check each service
services=(
    "http://localhost:8080|Wikistr"
    "http://localhost:8081|Biblestr"
    "http://localhost:8082|Quranstr"
    "http://localhost:8083|Torahstr"
    "http://localhost:8090|OG Proxy"
    "http://localhost:8091/healthz|AsciiDoctor"
)

all_healthy=true
for service in "${services[@]}"; do
    IFS='|' read -r url name <<< "$service"
    if check_health "$url" "$name"; then
        echo -e "  ${GREEN}✓${NC} ${name} is up"
    else
        echo -e "  ${RED}✗${NC} ${name} is down (${url})"
        all_healthy=false
    fi
done

echo
if [ "$all_healthy" = true ]; then
    echo -e "${GREEN}✅ All services are healthy!${NC}"
else
    echo -e "${YELLOW}⚠️  Some services are not responding. They may still be starting up.${NC}"
    echo -e "${YELLOW}   Check logs with: docker logs <container-name>${NC}"
fi
echo

echo -e "${BLUE}📋 Access URLs:${NC}"
echo -e "  • Wikistr:  http://localhost:8080"
echo -e "  • Biblestr: http://localhost:8081"
echo -e "  • Quranstr: http://localhost:8082"
echo -e "  • Torahstr: http://localhost:8083"
echo -e "  • OG Proxy: http://localhost:8090"
echo -e "  • AsciiDoctor: http://localhost:8091"
echo
echo -e "${BLUE}💡 Management commands:${NC}"
echo -e "  # View logs"
echo -e "  docker logs -f wikistr"
echo -e "  docker logs -f biblestr"
echo -e "  docker logs -f quranstr"
echo -e "  docker logs -f torahstr"
echo -e "  docker logs -f og-proxy"
echo -e "  docker logs -f asciidoctor"
echo
echo -e "  # Stop all"
echo -e "  docker stop wikistr biblestr quranstr torahstr og-proxy asciidoctor"
echo
echo -e "  # Remove all"
echo -e "  docker rm wikistr biblestr quranstr torahstr og-proxy asciidoctor"
echo
echo -e "${GREEN}🎉 Deployment complete!${NC}"

