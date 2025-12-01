#!/bin/bash

# Quick diagnostic script to check OG Proxy status
# Usage: ./check-proxy.sh

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}OG Proxy Diagnostic Check${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo

# Check 1: Is container running?
echo -e "${BLUE}1. Checking if og-proxy container is running...${NC}"
if docker ps --format '{{.Names}}' | grep -q "^og-proxy$"; then
    echo -e "  ${GREEN}✓${NC} og-proxy container is running"
    CONTAINER_RUNNING=true
else
    echo -e "  ${RED}✗${NC} og-proxy container is NOT running"
    echo -e "  ${YELLOW}   Fix: Run ./deploy-services.sh${NC}"
    CONTAINER_RUNNING=false
fi
echo

# Check 2: Is port 8090 accessible?
if [ "$CONTAINER_RUNNING" = true ]; then
    echo -e "${BLUE}2. Checking if port 8090 is accessible...${NC}"
    if curl -f -s "http://localhost:8090/healthz" > /dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} Port 8090 is accessible"
        PORT_ACCESSIBLE=true
    else
        echo -e "  ${RED}✗${NC} Port 8090 is NOT accessible"
        echo -e "  ${YELLOW}   Check: docker logs og-proxy${NC}"
        PORT_ACCESSIBLE=false
    fi
    echo
fi

# Check 3: Check container environment variables
if [ "$CONTAINER_RUNNING" = true ]; then
    echo -e "${BLUE}3. Checking container configuration...${NC}"
    PROXY_ORIGIN=$(docker inspect og-proxy --format '{{range .Config.Env}}{{println .}}{{end}}' | grep PROXY_ALLOW_ORIGIN | cut -d= -f2)
    PROXY_PORT=$(docker inspect og-proxy --format '{{range .Config.Env}}{{println .}}{{end}}' | grep PROXY_PORT | cut -d= -f2)
    
    echo -e "  PROXY_PORT: ${PROXY_PORT:-8090}"
    echo -e "  PROXY_ALLOW_ORIGIN: ${PROXY_ORIGIN:-*}"
    
    if [ -n "$PROXY_ORIGIN" ] && [ "$PROXY_ORIGIN" != "*" ]; then
        echo -e "  ${YELLOW}⚠${NC} PROXY_ALLOW_ORIGIN is set to: $PROXY_ORIGIN"
        echo -e "  ${YELLOW}   Make sure this matches your domain${NC}"
    fi
    echo
fi

# Check 4: Check Apache configuration
echo -e "${BLUE}4. Checking Apache configuration...${NC}"
if command -v apache2ctl > /dev/null 2>&1; then
    APACHE_CONFIG=$(apache2ctl -S 2>/dev/null | grep -E "wikistr|biblestr|quranstr|torahstr" | head -1 || true)
    if [ -n "$APACHE_CONFIG" ]; then
        echo -e "  ${GREEN}✓${NC} Apache is configured"
        
        # Check if /sites/ ProxyPass exists
        APACHE_SITES=$(grep -r "ProxyPass.*/sites/" /etc/apache2/sites-enabled/ 2>/dev/null | head -1 || true)
        if [ -n "$APACHE_SITES" ]; then
            echo -e "  ${GREEN}✓${NC} /sites/ ProxyPass found in Apache config"
            echo -e "  ${BLUE}   Config: ${APACHE_SITES}${NC}"
            
            # Check ProxyPass order - /sites/ should come before /
            SITES_LINE=$(grep -n "ProxyPass.*/sites/" /etc/apache2/sites-enabled/*.conf 2>/dev/null | head -1 | cut -d: -f2 || true)
            MAIN_LINE=$(grep -n "ProxyPass / " /etc/apache2/sites-enabled/*.conf 2>/dev/null | head -1 | cut -d: -f2 || true)
            
            if [ -n "$SITES_LINE" ] && [ -n "$MAIN_LINE" ]; then
                if [ "$SITES_LINE" -lt "$MAIN_LINE" ]; then
                    echo -e "  ${GREEN}✓${NC} ProxyPass order is correct (/sites/ before /)"
                else
                    echo -e "  ${RED}✗${NC} ProxyPass order is WRONG - /sites/ must come BEFORE /"
                    echo -e "  ${YELLOW}   Fix: Move /sites/ ProxyPass before main ProxyPass /${NC}"
                fi
            fi
        else
            echo -e "  ${RED}✗${NC} /sites/ ProxyPass NOT found in Apache config"
            echo -e "  ${YELLOW}   Fix: Add ProxyPass /sites/ http://127.0.0.1:8090/sites/${NC}"
        fi
    else
        echo -e "  ${YELLOW}⚠${NC} Apache configuration not found for wikistr domains"
    fi
else
    echo -e "  ${YELLOW}⚠${NC} Apache not installed or apache2ctl not found"
fi
echo

# Check 5: Test proxy through Apache (if domain is set)
if [ -n "$1" ]; then
    # Clean up domain parameter (remove brackets, https://, trailing slashes)
    DOMAIN=$(echo "$1" | sed 's/^\[//;s/\]$//;s|^https\?://||;s|/$||')
    echo -e "${BLUE}5. Testing proxy through Apache (https://${DOMAIN}/sites/)...${NC}"
    
    # Test with a real proxy request (proxy expects /sites/?url=...)
    TEST_URL="https://${DOMAIN}/sites/?url=https://www.example.com"
    echo -e "  ${BLUE}   Testing proxy request: ${TEST_URL}${NC}"
    
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -k "$TEST_URL" 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "502" ] || [ "$HTTP_CODE" = "504" ]; then
        # 200 = success, 502/504 = proxy working but upstream issue (which is OK for test)
        echo -e "  ${GREEN}✓${NC} Proxy is working through Apache (HTTP ${HTTP_CODE})"
        if [ "$HTTP_CODE" != "200" ]; then
            echo -e "  ${YELLOW}   Note: ${HTTP_CODE} indicates proxy is working but upstream had issues (expected for test)${NC}"
        fi
    else
        echo -e "  ${RED}✗${NC} Proxy request returned HTTP ${HTTP_CODE}"
    fi
    
    # Test with actual BibleGateway URL (this is what's failing)
    echo
    echo -e "  ${BLUE}   Testing BibleGateway URL (this is what's timing out)...${NC}"
    BG_URL="https://${DOMAIN}/sites/?url=https%3A%2F%2Fwww.biblegateway.com%2Fpassage%2F%3Fsearch%3DJohn%2B3%3A16%26version%3DKJV"
    echo -e "  ${BLUE}   URL: ${BG_URL}${NC}"
    
    # Test with 6 second timeout (slightly more than client's 5s)
    BG_CODE=$(timeout 6 curl -s -o /dev/null -w "%{http_code}" -k "$BG_URL" 2>/dev/null || echo "TIMEOUT")
    if [ "$BG_CODE" = "200" ]; then
        echo -e "  ${GREEN}✓${NC} BibleGateway proxy request succeeded (HTTP 200)"
    elif [ "$BG_CODE" = "TIMEOUT" ]; then
        echo -e "  ${RED}✗${NC} BibleGateway request TIMED OUT (>6 seconds)"
        echo -e "  ${YELLOW}   This confirms the issue - BibleGateway is slow or blocking${NC}"
        echo -e "  ${YELLOW}   Check proxy logs: docker logs og-proxy | tail -20${NC}"
    elif [ "$BG_CODE" = "502" ] || [ "$BG_CODE" = "504" ]; then
        echo -e "  ${YELLOW}⚠${NC} BibleGateway request returned HTTP ${BG_CODE} (proxy working, but BibleGateway unreachable)"
    else
        echo -e "  ${RED}✗${NC} BibleGateway request returned HTTP ${BG_CODE}"
    fi
    
    if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "502" ] && [ "$HTTP_CODE" != "504" ]; then
        echo -e "  ${RED}✗${NC} Proxy request returned HTTP ${HTTP_CODE}"
        echo -e "  ${YELLOW}   Testing with verbose output...${NC}"
        echo -e "  ${BLUE}   Running: curl -v -k \"${TEST_URL}\"${NC}"
        curl -v -k "$TEST_URL" 2>&1 | grep -E "(< HTTP|> GET|> Host|error|400|404|502|503)" | head -10
        echo
        echo -e "  ${BLUE}   For comparison, direct test to proxy:${NC}"
        echo -e "  ${BLUE}   curl -v \"http://localhost:8090/sites/?url=https://www.example.com\"${NC}"
        DIRECT_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:8090/sites/?url=https://www.example.com" 2>/dev/null || echo "000")
        echo -e "  ${BLUE}   Direct proxy returned: HTTP ${DIRECT_CODE}${NC}"
        echo
        echo -e "  ${YELLOW}   Common fixes:${NC}"
        echo -e "    - Check Apache error logs: sudo tail -20 /var/log/apache2/error.log"
        echo -e "    - Verify ProxyPass configuration: grep -r 'ProxyPass.*sites' /etc/apache2/sites-enabled/"
        echo -e "    - Test direct proxy: curl http://localhost:8090/sites/?url=https://www.example.com"
        echo -e "    - Reload Apache: sudo systemctl reload apache2"
    fi
    echo
fi

# Summary
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Summary${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

if [ "$CONTAINER_RUNNING" = false ]; then
    echo -e "${RED}❌ OG Proxy container is not running${NC}"
    echo -e "   Run: ./deploy-services.sh"
    exit 1
elif [ "$PORT_ACCESSIBLE" = false ]; then
    echo -e "${RED}❌ OG Proxy is not responding on port 8090${NC}"
    echo -e "   Check: docker logs og-proxy"
    exit 1
else
    echo -e "${GREEN}✓${NC} OG Proxy container is running and accessible"
    echo -e "${BLUE}💡${NC} If proxy still doesn't work:"
    echo -e "   1. Check Apache configuration for /sites/ ProxyPass"
    echo -e "   2. Verify ProxyPass order (must come before main ProxyPass /)"
    echo -e "   3. Check Apache error logs: sudo tail -f /var/log/apache2/error.log"
fi

