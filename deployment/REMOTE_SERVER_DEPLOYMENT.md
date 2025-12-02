# Remote Server Deployment Guide

This guide will help you deploy your Wikistr application to a remote server.

**Quick Start:** The easiest way to deploy is using the deployment scripts:
- `deploy-remote.sh` - Deploy theme applications (wikistr, biblestr, etc.) - **run for each theme**
- `deploy-services.sh` - Deploy supporting services (OG Proxy, AsciiDoctor) - **run once**

Copy both scripts to your server, make them executable, and run them. See [Option A: Using the Deployment Scripts](#option-a-using-the-deployment-scripts-recommended) below.

## Prerequisites

- Remote server with:
  - Docker installed
  - SSH access
  - Root or sudo access
  - (Optional) Apache or Nginx for reverse proxy
  - (Optional) Domain name pointing to your server

## Step 1: Build and Push Docker Images

On your **local machine**, build the Docker images and push them to Docker Hub:

```bash
cd deployment/

# Build all applications (or just the one you need, e.g., wikistr)
./build-all-apps.sh

# When prompted, answer 'y' to push to Docker Hub
# Make sure you're logged into Docker Hub: docker login
```

This will create and push images like:
- `silberengel/wikistr:v5.3.0-wikistr`
- `silberengel/wikistr:latest-wikistr`

**Note:** If you don't have a Docker Hub account or want to use a different registry, you can:
1. Export the images: `docker save -o wikistr.tar silberengel/wikistr:latest-wikistr`
2. Transfer to server: `scp wikistr.tar user@server:/path/`
3. Import on server: `docker load -i wikistr.tar`

## Step 2: Deploy on Remote Server

### Option A: Using the Deployment Scripts (Recommended)

The easiest way to deploy is using the deployment scripts. **You need both scripts** - they serve different purposes:

**Script 1: `deploy-remote.sh`** - Deploys main theme applications (wikistr, biblestr, quranstr, torahstr)
**Script 2: `deploy-services.sh`** - Deploys supporting services (OG Proxy, AsciiDoctor)

**Complete Deployment Steps:**

**1. Deploy Theme Applications (wikistr, biblestr, etc.):**

```bash
# Copy the script to your server
scp deployment/deploy-remote.sh user@your-server:/path/

# SSH into your server
ssh user@your-server

# Make the script executable
chmod +x deploy-remote.sh

# Deploy a single service (default: wikistr on port 3000)
./deploy-remote.sh

# Or specify theme and port
./deploy-remote.sh wikistr 3000
./deploy-remote.sh biblestr 4000
./deploy-remote.sh quranstr 4050
./deploy-remote.sh torahstr 4080
```

**2. Deploy Supporting Services (OG Proxy and AsciiDoctor):**

```bash
# Copy the services deployment script to your server
scp deployment/deploy-services.sh user@your-server:/path/

# On your server, make it executable
chmod +x deploy-services.sh

# Deploy OG Proxy and AsciiDoctor (replace with your repository path)
./deploy-services.sh /path/to/wikistr
```

**Summary:**
- **`deploy-remote.sh`**: Use this for each theme application you want to deploy (wikistr, biblestr, quranstr, torahstr)
- **`deploy-services.sh`**: Use this once to deploy OG Proxy and AsciiDoctor (required for all themes)

The scripts will:
- Pull or build the latest images
- Stop and remove any existing containers
- Start new containers with the correct configuration
- Perform health checks
- Show you useful management commands

**Port Mappings:**
- **Wikistr**: Port 3000 (default)
- **Biblestr**: Port 4000
- **Quranstr**: Port 4050
- **Torahstr**: Port 4080
- **OG Proxy**: Port 8090 (shared by all themes)
- **AsciiDoctor**: Port 8091 (shared by all themes)

### Option B: Simple Docker Deployment (No Reverse Proxy)

SSH into your server and run:

```bash
# Pull the latest image
docker pull silberengel/wikistr:latest-wikistr

# Run the container (exposes on port 3000)
docker run -d \
  --name wikistr \
  -p 3000:80 \
  --restart unless-stopped \
  silberengel/wikistr:latest-wikistr
```

Your app will be available at `http://your-server-ip:3000`

### Option C: Production Deployment with Apache Reverse Proxy

For production with SSL and a domain name:

#### 1. Deploy the Docker Container

You can use the deployment script or deploy manually:

**Using the deployment script:**
```bash
# Deploy wikistr on port 3000 (localhost only, for Apache proxy)
./deploy-remote.sh wikistr 3000
```

**Or deploy manually:**
```bash
# Pull the image
docker pull silberengel/wikistr:latest-wikistr

# Run container on localhost port 3000 (not exposed externally)
docker run -d \
  --name wikistr \
  -p 127.0.0.1:3000:80 \
  --restart unless-stopped \
  silberengel/wikistr:latest-wikistr
```

#### 2. Set Up Apache Reverse Proxy

Enable required Apache modules:

```bash
sudo a2enmod proxy
sudo a2enmod proxy_http
sudo a2enmod headers
sudo a2enmod ssl
sudo systemctl restart apache2
```

#### 3. Set Up SSL with Let's Encrypt

First, set up SSL with Let's Encrypt. Certbot will automatically create the virtual host configuration files:

```bash
# Install certbot
sudo apt update
sudo apt install -y certbot python3-certbot-apache

# Get SSL certificate (replace with your domain)
sudo certbot --apache -d yourdomain.com -d www.yourdomain.com

# Certbot will automatically create files like:
# - /etc/apache2/sites-available/yourdomain.com-le-ssl.conf (HTTPS)
# - /etc/apache2/sites-available/yourdomain.com.conf (HTTP redirect)
```

**Important:** Replace `yourdomain.com` with your actual domain (e.g., `wikistr.imwald.eu`).

#### 4. Deploy OG Proxy and AsciiDoctor Services

Before configuring Apache, you need to deploy the OG Proxy and AsciiDoctor services. These are required for:
- **OG Proxy**: OpenGraph metadata fetching (e.g., BibleGateway previews)
- **AsciiDoctor**: PDF and EPUB conversion

**Option A: Using the Deployment Script (Recommended)**

```bash
# Copy the deployment script to your server
scp deployment/deploy-services.sh user@your-server:/path/

# SSH into your server
ssh user@your-server

# Make the script executable
chmod +x deploy-services.sh

# Deploy the services (replace with your repository path)
./deploy-services.sh /path/to/wikistr
```

The script will:
- Build or pull the OG Proxy and AsciiDoctor images
- Deploy OG Proxy on port 8090
- Deploy AsciiDoctor on port 8091
- Perform health checks

**Option B: Manual Deployment**

If you prefer to deploy manually, you'll need the wikistr repository on your server:

```bash
# Clone or ensure the repository is on your server
# Then deploy OG Proxy:
docker pull silberengel/wikistr:latest-og-proxy || \
docker build -f /path/to/wikistr/deployment/Dockerfile.og-proxy \
  -t silberengel/wikistr:latest-og-proxy /path/to/wikistr

docker run -d \
  --name og-proxy \
  -p 127.0.0.1:8090:8090 \
  -v /path/to/wikistr/deployment/proxy-server.js:/app/deployment/proxy-server.js:ro \
  -w /app/deployment \
  -e PROXY_PORT=8090 \
  -e PROXY_ALLOW_ORIGIN="https://*.imwald.eu" \
  -e PROXY_TIMEOUT_MS=30000 \
  --dns 8.8.8.8 \
  --dns 8.8.4.4 \
  --dns 1.1.1.1 \
  --restart unless-stopped \
  silberengel/wikistr:latest-og-proxy

# Deploy AsciiDoctor:
docker pull silberengel/wikistr:latest-asciidoctor || \
docker build -f /path/to/wikistr/deployment/Dockerfile.asciidoctor \
  -t silberengel/wikistr:latest-asciidoctor /path/to/wikistr

docker run -d \
  --name asciidoctor \
  -p 127.0.0.1:8091:8091 \
  -v /path/to/wikistr/deployment/asciidoctor-server.rb:/app/deployment/asciidoctor-server.rb:ro \
  -w /app/deployment \
  -e ASCIIDOCTOR_PORT=8091 \
  -e ASCIIDOCTOR_ALLOW_ORIGIN="https://*.imwald.eu" \
  -e BUNDLE_PATH=/app/deployment/vendor/bundle \
  --restart unless-stopped \
  silberengel/wikistr:latest-asciidoctor
```

**Verify Services are Running:**

```bash
# Check containers
docker ps | grep -E "og-proxy|asciidoctor"

# Test OG Proxy
curl http://localhost:8090/healthz

# Test AsciiDoctor
curl http://localhost:8091/healthz
```

#### 5. Configure the SSL Virtual Host

After certbot creates the SSL configuration, edit the Let's Encrypt-generated SSL file:

```bash
# Edit the SSL virtual host (certbot creates files with -le-ssl.conf suffix)
sudo nano /etc/apache2/sites-available/yourdomain.com-le-ssl.conf
```

**Note:** You don't need separate `.conf` files for OG Proxy and AsciiDoctor. They are configured as ProxyPass directives within your main virtual host configuration.

Add the reverse proxy configuration inside the `<VirtualHost>` block. The file should look like this (replace `YOUR_SERVER_IP` with your server's IP address, e.g., `217.154.126.125`):

**See `deployment/apache-vhost-example.conf` for a complete example configuration file.**

```apache
<IfModule mod_ssl.c>
<VirtualHost YOUR_SERVER_IP:443>
    ServerName yourdomain.com
    ServerAlias www.yourdomain.com

    # Reverse Proxy Configuration
    ProxyPreserveHost On
    
    # OG Proxy for BibleGateway previews (MUST come before main ProxyPass)
    ProxyPass /sites/ http://127.0.0.1:8090/sites/
    ProxyPassReverse /sites/ http://127.0.0.1:8090/sites/
    
    # AsciiDoctor server for PDF/EPUB conversion (MUST come before main ProxyPass)
    ProxyPass /asciidoctor/ http://127.0.0.1:8091/
    ProxyPassReverse /asciidoctor/ http://127.0.0.1:8091/
    
    # Main application proxy (MUST come last)
    ProxyPass / http://127.0.0.1:3000/
    ProxyPassReverse / http://127.0.0.1:3000/

    # Headers for proper proxying (IMPORTANT: use https and 443 for HTTPS)
    Header always set X-Forwarded-Proto https
    Header always set X-Forwarded-Port 443

    # SSL Configuration (already configured by certbot)
    Include /etc/letsencrypt/options-ssl-apache.conf
    SSLCertificateFile /etc/letsencrypt/live/yourdomain.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/yourdomain.com/privkey.pem
</VirtualHost>
</IfModule>
```

**Important Notes:**
- Replace `YOUR_SERVER_IP` with your actual server IP address (e.g., `217.154.126.125`)
- Replace `yourdomain.com` with your actual domain
- The `X-Forwarded-Proto` must be `https` (not `http`) for HTTPS connections
- The `X-Forwarded-Port` must be `443` (not `80`) for HTTPS connections
- **Critical**: The `/sites/` and `/asciidoctor/` ProxyPass directives **MUST** come **before** the main `ProxyPass /` directive, otherwise they won't work

**Port Mappings:**
- Main application: `http://127.0.0.1:3000/` (wikistr) or `http://127.0.0.1:4000/` (biblestr), etc.
- OG Proxy: `http://127.0.0.1:8090/sites/`
- AsciiDoctor: `http://127.0.0.1:8091/`

Test and reload Apache:

```bash
# Test Apache configuration
sudo apache2ctl configtest

# If test passes, reload Apache
sudo systemctl reload apache2
```

**Configuration File Reference:**

For a complete example of the Apache configuration, see `deployment/apache-vhost-example.conf`. This file shows:
- The complete virtual host configuration
- How to configure OG Proxy and AsciiDoctor
- The correct order of ProxyPass directives
- All required settings

**Important:** You only need ONE virtual host configuration file per domain. The OG Proxy and AsciiDoctor are configured as ProxyPass directives within that single file, not as separate virtual hosts.

#### 6. Verify Complete Deployment

After deploying all services and configuring Apache, verify everything is working:

```bash
# Check all containers are running
docker ps

# Test main application (from server)
curl http://localhost:3000

# Test OG Proxy (from server)
curl http://localhost:8090/healthz

# Test AsciiDoctor (from server)
curl http://localhost:8091/healthz

# Test through Apache (from server)
curl https://yourdomain.com

# Test OG Proxy through Apache (from server)
curl https://yourdomain.com/sites/https%3A%2F%2Fwww.biblegateway.com%2Fpassage%2F%3Fsearch%3DJohn%2B3%3A16%26version%3DNIV
```

### Option C: Production Deployment with Nginx

If you prefer Nginx:

#### 1. Deploy Docker Container (same as above)

#### 2. Create Nginx Configuration

```bash
sudo nano /etc/nginx/sites-available/wikistr
```

Add:

```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;
    
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable and test:

```bash
sudo ln -s /etc/nginx/sites-available/wikistr /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## Step 3: Verify Deployment

```bash
# Check container is running
docker ps | grep wikistr

# Check container logs
docker logs wikistr

# Test locally (from server)
curl http://localhost:3000

# Test externally (from your machine)
curl https://yourdomain.com
```

## Step 4: Update Deployment

When you need to update, you can use the deployment script (recommended) or update manually:

### Using the Deployment Script

Simply run the script again - it will automatically pull the latest image and restart the container:

```bash
# Update wikistr
./deploy-remote.sh wikistr 3000

# Update biblestr
./deploy-remote.sh biblestr 4000

# Update all services (run for each)
./deploy-remote.sh wikistr 3000
./deploy-remote.sh biblestr 4000
./deploy-remote.sh quranstr 4050
./deploy-remote.sh torahstr 4080
```

### Manual Update

```bash
# Pull latest image
docker pull silberengel/wikistr:latest-wikistr

# Stop and remove old container
docker stop wikistr
docker rm wikistr

# Run new container
docker run -d \
  --name wikistr \
  -p 127.0.0.1:3000:80 \
  --restart unless-stopped \
  silberengel/wikistr:latest-wikistr
```

Or use this one-liner:

```bash
docker pull silberengel/wikistr:latest-wikistr && \
docker stop wikistr && \
docker rm wikistr && \
docker run -d --name wikistr -p 127.0.0.1:3000:80 --restart unless-stopped silberengel/wikistr:latest-wikistr
```

## Troubleshooting

### Container won't start
```bash
# Check logs
docker logs wikistr

# Check if port is in use
sudo netstat -tlnp | grep :3000
```

### Apache/Nginx not proxying correctly
```bash
# Apache: Test configuration
sudo apache2ctl configtest

# Nginx: Test configuration
sudo nginx -t

# Check error logs
sudo tail -f /var/log/apache2/error.log
# or
sudo tail -f /var/log/nginx/error.log
```

### SSL certificate issues
```bash
# Check certificate status
sudo certbot certificates

# Renew certificate manually
sudo certbot renew
```

## Quick Reference

### Deployment Script Commands

```bash
# Deploy a single service
./deploy-remote.sh [theme] [port]

# Examples:
./deploy-remote.sh wikistr 3000
./deploy-remote.sh biblestr 4000
./deploy-remote.sh quranstr 4050
./deploy-remote.sh torahstr 4080

# Default (wikistr on port 3000)
./deploy-remote.sh
```

### Docker Commands
```bash
# View running containers
docker ps

# View logs
docker logs -f wikistr

# Restart container
docker restart wikistr

# Stop container
docker stop wikistr

# Remove container
docker rm wikistr
```

### Health Check
```bash
# Create a simple health check script
cat > /usr/local/bin/check-wikistr.sh << 'EOF'
#!/bin/bash
if curl -f http://localhost:3000 > /dev/null 2>&1; then
    echo "OK: Wikistr is running"
    exit 0
else
    echo "ERROR: Wikistr is not responding"
    exit 1
fi
EOF

chmod +x /usr/local/bin/check-wikistr.sh

# Add to crontab for monitoring
echo "*/5 * * * * /usr/local/bin/check-wikistr.sh" | crontab -
```

## Next Steps

- Set up automatic updates (watchtower or similar)
- Configure monitoring and alerts
- Set up backups if needed
- Configure firewall rules
- Set up log rotation

---

**Your Wikistr application should now be live on your remote server!** 🎉

