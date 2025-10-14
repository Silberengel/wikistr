# Themed Deployment Guide

This guide explains how to deploy Wikistr with different themes for different domains.

## Available Themes

### Wikistr (Dark Theme)
- **Theme**: Dark, modern interface
- **Target Audience**: General wiki users
- **Colors**: Purple brand, dark background
- **Typography**: Modern sans-serif fonts
- **Domain**: `wikistr.yourdomain.com`

### Biblestr (Light Theme)
- **Theme**: Light, scholarly interface
- **Target Audience**: Bible study and religious text users
- **Colors**: Green brand, light background
- **Typography**: Serif fonts for better readability
- **Domain**: `biblestr.yourdomain.com`

## Building Themed Images

### Build Both Themes
```bash
chmod +x docker-build-themes.sh
./docker-build-themes.sh
```

This will build:
- `silberengel/wikistr:v2.0-wikistr` (dark theme)
- `silberengel/wikistr:latest-wikistr` (dark theme)
- `silberengel/wikistr:v2.0-biblestr` (light theme)
- `silberengel/wikistr:latest-biblestr` (light theme)

### Build Individual Themes
```bash
# Build Wikistr (dark theme)
docker build -f Dockerfile.wikistr -t silberengel/wikistr:latest-wikistr .

# Build Biblestr (light theme)
docker build -f Dockerfile.biblestr -t silberengel/wikistr:latest-biblestr .
```

## Deployment Options

### Option 1: Docker Compose (Recommended)
```bash
# Deploy both themes
docker-compose -f docker-compose.themes.yml up -d
```

This will run:
- Wikistr (dark) on `http://localhost:8080`
- Biblestr (light) on `http://localhost:8081`

### Option 2: Individual Docker Commands
```bash
# Run Wikistr (dark theme)
docker run -d \
  --name wikistr-dark \
  -p 8080:80 \
  --restart unless-stopped \
  silberengel/wikistr:latest-wikistr

# Run Biblestr (light theme)
docker run -d \
  --name wikistr-light \
  -p 8081:80 \
  --restart unless-stopped \
  silberengel/wikistr:latest-biblestr
```

### Option 3: Production with Traefik
Update the domain names in `docker-compose.themes.yml`:
```yaml
labels:
  - "traefik.http.routers.wikistr.rule=Host(`wikistr.yourdomain.com`)"
  - "traefik.http.routers.biblestr.rule=Host(`biblestr.yourdomain.com`)"
```

Then deploy:
```bash
docker-compose -f docker-compose.themes.yml up -d
```

## Domain Configuration

### DNS Setup
Point your domains to your server:
```
wikistr.yourdomain.com  →  YOUR_SERVER_IP
biblestr.yourdomain.com →  YOUR_SERVER_IP
```

### SSL Certificates
The Docker Compose file includes Traefik labels for automatic SSL certificate generation with Let's Encrypt.

## Customization

### Custom Themes
To create your own theme:

1. **Add theme configuration** in `src/lib/themes.ts`:
```typescript
export type ThemeType = 'wikistr' | 'biblestr' | 'yourtheme';

export const themes: Record<ThemeType, ThemeConfig> = {
  // ... existing themes
  yourtheme: {
    name: 'yourtheme',
    title: 'Your App',
    tagline: 'Your tagline',
    // ... theme configuration
  }
};
```

2. **Create custom Dockerfile**:
```dockerfile
FROM node:18-alpine AS builder
# ... build steps
ENV THEME=yourtheme
RUN npm run build
# ... rest of dockerfile
```

3. **Build and deploy**:
```bash
docker build -f Dockerfile.yourtheme -t silberengel/wikistr:latest-yourtheme .
```

### Environment Variables
Both themes support the same environment variables:
- `THEME`: Theme type (injected at build time)
- Standard Apache/HTTP configuration variables

## Monitoring and Maintenance

### Health Checks
Both containers include health checks:
```bash
# Check container health
docker ps
docker inspect --format='{{.State.Health.Status}}' wikistr-dark
docker inspect --format='{{.State.Health.Status}}' wikistr-light
```

### Logs
```bash
# View logs
docker logs wikistr-dark
docker logs wikistr-light

# Follow logs
docker logs -f wikistr-dark
```

### Updates
```bash
# Pull latest images
docker pull silberengel/wikistr:latest-wikistr
docker pull silberengel/wikistr:latest-biblestr

# Restart containers
docker-compose -f docker-compose.themes.yml restart
```

## Troubleshooting

### Theme Not Applied
- Ensure the `THEME` environment variable is set during build
- Check that the theme is defined in `src/lib/themes.ts`
- Verify the build completed successfully

### Port Conflicts
- Change ports in Docker Compose or Docker run commands
- Ensure no other services are using the same ports

### SSL Issues
- Verify domain names are correctly configured
- Check Traefik configuration
- Ensure Let's Encrypt certificates are being generated

## Performance Considerations

### Resource Usage
- Each theme runs as a separate container
- Both themes use the same underlying codebase
- Memory usage is minimal (Apache + static files)

### Scaling
- Use load balancers for high traffic
- Consider CDN for static assets
- Monitor resource usage with `docker stats`

## Security

### Best Practices
- Keep Docker images updated
- Use specific version tags in production
- Enable firewall rules
- Use HTTPS with valid certificates
- Regular security updates

### Network Security
- Use reverse proxy (Traefik/Nginx)
- Implement rate limiting
- Monitor access logs
- Use strong SSL/TLS configuration
