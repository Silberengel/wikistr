# Wikistr Deployment Guide for imwald.eu

This guide covers deploying Wikistr to your imwald.eu domains with both themes.

## Domains

- **Wikistr (dark theme)**: https://wikistr.imwald.eu
- **Biblestr (light theme)**: https://biblestr.imwald.eu

## Prerequisites

- Docker and Docker Compose installed on your server
- Traefik running with Let's Encrypt SSL certificates
- Access to your server via SSH

## Quick Deployment

### Option 1: Using the Deployment Script (Recommended)

1. **Upload files to your server**:
   ```bash
   # Copy the deployment files to your server
   scp docker-compose.production.yml deploy-to-imwald.sh user@your-server:/path/to/wikistr/
   ```

2. **SSH into your server**:
   ```bash
   ssh user@your-server
   cd /path/to/wikistr
   ```

3. **Make the script executable and run it**:
   ```bash
   chmod +x deploy-to-imwald.sh
   ./deploy-to-imwald.sh
   ```

### Option 2: Manual Deployment

1. **SSH into your server**:
   ```bash
   ssh user@your-server
   cd /path/to/wikistr
   ```

2. **Pull the latest images**:
   ```bash
   docker pull silberengel/wikistr:latest-wikistr
   docker pull silberengel/wikistr:latest-biblestr
   ```

3. **Stop existing containers** (if any):
   ```bash
   docker-compose -f docker-compose.production.yml down
   ```

4. **Start the services**:
   ```bash
   docker-compose -f docker-compose.production.yml up -d
   ```

5. **Verify deployment**:
   ```bash
   docker ps
   curl -I https://wikistr.imwald.eu
   curl -I https://biblestr.imwald.eu
   ```

## Configuration Details

### Traefik Labels

The deployment uses these Traefik labels:

**Wikistr (Dark Theme)**:
- Host: `wikistr.imwald.eu`
- SSL: Automatic Let's Encrypt certificate
- Network: `traefik` (external network)

**Biblestr (Light Theme)**:
- Host: `biblestr.imwald.eu`
- SSL: Automatic Let's Encrypt certificate
- Network: `traefik` (external network)

### Health Checks

Both containers include health checks that verify:
- Container is responding on port 80
- Health endpoint is accessible
- Container starts properly

## Management Commands

### View Logs
```bash
# All services
docker-compose -f docker-compose.production.yml logs -f

# Specific service
docker-compose -f docker-compose.production.yml logs -f wikistr
docker-compose -f docker-compose.production.yml logs -f biblestr
```

### Update Images
```bash
# Pull latest images
docker-compose -f docker-compose.production.yml pull

# Restart with new images
docker-compose -f docker-compose.production.yml up -d
```

### Stop Services
```bash
docker-compose -f docker-compose.production.yml down
```

### Restart Services
```bash
docker-compose -f docker-compose.production.yml restart
```

## Troubleshooting

### Container Not Starting
```bash
# Check container status
docker ps -a

# Check logs
docker logs wikistr-dark
docker logs wikistr-light
```

### SSL Certificate Issues
```bash
# Check Traefik logs
docker logs traefik

# Verify DNS resolution
nslookup wikistr.imwald.eu
nslookup biblestr.imwald.eu
```

### Health Check Failures
```bash
# Check if containers are responding
curl http://localhost:8080/health  # If exposed directly
docker exec wikistr-dark curl -f http://localhost/health
docker exec wikistr-light curl -f http://localhost/health
```

## DNS Configuration

Ensure your DNS records point to your server:

```
wikistr.imwald.eu  A  YOUR_SERVER_IP
biblestr.imwald.eu A  YOUR_SERVER_IP
```

## Backup and Updates

### Creating a Backup
```bash
# Export current configuration
docker-compose -f docker-compose.production.yml config > backup-config.yml
```

### Updating to New Versions
1. Update the image tags in `docker-compose.production.yml`
2. Run the deployment script again
3. Or manually pull and restart containers

### Rolling Back
```bash
# Stop current containers
docker-compose -f docker-compose.production.yml down

# Start with previous version (update image tags first)
docker-compose -f docker-compose.production.yml up -d
```

## Monitoring

### Resource Usage
```bash
# Check resource usage
docker stats wikistr-dark wikistr-light
```

### Container Health
```bash
# Check health status
docker inspect --format='{{.State.Health.Status}}' wikistr-dark
docker inspect --format='{{.State.Health.Status}}' wikistr-light
```

## Security Notes

- Containers run as non-root user
- Health checks prevent unhealthy containers from receiving traffic
- SSL certificates are automatically renewed by Let's Encrypt
- Containers are isolated in the Traefik network

## Support

If you encounter issues:

1. Check the logs: `docker-compose -f docker-compose.production.yml logs`
2. Verify Traefik configuration
3. Check DNS resolution
4. Ensure firewall allows traffic on ports 80 and 443
