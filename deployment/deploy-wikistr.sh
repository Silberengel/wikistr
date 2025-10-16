#!/bin/bash

# Deployment script for wikistr.imwald.eu on Plesk server
# Based on Stella's deployment guide

set -e

echo "🚀 Deploying wikistr.imwald.eu to Plesk server..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Step 1: Deploy wikistr Docker container${NC}"

# Pull the latest wikistr image
echo -e "${YELLOW}Pulling latest wikistr image...${NC}"
docker pull silberengel/wikistr:latest

# Stop and remove existing container if it exists
echo -e "${YELLOW}Stopping existing wikistr container...${NC}"
docker stop wikistr-app 2>/dev/null || true
docker rm wikistr-app 2>/dev/null || true

# Run the wikistr container
echo -e "${YELLOW}Starting wikistr container...${NC}"
docker run -d \
  --name wikistr-app \
  --restart unless-stopped \
  -p 127.0.0.1:3000:80 \
  -e NODE_ENV=production \
  silberengel/wikistr:latest

# Wait for container to start
echo -e "${YELLOW}Waiting for container to start...${NC}"
sleep 10

# Test the container
echo -e "${YELLOW}Testing container health...${NC}"
if curl -f http://127.0.0.1:3000/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Container is healthy!${NC}"
else
    echo -e "${RED}❌ Container health check failed${NC}"
    docker logs wikistr-app
    exit 1
fi

echo -e "${BLUE}Step 2: Configure Apache virtual host${NC}"

# Create Apache configuration file
echo -e "${YELLOW}Creating Apache virtual host configuration...${NC}"
sudo tee /etc/apache2/conf-available/wikistr-override.conf << 'EOF'
<VirtualHost wikistr.imwald.eu:443>
    ServerName wikistr.imwald.eu
    ServerAlias www.wikistr.imwald.eu

    # SSL Configuration (Let's Encrypt)
    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/wikistr.imwald.eu/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/wikistr.imwald.eu/privkey.pem

    # Document Root (required for Plesk)
    DocumentRoot /var/www/wikistr

    # Proxy settings for Docker container
    ProxyPreserveHost On
    ProxyRequests Off

    # Regular HTTP proxy to the wikistr container
    ProxyPass / http://127.0.0.1:3000/
    ProxyPassReverse / http://127.0.0.1:3000/

    # Headers for modern web apps
    ProxyAddHeaders On
    Header always set X-Forwarded-Proto "https"
    Header always set X-Forwarded-Port "443"
    Header always set X-Forwarded-For %{REMOTE_ADDR}s

    # Security headers
    Header always set Strict-Transport-Security "max-age=63072000; includeSubDomains"
    Header always set X-Content-Type-Options "nosniff"
    Header always set X-Frame-Options "SAMEORIGIN"
    Header always set X-XSS-Protection "1; mode=block"
    Header always set Referrer-Policy "strict-origin-when-cross-origin"
    
    # CSP for SvelteKit app
    Header always set Content-Security-Policy "default-src 'self' http: https: data: blob: 'unsafe-inline' 'unsafe-eval'; connect-src 'self' https: wss: ws:; font-src 'self' https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;"

    # Logging
    ErrorLog /var/log/apache2/wikistr-error.log
    CustomLog /var/log/apache2/wikistr-access.log combined
</VirtualHost>

# HTTP Virtual Host (Redirect to HTTPS)
<VirtualHost *:80>
    ServerName wikistr.imwald.eu
    ServerAlias www.wikistr.imwald.eu
    
    # Redirect all HTTP traffic to HTTPS
    Redirect permanent / https://wikistr.imwald.eu/
    
    # Logging
    ErrorLog /var/log/apache2/wikistr-http-error.log
    CustomLog /var/log/apache2/wikistr-http-access.log combined
</VirtualHost>
EOF

# Enable the Apache configuration
echo -e "${YELLOW}Enabling Apache configuration...${NC}"
sudo a2enconf wikistr-override

# Create document root directory
echo -e "${YELLOW}Creating document root directory...${NC}"
sudo mkdir -p /var/www/wikistr

echo -e "${BLUE}Step 3: Enable required Apache modules${NC}"

# Enable required Apache modules
echo -e "${YELLOW}Enabling Apache modules...${NC}"
sudo a2enmod proxy
sudo a2enmod proxy_http
sudo a2enmod headers
sudo a2enmod rewrite
sudo a2enmod ssl

echo -e "${BLUE}Step 4: Restart Apache${NC}"

# Restart Apache to apply changes
echo -e "${YELLOW}Restarting Apache...${NC}"
sudo systemctl restart apache2

echo -e "${BLUE}Step 5: Verify deployment${NC}"

# Wait a moment for Apache to restart
sleep 5

# Test the deployment
echo -e "${YELLOW}Testing deployment...${NC}"
if curl -I https://wikistr.imwald.eu 2>/dev/null | grep -q "200 OK"; then
    echo -e "${GREEN}✅ HTTPS deployment successful!${NC}"
elif curl -I http://wikistr.imwald.eu 2>/dev/null | grep -q "301\|302"; then
    echo -e "${GREEN}✅ HTTP redirect working!${NC}"
    echo -e "${YELLOW}⚠️  Note: SSL certificate may need to be set up${NC}"
else
    echo -e "${RED}❌ Deployment test failed${NC}"
    echo -e "${YELLOW}Checking Apache configuration...${NC}"
    sudo apache2ctl configtest
    echo -e "${YELLOW}Checking virtual host precedence...${NC}"
    sudo apache2ctl -S | grep wikistr
fi

echo -e "${GREEN}🎉 Deployment complete!${NC}"
echo -e "${BLUE}Next steps:${NC}"
echo -e "1. Set up SSL certificate with Let's Encrypt (if not already done)"
echo -e "2. Test the website at https://wikistr.imwald.eu"
echo -e "3. Monitor logs: sudo tail -f /var/log/apache2/wikistr-error.log"

echo -e "${BLUE}Useful commands:${NC}"
echo -e "• View container logs: docker logs wikistr-app"
echo -e "• Restart container: docker restart wikistr-app"
echo -e "• Check Apache config: sudo apache2ctl configtest"
echo -e "• View virtual hosts: sudo apache2ctl -S"
