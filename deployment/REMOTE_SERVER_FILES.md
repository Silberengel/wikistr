# Files Needed on Remote Server

## Minimum Required Files (No Volume Mounts)

If you just want to deploy using Docker images from Docker Hub, you only need:

### 1. Deployment Scripts (Required)
- `deployment/deploy-remote.sh` - Deploy theme applications (wikistr, biblestr, etc.)
- `deployment/deploy-services.sh` - Deploy supporting services (OG Proxy, AsciiDoctor)

**Usage:**
```bash
# Copy scripts to server
scp deployment/deploy-remote.sh user@server:/path/
scp deployment/deploy-services.sh user@server:/path/

# Make executable
chmod +x deploy-remote.sh deploy-services.sh

# Deploy (no repo files needed)
./deploy-remote.sh wikistr 3000
./deploy-services.sh  # No path needed - uses files from Docker image
```

**Note:** All necessary files (proxy-server.js, asciidoctor-server.rb, etc.) are already in the Docker images, so you don't need the repository files.

---

## Optional: Full Repository (For Volume Mounts)

If you want to update service scripts without rebuilding Docker images, you need the full repository:

### Required Files for Volume Mounts:
- `deployment/proxy-server.js` - OG Proxy server script
- `deployment/asciidoctor-server.rb` - AsciiDoctor server script

**Usage:**
```bash
# Copy entire repo to server (or just the deployment directory)
scp -r /path/to/wikistr user@server:/path/

# Deploy with volume mounts (allows easy script updates)
./deploy-services.sh /path/to/wikistr
```

**Benefits of Volume Mounts:**
- Update `proxy-server.js` or `asciidoctor-server.rb` without rebuilding Docker images
- Changes take effect after container restart: `docker restart og-proxy asciidoctor`
- No need to push new images to Docker Hub for script changes

**Note:** The Docker images still need to be built and pushed to Docker Hub (or loaded locally) - volume mounts only override specific files.

---

## Summary

### Minimum Setup (Recommended for Most Users):
```
Remote Server:
├── deploy-remote.sh      (deploy theme apps)
└── deploy-services.sh   (deploy services, no repo needed)
```

### With Volume Mounts (For Easy Updates):
```
Remote Server:
├── deploy-remote.sh
├── deploy-services.sh
└── wikistr/              (full repository)
    └── deployment/
        ├── proxy-server.js
        └── asciidoctor-server.rb
```

---

## What's Already in Docker Images?

The Docker images contain all necessary files:
- **Theme apps**: Built SvelteKit applications
- **OG Proxy**: `proxy-server.js` and Node.js runtime
- **AsciiDoctor**: `asciidoctor-server.rb`, Ruby gems, themes, and EPUB stylesheets

You only need the repository files if you want to update scripts without rebuilding images.

