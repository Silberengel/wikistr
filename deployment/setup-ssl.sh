#!/bin/bash

# SSL Certificate Setup for wikistr.imwald.eu
# Using Let's Encrypt with certbot

set -e

echo "🔒 Setting up SSL certificate for wikistr.imwald.eu..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

DOMAIN="wikistr.imwald.eu"

# Check if certbot is installed
if ! command -v certbot &> /dev/null; then
    echo -e "${YELLOW}Installing certbot...${NC}"
    sudo apt update
    sudo apt install -y certbot python3-certbot-apache
fi

echo -e "${BLUE}Step 1: Stop Apache temporarily${NC}"
sudo systemctl stop apache2

echo -e "${BLUE}Step 2: Obtain SSL certificate${NC}"
echo -e "${YELLOW}Obtaining SSL certificate for $DOMAIN...${NC}"

# Get certificate using standalone mode (since Apache is stopped)
sudo certbot certonly \
    --standalone \
    --preferred-challenges http \
    -d $DOMAIN \
    -d www.$DOMAIN \
    --email admin@imwald.eu \
    --agree-tos \
    --non-interactive

echo -e "${BLUE}Step 3: Start Apache${NC}"
sudo systemctl start apache2

echo -e "${BLUE}Step 4: Test SSL certificate${NC}"

# Wait for Apache to start
sleep 5

# Test HTTPS
if curl -I https://$DOMAIN 2>/dev/null | grep -q "200 OK"; then
    echo -e "${GREEN}✅ SSL certificate is working!${NC}"
else
    echo -e "${YELLOW}⚠️  SSL setup completed, but HTTPS test failed${NC}"
    echo -e "${YELLOW}This might be normal if the certificate is still propagating${NC}"
fi

echo -e "${BLUE}Step 5: Set up automatic renewal${NC}"

# Create renewal script
sudo tee /etc/cron.d/certbot-renewal << EOF
# Renew Let's Encrypt certificates twice daily
0 12 * * * root certbot renew --quiet --post-hook "systemctl reload apache2"
0 0 * * * root certbot renew --quiet --post-hook "systemctl reload apache2"
EOF

echo -e "${GREEN}🎉 SSL setup complete!${NC}"
echo -e "${BLUE}Certificate location:${NC}"
echo -e "• Certificate: /etc/letsencrypt/live/$DOMAIN/fullchain.pem"
echo -e "• Private Key: /etc/letsencrypt/live/$DOMAIN/privkey.pem"

echo -e "${BLUE}Test your SSL:${NC}"
echo -e "• https://$DOMAIN"
echo -e "• https://www.ssllabs.com/ssltest/analyze.html?d=$DOMAIN"

echo -e "${BLUE}Useful commands:${NC}"
echo -e "• Renew certificate: sudo certbot renew"
echo -e "• Check certificate status: sudo certbot certificates"
echo -e "• Test renewal: sudo certbot renew --dry-run"
