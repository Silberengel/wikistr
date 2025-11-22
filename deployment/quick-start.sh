#!/bin/bash

# Quick start script for Wikistr v4.2
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Wikistr v4.2 Quick Start${NC}"
echo

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker is not running. Please start Docker first.${NC}"
    exit 1
fi

# Make scripts executable
echo -e "${BLUE}🔧 Making scripts executable...${NC}"
chmod +x *.sh

echo -e "${BLUE}📋 Choose an option:${NC}"
echo -e "  1) Build all applications locally"
echo -e "  2) Deploy all applications locally"
echo -e "  3) Build and push to Docker Hub"
echo -e "  4) Show usage examples"
echo

read -p "Enter your choice (1-4): " choice

case $choice in
    1)
        echo -e "${BLUE}🏗️ Building all applications locally...${NC}"
        ./docker-build-themes.sh
        ;;
    2)
        echo -e "${BLUE}🚀 Deploying all applications locally...${NC}"
        ./deploy-all-apps.sh
        ;;
    3)
        echo -e "${BLUE}🏗️ Building and pushing to Docker Hub...${NC}"
        ./docker-build-themes.sh
        echo -e "${GREEN}✅ Images pushed to Docker Hub!${NC}"
        ;;
    4)
        echo -e "${BLUE}💡 Usage Examples:${NC}"
        echo
        echo -e "${YELLOW}Local Development:${NC}"
        echo -e "  # Build all applications"
        echo -e "  ./docker-build-themes.sh"
        echo
        echo -e "  # Deploy all applications"
        echo -e "  ./deploy-all-apps.sh"
        echo
        echo -e "${YELLOW}Individual Applications:${NC}"
        echo -e "  # Wikistr"
        echo -e "  docker run -p 3000:80 silberengel/wikistr:latest-wikistr"
        echo
        echo -e "  # Biblestr"
        echo -e "  docker run -p 4000:80 silberengel/wikistr:latest-biblestr"
        echo
        echo -e "  # Quranstr"
        echo -e "  docker run -p 4050:80 silberengel/wikistr:latest-quranstr"
        echo
        echo -e "  # Torahstr"
        echo -e "  docker run -p 4080:80 silberengel/wikistr:latest-torahstr"
        echo
        echo -e "${YELLOW}Access URLs:${NC}"
        echo -e "  - Wikistr: http://localhost:3000"
        echo -e "  - Biblestr: http://localhost:4000"
        echo -e "  - Quranstr: http://localhost:4050"
        echo -e "  - Torahstr: http://localhost:4080"
        ;;
    *)
        echo -e "${RED}❌ Invalid choice. Please run the script again.${NC}"
        exit 1
        ;;
esac

echo
echo -e "${GREEN}🎉 Done!${NC}"
