# Wikistr v3.0 Build and Deploy Guide

This guide covers building and deploying all four applications (wikistr, biblestr, quranstr, torahstr) both locally and remotely.

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

# Build all four applications with version 3.0 and latest tags
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
docker run -p 8080:80 silberengel/wikistr:latest-wikistr

# Biblestr on port 8081
docker run -p 8081:80 silberengel/wikistr:latest-biblestr

# Quranstr on port 8082
docker run -p 8082:80 silberengel/wikistr:latest-quranstr

# Torahstr on port 8083
docker run -p 8083:80 silberengel/wikistr:latest-torahstr
```

#### Option B: Run All Applications with Docker Compose
```bash
# Start all four applications
docker-compose -f docker-compose.all-apps.yml up -d

# View logs
docker-compose -f docker-compose.all-apps.yml logs -f

# Stop all applications
docker-compose -f docker-compose.all-apps.yml down
```

#### Option C: Use Deployment Script
```bash
# Deploy all applications with one command
./deploy-all-apps.sh
```

### 3. Access Applications
- **Wikistr**: http://localhost:3000
- **Biblestr**: http://localhost:4000
- **Quranstr**: http://localhost:4050
- **Torahstr**: http://localhost:4080

## 🚀 Remote Deployment

### Prerequisites
- Remote server with Docker installed
- SSH access to the server
- Docker Hub account (for pulling images)

### 1. Build and Push to Docker Hub

#### On your local machine:
```bash
# Build and push all applications
./docker-build-themes.sh
# Answer 'y' when prompted to push to Docker Hub
```

This creates and pushes these images:
- `silberengel/wikistr:v3.0-wikistr` & `silberengel/wikistr:latest-wikistr`
- `silberengel/wikistr:v3.0-biblestr` & `silberengel/wikistr:latest-biblestr`
- `silberengel/wikistr:v3.0-quranstr` & `silberengel/wikistr:latest-quranstr`
- `silberengel/wikistr:v3.0-torahstr` & `silberengel/wikistr:latest-torahstr`

### 2. Deploy to Remote Server

#### Option A: Copy Files and Deploy
```bash
# Copy deployment files to server
scp -r deployment/ user@your-server:/path/to/wikistr/

# SSH into server
ssh user@your-server

# Navigate to deployment directory
cd /path/to/wikistr/deployment/

# Make scripts executable
chmod +x *.sh

# Deploy all applications
./deploy-all-apps.sh
```

#### Option B: Direct Docker Run on Server
```bash
# SSH into server
ssh user@your-server

# Run each application
docker run -d --name wikistr -p 3000:80 silberengel/wikistr:latest-wikistr
docker run -d --name biblestr -p 4000:80 silberengel/wikistr:latest-biblestr
docker run -d --name quranstr -p 4050:80 silberengel/wikistr:latest-quranstr
docker run -d --name torahstr -p 4080:80 silberengel/wikistr:latest-torahstr
```

#### Option C: Docker Compose on Server
```bash
# Copy docker-compose file to server
scp docker-compose.all-apps.yml user@your-server:/path/to/wikistr/

# SSH and deploy
ssh user@your-server
cd /path/to/wikistr/
docker-compose -f docker-compose.all-apps.yml up -d
```

### 3. Production Setup with Reverse Proxy

For production, you'll want to set up a reverse proxy (nginx/Apache) to handle SSL and routing:

#### Apache Configuration Example

Add the OG proxy configuration to each theme's SSL virtual host (e.g., `biblestr.imwald.eu-le-ssl.conf`):

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
    ProxyPass /sites/ http://127.0.0.1:8090/sites/
    ProxyPassReverse /sites/ http://127.0.0.1:8090/sites/
    
    # Headers for proper proxying
    Header always set X-Forwarded-Proto https
    Header always set X-Forwarded-Port 443
</VirtualHost>
```

#### OG Proxy Service

The OG proxy service runs alongside the theme containers. It's configured in `docker-compose.yml` and `docker-compose.build.yml`. The proxy:

- Listens on port 8090 (configurable via `PROXY_PORT` environment variable)
- Handles CORS for `*.imwald.eu` domains (configurable via `PROXY_ALLOW_ORIGIN`)
- Proxies requests to external sites (like BibleGateway) for OpenGraph metadata fetching

#### Environment Variables

To configure the OG proxy URL in the frontend, set the `VITE_OG_PROXY_URL` environment variable when building:

```bash
# Use relative path (default, works with Apache proxy)
VITE_OG_PROXY_URL=/sites/

# Or use absolute URL
VITE_OG_PROXY_URL=https://your-domain.com/sites/
```

This variable is used at build time, so rebuild the Docker images after changing it.

## 🔧 Management Commands

### View Logs
```bash
# All applications
docker-compose -f docker-compose.all-apps.yml logs -f

# Individual application
docker logs wikistr-v3
docker logs biblestr-v3
docker logs quranstr-v3
docker logs torahstr-v3
```

### Update Applications
```bash
# Pull latest images and restart
docker-compose -f docker-compose.all-apps.yml pull
docker-compose -f docker-compose.all-apps.yml up -d
```

### Stop/Start Applications
```bash
# Stop all
docker-compose -f docker-compose.all-apps.yml down

# Start all
docker-compose -f docker-compose.all-apps.yml up -d

# Restart all
docker-compose -f docker-compose.all-apps.yml restart
```

### Health Checks
```bash
# Check if containers are running
docker ps --filter "name=wikistr-v3"
docker ps --filter "name=biblestr-v3"
docker ps --filter "name=quranstr-v3"
docker ps --filter "name=torahstr-v3"

# Test endpoints
curl http://localhost:8080/health
curl http://localhost:8081/health
curl http://localhost:8082/health
curl http://localhost:8083/health
```

## 🐛 Troubleshooting

### Common Issues

1. **Port conflicts**: Make sure ports 8080-8083 are available
2. **Docker not running**: Start Docker service
3. **Permission issues**: Make scripts executable with `chmod +x *.sh`
4. **Image not found**: Pull images first with `docker pull silberengel/wikistr:latest-*`

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
```

## 📋 Quick Reference

### Build Commands
```bash
# Build all applications
./docker-build-themes.sh

# Build specific application
docker build -f Dockerfile.wikistr -t silberengel/wikistr:latest-wikistr .
```

### Deploy Commands
```bash
# Deploy all applications
./deploy-all-apps.sh

# Deploy with docker-compose
docker-compose -f docker-compose.all-apps.yml up -d
```

### Access URLs
- Wikistr: http://localhost:3000
- Biblestr: http://localhost:4000
- Quranstr: http://localhost:4050
- Torahstr: http://localhost:4080
