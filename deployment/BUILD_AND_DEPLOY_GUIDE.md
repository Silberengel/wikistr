# Wikistr Build and Deploy Guide

This guide covers building and deploying all four applications (wikistr, biblestr, quranstr, torahstr) both locally and on cloud servers.

## 🏗️ Local Development

### Prerequisites
- Docker installed and running
- Git repository cloned
- Node.js 18+ (for development)

### 1. Build All Applications Locally

```bash
# Navigate to deployment directory
cd deployment/

# Make scripts executable
chmod +x *.sh

# Build all four applications with version tags and latest tags
./docker-build-themes.sh
```

This will:
- Build 8 Docker images (4 apps × 2 tags each)
- Ask if you want to push to Docker Hub
- Show usage examples

### 2. Run Applications Locally

#### Option A: Run Individual Applications
```bash
# Wikistr on port 8080
docker run -d --name wikistr -p 8080:80 silberengel/wikistr:latest-wikistr

# Biblestr on port 8081
docker run -d --name biblestr -p 8081:80 silberengel/wikistr:latest-biblestr

# Quranstr on port 8082
docker run -d --name quranstr -p 8082:80 silberengel/wikistr:latest-quranstr

# Torahstr on port 8083
docker run -d --name torahstr -p 8083:80 silberengel/wikistr:latest-torahstr

# OG Proxy on port 8090 (required for OpenGraph metadata fetching)
docker run -d \
  --name og-proxy \
  -p 8090:8090 \
  -v $(pwd)/..:/app:ro \
  -w /app \
  -e PROXY_ALLOW_ORIGIN="*" \
  node:20-alpine \
  node deployment/proxy-server.js
```

**Note**: The OG proxy is required for OpenGraph metadata fetching. Make sure to run it from the deployment directory so the volume mount path is correct.

#### Option B: Run All Applications with Docker Compose
```bash
# Start all applications including OG proxy
docker-compose -f docker-compose.yml up -d

# View logs
docker-compose -f docker-compose.yml logs -f

# Stop all applications
docker-compose -f docker-compose.yml down
```

**Note**: The `docker-compose.yml` file includes the OG proxy service, so it will be started automatically.

#### Option C: Use Deployment Script
```bash
# Deploy all applications with one command
./deploy-all-apps.sh
```

### 3. Access Applications Locally
- **Wikistr**: http://localhost:8080
- **Biblestr**: http://localhost:8081
- **Quranstr**: http://localhost:8082
- **Torahstr**: http://localhost:8083

## 🚀 Cloud Deployment

### Prerequisites
- Remote server with Docker installed
- SSH access to the server (typically as root)
- Docker Hub account (for pulling images)

### 1. Build and Push to Docker Hub (Local Machine)

On your local development machine:
```bash
# Navigate to deployment directory
cd deployment/

# Build and push all applications for production
# Default uses /sites/ (relative path) which works with Apache proxying
./docker-build-themes.sh
# Answer 'y' when prompted to push to Docker Hub
```

**OG Proxy URL Configuration:**
- **Production builds** (default): Uses `/sites/` - Apache will proxy this to the OG proxy container
- **Local development builds**: Use `VITE_OG_PROXY_URL=http://localhost:8090/sites/ ./docker-build-themes.sh`

This creates and pushes these images:
- `silberengel/wikistr:v4.2-wikistr` & `silberengel/wikistr:latest-wikistr`
- `silberengel/wikistr:v4.2-biblestr` & `silberengel/wikistr:latest-biblestr`
- `silberengel/wikistr:v4.2-quranstr` & `silberengel/wikistr:latest-quranstr`
- `silberengel/wikistr:v4.2-torahstr` & `silberengel/wikistr:latest-torahstr`

### 2. Deploy to Cloud Server

#### SSH into your cloud server:
```bash
ssh root@your-server
```

#### Deploy Applications with Docker Run

Run each application with the specific version tag and port mapping:

```bash
# Wikistr on port 3000
docker run -d --name wikistr -p 3000:80 silberengel/wikistr:v4.2-wikistr

# Biblestr on port 4000
docker run -d --name biblestr -p 4000:80 silberengel/wikistr:v4.2-biblestr

# Quranstr on port 4050
docker run -d --name quranstr -p 4050:80 silberengel/wikistr:v4.2-quranstr

# Torahstr on port 4080
docker run -d --name torahstr -p 4080:80 silberengel/wikistr:v4.2-torahstr
```

**Note**: Replace `v4.2` with your current version tag. The `-d` flag runs containers in detached mode.

#### Deploy OG Proxy Service

The OG proxy service must also run in a Docker container. It handles CORS for OpenGraph metadata fetching from external sites (like BibleGateway).

First, ensure you have the repository cloned on your server or copy the `proxy-server.js` file. Then run:

```bash
# Deploy OG proxy on port 8090
docker run -d \
  --name og-proxy \
  -p 8090:8090 \
  -v /path/to/wikistr:/app:ro \
  -w /app \
  -e PROXY_ALLOW_ORIGIN="https://*.imwald.eu" \
  node:20-alpine \
  node deployment/proxy-server.js
```

**Note**: Replace `/path/to/wikistr` with the actual path to your wikistr repository on the server. The `-v` flag mounts the repository as read-only, and `-w` sets the working directory.

Alternatively, if you have the repository in a specific location:
```bash
# Example with repository in /root/wikistr
docker run -d \
  --name og-proxy \
  -p 8090:8090 \
  -v /root/wikistr:/app:ro \
  -w /app \
  -e PROXY_ALLOW_ORIGIN="https://*.imwald.eu" \
  node:20-alpine \
  node deployment/proxy-server.js
```

#### Update Existing Containers

If containers already exist, stop and remove them first:
```bash
# Stop and remove existing containers
docker stop wikistr biblestr quranstr torahstr og-proxy
docker rm wikistr biblestr quranstr torahstr og-proxy

# Then run the new containers as shown above
```

**Note**: The OG proxy container doesn't need version updates like the theme containers, but you may need to restart it if you update the `proxy-server.js` file or change environment variables.

#### Verify Deployment

```bash
# Check running containers
docker ps

# Check container logs
docker logs wikistr
docker logs biblestr
docker logs quranstr
docker logs torahstr
```

### 3. Production Setup with Apache Reverse Proxy

For production, set up Apache as a reverse proxy to handle SSL and routing to the Docker containers.

#### Apache Configuration Location

Apache configuration files are located in `/etc/apache2/sites-enabled/`. Each application should have its own SSL virtual host configuration file (e.g., `biblestr.imwald.eu-le-ssl.conf`).

#### Apache Configuration Example

Edit the SSL virtual host configuration file for each theme in `/etc/apache2/sites-enabled/`:

```bash
# Edit the configuration file (example for biblestr)
sudo nano /etc/apache2/sites-enabled/biblestr.imwald.eu-le-ssl.conf
```

Add the following configuration to each theme's SSL virtual host:

```apache
<VirtualHost 217.154.126.125:443>
    ServerName biblestr.imwald.eu
    ServerAlias www.biblestr.imwald.eu
    
    # SSL Configuration
    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/biblestr.imwald.eu/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/biblestr.imwald.eu/privkey.pem
    
    # Reverse Proxy Configuration
    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:4000/
    ProxyPassReverse / http://127.0.0.1:4000/
    
    # OG Proxy for BibleGateway previews
    # This proxies /sites/ requests to the OG proxy container
    ProxyPass /sites/ http://127.0.0.1:8090/sites/
    ProxyPassReverse /sites/ http://127.0.0.1:8090/sites/
    
    # Headers for proper proxying
    Header always set X-Forwarded-Proto https
    Header always set X-Forwarded-Port 443
</VirtualHost>
```

**Important**: The `/sites/` proxy configuration must come **after** the main `ProxyPass /` directive, otherwise it won't work correctly.

**Port Mappings for Each Application:**
- **Wikistr**: `http://127.0.0.1:3000/`
- **Biblestr**: `http://127.0.0.1:4000/`
- **Quranstr**: `http://127.0.0.1:4050/`
- **Torahstr**: `http://127.0.0.1:4080/`

#### Enable Required Apache Modules

Ensure the required Apache modules are enabled:
```bash
sudo a2enmod proxy
sudo a2enmod proxy_http
sudo a2enmod headers
sudo a2enmod ssl
sudo systemctl restart apache2
```

#### Test and Reload Apache

```bash
# Test Apache configuration
sudo apache2ctl configtest

# If test passes, reload Apache
sudo systemctl reload apache2
```

#### OG Proxy Service

The OG proxy service runs in a Docker container alongside the theme containers. It's a Node.js service that:

- Listens on port 8090 (configurable via `PROXY_PORT` environment variable)
- Handles CORS for `*.imwald.eu` domains (configurable via `PROXY_ALLOW_ORIGIN`)
- Proxies requests to external sites (like BibleGateway) for OpenGraph metadata fetching

The proxy is configured in `docker-compose.yml` for local development and must be deployed as a separate Docker container on the cloud server (see Cloud Deployment section above).

#### OG Proxy URL Configuration

The OG proxy URL is configured at build time via the `VITE_OG_PROXY_URL` build argument:

**For Production (default):**
- Uses `/sites/` (relative path)
- Apache proxies `/sites/` requests to the OG proxy container on port 8090
- Works automatically with the Apache configuration shown above

**For Local Development:**
- Use `VITE_OG_PROXY_URL=http://localhost:8090/sites/ ./docker-build-themes.sh`
- Or modify `deploy-all-apps.sh` which uses `http://localhost:8090/sites/` by default

**Important:** The `VITE_OG_PROXY_URL` is baked into the build at compile time, so you must rebuild the Docker images if you change it. The default production build uses `/sites/` which works with Apache proxying.

#### Complete Production Setup Summary

For OG proxy to work on the remote server:

1. **Build images** with default `/sites/` (production build):
   ```bash
   ./docker-build-themes.sh
   ```

2. **Deploy OG proxy container** on port 8090 (see Cloud Deployment section)

3. **Configure Apache** to proxy `/sites/` to the OG proxy:
   - Add `ProxyPass /sites/ http://127.0.0.1:8090/sites/` to each virtual host
   - Ensure this comes **after** the main `ProxyPass /` directive

4. **Verify** the setup:
   ```bash
   # Test OG proxy directly
   curl http://localhost:8090/healthz
   
   # Test through Apache (from server)
   curl https://biblestr.imwald.eu/sites/https%3A%2F%2Fwww.biblegateway.com%2Fpassage%2F%3Fsearch%3DJohn%2B3%3A16%26version%3DNIV
   ```

## 🔧 Management Commands

### View Logs

#### Local Development
```bash
# All applications
docker-compose -f docker-compose.all-apps.yml logs -f

# Individual application
docker logs wikistr
docker logs biblestr
docker logs quranstr
docker logs torahstr
```

#### Cloud Server
```bash
# Individual application logs
docker logs wikistr
docker logs biblestr
docker logs quranstr
docker logs torahstr
docker logs og-proxy

# Follow logs in real-time
docker logs -f wikistr
docker logs -f og-proxy
```

### Update Applications

#### Local Development
```bash
# Pull latest images and restart
docker-compose -f docker-compose.all-apps.yml pull
docker-compose -f docker-compose.all-apps.yml up -d
```

#### Cloud Server
```bash
# Stop and remove existing container
docker stop torahstr
docker rm torahstr

# Pull latest image and run new container
docker pull silberengel/wikistr:v4.2-torahstr
docker run -d --name torahstr -p 4080:80 silberengel/wikistr:v4.2-torahstr

# Repeat for other applications (wikistr, biblestr, quranstr)
```

### Stop/Start Applications

#### Local Development
```bash
# Stop all
docker-compose -f docker-compose.all-apps.yml down

# Start all
docker-compose -f docker-compose.all-apps.yml up -d

# Restart all
docker-compose -f docker-compose.all-apps.yml restart
```

#### Cloud Server
```bash
# Stop a container
docker stop torahstr
docker stop og-proxy

# Start a stopped container
docker start torahstr
docker start og-proxy

# Restart a container
docker restart torahstr
docker restart og-proxy

# Stop and remove a container
docker stop torahstr && docker rm torahstr
docker stop og-proxy && docker rm og-proxy
```

### Health Checks

#### Local Development
```bash
# Check if containers are running
docker ps --filter "name=wikistr"
docker ps --filter "name=biblestr"
docker ps --filter "name=quranstr"
docker ps --filter "name=torahstr"

# Test endpoints
curl http://localhost:8080
curl http://localhost:8081
curl http://localhost:8082
curl http://localhost:8083
```

#### Cloud Server
```bash
# Check if containers are running
docker ps

# Test endpoints (from server)
curl http://localhost:3000  # wikistr
curl http://localhost:4000  # biblestr
curl http://localhost:4050  # quranstr
curl http://localhost:4080  # torahstr
curl http://localhost:8090  # og-proxy
```

## 🐛 Troubleshooting

### Common Issues

1. **Port conflicts**: 
   - Local: Make sure ports 8080-8083 and 8090 are available
   - Cloud: Make sure ports 3000, 4000, 4050, 4080, and 8090 are available
2. **Docker not running**: Start Docker service with `sudo systemctl start docker`
3. **Permission issues**: Make scripts executable with `chmod +x *.sh`
4. **Image not found**: Pull images first with `docker pull silberengel/wikistr:v4.2-*`
5. **Container name already exists**: Remove existing container first with `docker rm <container-name>`
6. **OG proxy not working**: 
   - Verify the container is running: `docker ps | grep og-proxy`
   - Check the volume mount path is correct
   - Verify the proxy-server.js file exists in the mounted directory
   - Check logs: `docker logs og-proxy`
7. **Apache not proxying correctly**: 
   - Check that Apache modules are enabled: `sudo a2enmod proxy proxy_http headers ssl`
   - Verify configuration files in `/etc/apache2/sites-enabled/`
   - Test configuration: `sudo apache2ctl configtest`

### Debug Commands
```bash
# Check Docker status
docker info

# Check running containers
docker ps -a

# Check container logs
docker logs <container-name>

# Check resource usage
docker stats

# Check Apache status
sudo systemctl status apache2

# Check Apache error logs
sudo tail -f /var/log/apache2/error.log
```

## 📋 Quick Reference

### Build Commands (Local)
```bash
# Build all applications
cd deployment/
./docker-build-themes.sh

# Build specific application
docker build -f Dockerfile.wikistr -t silberengel/wikistr:latest-wikistr .
```

### Deploy Commands

#### Local Development
```bash
# Deploy all applications
./deploy-all-apps.sh

# Deploy with docker-compose
docker-compose -f docker-compose.all-apps.yml up -d
```

#### Cloud Server
```bash
# Deploy individual applications
docker run -d --name wikistr -p 3000:80 silberengel/wikistr:v4.2-wikistr
docker run -d --name biblestr -p 4000:80 silberengel/wikistr:v4.2-biblestr
docker run -d --name quranstr -p 4050:80 silberengel/wikistr:v4.2-quranstr
docker run -d --name torahstr -p 4080:80 silberengel/wikistr:v4.2-torahstr

# Deploy OG proxy
docker run -d \
  --name og-proxy \
  -p 8090:8090 \
  -v /path/to/wikistr:/app:ro \
  -w /app \
  -e PROXY_ALLOW_ORIGIN="https://*.imwald.eu" \
  node:20-alpine \
  node deployment/proxy-server.js
```

### Access URLs

#### Local Development
- Wikistr: http://localhost:8080
- Biblestr: http://localhost:8081
- Quranstr: http://localhost:8082
- Torahstr: http://localhost:8083

#### Cloud Server (Direct Docker Ports)
- Wikistr: http://your-server:3000
- Biblestr: http://your-server:4000
- Quranstr: http://your-server:4050
- Torahstr: http://your-server:4080

#### Production (via Apache Reverse Proxy)
- Access via your configured domain names (e.g., `biblestr.imwald.eu`)
