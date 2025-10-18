#!/bin/bash

# Docker build script for all four Wikistr applications
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

echo -e "${GREEN}🐳 Building all four Wikistr applications...${NC}"
echo

# Build Wikistr images
echo -e "${BLUE}📦 Building Wikistr images...${NC}"
echo -e "${YELLOW}Building image with tag: ${VERSION}-wikistr${NC}"
docker build -f Dockerfile.wikistr -t ${DOCKER_REGISTRY}/${IMAGE_NAME}:${VERSION}-wikistr .

echo -e "${YELLOW}Building image with tag: latest-wikistr${NC}"
docker build -f Dockerfile.wikistr -t ${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}-wikistr .

# Build Biblestr images
echo -e "${BLUE}📦 Building Biblestr images...${NC}"
echo -e "${YELLOW}Building image with tag: ${VERSION}-biblestr${NC}"
docker build -f Dockerfile.biblestr -t ${DOCKER_REGISTRY}/${IMAGE_NAME}:${VERSION}-biblestr .

echo -e "${YELLOW}Building image with tag: latest-biblestr${NC}"
docker build -f Dockerfile.biblestr -t ${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}-biblestr .

# Build Quranstr images
echo -e "${BLUE}📦 Building Quranstr images...${NC}"
echo -e "${YELLOW}Building image with tag: ${VERSION}-quranstr${NC}"
docker build -f Dockerfile.quranstr -t ${DOCKER_REGISTRY}/${IMAGE_NAME}:${VERSION}-quranstr .

echo -e "${YELLOW}Building image with tag: latest-quranstr${NC}"
docker build -f Dockerfile.quranstr -t ${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}-quranstr .

# Build Torahstr images
echo -e "${BLUE}📦 Building Torahstr images...${NC}"
echo -e "${YELLOW}Building image with tag: ${VERSION}-torahstr${NC}"
docker build -f Dockerfile.torahstr -t ${DOCKER_REGISTRY}/${IMAGE_NAME}:${VERSION}-torahstr .

echo -e "${YELLOW}Building image with tag: latest-torahstr${NC}"
docker build -f Dockerfile.torahstr -t ${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}-torahstr .

echo -e "${GREEN}✅ Build completed successfully!${NC}"
echo

# Show built images
echo -e "${BLUE}📋 Built images:${NC}"
echo -e "  - ${DOCKER_REGISTRY}/${IMAGE_NAME}:${VERSION}-wikistr (Wikistr)"
echo -e "  - ${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}-wikistr (Wikistr)"
echo -e "  - ${DOCKER_REGISTRY}/${IMAGE_NAME}:${VERSION}-biblestr (Biblestr)"
echo -e "  - ${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}-biblestr (Biblestr)"
echo -e "  - ${DOCKER_REGISTRY}/${IMAGE_NAME}:${VERSION}-quranstr (Quranstr)"
echo -e "  - ${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}-quranstr (Quranstr)"
echo -e "  - ${DOCKER_REGISTRY}/${IMAGE_NAME}:${VERSION}-torahstr (Torahstr)"
echo -e "  - ${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}-torahstr (Torahstr)"
echo

# Ask if user wants to push to registry
read -p "Do you want to push the images to Docker Hub? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Pushing Wikistr images...${NC}"
    docker push ${DOCKER_REGISTRY}/${IMAGE_NAME}:${VERSION}-wikistr
    docker push ${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}-wikistr
    
    echo -e "${YELLOW}Pushing Biblestr images...${NC}"
    docker push ${DOCKER_REGISTRY}/${IMAGE_NAME}:${VERSION}-biblestr
    docker push ${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}-biblestr
    
    echo -e "${YELLOW}Pushing Quranstr images...${NC}"
    docker push ${DOCKER_REGISTRY}/${IMAGE_NAME}:${VERSION}-quranstr
    docker push ${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}-quranstr
    
    echo -e "${YELLOW}Pushing Torahstr images...${NC}"
    docker push ${DOCKER_REGISTRY}/${IMAGE_NAME}:${VERSION}-torahstr
    docker push ${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}-torahstr
    
    echo -e "${GREEN}✅ Images pushed successfully!${NC}"
    echo -e "${GREEN}Images available at:${NC}"
    echo -e "  - https://hub.docker.com/r/${DOCKER_REGISTRY}/${IMAGE_NAME}:${VERSION}-wikistr"
    echo -e "  - https://hub.docker.com/r/${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}-wikistr"
    echo -e "  - https://hub.docker.com/r/${DOCKER_REGISTRY}/${IMAGE_NAME}:${VERSION}-biblestr"
    echo -e "  - https://hub.docker.com/r/${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}-biblestr"
    echo -e "  - https://hub.docker.com/r/${DOCKER_REGISTRY}/${IMAGE_NAME}:${VERSION}-quranstr"
    echo -e "  - https://hub.docker.com/r/${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}-quranstr"
    echo -e "  - https://hub.docker.com/r/${DOCKER_REGISTRY}/${IMAGE_NAME}:${VERSION}-torahstr"
    echo -e "  - https://hub.docker.com/r/${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}-torahstr"
else
    echo -e "${YELLOW}Images built locally. To push later, run:${NC}"
    echo -e "  docker push ${DOCKER_REGISTRY}/${IMAGE_NAME}:${VERSION}-wikistr"
    echo -e "  docker push ${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}-wikistr"
    echo -e "  docker push ${DOCKER_REGISTRY}/${IMAGE_NAME}:${VERSION}-biblestr"
    echo -e "  docker push ${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}-biblestr"
    echo -e "  docker push ${DOCKER_REGISTRY}/${IMAGE_NAME}:${VERSION}-quranstr"
    echo -e "  docker push ${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}-quranstr"
    echo -e "  docker push ${DOCKER_REGISTRY}/${IMAGE_NAME}:${VERSION}-torahstr"
    echo -e "  docker push ${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}-torahstr"
fi

echo
echo -e "${GREEN}🎉 Done!${NC}"
echo
echo -e "${BLUE}💡 Usage examples:${NC}"
echo -e "  # Run Wikistr on port 8080:${NC}"
echo -e "  docker run -p 8080:80 ${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}-wikistr"
echo
echo -e "  # Run Biblestr on port 8081:${NC}"
echo -e "  docker run -p 8081:80 ${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}-biblestr"
echo
echo -e "  # Run Quranstr on port 8082:${NC}"
echo -e "  docker run -p 8082:80 ${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}-quranstr"
echo
echo -e "  # Run Torahstr on port 8083:${NC}"
echo -e "  docker run -p 8083:80 ${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}-torahstr"
