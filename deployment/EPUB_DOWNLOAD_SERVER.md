# Alexandria Catalogue

A simple HTTP server for browsing and downloading books (kind 30040) as EPUB, PDF, and HTML files from Nostr. Designed for e-paper readers and other devices that can't use websockets.

## Overview

The Alexandria Catalogue provides a simple HTTP-based interface to:
1. Browse available books (kind 30040 events) from Nostr relays
2. Search for books by title or d-tag (fuzzy matching, case-insensitive)
3. View book details with comments (kind 1111) and highlights (kind 9802)
4. Download books as EPUB, PDF, or view as HTML5 web pages
5. All formats include images, including cover images

## Features

- **Browse Library**: View all available books (kind 30040 events) in a searchable list
- **Book View**: View individual books with their full content, comments, and highlights
- **Threaded Comments**: Comments and highlights are displayed in a hierarchical, threaded structure
- **Multiple Formats**: Download as EPUB, PDF, or view as HTML5 (optimized for e-paper readers)
- **Fuzzy Search**: Search by book title or d-tag with case-insensitive, punctuation-ignoring, partial matching
- **Image Support**: All formats include images embedded as base64 data URIs for self-contained files
- **E-paper Optimized**: HTML5 output is optimized for e-paper readers (Kindle, Tolino, etc.)

## Usage

### Starting the Server

```bash
node deployment/epub-download-server.js [port]
```

Default port: `8092`

Environment variables:
- `EPUB_DOWNLOAD_PORT` - Port to listen on (default: 8092)
- `ASCIIDOCTOR_SERVER_URL` - URL of the AsciiDoctor server (default: http://localhost:8091)

### Accessing the Server

Once running, you can access the server at:
- **Main page**: `http://localhost:8092/` - Search and view books
- **Browse books**: `http://localhost:8092/books` - List all available books
- **View book**: `http://localhost:8092/book?naddr=naddr1...` - View book with comments
- **View as HTML**: `http://localhost:8092/view?naddr=naddr1...` - View book as HTML5 web page
- **Download EPUB**: `http://localhost:8092/download-epub?naddr=naddr1...` - Download EPUB file
- **Download PDF**: `http://localhost:8092/download-pdf?naddr=naddr1...` - Download PDF file

### Using from E-Paper Readers

1. **Browse books:**
   - Open `http://your-server:8092/books` in your e-paper reader's browser
   - View a list of available books (kind 30040 events)
   - Use the search box to find books by title or d-tag
   - Click on a book to view it with comments and highlights

2. **View and download:**
   - From the book view page, you can:
     - View the book as an HTML5 web page (optimized for e-paper)
     - Download as EPUB
     - Download as PDF

3. **Via direct URL:**
   - Open `http://your-server:8092/download-epub?naddr=naddr1...` directly
   - The EPUB will download automatically

4. **Search by d-tag:**
   - Enter a d-tag in the search box on the main page
   - If multiple books share the same d-tag, all matching results will be displayed

## Requirements

- Node.js (with ES modules support)
- `@nostr/tools` package (already in dependencies)
- `ws` package for WebSocket support in Node.js (already in dependencies)
- AsciiDoctor server running (default: http://localhost:8091)

## How It Works

### Book Fetching
1. **Decode naddr:** The server decodes the naddr to get the book's kind, pubkey, and identifier
2. **Fetch book event:** Queries Nostr relays to fetch the book index event (kind 30040)
3. **Build hierarchy:** Recursively fetches all book content events (kind 30041) and nested books
4. **Fetch comments:** Fetches kind 1111 (comments) and kind 9802 (highlights) that reference the book
5. **Thread comments:** Organizes comments and highlights into a hierarchical, threaded structure based on 'e' and 'a' tags

### EPUB/PDF Generation
1. **Combine content:** Builds an AsciiDoc document from the book structure
2. **Download images:** Downloads all remote images (including cover image) to local temporary directory
3. **Generate format:** Sends the AsciiDoc to the AsciiDoctor server for conversion
4. **Embed images:** For EPUB/PDF, images are included as local files. For HTML5, images are embedded as base64 data URIs
5. **Return file:** Streams the file back to the client

### HTML5 View
1. **Generate HTML:** Converts the book to HTML5 using AsciiDoctor
2. **Embed images:** All images are embedded as base64 data URIs for a self-contained HTML file
3. **Add cover image:** The cover image (from `:front-cover-image:` attribute) is displayed at the top
4. **Optimize for e-paper:** CSS is simplified for e-paper readers (no horizontal scrolling, text wrapping, etc.)

### Browse Books
1. **Fetch books:** Queries Nostr relays for kind 30040 events (book indexes)
2. **Display list:** Shows book titles, authors, and creation dates
3. **Search:** Allows fuzzy search by title or d-tag (case-insensitive, punctuation-ignoring, partial matching)
4. **View book:** Clicking a book fetches its details and displays comments/highlights

### Comments and Highlights
- Comments (kind 1111) and highlights (kind 9802) are fetched using NIP-22 standard
- The book coordinate is built as `kind:pubkey:identifier`
- Comments are filtered using the `#A` tag filter
- Threading is based on 'e' (event reference) and 'a' (coordinate reference) tags
- Highlights are visually distinguished with a yellow border
- Comments and highlights are sorted chronologically (oldest first) for conversation flow

## Docker Deployment

### Using docker-compose

The Alexandria Catalogue is included in `docker-compose.yml`:

```yaml
  alexandria-catalogue:
    build:
      context: ..
      dockerfile: deployment/Dockerfile.alexandria-catalogue
    image: silberengel/wikistr:latest-alexandria-catalogue
    volumes:
      - ../deployment/epub-download-server.js:/app/deployment/epub-download-server.js:ro
    working_dir: /app/deployment
    ports:
      - "127.0.0.1:8092:8092"
    environment:
      EPUB_DOWNLOAD_PORT: 8092
      ASCIIDOCTOR_SERVER_URL: http://asciidoctor:8091
    depends_on:
      - asciidoctor
    networks:
      - default
      - wikistr-network
    restart: unless-stopped
```

Build and start:
```bash
docker-compose -f deployment/docker-compose.yml build alexandria-catalogue
docker-compose -f deployment/docker-compose.yml up -d alexandria-catalogue
```

### Using deploy-all-apps.sh

The deployment script automatically includes the Alexandria Catalogue:

```bash
./deployment/deploy-all-apps.sh
```

This will:
- Build the Docker image
- Start the container on port 8092
- Connect it to the wikistr-network
- Configure it to use the asciidoctor service

### Manual Docker Run

```bash
# Build the image
docker build -f deployment/Dockerfile.alexandria-catalogue -t silberengel/wikistr:latest-alexandria-catalogue .

# Run the container
docker run -d \
  --name alexandria-catalogue \
  --restart unless-stopped \
  --network wikistr-network \
  -p 127.0.0.1:8092:8092 \
  -v "$(pwd)/deployment/epub-download-server.js:/app/deployment/epub-download-server.js:ro" \
  -w /app/deployment \
  -e EPUB_DOWNLOAD_PORT=8092 \
  -e ASCIIDOCTOR_SERVER_URL=http://asciidoctor:8091 \
  silberengel/wikistr:latest-alexandria-catalogue
```

## Integration with Apache/Nginx

To expose the Alexandria Catalogue through a reverse proxy:

### Apache Configuration

Add to your virtual host (before the main ProxyPass):

```apache
# Alexandria Catalogue (e-book download portal)
ProxyPass /alexandria/ http://127.0.0.1:8092/
ProxyPassReverse /alexandria/ http://127.0.0.1:8092/
```

Then access at: `https://yourdomain.com/alexandria/`

### Nginx Configuration

Add to your server block:

```nginx
location /alexandria/ {
    proxy_pass http://127.0.0.1:8092/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

## Limitations

- Only supports book kinds (30040, 30041)
- Requires AsciiDoctor server to be running
- Uses default Nostr relays (can be extended to use relay hints from naddr)
- No authentication (add if needed for production)
- HTML5 view depends on AsciiDoctor server (no fallback currently)

## Troubleshooting

**Server won't start:**
- Check that port 8092 is available
- Ensure Node.js and dependencies are installed
- Verify the script syntax: `node --check deployment/epub-download-server.js`

**Can't fetch book:**
- Check that the naddr is valid
- Verify the book exists on Nostr relays
- Check server logs for relay connection errors
- Ensure the container can reach external Nostr relays (network configuration)

**EPUB/PDF/HTML generation fails:**
- Ensure AsciiDoctor server is running and accessible
- Check `ASCIIDOCTOR_SERVER_URL` environment variable (should be `http://asciidoctor:8091` in Docker)
- Review AsciiDoctor server logs
- Verify network connectivity between containers

**Images not appearing:**
- Check that image URLs are accessible from the server
- Verify image download permissions
- Check AsciiDoctor server logs for image processing errors

## Security Notes

- This server has no authentication by default
- For production, consider adding rate limiting
- Consider adding CORS restrictions if needed
- The server fetches content from public Nostr relays
- Images are downloaded from remote URLs - ensure URLs are trusted

## API Endpoints

- `GET /` - Main search/view page
- `GET /books` - Browse all books
- `GET /book?naddr=...` - View book with comments
- `GET /view?naddr=...` - View book as HTML5
- `GET /download-epub?naddr=...` - Download EPUB
- `GET /download-pdf?naddr=...` - Download PDF
- `GET /books?search=...` - Search books (query parameter)

All endpoints accept either `naddr` or `d` (d-tag) query parameters.