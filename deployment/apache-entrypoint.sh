#!/bin/sh
# Apache entrypoint script that dynamically updates proxy IPs at container startup
# This script requires the Docker socket to be mounted: -v /var/run/docker.sock:/var/run/docker.sock:ro

set -e

APACHE_CONF="/usr/local/apache2/conf/httpd.conf"

# Check if docker is available
if ! command -v docker >/dev/null 2>&1; then
    echo "[Entrypoint] Docker CLI not available, skipping dynamic IP update"
    echo "[Entrypoint] Starting Apache with default configuration"
    exec httpd -D FOREGROUND
    exit 0
fi

# Function to get container IP by name
get_container_ip() {
    local container_name=$1
    # Try to get IP from wikistr-network first, then default network
    docker inspect "$container_name" --format='{{range $k, $v := .NetworkSettings.Networks}}{{if eq $k "wikistr-network"}}{{$v.IPAddress}}{{end}}{{end}}' 2>/dev/null || \
    docker inspect "$container_name" --format='{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' 2>/dev/null | head -1 || \
    echo ""
}

# Update alexandria-catalogue IP if container exists
if docker ps --format '{{.Names}}' | grep -q "^alexandria-catalogue$" || \
   docker ps -a --format '{{.Names}}' | grep -q "^alexandria-catalogue$"; then
    ALEX_IP=$(get_container_ip "alexandria-catalogue")
    if [ -n "$ALEX_IP" ]; then
        echo "[Entrypoint] Updating alexandria-catalogue proxy IP to: $ALEX_IP"
        sed -i "s|ProxyPassMatch \^/alexandria-catalogue(\.\*)\\\$ http://[0-9.]\\+:8092|ProxyPassMatch ^/alexandria-catalogue(.*)\$ http://${ALEX_IP}:8092|g" "$APACHE_CONF"
        sed -i "s|ProxyPassReverse /alexandria-catalogue http://[0-9.]\\+:8092|ProxyPassReverse /alexandria-catalogue http://${ALEX_IP}:8092|g" "$APACHE_CONF"
    fi
fi

# Update asciidoctor IP if container exists
if docker ps --format '{{.Names}}' | grep -q "^asciidoctor$" || \
   docker ps -a --format '{{.Names}}' | grep -q "^asciidoctor$"; then
    ASCIIDOCTOR_IP=$(get_container_ip "asciidoctor")
    if [ -n "$ASCIIDOCTOR_IP" ]; then
        echo "[Entrypoint] Updating asciidoctor proxy IP to: $ASCIIDOCTOR_IP"
        sed -i "s|ProxyPass /asciidoctor http://[0-9.]\\+:8091/|ProxyPass /asciidoctor http://${ASCIIDOCTOR_IP}:8091/|g" "$APACHE_CONF"
        sed -i "s|ProxyPassReverse /asciidoctor http://[0-9.]\\+:8091/|ProxyPassReverse /asciidoctor http://${ASCIIDOCTOR_IP}:8091/|g" "$APACHE_CONF"
    fi
fi

# Update og-proxy IP if container exists (check for both naming patterns)
OG_PROXY_NAME=$(docker ps --format '{{.Names}}' | grep -E '^og-proxy$|^deployment_og-proxy' | head -1)
if [ -n "$OG_PROXY_NAME" ]; then
    OG_PROXY_IP=$(get_container_ip "$OG_PROXY_NAME")
    if [ -n "$OG_PROXY_IP" ]; then
        echo "[Entrypoint] Updating og-proxy proxy IP to: $OG_PROXY_IP"
        sed -i "s|ProxyPassMatch \^/sites(\.\*)\\\$ http://[0-9.]\\+:8090|ProxyPassMatch ^/sites(.*)\$ http://${OG_PROXY_IP}:8090|g" "$APACHE_CONF"
        sed -i "s|ProxyPassReverse /sites http://[0-9.]\\+:8090|ProxyPassReverse /sites http://${OG_PROXY_IP}:8090|g" "$APACHE_CONF"
    fi
fi

# Start Apache
exec httpd -D FOREGROUND
