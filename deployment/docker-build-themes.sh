#!/bin/bash

# Build script for all Wikistr themes
# Builds and tags all four applications (wikistr, biblestr, quranstr, torahstr)
# Version: v4.2

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

VERSION="v4.2"
THEMES=("wikistr" "biblestr" "quranstr" "torahstr")

# OG Proxy URL - can be overridden via environment variable
# For local dev: http://localhost:8090/sites/
# For production: /sites/ (relative path, Apache will proxy it)
OG_PROXY_URL="${VITE_OG_PROXY_URL:-/sites/}"

echo -e "${GREEN}🏗️  Building Wikistr themes ${VERSION}${NC}"
echo -e "${BLUE}OG Proxy URL: ${OG_PROXY_URL}${NC}"
echo

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker is not running. Please start Docker first.${NC}"
    exit 1
fi

# Build all images using docker-compose with OG proxy URL
echo -e "${BLUE}📦 Building Docker images...${NC}"
export VITE_OG_PROXY_URL="${OG_PROXY_URL}"
docker-compose -f docker-compose.yml build

echo -e "${GREEN}✅ Build complete!${NC}"
echo

# Tag images with version and latest
echo -e "${BLUE}🏷️  Tagging images...${NC}"
for theme in "${THEMES[@]}"; do
    VERSION_TAG="silberengel/wikistr:${VERSION}-${theme}"
    LATEST_TAG="silberengel/wikistr:latest-${theme}"
    
    echo -e "  Tagging ${theme}..."
    docker tag "${VERSION_TAG}" "${LATEST_TAG}"
    echo -e "  ${GREEN}✓${NC} ${VERSION_TAG}"
    echo -e "  ${GREEN}✓${NC} ${LATEST_TAG}"
done

echo
echo -e "${GREEN}✅ All images tagged successfully!${NC}"
echo

# Ask if user wants to push to Docker Hub
read -p "Do you want to push images to Docker Hub? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${BLUE}📤 Pushing images to Docker Hub...${NC}"
    
    for theme in "${THEMES[@]}"; do
        VERSION_TAG="silberengel/wikistr:${VERSION}-${theme}"
        LATEST_TAG="silberengel/wikistr:latest-${theme}"
        
        echo -e "  Pushing ${theme}..."
        docker push "${VERSION_TAG}"
        docker push "${LATEST_TAG}"
        echo -e "  ${GREEN}✓${NC} ${theme} pushed"
    done
    
    echo
    echo -e "${GREEN}✅ All images pushed to Docker Hub!${NC}"
else
    echo -e "${YELLOW}⏭️  Skipping Docker Hub push${NC}"
fi

echo
echo -e "${BLUE}📋 Summary:${NC}"
echo -e "Built and tagged the following images:"
for theme in "${THEMES[@]}"; do
    echo -e "  • silberengel/wikistr:${VERSION}-${theme}"
    echo -e "  • silberengel/wikistr:latest-${theme}"
done

echo
echo -e "${BLUE}💡 Usage examples:${NC}"
echo -e "  # Run locally"
echo -e "  docker run -d --name wikistr -p 8080:80 silberengel/wikistr:latest-wikistr"
echo -e "  docker run -d --name biblestr -p 8081:80 silberengel/wikistr:latest-biblestr"
echo -e "  docker run -d --name quranstr -p 8082:80 silberengel/wikistr:latest-quranstr"
echo -e "  docker run -d --name torahstr -p 8083:80 silberengel/wikistr:latest-torahstr"
echo
echo -e "  # Deploy on cloud server"
echo -e "  docker run -d --name wikistr -p 3000:80 silberengel/wikistr:${VERSION}-wikistr"
echo -e "  docker run -d --name biblestr -p 4000:80 silberengel/wikistr:${VERSION}-biblestr"
echo -e "  docker run -d --name quranstr -p 4050:80 silberengel/wikistr:${VERSION}-quranstr"
echo -e "  docker run -d --name torahstr -p 4080:80 silberengel/wikistr:${VERSION}-torahstr"
echo
echo -e "${GREEN}🎉 Done!${NC}"

