#!/bin/bash

# Remote server deployment script for Wikistr
# This script should be run on your remote server
# Usage: ./deploy-remote.sh [theme|all] [port]
# Example: ./deploy-remote.sh  # Deploy all themes (default)
# Example: ./deploy-remote.sh wikistr 3000  # Deploy single theme
# Example: ./deploy-remote.sh all  # Deploy all themes (explicit)
# Default ports: wikistr=3000, biblestr=4000, quranstr=4050, torahstr=4080

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

VERSION="v5.3.0"
THEME_ARG="${1:-all}"
PORT_ARG="${2:-}"

# All available themes
VALID_THEMES=("wikistr" "biblestr" "quranstr" "torahstr")

# Port mapping as defined in REMOTE_SERVER_DEPLOYMENT.md
declare -A THEME_PORTS=(
    ["wikistr"]=3000
    ["biblestr"]=4000
    ["quranstr"]=4050
    ["torahstr"]=4080
)

# Determine which themes to deploy
if [ "$THEME_ARG" = "all" ]; then
    THEMES_TO_DEPLOY=("${VALID_THEMES[@]}")
    echo -e "${GREEN}🚀 Deploying all Wikistr themes${NC}"
else
    # Validate single theme
    if [[ ! " ${VALID_THEMES[@]} " =~ " ${THEME_ARG} " ]]; then
        echo -e "${RED}❌ Error: Invalid theme '${THEME_ARG}'${NC}"
        echo -e "${YELLOW}Valid themes: ${VALID_THEMES[*]} or 'all'${NC}"
        exit 1
    fi
    THEMES_TO_DEPLOY=("$THEME_ARG")
    # Use provided port or default from mapping
    if [ -n "$PORT_ARG" ]; then
        PORT="$PORT_ARG"
    else
        PORT="${THEME_PORTS["$THEME_ARG"]}"
    fi
    echo -e "${GREEN}🚀 Deploying Wikistr ${THEME_ARG} on port ${PORT}${NC}"
fi

echo

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker is not running. Please start Docker first.${NC}"
    exit 1
fi

# Function to deploy a single theme
deploy_theme() {
    local theme=$1
    local port=$2
    
    echo -e "${BLUE}📦 Deploying ${theme} on port ${port}...${NC}"
    
    # Image name
    local IMAGE="silberengel/wikistr:latest-${theme}"
    local CONTAINER_NAME="${theme}"
    
    # Pull latest image
    echo -e "  ${BLUE}📥 Pulling latest image...${NC}"
    if ! docker pull "${IMAGE}" 2>/dev/null; then
        echo -e "  ${YELLOW}⚠️  Image not found. Make sure you've built and pushed it to Docker Hub.${NC}"
        echo -e "  ${YELLOW}   Or build it locally with: ./build-all-apps.sh${NC}"
        return 1
    fi
    
    # Stop and remove existing container if it exists
    if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        echo -e "  ${BLUE}🛑 Stopping existing container...${NC}"
        docker stop "${CONTAINER_NAME}" > /dev/null 2>&1 || true
        echo -e "  ${BLUE}🗑️  Removing existing container...${NC}"
        docker rm "${CONTAINER_NAME}" > /dev/null 2>&1 || true
    fi
    
    # Run new container
    echo -e "  ${BLUE}🚀 Starting new container...${NC}"
    docker run -d \
      --name "${CONTAINER_NAME}" \
      -p "127.0.0.1:${port}:80" \
      --restart unless-stopped \
      "${IMAGE}"
    
    echo -e "  ${GREEN}✅ Container started!${NC}"
    
    # Wait for container to be ready
    sleep 2
    
    # Health check
    if curl -f "http://localhost:${port}" > /dev/null 2>&1; then
        echo -e "  ${GREEN}✅ Health check passed!${NC}"
    else
        echo -e "  ${YELLOW}⚠️  Health check failed, but container is running.${NC}"
        echo -e "  ${YELLOW}   Check logs with: docker logs ${CONTAINER_NAME}${NC}"
    fi
    
    # Note: If this container needs to proxy to services (alexandria-catalogue, asciidoctor, og-proxy),
    # you may need to update the Apache proxy configuration inside the container.
    # See deployment/fix-alexandria-proxy.sh for details.
    
    echo
}

# Deploy themes
SUCCESSFUL_DEPLOYMENTS=()
FAILED_DEPLOYMENTS=()

for theme in "${THEMES_TO_DEPLOY[@]}"; do
    # Use provided port for single theme, or default from mapping
    if [ ${#THEMES_TO_DEPLOY[@]} -eq 1 ] && [ -n "$PORT_ARG" ]; then
        PORT="$PORT_ARG"
    else
        PORT="${THEME_PORTS["$theme"]}"
    fi
    if deploy_theme "$theme" "$PORT"; then
        SUCCESSFUL_DEPLOYMENTS+=("${theme}:${PORT}")
    else
        FAILED_DEPLOYMENTS+=("${theme}:${PORT}")
    fi
done

echo
echo -e "${BLUE}📋 Deployment Summary:${NC}"
if [ ${#SUCCESSFUL_DEPLOYMENTS[@]} -gt 0 ]; then
    echo -e "${GREEN}✅ Successfully deployed:${NC}"
    for deployment in "${SUCCESSFUL_DEPLOYMENTS[@]}"; do
        IFS=':' read -r theme port <<< "$deployment"
        echo -e "  • ${theme} on port ${port}"
    done
fi
if [ ${#FAILED_DEPLOYMENTS[@]} -gt 0 ]; then
    echo -e "${RED}❌ Failed deployments:${NC}"
    for deployment in "${FAILED_DEPLOYMENTS[@]}"; do
        IFS=':' read -r theme port <<< "$deployment"
        echo -e "  • ${theme} on port ${port}"
    done
fi
echo

if [ ${#SUCCESSFUL_DEPLOYMENTS[@]} -gt 0 ]; then
    echo -e "${BLUE}💡 Useful Commands:${NC}"
    for deployment in "${SUCCESSFUL_DEPLOYMENTS[@]}"; do
        IFS=':' read -r theme port <<< "$deployment"
        echo -e "  ${theme}:"
        echo -e "    View logs:    docker logs -f ${theme}"
        echo -e "    Restart:      docker restart ${theme}"
        echo -e "    Stop:         docker stop ${theme}"
        echo -e "    Test:         curl http://localhost:${port}"
        echo
    done
fi

if [ ${#FAILED_DEPLOYMENTS[@]} -eq 0 ]; then
    echo -e "${GREEN}🎉 Deployment complete!${NC}"
else
    echo -e "${YELLOW}⚠️  Deployment completed with some failures.${NC}"
    exit 1
fi

