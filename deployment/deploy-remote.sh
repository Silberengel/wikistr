#!/bin/bash

# Remote server deployment script for Wikistr
# This script should be run on your remote server
# Usage: ./deploy-remote.sh [theme] [port]
# Example: ./deploy-remote.sh wikistr 3000

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

VERSION="v5.1.0"
THEME="${1:-wikistr}"
PORT="${2:-3000}"

# Validate theme
VALID_THEMES=("wikistr" "biblestr" "quranstr" "torahstr")
if [[ ! " ${VALID_THEMES[@]} " =~ " ${THEME} " ]]; then
    echo -e "${RED}❌ Error: Invalid theme '${THEME}'${NC}"
    echo -e "${YELLOW}Valid themes: ${VALID_THEMES[*]}${NC}"
    exit 1
fi

echo -e "${GREEN}🚀 Deploying Wikistr ${THEME} on port ${PORT}${NC}"
echo

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker is not running. Please start Docker first.${NC}"
    exit 1
fi

# Image name
IMAGE="silberengel/wikistr:latest-${THEME}"
CONTAINER_NAME="${THEME}"

# Pull latest image
echo -e "${BLUE}📥 Pulling latest image...${NC}"
docker pull "${IMAGE}" || {
    echo -e "${YELLOW}⚠️  Image not found. Make sure you've built and pushed it to Docker Hub.${NC}"
    echo -e "${YELLOW}   Or build it locally with: ./build-all-apps.sh${NC}"
    exit 1
}

# Stop and remove existing container if it exists
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo -e "${BLUE}🛑 Stopping existing container...${NC}"
    docker stop "${CONTAINER_NAME}" > /dev/null 2>&1 || true
    echo -e "${BLUE}🗑️  Removing existing container...${NC}"
    docker rm "${CONTAINER_NAME}" > /dev/null 2>&1 || true
fi

# Run new container
echo -e "${BLUE}🚀 Starting new container...${NC}"
docker run -d \
  --name "${CONTAINER_NAME}" \
  -p "127.0.0.1:${PORT}:80" \
  --restart unless-stopped \
  "${IMAGE}"

echo -e "${GREEN}✅ Container started!${NC}"
echo

# Wait for container to be ready
echo -e "${BLUE}⏳ Waiting for container to be ready...${NC}"
sleep 3

# Health check
if curl -f "http://localhost:${PORT}" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Health check passed!${NC}"
else
    echo -e "${YELLOW}⚠️  Health check failed, but container is running.${NC}"
    echo -e "${YELLOW}   Check logs with: docker logs ${CONTAINER_NAME}${NC}"
fi

echo
echo -e "${BLUE}📋 Deployment Summary:${NC}"
echo -e "  Theme: ${THEME}"
echo -e "  Port: ${PORT}"
echo -e "  Container: ${CONTAINER_NAME}"
echo -e "  Image: ${IMAGE}"
echo
echo -e "${BLUE}💡 Useful Commands:${NC}"
echo -e "  View logs:    docker logs -f ${CONTAINER_NAME}"
echo -e "  Restart:      docker restart ${CONTAINER_NAME}"
echo -e "  Stop:         docker stop ${CONTAINER_NAME}"
echo -e "  Test locally: curl http://localhost:${PORT}"
echo
echo -e "${GREEN}🎉 Deployment complete!${NC}"

