# Deployment Files

This folder contains deployment-related files for the Wikistr project.

## Active Deployment Files

- `docker-compose.simple.yml` - Main Docker Compose configuration for production deployment
- `setup-ssl.sh` - SSL certificate setup script for wikistr.imwald.eu

## Usage

### Production Deployment
```bash
# Start the services
docker-compose -f deployment/docker-compose.simple.yml up -d

# Setup SSL (run once)
sudo ./deployment/setup-ssl.sh
```

### Other Files
The other files in this folder are legacy or alternative deployment configurations that are not currently used in production.

## Services

- **wikistr** (port 8080) - Dark theme version
- **biblestr** (port 8081) - Light theme version

Both services include health checks and automatic restart policies.
