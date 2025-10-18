#!/bin/bash

# Deploy all four Wikistr applications
set -e

# Configuration
DOCKER_REGISTRY="silberengel"
IMAGE_NAME="wikistr"
VERSION="v3.0"
LATEST_TAG="latest"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Deploying all four Wikistr applications...${NC}"
echo

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker is not running. Please start Docker first.${NC}"
    exit 1
fi

# Pull latest images
echo -e "${BLUE}📥 Pulling latest images...${NC}"
docker pull ${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}-wikistr
docker pull ${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}-biblestr
docker pull ${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}-quranstr
docker pull ${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}-torahstr

# Stop existing containers
echo -e "${BLUE}🛑 Stopping existing containers...${NC}"
docker-compose -f docker-compose.all-apps.yml down 2>/dev/null || true

# Start all applications
echo -e "${BLUE}🚀 Starting all applications...${NC}"
docker-compose -f docker-compose.all-apps.yml up -d

# Wait for services to be ready
echo -e "${BLUE}⏳ Waiting for services to be ready...${NC}"
sleep 10

# Check health
echo -e "${BLUE}🏥 Checking service health...${NC}"
for service in wikistr biblestr quranstr torahstr; do
    if docker ps --filter "name=${service}-v3" --filter "status=running" | grep -q ${service}-v3; then
        echo -e "${GREEN}✅ ${service} is running${NC}"
    else
        echo -e "${RED}❌ ${service} is not running${NC}"
    fi
done

echo
echo -e "${GREEN}🎉 Deployment completed!${NC}"
echo
echo -e "${BLUE}📋 Services available at:${NC}"
echo -e "  - Wikistr: http://localhost:3000"
echo -e "  - Biblestr: http://localhost:4000"
echo -e "  - Quranstr: http://localhost:4050"
echo -e "  - Torahstr: http://localhost:4080"
echo
echo -e "${BLUE}💡 Management commands:${NC}"
echo -e "  # View logs: docker-compose -f docker-compose.all-apps.yml logs -f"
echo -e "  # Stop all: docker-compose -f docker-compose.all-apps.yml down"
echo -e "  # Restart all: docker-compose -f docker-compose.all-apps.yml restart"
echo -e "  # Update images: docker-compose -f docker-compose.all-apps.yml pull && docker-compose -f docker-compose.all-apps.yml up -d"
