#!/bin/bash

# Docker build and push script for wikistr
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
NC='\033[0m' # No Color

echo -e "${GREEN}🐳 Building wikistr Docker images...${NC}"

# Build the image with version tag
echo -e "${YELLOW}Building image with tag: ${VERSION}${NC}"
docker build -t ${DOCKER_REGISTRY}/${IMAGE_NAME}:${VERSION} .

# Build the image with latest tag
echo -e "${YELLOW}Building image with tag: ${LATEST_TAG}${NC}"
docker build -t ${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG} .

echo -e "${GREEN}✅ Build completed successfully!${NC}"

# Ask if user wants to push to registry
read -p "Do you want to push the images to Docker Hub? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Pushing ${VERSION} tag...${NC}"
    docker push ${DOCKER_REGISTRY}/${IMAGE_NAME}:${VERSION}
    
    echo -e "${YELLOW}Pushing ${LATEST_TAG} tag...${NC}"
    docker push ${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}
    
    echo -e "${GREEN}✅ Images pushed successfully!${NC}"
    echo -e "${GREEN}Images available at:${NC}"
    echo -e "  - https://hub.docker.com/r/${DOCKER_REGISTRY}/${IMAGE_NAME}:${VERSION}"
    echo -e "  - https://hub.docker.com/r/${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}"
else
    echo -e "${YELLOW}Images built locally. To push later, run:${NC}"
    echo -e "  docker push ${DOCKER_REGISTRY}/${IMAGE_NAME}:${VERSION}"
    echo -e "  docker push ${DOCKER_REGISTRY}/${IMAGE_NAME}:${LATEST_TAG}"
fi

echo -e "${GREEN}🎉 Done!${NC}"
