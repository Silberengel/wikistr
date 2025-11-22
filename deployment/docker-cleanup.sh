#!/bin/bash

# Cleanup script for Wikistr Docker images
# Removes all wikistr-related Docker images to free up disk space

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🧹 Cleaning up Wikistr Docker images...${NC}"
echo

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker is not running. Please start Docker first.${NC}"
    exit 1
fi

# Show current images
echo -e "${BLUE}📋 Current Wikistr images:${NC}"
docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedAt}}" | grep -E "REPOSITORY|silberengel/wikistr" || echo "  No wikistr images found"
echo

# Ask for confirmation
read -p "Are you sure you want to remove ALL wikistr Docker images? (y/n): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}⏭️  Cleanup cancelled${NC}"
    exit 0
fi

# Remove all wikistr images
echo -e "${BLUE}🗑️  Removing all wikistr images...${NC}"

# Get all image IDs for silberengel/wikistr
IMAGE_IDS=$(docker images --format "{{.ID}}" silberengel/wikistr | sort -u)

if [ -z "$IMAGE_IDS" ]; then
    echo -e "${YELLOW}⚠${NC} No wikistr images found to remove"
else
    for image_id in $IMAGE_IDS; do
        echo -e "  Removing image ${image_id}..."
        docker rmi -f "$image_id" 2>/dev/null || true
    done
    echo -e "${GREEN}✅ All wikistr images removed!${NC}"
fi

# Also remove dangling images
echo
echo -e "${BLUE}🧹 Removing dangling images...${NC}"
DANGLING_IMAGES=$(docker images -f "dangling=true" -q)
if [ -n "$DANGLING_IMAGES" ]; then
    docker rmi $DANGLING_IMAGES 2>/dev/null || true
    echo -e "${GREEN}✅ Dangling images removed!${NC}"
else
    echo -e "${YELLOW}⚠${NC} No dangling images found"
fi

# Show disk space saved
echo
echo -e "${BLUE}💾 Disk space summary:${NC}"
docker system df

echo
echo -e "${GREEN}🎉 Cleanup complete!${NC}"

