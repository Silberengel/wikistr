#!/bin/bash

# Build script for Wikistr applications
# Builds and tags applications (wikistr, biblestr, quranstr, torahstr, og-proxy, alexandria-catalogue)
# Version: v4.2
#
# Usage:
#   ./build-all-apps.sh                           # Build all applications
#   ./build-all-apps.sh wikistr                   # Build only wikistr
#   ./build-all-apps.sh wikistr biblestr         # Build wikistr and biblestr
#   ./build-all-apps.sh og-proxy alexandria-catalogue      # Build supporting services

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

VERSION="v5.3.0"

# All available services
ALL_SERVICES=("wikistr" "biblestr" "quranstr" "torahstr" "og-proxy" "asciidoctor" "alexandria-catalogue")

# Services that use version tags (themes)
THEME_SERVICES=("wikistr" "biblestr" "quranstr" "torahstr")

# Services that use latest tags only
LATEST_ONLY_SERVICES=("og-proxy" "asciidoctor" "alexandria-catalogue")

# Parse command-line arguments
SERVICES_TO_BUILD=()
for arg in "$@"; do
    if [ "$arg" != "--no-cache" ]; then
        SERVICES_TO_BUILD+=("$arg")
    fi
done

if [ ${#SERVICES_TO_BUILD[@]} -eq 0 ]; then
    # No arguments: build all
    SERVICES_TO_BUILD=("${ALL_SERVICES[@]}")
    echo -e "${GREEN}🏗️  Building all Wikistr applications ${VERSION}${NC}"
else
    # Build only specified services
    echo -e "${GREEN}🏗️  Building selected Wikistr applications ${VERSION}${NC}"
    echo -e "${BLUE}Selected services: ${SERVICES_TO_BUILD[*]}${NC}"
    
    # Validate that all specified services are valid
    for service in "${SERVICES_TO_BUILD[@]}"; do
        if [[ ! " ${ALL_SERVICES[@]} " =~ " ${service} " ]]; then
            echo -e "${RED}❌ Error: '${service}' is not a valid service.${NC}"
            echo -e "${YELLOW}Valid services: ${ALL_SERVICES[*]}${NC}"
            exit 1
        fi
    done
fi

# OG Proxy URL - can be overridden via environment variable
# For local dev: http://localhost:8090/sites/
# For production: /sites/ (relative path, Apache will proxy it)
OG_PROXY_URL="${VITE_OG_PROXY_URL:-/sites/}"

echo -e "${BLUE}OG Proxy URL: ${OG_PROXY_URL}${NC}"
echo

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker is not running. Please start Docker first.${NC}"
    exit 1
fi

# Clean up old images before building
echo -e "${BLUE}🧹 Cleaning up old Docker images...${NC}"

# Remove dangling images (images with <none> tag)
DANGLING_IMAGES=$(docker images -f "dangling=true" -q --filter "reference=silberengel/wikistr")
if [ -n "$DANGLING_IMAGES" ]; then
    echo -e "  Removing dangling images..."
    docker rmi $DANGLING_IMAGES 2>/dev/null || true
    echo -e "  ${GREEN}✓${NC} Dangling images removed"
else
    echo -e "  ${YELLOW}⚠${NC} No dangling images found"
fi

# Remove old version tags (keep only current version and latest)
echo -e "  Removing old version tags..."
for service in "${SERVICES_TO_BUILD[@]}"; do
    if [[ " ${THEME_SERVICES[@]} " =~ " ${service} " ]]; then
        # Find all version tags for this service except current version and latest
        OLD_TAGS=$(docker images --format "{{.Repository}}:{{.Tag}}" silberengel/wikistr | grep "${service}" | grep -v "${VERSION}-${service}" | grep -v "latest-${service}" | grep -E "v[0-9]+\.[0-9]+" || true)
        if [ -n "$OLD_TAGS" ]; then
            echo "$OLD_TAGS" | while read -r tag; do
                if [ -n "$tag" ]; then
                    echo -e "    Removing ${tag}..."
                    docker rmi "$tag" 2>/dev/null || true
                fi
            done
        fi
    fi
done
echo -e "  ${GREEN}✓${NC} Old version tags removed"

echo

# Build images using docker-compose with OG proxy URL
echo -e "${BLUE}📦 Building Docker images...${NC}"
export VITE_OG_PROXY_URL="${OG_PROXY_URL}"

# Check for --no-cache flag in original arguments
NO_CACHE_FLAG=""
for arg in "$@"; do
    if [ "$arg" == "--no-cache" ]; then
        NO_CACHE_FLAG="--no-cache"
        echo -e "${YELLOW}⚠${NC} Building without cache (--no-cache flag detected)"
        break
    fi
done

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yml"

# Build only the specified services
if [ ${#SERVICES_TO_BUILD[@]} -eq ${#ALL_SERVICES[@]} ]; then
    # Building all services
    echo -e "${BLUE}Building all services: ${ALL_SERVICES[*]}${NC}"
    if ! docker-compose -f "${DOCKER_COMPOSE_FILE}" build ${NO_CACHE_FLAG}; then
        echo -e "${RED}❌ Build failed!${NC}"
        exit 1
    fi
else
    # Building subset of services
    echo -e "${BLUE}Building services: ${SERVICES_TO_BUILD[*]}${NC}"
    if ! docker-compose -f "${DOCKER_COMPOSE_FILE}" build ${NO_CACHE_FLAG} "${SERVICES_TO_BUILD[@]}"; then
        echo -e "${RED}❌ Build failed!${NC}"
        exit 1
    fi
fi

echo -e "${GREEN}✅ Build complete!${NC}"

# Verify which images were actually built
echo -e "${BLUE}🔍 Verifying built images...${NC}"
BUILT_IMAGES=()
for service in "${SERVICES_TO_BUILD[@]}"; do
    if [[ " ${THEME_SERVICES[@]} " =~ " ${service} " ]]; then
        VERSION_TAG="silberengel/wikistr:${VERSION}-${service}"
        if docker images --format '{{.Repository}}:{{.Tag}}' | grep -q "^${VERSION_TAG}$"; then
            echo -e "  ${GREEN}✓${NC} ${VERSION_TAG} built successfully"
            BUILT_IMAGES+=("${service}")
        else
            echo -e "  ${RED}✗${NC} ${VERSION_TAG} was not built!"
        fi
    elif [[ " ${LATEST_ONLY_SERVICES[@]} " =~ " ${service} " ]]; then
        LATEST_TAG="silberengel/wikistr:latest-${service}"
        if docker images --format '{{.Repository}}:{{.Tag}}' | grep -q "^${LATEST_TAG}$"; then
            echo -e "  ${GREEN}✓${NC} ${LATEST_TAG} built successfully"
            BUILT_IMAGES+=("${service}")
        else
            echo -e "  ${RED}✗${NC} ${LATEST_TAG} was not built!"
        fi
    fi
done

if [ ${#BUILT_IMAGES[@]} -eq 0 ]; then
    echo -e "${RED}❌ No images were built! Check the build output above for errors.${NC}"
    exit 1
elif [ ${#BUILT_IMAGES[@]} -lt ${#SERVICES_TO_BUILD[@]} ]; then
    echo -e "${YELLOW}⚠️  Warning: Only ${#BUILT_IMAGES[@]} of ${#SERVICES_TO_BUILD[@]} requested services were built.${NC}"
fi
echo
echo

# Tag images with version and latest
echo -e "${BLUE}🏷️  Tagging images...${NC}"
for service in "${SERVICES_TO_BUILD[@]}"; do
    if [[ " ${THEME_SERVICES[@]} " =~ " ${service} " ]]; then
        # Theme services get both version and latest tags
        VERSION_TAG="silberengel/wikistr:${VERSION}-${service}"
        LATEST_TAG="silberengel/wikistr:latest-${service}"
        
        echo -e "  Tagging ${service}..."
        docker tag "${VERSION_TAG}" "${LATEST_TAG}" 2>/dev/null || echo -e "    ${YELLOW}⚠${NC} ${VERSION_TAG} not found, skipping tag"
        echo -e "  ${GREEN}✓${NC} ${VERSION_TAG}"
        echo -e "  ${GREEN}✓${NC} ${LATEST_TAG}"
    elif [[ " ${LATEST_ONLY_SERVICES[@]} " =~ " ${service} " ]]; then
        # Latest-only services (og-proxy) already have latest tag from docker-compose
        echo -e "  ${GREEN}✓${NC} ${service} (latest tag already set)"
    fi
done

echo
echo -e "${GREEN}✅ All images tagged successfully!${NC}"
echo

# Clean up old images after building (remove old version tags that are no longer needed)
echo -e "${BLUE}🧹 Final cleanup of old images...${NC}"
CLEANED_ANY=false

# Get all theme services and clean up old versions (excluding current version and latest)
for service in "${THEME_SERVICES[@]}"; do
    # Get all version tags for this service
    ALL_TAGS=$(docker images --format "{{.Repository}}:{{.Tag}}" silberengel/wikistr 2>/dev/null | \
        grep "^silberengel/wikistr:" | \
        grep -E "v[0-9]+\.[0-9]+-${service}$" || true)
    
    if [ -n "$ALL_TAGS" ]; then
        while IFS= read -r tag; do
            # Skip if it's the current version or latest tag
            if [ "$tag" = "silberengel/wikistr:${VERSION}-${service}" ] || \
               [ "$tag" = "silberengel/wikistr:latest-${service}" ]; then
                continue
            fi
            
            # This is an old version tag, remove it
            echo -e "  Removing old tag: ${tag}"
            docker rmi "$tag" 2>/dev/null || true
            CLEANED_ANY=true
        done <<< "$ALL_TAGS"
    fi
done

# Remove any remaining dangling images
DANGLING_IMAGES=$(docker images -f "dangling=true" -q --filter "reference=silberengel/wikistr" 2>/dev/null || true)
if [ -n "$DANGLING_IMAGES" ]; then
    echo -e "  Removing remaining dangling images..."
    echo "$DANGLING_IMAGES" | xargs -r docker rmi 2>/dev/null || true
    CLEANED_ANY=true
fi

if [ "$CLEANED_ANY" = true ]; then
    echo -e "${GREEN}✅ Cleanup complete!${NC}"
else
    echo -e "${BLUE}ℹ️  No old images to clean up${NC}"
fi
echo

# Ask if user wants to push to Docker Hub
read -p "Do you want to push images to Docker Hub? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${BLUE}📤 Pushing images to Docker Hub...${NC}"
    
    PUSHED_COUNT=0
    SKIPPED_COUNT=0
    
    for service in "${SERVICES_TO_BUILD[@]}"; do
        if [[ " ${THEME_SERVICES[@]} " =~ " ${service} " ]]; then
            VERSION_TAG="silberengel/wikistr:${VERSION}-${service}"
            LATEST_TAG="silberengel/wikistr:latest-${service}"
            
            # Check if images exist before pushing
            if docker images --format '{{.Repository}}:{{.Tag}}' | grep -q "^${VERSION_TAG}$"; then
                echo -e "  Pushing ${service}..."
                docker push "${VERSION_TAG}" || {
                    echo -e "    ${RED}✗${NC} Failed to push ${VERSION_TAG}"
                    SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
                    continue
                }
                docker push "${LATEST_TAG}" || {
                    echo -e "    ${RED}✗${NC} Failed to push ${LATEST_TAG}"
                    SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
                    continue
                }
                echo -e "  ${GREEN}✓${NC} ${service} pushed"
                PUSHED_COUNT=$((PUSHED_COUNT + 1))
            else
                echo -e "  ${YELLOW}⚠${NC} ${service} image not found (${VERSION_TAG}), skipping push"
                SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
            fi
        elif [[ " ${LATEST_ONLY_SERVICES[@]} " =~ " ${service} " ]]; then
            LATEST_TAG="silberengel/wikistr:latest-${service}"
            
            # Check if image exists before pushing
            if docker images --format '{{.Repository}}:{{.Tag}}' | grep -q "^${LATEST_TAG}$"; then
                echo -e "  Pushing ${service}..."
                docker push "${LATEST_TAG}" || {
                    echo -e "    ${RED}✗${NC} Failed to push ${LATEST_TAG}"
                    SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
                    continue
                }
                echo -e "  ${GREEN}✓${NC} ${service} pushed"
                PUSHED_COUNT=$((PUSHED_COUNT + 1))
            else
                echo -e "  ${YELLOW}⚠${NC} ${service} image not found (${LATEST_TAG}), skipping push"
                SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
            fi
        fi
    done
    
    echo
    if [ $PUSHED_COUNT -gt 0 ]; then
        echo -e "${GREEN}✅ Pushed ${PUSHED_COUNT} service(s) to Docker Hub!${NC}"
    fi
    if [ $SKIPPED_COUNT -gt 0 ]; then
        echo -e "${YELLOW}⚠️  Skipped ${SKIPPED_COUNT} service(s) (not built or push failed)${NC}"
    fi
else
    echo -e "${YELLOW}⏭️  Skipping Docker Hub push${NC}"
fi

echo
echo -e "${BLUE}📋 Summary:${NC}"
echo -e "Built and tagged the following images:"
for service in "${SERVICES_TO_BUILD[@]}"; do
    if [[ " ${THEME_SERVICES[@]} " =~ " ${service} " ]]; then
        echo -e "  • silberengel/wikistr:${VERSION}-${service}"
        echo -e "  • silberengel/wikistr:latest-${service}"
    elif [[ " ${LATEST_ONLY_SERVICES[@]} " =~ " ${service} " ]]; then
        echo -e "  • silberengel/wikistr:latest-${service}"
    fi
done

echo
echo -e "${BLUE}💡 Usage examples:${NC}"
echo -e "  # Run locally"
echo -e "  docker run -d --name wikistr -p 8080:80 silberengel/wikistr:latest-wikistr"
echo -e "  docker run -d --name biblestr -p 8081:80 silberengel/wikistr:latest-biblestr"
echo -e "  docker run -d --name quranstr -p 8082:80 silberengel/wikistr:latest-quranstr"
echo -e "  docker run -d --name torahstr -p 8083:80 silberengel/wikistr:latest-torahstr"
echo -e "  docker run -d --name og-proxy -p 8090:8090 silberengel/wikistr:latest-og-proxy"
echo -e "  docker run -d --name asciidoctor -p 8091:8091 silberengel/wikistr:latest-asciidoctor"
echo -e "  docker run -d --name alexandria-catalogue -p 8092:8092 silberengel/wikistr:latest-alexandria-catalogue"
echo
echo -e "  # Deploy on cloud server"
echo -e "  docker run -d --name wikistr -p 3000:80 silberengel/wikistr:${VERSION}-wikistr"
echo -e "  docker run -d --name biblestr -p 4000:80 silberengel/wikistr:${VERSION}-biblestr"
echo -e "  docker run -d --name quranstr -p 4050:80 silberengel/wikistr:${VERSION}-quranstr"
echo -e "  docker run -d --name torahstr -p 4080:80 silberengel/wikistr:${VERSION}-torahstr"
echo
echo -e "${GREEN}🎉 Done!${NC}"

