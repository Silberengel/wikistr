#!/bin/bash
# Fix Alexandria Catalogue proxy configuration in Apache
# This script finds the correct IP address and updates Apache config

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APACHE_CONF="${SCRIPT_DIR}/apache.conf"

echo "🔍 Checking Alexandria Catalogue container status..."

# Check if container exists
if ! docker ps -a --format '{{.Names}}' | grep -q "^alexandria-catalogue$"; then
    echo "❌ Alexandria Catalogue container not found!"
    echo "   Please run: ./deploy-all-apps.sh or ./deploy-services.sh"
    exit 1
fi

# Check if container is running
if ! docker ps --format '{{.Names}}' | grep -q "^alexandria-catalogue$"; then
    echo "⚠️  Alexandria Catalogue container exists but is not running!"
    echo "   Starting container..."
    docker start alexandria-catalogue
    sleep 2
fi

# Get the IP address
echo "🌐 Finding Alexandria Catalogue container IP address..."
IP_ADDRESS=$(docker inspect alexandria-catalogue --format='{{range $k, $v := .NetworkSettings.Networks}}{{if eq $k "wikistr-network"}}{{$v.IPAddress}}{{end}}{{end}}' 2>/dev/null)

if [ -z "$IP_ADDRESS" ]; then
    # Try default network
    IP_ADDRESS=$(docker inspect alexandria-catalogue --format='{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' 2>/dev/null | head -1)
fi

if [ -z "$IP_ADDRESS" ]; then
    echo "❌ Could not determine IP address of alexandria-catalogue container"
    echo "   Container info:"
    docker inspect alexandria-catalogue --format='Networks: {{range $k, $v := .NetworkSettings.Networks}}{{$k}}={{$v.IPAddress}} {{end}}'
    exit 1
fi

echo "✅ Found IP address: $IP_ADDRESS"

# Check if service is responding
echo "🔍 Testing connection to http://${IP_ADDRESS}:8092/..."
if curl -f -s "http://${IP_ADDRESS}:8092/healthz" > /dev/null 2>&1; then
    echo "✅ Service is responding on port 8092"
else
    echo "⚠️  Service health check failed, but continuing..."
fi

# Update Apache config
echo "📝 Updating Apache configuration..."
# Try to get IP from ProxyPassMatch first, then ProxyPass
CURRENT_IP=$(grep -oP 'ProxyPassMatch \^/alexandria-catalogue\(\.\*\)\\\$ http://\K[0-9.]+' "$APACHE_CONF" | head -1)
if [ -z "$CURRENT_IP" ]; then
    CURRENT_IP=$(grep -oP 'ProxyPass /alexandria-catalogue http://\K[0-9.]+' "$APACHE_CONF" | head -1)
fi

if [ "$CURRENT_IP" = "$IP_ADDRESS" ]; then
    echo "✅ Apache config file already has correct IP address ($IP_ADDRESS)"
else
    echo "🔄 Updating IP from $CURRENT_IP to $IP_ADDRESS..."
    
    # Create backup
    cp "$APACHE_CONF" "${APACHE_CONF}.backup.$(date +%Y%m%d_%H%M%S)"
    
    # Update the IP address (handle both ProxyPass and ProxyPassMatch formats)
    # First, convert ProxyPass to ProxyPassMatch if needed, or update existing ProxyPassMatch
    if grep -q "ProxyPassMatch.*alexandria-catalogue" "$APACHE_CONF"; then
        sed -i "s|ProxyPassMatch \^/alexandria-catalogue(\.\*)\\\$ http://[0-9.]\\+:8092|ProxyPassMatch ^/alexandria-catalogue(.*)\$ http://${IP_ADDRESS}:8092|g" "$APACHE_CONF"
    else
        sed -i "s|ProxyPass /alexandria-catalogue http://[0-9.]\\+:8092/|ProxyPassMatch ^/alexandria-catalogue(.*)\$ http://${IP_ADDRESS}:8092\1|g" "$APACHE_CONF"
    fi
    sed -i "s|ProxyPassReverse /alexandria-catalogue http://[0-9.]\\+:8092|ProxyPassReverse /alexandria-catalogue http://${IP_ADDRESS}:8092|g" "$APACHE_CONF"
    
    echo "✅ Apache config file updated!"
fi

# Find wikistr container
WIKISTR_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E '^wikistr$|^deployment_wikistr' | head -1)
if [ -z "$WIKISTR_CONTAINER" ]; then
    echo "⚠️  Could not find running wikistr container"
    echo "   Please manually restart your wikistr container after rebuilding the image"
    exit 1
fi

echo "🔄 Updating Apache config inside wikistr container..."
# Copy updated config into the running container
docker cp "$APACHE_CONF" "${WIKISTR_CONTAINER}:/usr/local/apache2/conf/httpd.conf"

echo "🔄 Restarting Apache inside container..."
# Restart Apache inside the container (graceful restart)
docker exec "${WIKISTR_CONTAINER}" httpd -k graceful 2>/dev/null || {
    echo "⚠️  Graceful restart failed, doing full restart..."
    docker restart "$WIKISTR_CONTAINER"
    sleep 2
}

echo ""
echo "✅ Done! The proxy should now work correctly."
echo "   Test it: curl http://localhost:8080/alexandria-catalogue/healthz"
