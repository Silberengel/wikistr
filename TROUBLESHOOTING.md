# wikistr.imwald.eu Troubleshooting Guide

Based on Stella's deployment guide and real-world experience with Plesk environments.

## 🚨 Common Issues & Solutions

### **Container Issues**

#### **Container won't start**
```bash
# Check container status
docker ps -a | grep wikistr

# View container logs
docker logs wikistr-app

# Check if port 3000 is available
sudo netstat -tlnp | grep :3000

# Restart container
docker restart wikistr-app
```

#### **Container health check failing**
```bash
# Test container directly
curl -f http://127.0.0.1:3000/health

# Expected response: "healthy" or HTML content
# If fails, check:
docker logs wikistr-app | tail -20
```

### **Apache/Proxy Issues**

#### **HTTP 503 Service Unavailable**
- **Cause**: Docker container not running or not responding
- **Check**: `docker ps | grep wikistr`
- **Fix**: `docker restart wikistr-app`

#### **Plesk configuration not applied**
- **Symptom**: Changes in Plesk interface don't take effect
- **Check**: `grep wikistr /etc/apache2/plesk.conf.d/vhosts/*.conf`
- **Solution**: Use direct Apache override (already included in deploy script)

#### **Virtual host conflicts**
```bash
# Check virtual host precedence
sudo apache2ctl -S | grep wikistr

# Check if Plesk config conflicts
sudo ls -la /etc/apache2/plesk.conf.d/vhosts/ | grep wikistr

# If conflicts exist, remove Plesk config
sudo rm /etc/apache2/plesk.conf.d/vhosts/wikistr.imwald.eu.conf
```

#### **Apache modules not enabled**
```bash
# Check enabled modules
sudo apache2ctl -M | grep -E "(proxy|headers|rewrite|ssl)"

# Enable required modules
sudo a2enmod proxy proxy_http headers rewrite ssl
sudo systemctl restart apache2
```

### **SSL Certificate Issues**

#### **Certificate not found**
```bash
# Check certificate files
sudo ls -la /etc/letsencrypt/live/wikistr.imwald.eu/

# Expected files:
# - fullchain.pem
# - privkey.pem
```

#### **SSL certificate expired**
```bash
# Check certificate expiry
sudo certbot certificates

# Renew certificate
sudo certbot renew

# Test renewal
sudo certbot renew --dry-run
```

#### **Self-signed certificate showing**
- **Cause**: Apache using wrong certificate file
- **Check**: Certificate paths in Apache config
- **Fix**: Ensure paths point to Let's Encrypt certificates

### **DNS Issues**

#### **Domain not resolving**
```bash
# Check DNS resolution
nslookup wikistr.imwald.eu

# Check from different locations
dig wikistr.imwald.eu @8.8.8.8
```

## 🔧 Debug Commands

### **Container Debugging**
```bash
# Container status and logs
docker ps | grep wikistr
docker logs wikistr-app
docker stats wikistr-app

# Test container locally
curl -I http://127.0.0.1:3000
curl -f http://127.0.0.1:3000/health
```

### **Apache Debugging**
```bash
# Configuration test
sudo apache2ctl configtest

# Virtual host precedence
sudo apache2ctl -S | grep wikistr

# Check if config is loaded
sudo apache2ctl -M | grep wikistr

# View Apache logs
sudo tail -f /var/log/apache2/wikistr-error.log
sudo tail -f /var/log/apache2/wikistr-access.log
```

### **SSL Debugging**
```bash
# Check certificate
sudo certbot certificates

# Test SSL connection
openssl s_client -connect wikistr.imwald.eu:443 -servername wikistr.imwald.eu

# Check certificate expiry
echo | openssl s_client -connect wikistr.imwald.eu:443 2>/dev/null | openssl x509 -noout -dates
```

### **Network Debugging**
```bash
# Check port binding
sudo netstat -tlnp | grep :3000
sudo netstat -tlnp | grep :443

# Test local connectivity
curl -I http://127.0.0.1:3000
curl -I https://127.0.0.1:443

# Test external connectivity
curl -I http://wikistr.imwald.eu
curl -I https://wikistr.imwald.eu
```

## 🚀 Quick Fixes

### **Complete Reset**
```bash
# Stop everything
docker stop wikistr-app
sudo systemctl stop apache2

# Remove container
docker rm wikistr-app

# Disable Apache config
sudo a2disconf wikistr-override

# Restart Apache
sudo systemctl start apache2

# Run deployment script again
./deploy-wikistr.sh
```

### **Update Application**
```bash
# Pull latest image
docker pull silberengel/wikistr:latest

# Restart container
docker restart wikistr-app

# Test
curl -f http://127.0.0.1:3000/health
```

### **Fix Apache Configuration**
```bash
# Test configuration
sudo apache2ctl configtest

# If errors, check syntax
sudo apache2ctl -t

# Reload configuration
sudo systemctl reload apache2

# Full restart if needed
sudo systemctl restart apache2
```

## 📊 Monitoring

### **Health Checks**
```bash
# Container health
docker inspect wikistr-app | grep -A 10 Health

# Application health
curl -f https://wikistr.imwald.eu/health

# SSL health
curl -I https://wikistr.imwald.eu
```

### **Log Monitoring**
```bash
# Follow container logs
docker logs -f wikistr-app

# Follow Apache logs
sudo tail -f /var/log/apache2/wikistr-access.log
sudo tail -f /var/log/apache2/wikistr-error.log

# System logs
sudo journalctl -u apache2 -f
```

## 🎯 Expected Results

### **Successful Deployment**
- ✅ `https://wikistr.imwald.eu` returns HTTP 200
- ✅ `http://wikistr.imwald.eu` redirects to HTTPS
- ✅ Container health check passes
- ✅ SSL certificate is valid and not expired
- ✅ No errors in Apache logs

### **Performance Indicators**
- Container uses < 512MB RAM
- Response time < 2 seconds
- SSL Labs rating A or higher
- No 5xx errors in logs

---

**Need help?** Check the logs first, then run the debug commands above. Most issues are related to container health or Apache configuration.
