#!/bin/bash

# Debug script for wikistr deployment issues
# Run this on your server to diagnose problems

set -e

echo "🔍 Debugging wikistr deployment..."

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}Step 1: Check Docker containers${NC}"
echo "Running Docker containers:"
docker ps | grep -E "(wikistr|relay)" || echo "No wikistr or relay containers found"

echo -e "\n${BLUE}Step 2: Check port usage${NC}"
echo "Port 3000 (wikistr should be here):"
sudo netstat -tlnp | grep :3000 || echo "Port 3000 is free"

echo "Port 7777 (relay should be here):"
sudo netstat -tlnp | grep :7777 || echo "Port 7777 is free"

echo -e "\n${BLUE}Step 3: Test local connectivity${NC}"
echo "Testing wikistr on localhost:3000:"
if curl -f http://127.0.0.1:3000/health 2>/dev/null; then
    echo -e "${GREEN}✅ wikistr is responding on port 3000${NC}"
else
    echo -e "${RED}❌ wikistr is NOT responding on port 3000${NC}"
fi

echo "Testing relay on localhost:7777:"
if curl -f http://127.0.0.1:7777 2>/dev/null; then
    echo -e "${GREEN}✅ Relay is responding on port 7777${NC}"
else
    echo -e "${RED}❌ Relay is NOT responding on port 7777${NC}"
fi

echo -e "\n${BLUE}Step 4: Check Apache virtual hosts${NC}"
echo "Active virtual hosts:"
sudo apache2ctl -S | grep -E "(wikistr|relay)" || echo "No wikistr or relay virtual hosts found"

echo -e "\n${BLUE}Step 5: Check Apache configuration files${NC}"
echo "wikistr config:"
if [ -f /etc/apache2/conf-available/wikistr-override.conf ]; then
    echo -e "${GREEN}✅ wikistr config exists${NC}"
    grep -E "(ServerName|ProxyPass)" /etc/apache2/conf-available/wikistr-override.conf
else
    echo -e "${RED}❌ wikistr config missing${NC}"
fi

echo "relay config:"
if [ -f /etc/apache2/conf-available/relay-override.conf ]; then
    echo -e "${GREEN}✅ relay config exists${NC}"
    grep -E "(ServerName|ProxyPass)" /etc/apache2/conf-available/relay-override.conf
else
    echo -e "${YELLOW}⚠️  relay config not found in conf-available${NC}"
fi

echo -e "\n${BLUE}Step 6: Check Plesk virtual hosts${NC}"
echo "Plesk vhost files:"
sudo ls -la /etc/apache2/plesk.conf.d/vhosts/ | grep -E "(wikistr|relay)" || echo "No wikistr or relay Plesk configs"

echo -e "\n${BLUE}Step 7: Test external connectivity${NC}"
echo "Testing wikistr.imwald.eu:"
curl -I https://wikistr.imwald.eu 2>/dev/null | head -1 || echo "Failed to connect to wikistr.imwald.eu"

echo "Testing relay domain (if different):"
# Replace with your actual relay domain
curl -I https://orly-relay.imwald.eu 2>/dev/null | head -1 || echo "Failed to connect to relay domain"

echo -e "\n${BLUE}Step 8: Check Apache error logs${NC}"
echo "Recent Apache errors:"
sudo tail -10 /var/log/apache2/error.log | grep -E "(wikistr|relay)" || echo "No relevant errors found"

echo -e "\n${BLUE}Step 9: Check enabled Apache configs${NC}"
echo "Enabled configs:"
sudo ls -la /etc/apache2/conf-enabled/ | grep -E "(wikistr|relay)"

echo -e "\n${YELLOW}Diagnosis complete!${NC}"
echo -e "${BLUE}Common issues and solutions:${NC}"
echo "1. If wikistr container isn't running: docker start wikistr-app"
echo "2. If port 3000 is free: The wikistr container failed to start"
echo "3. If Apache shows relay config: Virtual host precedence issue"
echo "4. If no wikistr config: Run the deployment script"
