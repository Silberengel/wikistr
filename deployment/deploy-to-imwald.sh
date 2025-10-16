#!/bin/bash

# Deployment script for Wikistr on imwald.eu
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Deploying Wikistr to imwald.eu domains...${NC}"
echo

# Check if we're on the server
if [[ "$HOSTNAME" != *"imwald"* ]]; then
    echo -e "${YELLOW}⚠️  This script is designed to run on the imwald.eu server${NC}"
    echo -e "${YELLOW}   Make sure you're SSH'd into the correct server${NC}"
    echo
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Pull latest images
echo -e "${BLUE}📦 Pulling latest Docker images...${NC}"
docker pull silberengel/wikistr:latest-wikistr
docker pull silberengel/wikistr:latest-biblestr

# Stop existing containers if they exist
echo -e "${BLUE}🛑 Stopping existing containers...${NC}"
docker compose -f docker-compose.production.yml down 2>/dev/null || true

# Start new containers
echo -e "${BLUE}🚀 Starting new containers...${NC}"
docker compose -f docker-compose.production.yml up -d

# Wait for containers to be healthy
echo -e "${BLUE}⏳ Waiting for containers to be healthy...${NC}"
timeout=60
counter=0

while [ $counter -lt $timeout ]; do
    if docker ps --format "table {{.Names}}\t{{.Status}}" | grep -E "(wikistr-dark|wikistr-light)" | grep -q "healthy"; then
        echo -e "${GREEN}✅ Containers are healthy!${NC}"
        break
    fi
    
    if [ $counter -eq 0 ]; then
        echo -e "${YELLOW}   Waiting for health checks...${NC}"
    fi
    
    sleep 5
    counter=$((counter + 5))
done

if [ $counter -ge $timeout ]; then
    echo -e "${RED}❌ Health check timeout. Checking container status...${NC}"
    docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    exit 1
fi

# Show deployment status
echo
echo -e "${GREEN}🎉 Deployment completed!${NC}"
echo
echo -e "${BLUE}📋 Container Status:${NC}"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -E "(wikistr-dark|wikistr-light|NAME)"

echo
echo -e "${BLUE}🌐 Deployed URLs:${NC}"
echo -e "  - ${GREEN}Wikistr (dark theme):${NC} https://wikistr.imwald.eu"
echo -e "  - ${GREEN}Biblestr (light theme):${NC} https://biblestr.imwald.eu"

echo
echo -e "${BLUE}🔍 Quick Health Check:${NC}"
echo -e "  - Wikistr: $(curl -s -o /dev/null -w "%{http_code}" https://wikistr.imwald.eu:443 || echo "Failed")"
echo -e "  - Biblestr: $(curl -s -o /dev/null -w "%{http_code}" https://biblestr.imwald.eu:443 || echo "Failed")"

echo
echo -e "${BLUE}📝 Useful Commands:${NC}"
echo -e "  - View logs: docker compose -f docker-compose.production.yml logs -f"
echo -e "  - Stop services: docker compose -f docker-compose.production.yml down"
echo -e "  - Restart services: docker compose -f docker-compose.production.yml restart"
echo -e "  - Update images: docker compose -f docker-compose.production.yml pull && docker compose -f docker-compose.production.yml up -d"

echo
echo -e "${GREEN}✨ Done! Your Wikistr instances are now running on both domains.${NC}"
