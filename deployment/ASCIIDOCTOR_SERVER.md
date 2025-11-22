# AsciiDoctor Server

A Ruby-based server for converting AsciiDoc content to PDF and EPUB formats.

## Overview

This server runs on port 8091 (configurable) and provides REST API endpoints for converting AsciiDoc content to PDF and EPUB formats. It uses the native Ruby AsciiDoctor implementation, which is the most mature and feature-complete option.

## Prerequisites

- Ruby 3.0 or higher
- Bundler gem (`gem install bundler`)

## Installation

1. Install Ruby dependencies:
```bash
cd deployment
bundle install
```

This will install:
- `sinatra` - Web framework
- `asciidoctor` - AsciiDoc processor
- `asciidoctor-pdf` - PDF converter
- `asciidoctor-epub3` - EPUB3 converter

## Running the Server

### Option 1: Using the start script
```bash
./asciidoctor.sh
```

### Option 2: Direct Ruby execution
```bash
bundle exec ruby asciidoctor.rb
```

### Environment Variables

- `ASCIIDOCTOR_PORT` - Server port (default: 8091)
- `ASCIIDOCTOR_ALLOW_ORIGIN` - CORS allowed origins (default: `*`)

Example:
```bash
ASCIIDOCTOR_PORT=8091 ASCIIDOCTOR_ALLOW_ORIGIN=http://localhost:8080 bundle exec ruby asciidoctor.rb
```

## API Endpoints

### Health Check
```
GET /healthz
```

Returns server status and available endpoints.

### Convert to PDF
```
POST /convert/pdf
Content-Type: application/json

{
  "content": "= Document Title\n\nContent here...",
  "title": "My Document",
  "author": "Author Name"
}
```

Returns: PDF file (application/pdf)

### Convert to EPUB
```
POST /convert/epub
Content-Type: application/json

{
  "content": "= Document Title\n\nContent here...",
  "title": "My Document",
  "author": "Author Name"
}
```

Returns: EPUB file (application/epub+zip)

## Client Usage

The client-side utility is available in `src/lib/asciidoctorExport.ts`:

```typescript
import { exportToPDF, exportToEPUB, downloadBlob } from '$lib/asciidoctorExport';

// Export to PDF
const pdfBlob = await exportToPDF({
  content: asciidocContent,
  title: 'My Document',
  author: 'Author Name'
});
downloadBlob(pdfBlob, 'document.pdf');

// Export to EPUB
const epubBlob = await exportToEPUB({
  content: asciidocContent,
  title: 'My Document',
  author: 'Author Name'
});
downloadBlob(epubBlob, 'document.epub');
```

## Configuration

Set the server URL in your environment or `.env` file:
```
VITE_ASCIIDOCTOR_SERVER_URL=http://localhost:8091
```

## Integration with Wikistr

The server runs alongside:
- **Wikistr app** (port 8080/8081)
- **OG Proxy server** (port 8090)
- **AsciiDoctor server** (port 8091)

All three servers can run independently and communicate via HTTP.

### Apache Reverse Proxy Configuration

Since you're using Apache as a reverse proxy with SSL termination, add the AsciiDoctor server to your Apache SSL virtual host configuration:

```apache
# AsciiDoctor server for PDF/EPUB conversion
ProxyPass /asciidoctor/ http://127.0.0.1:8091/
ProxyPassReverse /asciidoctor/ http://127.0.0.1:8091/
```

This allows the client to access the server at `https://yourdomain.com/asciidoctor/` instead of `http://localhost:8091/`, and Apache handles SSL using the existing certificate.

**Important**: Add this **after** the main `ProxyPass /` directive, similar to how `/sites/` is configured for the OG proxy.

Then update your client configuration:
```typescript
// In .env or environment
VITE_ASCIIDOCTOR_SERVER_URL=/asciidoctor
```

This way, the AsciiDoctor server uses the same SSL certificate as your main application - no separate certificate needed!

## Docker Deployment

To run in Docker, you'll need a Ruby base image. Example Dockerfile:

```dockerfile
FROM ruby:3.2

WORKDIR /app

COPY deployment/Gemfile deployment/Gemfile.lock ./
RUN bundle install

COPY deployment/asciidoctor.rb ./

EXPOSE 8091

CMD ["bundle", "exec", "ruby", "asciidoctor.rb"]
```

## Troubleshooting

### Server won't start
- Check Ruby version: `ruby --version` (needs 3.0+)
- Install bundler: `gem install bundler`
- Install dependencies: `bundle install`

### PDF/EPUB generation fails
- Check server logs for error messages
- Ensure AsciiDoc content is valid
- Check that required fonts are available (for PDF)

### CORS errors
- Set `ASCIIDOCTOR_ALLOW_ORIGIN` to match your frontend URL
- Or use `*` for development (not recommended for production)

