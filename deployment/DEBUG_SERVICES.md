# Debugging OG Proxy and AsciiDoctor Services

If the services are running but not working, follow these debugging steps:

## Step 1: Test Services Directly (from server)

```bash
# Test OG Proxy directly
curl -v http://localhost:8090/healthz

# Test OG Proxy with a real request
curl -v "http://localhost:8090/sites/https%3A%2F%2Fwww.biblegateway.com%2Fpassage%2F%3Fsearch%3DJohn%2B3%3A16%26version%3DNIV"

# Test AsciiDoctor directly
curl -v http://localhost:8091/healthz

# Test AsciiDoctor with a simple request
curl -v -X POST http://localhost:8091/convert/html5 \
  -H "Content-Type: text/plain" \
  -d "= Test"
```

## Step 2: Check Container Logs

```bash
# Check OG Proxy logs
docker logs og-proxy

# Check AsciiDoctor logs
docker logs asciidoctor

# Follow logs in real-time
docker logs -f og-proxy
docker logs -f asciidoctor
```

## Step 3: Verify Apache Configuration

Make sure your Apache virtual host has the ProxyPass directives in the **correct order**:

```apache
# These MUST come BEFORE the main ProxyPass /
ProxyPass /sites/ http://127.0.0.1:8090/sites/
ProxyPassReverse /sites/ http://127.0.0.1:8090/sites/

ProxyPass /asciidoctor/ http://127.0.0.1:8091/
ProxyPassReverse /asciidoctor/ http://127.0.0.1:8091/

# Main application proxy (MUST come last)
ProxyPass / http://127.0.0.1:3000/
ProxyPassReverse / http://127.0.0.1:3000/
```

## Step 4: Test Through Apache (from server)

```bash
# Test OG Proxy through Apache
curl -v "https://yourdomain.com/sites/https%3A%2F%2Fwww.biblegateway.com%2Fpassage%2F%3Fsearch%3DJohn%2B3%3A16%26version%3DNIV"

# Test AsciiDoctor through Apache
curl -v -X POST "https://yourdomain.com/asciidoctor/convert/html5" \
  -H "Content-Type: text/plain" \
  -d "= Test"
```

## Step 5: Check Apache Error Logs

```bash
# Check Apache error logs
sudo tail -f /var/log/apache2/error.log

# Check your domain-specific error log
sudo tail -f /var/log/apache2/wikistr-error.log
```

## Common Issues

### Issue 1: OG Proxy Timeout
**Symptoms:** "BibleGateway OG fetch timeout"

**Possible causes:**
- OG Proxy container not responding
- Network/DNS issues in container
- Apache not proxying correctly

**Solutions:**
```bash
# Check if OG Proxy is responding
curl http://localhost:8090/healthz

# Check container logs
docker logs og-proxy

# Restart container
docker restart og-proxy
```

### Issue 2: AsciiDoctor 503 Service Unavailable
**Symptoms:** "503 Service Unavailable" when calling `/asciidoctor/convert/html5`

**Possible causes:**
- AsciiDoctor container not responding
- Apache not proxying correctly
- Container crashed or not ready

**Solutions:**
```bash
# Check if AsciiDoctor is responding
curl http://localhost:8091/healthz

# Check container logs
docker logs asciidoctor

# Check if container is actually running
docker ps | grep asciidoctor

# Restart container
docker restart asciidoctor
```

### Issue 3: Apache Not Proxying
**Symptoms:** Requests to `/sites/` or `/asciidoctor/` return 404 or don't work

**Solutions:**
1. Verify ProxyPass directives are in correct order (specific paths before `/`)
2. Check Apache configuration syntax:
   ```bash
   sudo apache2ctl configtest
   ```
3. Reload Apache:
   ```bash
   sudo systemctl reload apache2
   ```
4. Check Apache error logs for proxy errors

### Issue 4: CORS Issues
**Symptoms:** Browser console shows CORS errors

**Solutions:**
- Verify `PROXY_ALLOW_ORIGIN` environment variable includes your domain
- For OG Proxy: Should include `https://*.imwald.eu` or your specific domain
- For AsciiDoctor: Should include `https://*.imwald.eu` or your specific domain

## Quick Fix Commands

```bash
# Restart both services
docker restart og-proxy asciidoctor

# Check service health
curl http://localhost:8090/healthz && echo "OG Proxy OK" || echo "OG Proxy FAILED"
curl http://localhost:8091/healthz && echo "AsciiDoctor OK" || echo "AsciiDoctor FAILED"

# Reload Apache
sudo systemctl reload apache2

# View all container status
docker ps | grep -E "og-proxy|asciidoctor"
```

