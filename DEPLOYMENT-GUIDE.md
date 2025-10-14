# wikistr.imwald.eu Deployment Guide

Complete deployment guide for setting up wikistr on a Plesk server with SSL certificates.

## 🎯 Prerequisites

- Remote server with Plesk installed
- SSH access to the server
- Domain `wikistr.imwald.eu` pointing to your server
- Docker installed on the server
- Root/sudo access

## 🚀 Step-by-Step Deployment

### **Step 1: Upload Files to Server**

Upload these files to your server (e.g., `/home/admin/wikistr-deployment/`):

```bash
# On your local machine, upload the deployment files
scp deploy-wikistr.sh setup-ssl.sh your-server:/home/admin/wikistr-deployment/
ssh your-server
cd /home/admin/wikistr-deployment/
chmod +x deploy-wikistr.sh setup-ssl.sh
```

### **Step 2: Deploy the Application**

Run the deployment script on your server:

```bash
# Make sure you're on the server
ssh your-server
cd /home/admin/wikistr-deployment/

# Deploy wikistr application
./deploy-wikistr.sh
```

This script will:
- Pull the latest wikistr Docker image
- Start the container on port 3000 (localhost only)
- Configure Apache virtual host
- Enable required Apache modules
- Set up proxy configuration
- Test the deployment

### **Step 3: Set Up SSL Certificate**

After the application is deployed, set up the SSL certificate:

```bash
# Set up SSL certificate with Let's Encrypt
./setup-ssl.sh
```

This script will:
- Install certbot if not already installed
- Obtain SSL certificate for `wikistr.imwald.eu` and `www.wikistr.imwald.eu`
- Configure automatic renewal
- Test the SSL setup

### **Step 4: Verify Deployment**

Test your deployment:

```bash
# Test HTTPS (should work after SSL setup)
curl -I https://wikistr.imwald.eu

# Test HTTP redirect (should redirect to HTTPS)
curl -I http://wikistr.imwald.eu

# Test container health
curl -f http://127.0.0.1:3000/health
```

## 🔧 Manual SSL Setup (Alternative)

If the SSL script doesn't work, you can set it up manually:

```bash
# Install certbot
sudo apt update
sudo apt install -y certbot python3-certbot-apache

# Stop Apache temporarily
sudo systemctl stop apache2

# Get certificate
sudo certbot certonly \
    --standalone \
    -d wikistr.imwald.eu \
    -d www.wikistr.imwald.eu \
    --email admin@imwald.eu \
    --agree-tos \
    --non-interactive

# Start Apache
sudo systemctl start apache2

# Set up auto-renewal
sudo crontab -e
# Add this line:
# 0 12 * * * certbot renew --quiet --post-hook "systemctl reload apache2"
```

## 🐳 Docker Commands

Useful Docker commands for managing your deployment:

```bash
# View running containers
docker ps | grep wikistr

# View container logs
docker logs wikistr-app

# Restart container
docker restart wikistr-app

# Update to latest image
docker pull silberengel/wikistr:latest
docker restart wikistr-app

# View container stats
docker stats wikistr-app
```

## 🔍 Troubleshooting

### **Common Issues**

#### **Container not starting**
```bash
# Check container logs
docker logs wikistr-app

# Check if port 3000 is in use
sudo netstat -tlnp | grep :3000

# Restart container
docker restart wikistr-app
```

#### **Apache configuration not working**
```bash
# Test Apache configuration
sudo apache2ctl configtest

# Check virtual hosts
sudo apache2ctl -S | grep wikistr

# Check if modules are enabled
sudo apache2ctl -M | grep proxy
```

#### **SSL certificate issues**
```bash
# Check certificate status
sudo certbot certificates

# Test SSL connection
openssl s_client -connect wikistr.imwald.eu:443

# Check certificate expiry
echo | openssl s_client -connect wikistr.imwald.eu:443 2>/dev/null | openssl x509 -noout -dates
```

### **Debug Commands**

```bash
# Check everything is running
docker ps | grep wikistr
sudo systemctl status apache2

# Test local connectivity
curl -f http://127.0.0.1:3000/health

# Test external connectivity
curl -I https://wikistr.imwald.eu

# Check Apache logs
sudo tail -f /var/log/apache2/wikistr-error.log
sudo tail -f /var/log/apache2/wikistr-access.log
```

## 📊 Monitoring

### **Health Checks**

Set up monitoring for your deployment:

```bash
# Create a simple health check script
cat > /home/admin/health-check.sh << 'EOF'
#!/bin/bash
# Health check script for wikistr.imwald.eu

# Check container
if ! docker ps | grep -q wikistr-app; then
    echo "ERROR: Container not running"
    exit 1
fi

# Check local health endpoint
if ! curl -f http://127.0.0.1:3000/health > /dev/null 2>&1; then
    echo "ERROR: Local health check failed"
    exit 1
fi

# Check HTTPS
if ! curl -f https://wikistr.imwald.eu > /dev/null 2>&1; then
    echo "ERROR: HTTPS check failed"
    exit 1
fi

echo "OK: All checks passed"
EOF

chmod +x /home/admin/health-check.sh

# Add to crontab for regular monitoring
echo "*/5 * * * * /home/admin/health-check.sh" | crontab -
```

## 🔄 Updates

To update your deployment:

```bash
# Pull latest image
docker pull silberengel/wikistr:latest

# Restart container
docker restart wikistr-app

# Test deployment
curl -f https://wikistr.imwald.eu
```

## 📝 Files Created

After deployment, these files will be created on your server:

- `/etc/apache2/conf-available/wikistr-override.conf` - Apache configuration
- `/var/www/wikistr/` - Document root directory
- `/var/log/apache2/wikistr-*.log` - Apache logs
- `/etc/letsencrypt/live/wikistr.imwald.eu/` - SSL certificates

## 🎉 Success Indicators

Your deployment is successful when:

- ✅ `https://wikistr.imwald.eu` returns HTTP 200
- ✅ `http://wikistr.imwald.eu` redirects to HTTPS
- ✅ SSL certificate is valid (green lock in browser)
- ✅ Container health check passes
- ✅ No errors in Apache logs
- ✅ Application loads correctly

## 🆘 Getting Help

If you encounter issues:

1. Check the troubleshooting section above
2. Review the logs: `docker logs wikistr-app` and Apache error logs
3. Verify DNS is pointing to your server
4. Ensure all required Apache modules are enabled
5. Check that the SSL certificate is valid and not expired

---

**Your wikistr.imwald.eu should now be live and accessible via HTTPS!** 🎉
