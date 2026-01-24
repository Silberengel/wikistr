# AsciiDoctor Server (Go Implementation)

A robust, production-ready Go server for converting AsciiDoc documents to EPUB, PDF, and HTML5 formats.

## Features

- **Stability First**: Comprehensive error handling, panic recovery, and auto-restart on crashes
- **Structured Logging**: JSON-formatted logs with detailed error information for easy debugging
- **Graceful Shutdown**: Handles shutdown signals properly, allowing active requests to complete
- **Health Checks**: Built-in health check endpoint for monitoring
- **Timeout Protection**: Configurable timeouts prevent hung conversions
- **Detailed Error Messages**: Actionable error messages that guide troubleshooting

## Architecture

The server uses a hybrid approach:
- **Go HTTP Server**: Handles all HTTP requests, logging, error handling, and stability
- **Ruby Asciidoctor CLI Tools**: Performs actual document conversion (proven, feature-complete)

This separation provides:
- Go's reliability for the server layer
- Full AsciiDoc feature support (stem blocks, diagrams, etc.)
- Easy maintenance and debugging

## API Endpoints

### Health Check
```
GET /healthz
```

Returns server status and converter readiness.

### Convert to EPUB
```
POST /convert/epub
Content-Type: application/json

{
  "content": "= Title\n\nContent here...",
  "title": "My Book",
  "author": "Author Name"
}
```

### Convert to PDF
```
POST /convert/pdf
Content-Type: application/json

{
  "content": "= Title\n\nContent here...",
  "title": "My Book",
  "author": "Author Name"
}
```

### Convert to HTML5
```
POST /convert/html5
Content-Type: application/json

{
  "content": "= Title\n\nContent here...",
  "title": "My Book",
  "author": "Author Name"
}
```

## Environment Variables

- `ASCIIDOCTOR_PORT`: Server port (default: 8091)
- `ASCIIDOCTOR_HOST`: Bind address (default: 0.0.0.0)
- `ASCIIDOCTOR_ALLOW_ORIGIN`: CORS allowed origin (default: *)
- `ASCIIDOCTOR_CONVERSION_TIMEOUT`: Conversion timeout (default: 10m)
- `ASCIIDOCTOR_DEBUG`: Enable debug logging (default: false)
- `TMPDIR`: Temporary directory for conversions (default: /tmp)

## Logging

All logs are output as JSON to stderr (captured by Docker). Each log entry includes:

- `timestamp`: RFC3339Nano timestamp
- `level`: INFO, WARN, ERROR, DEBUG
- `component`: Component that generated the log
- `message`: Human-readable message
- `error`: Detailed error information (if applicable)
- `fields`: Additional context

Error logs include:
- `error.type`: Error classification
- `error.actionable`: What to do to fix the issue
- `error.component`: Which component failed
- `error.operation`: What operation was being performed

## Stability Features

1. **Panic Recovery**: All HTTP handlers are wrapped with panic recovery middleware
2. **Auto-Restart**: Startup script automatically restarts the server on crash (with rate limiting)
3. **Graceful Shutdown**: Server waits for active requests to complete before shutting down
4. **Timeout Protection**: All conversions have configurable timeouts
5. **Resource Cleanup**: Temp files and directories are properly cleaned up

## Building

```bash
# Build the Docker image
docker build -f deployment/Dockerfile.asciidoctor -t silberengel/wikistr:latest-asciidoctor .
```

## Running Locally

```bash
# Install Go dependencies
cd deployment/asciidoctor-server
go mod tidy

# Run the server
go run .
```

## Troubleshooting

Check logs for detailed error information. Common issues:

1. **Conversion Timeout**: Increase `ASCIIDOCTOR_CONVERSION_TIMEOUT`
2. **Asciidoctor Not Found**: Ensure Ruby gems are installed (`bundle install`)
3. **File Permission Errors**: Check temp directory permissions
4. **Port Already in Use**: Change `ASCIIDOCTOR_PORT` or stop conflicting service

All errors include actionable guidance in the log messages.
