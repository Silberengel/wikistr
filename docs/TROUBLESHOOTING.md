# Troubleshooting Guide

Common issues and solutions for Wikistr - Biblestr Edition.

## Search Issues

### Book Search Not Working

**Problem:** Book searches return no results.

**Solutions:**
1. Check notation format:
   - Use: `book:bible:John 3:16`
   - Not: `/book:bible:John 3:16` (no leading slash)

2. Verify book type:
   - Bible: `book:bible:reference`
   - Quran: `book:quran:reference`
   - Catechism: `book:catechism:reference`

3. Check version availability:
   - Try without version first: `book:bible:John 3:16`
   - Then with version: `book:bible:John 3:16 | KJV`

### Wikilinks Not Rendering

**Problem:** Book wikilinks in articles don't work.

**Solutions:**
1. Check syntax:
   ```asciidoc
   [[book:bible:John 3:16 | KJV]]
   ```

2. Verify book type support:
   - Ensure the book type is configured
   - Check if events exist for that book type

3. Test direct search first:
   - Try `book:bible:John 3:16` in search bar
   - If that works, the wikilink should work too

### Version Fallback Issues

**Problem:** Requested version not found.

**Solutions:**
1. Check available versions:
   - Look at the version dropdown in search results
   - Try different version abbreviations

2. Use version fallback:
   - Search without version: `book:bible:John 3:16`
   - Select from available versions

3. Check event tags:
   - Verify events have correct `version` tags
   - Ensure version names match expected format

## Theme Issues

### Theme Not Loading

**Problem:** Custom theme not appearing.

**Solutions:**
1. Check environment variable:
   ```bash
   echo $VITE_THEME
   ```

2. Restart application:
   ```bash
   docker restart wikistr-app
   ```

3. Verify theme configuration:
   - Check `src/lib/themes.ts`
   - Ensure theme is exported

### Theme Colors Not Updating

**Problem:** Color overrides not working.

**Solutions:**
1. Check environment variables:
   ```bash
   echo $VITE_PRIMARY_COLOR
   echo $VITE_SECONDARY_COLOR
   ```

2. Clear browser cache:
   - Hard refresh (Ctrl+F5)
   - Clear browser cache

3. Rebuild application:
   ```bash
   npm run build
   ```

## Performance Issues

### Slow Search Results

**Problem:** Searches take too long to return results.

**Solutions:**
1. Check relay connection:
   - Verify relay URLs in settings
   - Test relay connectivity

2. Optimize search queries:
   - Use more specific searches
   - Avoid overly broad queries

3. Check server resources:
   - Monitor CPU and memory usage
   - Ensure adequate server resources

### High Memory Usage

**Problem:** Application using too much memory.

**Solutions:**
1. Restart application:
   ```bash
   docker restart wikistr-app
   ```

2. Check for memory leaks:
   - Monitor memory usage over time
   - Look for growing memory consumption

3. Optimize configuration:
   - Reduce cache sizes
   - Limit concurrent connections

## Deployment Issues

### SSL Certificate Problems

**Problem:** HTTPS not working.

**Solutions:**
1. Check certificate status:
   ```bash
   certbot certificates
   ```

2. Renew certificates:
   ```bash
   certbot renew --dry-run
   certbot renew
   ```

3. Verify Apache configuration:
   ```bash
   apache2ctl configtest
   systemctl reload apache2
   ```

### Container Won't Start

**Problem:** Docker container fails to start.

**Solutions:**
1. Check container logs:
   ```bash
   docker logs wikistr-app
   ```

2. Verify image exists:
   ```bash
   docker images | grep wikistr
   ```

3. Check port conflicts:
   ```bash
   netstat -tlnp | grep :3000
   ```

### Database Connection Issues

**Problem:** Cannot connect to Nostr relays.

**Solutions:**
1. Check relay URLs:
   - Verify relay addresses in settings
   - Test relay connectivity

2. Check network connectivity:
   ```bash
   ping relay.example.com
   telnet relay.example.com 443
   ```

3. Verify firewall settings:
   - Ensure outbound HTTPS (443) is allowed
   - Check for proxy configurations

## Content Issues

### Missing Book Content

**Problem:** Expected book passages not found.

**Solutions:**
1. Check event tags:
   - Verify correct `type`, `book`, `chapter`, `verse` tags
   - Ensure proper tag formatting

2. Check relay data:
   - Verify events exist on relay
   - Test with different relays

3. Verify notation format:
   - Check book name spelling
   - Verify chapter/verse numbers

### Incorrect Metadata

**Problem:** Book metadata not displaying correctly.

**Solutions:**
1. Check event structure:
   ```json
   {
     "tags": [
       ["type", "bible"],
       ["book", "John"],
       ["chapter", "3"],
       ["verse", "16"],
       ["version", "KJV"]
     ]
   }
   ```

2. Verify tag names:
   - Use `book`, not `bible-book`
   - Use `verse`, not `verses`
   - Use `version`, not `bible-version`

## Development Issues

### Tests Failing

**Problem:** Test suite not passing.

**Solutions:**
1. Run tests individually:
   ```bash
   npm test bible.test.ts
   npm test diff.test.ts
   ```

2. Check test data:
   - Verify test files have correct tag format
   - Update test expectations for new features

3. Check dependencies:
   ```bash
   npm install
   npm audit fix
   ```

### Build Errors

**Problem:** Application won't build.

**Solutions:**
1. Check TypeScript errors:
   ```bash
   npx tsc --noEmit
   ```

2. Check for missing dependencies:
   ```bash
   npm install
   ```

3. Clear build cache:
   ```bash
   rm -rf dist/
   npm run build
   ```

## Getting Help

### Debug Information

When reporting issues, include:

1. **Browser information:**
   - Browser name and version
   - Console error messages
   - Network tab errors

2. **Server information:**
   ```bash
   docker logs wikistr-app
   docker ps
   systemctl status apache2
   ```

3. **Search queries:**
   - Exact search terms used
   - Expected vs actual results
   - Screenshots of issues

### Contact Information

- **GitHub Issues:** [Repository Issues](https://github.com/your-org/wikistr/issues)
- **Nostr:** [Author Profile](https://jumble.imwald.eu/users/npub1l5sga6xg72phsz5422ykujprejwud075ggrr3z2hwyrfgr7eylqstegx9z)
- **Documentation:** [Book Search Guide](BOOK_SEARCH_GUIDE.md)

### Common Commands

```bash
# Check application status
docker ps | grep wikistr

# View application logs
docker logs wikistr-app

# Restart application
docker restart wikistr-app

# Check SSL certificates
certbot certificates

# Test relay connectivity
curl -I https://relay.example.com

# Run tests
npm test

# Build application
npm run build
```