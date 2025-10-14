#!/bin/bash

# Fix SSL certificate issues for wikistr.imwald.eu

set -e

echo "🔧 Fixing SSL certificate for wikistr.imwald.eu..."

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}Step 1: Check existing certificates${NC}"
sudo certbot certificates | grep -A 10 "wikistr.imwald.eu" || echo "No certificate found for wikistr.imwald.eu"

echo -e "\n${BLUE}Step 2: Check certificate files${NC}"
if [ -f /etc/letsencrypt/live/wikistr.imwald.eu/fullchain.pem ]; then
    echo -e "${GREEN}✅ Certificate file exists${NC}"
    echo "Certificate details:"
    sudo openssl x509 -in /etc/letsencrypt/live/wikistr.imwald.eu/fullchain.pem -text -noout | grep -E "(Subject:|DNS:|Not After)"
else
    echo -e "${RED}❌ Certificate file missing${NC}"
fi

echo -e "\n${BLUE}Step 3: Check Apache configuration${NC}"
echo "Current wikistr config:"
sudo grep -A 5 -B 5 "wikistr.imwald.eu" /etc/apache2/conf-available/wikistr-override.conf

echo -e "\n${BLUE}Step 4: Check Apache error logs${NC}"
echo "Recent SSL-related errors:"
sudo tail -20 /var/log/apache2/error.log | grep -i ssl || echo "No SSL errors found"

echo -e "\n${BLUE}Step 5: Test Apache configuration${NC}"
sudo apache2ctl configtest

echo -e "\n${BLUE}Step 6: Check virtual host precedence${NC}"
sudo apache2ctl -S | grep -A 5 -B 5 "wikistr.imwald.eu"

echo -e "\n${BLUE}Step 7: Fix virtual host precedence${NC}"
echo "Making wikistr the default server for port 443..."

# Backup original config
sudo cp /etc/apache2/conf-available/wikistr-override.conf /etc/apache2/conf-available/wikistr-override.conf.backup

# Fix the virtual host to be the default
sudo sed -i 's/<VirtualHost \*:443>/<VirtualHost _default_:443>/' /etc/apache2/conf-available/wikistr-override.conf

echo -e "\n${BLUE}Step 8: Restart Apache${NC}"
sudo systemctl restart apache2

echo -e "\n${BLUE}Step 9: Test SSL connection${NC}"
sleep 3
echo "Testing HTTPS connection..."
if curl -I https://wikistr.imwald.eu 2>/dev/null | grep -q "200 OK"; then
    echo -e "${GREEN}✅ HTTPS is working!${NC}"
else
    echo -e "${RED}❌ HTTPS still not working${NC}"
    echo "Trying to debug further..."
    
    # Check if certificate is being used
    echo "Certificate being served:"
    echo | openssl s_client -connect wikistr.imwald.eu:443 -servername wikistr.imwald.eu 2>/dev/null | openssl x509 -noout -subject -dates 2>/dev/null || echo "Cannot connect to SSL"
    
    # Check Apache access logs
    echo "Recent Apache access logs:"
    sudo tail -5 /var/log/apache2/wikistr-access.log 2>/dev/null || echo "No wikistr access logs found"
fi

echo -e "\n${YELLOW}If HTTPS still doesn't work, try these manual fixes:${NC}"
echo "1. Check certificate validity: sudo certbot certificates"
echo "2. Force certificate renewal: sudo certbot renew --force-renewal"
echo "3. Check Apache modules: sudo a2enmod ssl"
echo "4. Verify DNS: nslookup wikistr.imwald.eu"
echo "5. Check firewall: sudo ufw status"
