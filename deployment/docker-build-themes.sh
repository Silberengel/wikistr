#!/bin/bash

# Docker build script for both Wikistr themes
set -e

# Configuration
DOCKER_REGISTRY="silberengel"
IMAGE_NAME="wikistr"
VERSION="v2.0"
LATEST_TAG="latest"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${GREEN}🐳 Building Wikistr Docker images for both themes...${NC}"
echo

# Build Wikistr (dark theme) images
echo -e "${BLUE}📦 Building Wikistr (dark theme) images...${NC}"
echo -e "${YELLOW}Building image with tag: ${VERSION}-wikistr${NC}"
docker build -f Dockerfile.wikistr -t ${DOCKER_REGISTRY}/${IMAGE_NAME}:${VERSION}-wikistr .

echo -e "${YELLOW}Building image with tag: latest-wikistr${NC}"
docker build -f Dockerfile.wikistr -t ${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}-wikistr .

# Build Biblestr (light theme) images
echo -e "${BLUE}📦 Building Biblestr (light theme) images...${NC}"
echo -e "${YELLOW}Building image with tag: ${VERSION}-biblestr${NC}"
docker build -f Dockerfile.biblestr -t ${DOCKER_REGISTRY}/${IMAGE_NAME}:${VERSION}-biblestr .

echo -e "${YELLOW}Building image with tag: latest-biblestr${NC}"
docker build -f Dockerfile.biblestr -t ${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}-biblestr .

echo -e "${GREEN}✅ Build completed successfully!${NC}"
echo

# Show built images
echo -e "${BLUE}📋 Built images:${NC}"
echo -e "  - ${DOCKER_REGISTRY}/${IMAGE_NAME}:${VERSION}-wikistr (dark theme)"
echo -e "  - ${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}-wikistr (dark theme)"
echo -e "  - ${DOCKER_REGISTRY}/${IMAGE_NAME}:${VERSION}-biblestr (light theme)"
echo -e "  - ${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}-biblestr (light theme)"
echo

# Ask if user wants to push to registry
read -p "Do you want to push the images to Docker Hub? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Pushing Wikistr (dark theme) images...${NC}"
    docker push ${DOCKER_REGISTRY}/${IMAGE_NAME}:${VERSION}-wikistr
    docker push ${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}-wikistr
    
    echo -e "${YELLOW}Pushing Biblestr (light theme) images...${NC}"
    docker push ${DOCKER_REGISTRY}/${IMAGE_NAME}:${VERSION}-biblestr
    docker push ${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}-biblestr
    
    echo -e "${GREEN}✅ Images pushed successfully!${NC}"
    echo -e "${GREEN}Images available at:${NC}"
    echo -e "  - https://hub.docker.com/r/${DOCKER_REGISTRY}/${IMAGE_NAME}:${VERSION}-wikistr"
    echo -e "  - https://hub.docker.com/r/${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}-wikistr"
    echo -e "  - https://hub.docker.com/r/${DOCKER_REGISTRY}/${IMAGE_NAME}:${VERSION}-biblestr"
    echo -e "  - https://hub.docker.com/r/${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}-biblestr"
else
    echo -e "${YELLOW}Images built locally. To push later, run:${NC}"
    echo -e "  docker push ${DOCKER_REGISTRY}/${IMAGE_NAME}:${VERSION}-wikistr"
    echo -e "  docker push ${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}-wikistr"
    echo -e "  docker push ${DOCKER_REGISTRY}/${IMAGE_NAME}:${VERSION}-biblestr"
    echo -e "  docker push ${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}-biblestr"
fi

echo
echo -e "${GREEN}🎉 Done!${NC}"
echo
echo -e "${BLUE}💡 Usage examples:${NC}"
echo -e "  # Run Wikistr (dark theme) on port 8080:${NC}"
echo -e "  docker run -p 8080:80 ${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}-wikistr"
echo
echo -e "  # Run Biblestr (light theme) on port 8081:${NC}"
echo -e "  docker run -p 8081:80 ${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}-biblestr"
