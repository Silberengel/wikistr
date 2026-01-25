package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gorilla/mux"
)

const (
	DefaultPort        = "8091"
	DefaultHost        = "0.0.0.0"
	DefaultAllowOrigin = "*"
	
	// Timeouts - OPTIMIZED for e-reader performance
	DefaultConversionTimeout = 5 * time.Minute  // Reduced from 10 minutes
	DefaultReadTimeout       = 2 * time.Minute   // Reduced from 5 minutes
	DefaultWriteTimeout      = 5 * time.Minute    // Reduced from 15 minutes
	DefaultIdleTimeout       = 120 * time.Second
	DefaultShutdownTimeout   = 30 * time.Second
	
	// Bundle paths
	DefaultBundlePath   = "/app/deployment/vendor/bundle"
	DefaultBundleGemfile = "/app/deployment/Gemfile"
	
	// Temporary directory
	DefaultTempDir = "/tmp"
	
	// File permissions
	FileModeDir  = 0755
	FileModeFile = 0644
	
	// Executable permission check
	ExecutablePermission = 0111
	
	// Timeouts for command execution
	CommandTimeout = 5 * time.Second
	VerifyTimeout  = 10 * time.Second
	
	// Content size limits
	MaxContentSize = 50 * 1024 * 1024 // 50MB
)

type Server struct {
	router     *mux.Router
	httpServer *http.Server
	logger     *Logger
	converter  *Converter
}

func main() {
	// Initialize structured logger
	logger := NewLogger()
	
	logger.Info("asciidoctor-server", "Starting AsciiDoctor conversion server", map[string]interface{}{
		"version": "1.0.0",
		"pid":     os.Getpid(),
	})

	// Load configuration
	config := LoadConfig()
	
	logger.Info("asciidoctor-server", "Configuration loaded", map[string]interface{}{
		"port":              config.Port,
		"host":              config.Host,
		"allow_origin":      config.AllowOrigin,
		"conversion_timeout": config.ConversionTimeout.String(),
	})

	// Initialize converter with full config
	converter, err := NewConverter(logger, config)
	if err != nil {
		logger.Error("asciidoctor-server", "Failed to initialize converter", err, map[string]interface{}{
			"error_type": "initialization_error",
			"component":  "converter",
		})
		os.Exit(1)
	}

	// Create server
	server := NewServer(&config, logger, converter)

	// Setup graceful shutdown
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Handle OS signals
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM, syscall.SIGINT)

	// Start server in goroutine
	go func() {
		logger.Info("asciidoctor-server", "Starting HTTP server", map[string]interface{}{
			"address": fmt.Sprintf("%s:%s", config.Host, config.Port),
		})
		
		if err := server.Start(); err != nil && err != http.ErrServerClosed {
			logger.Error("asciidoctor-server", "HTTP server error", err, map[string]interface{}{
				"error_type": "server_error",
				"component":  "http_server",
			})
			os.Exit(1)
		}
	}()

	// Wait for shutdown signal
	sig := <-sigChan
	logger.Info("asciidoctor-server", "Received shutdown signal", map[string]interface{}{
		"signal": sig.String(),
	})

	// Graceful shutdown with timeout
	shutdownCtx, shutdownCancel := context.WithTimeout(ctx, DefaultShutdownTimeout)
	defer shutdownCancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("asciidoctor-server", "Error during graceful shutdown", err, map[string]interface{}{
			"error_type": "shutdown_error",
		})
	} else {
		logger.Info("asciidoctor-server", "Server shutdown complete", nil)
	}
}

// loadConfig is deprecated - use LoadConfig() from config.go instead
// This function is kept for backward compatibility during migration
func loadConfig() (cfg *Config) {
	appConfig := LoadConfig()
	cfg = &appConfig
	return
}

func NewServer(config *Config, logger *Logger, converter *Converter) *Server {
	// Config is now the full config from config.go
	router := mux.NewRouter()
	
	server := &Server{
		router:    router,
		logger:    logger,
		converter: converter,
		httpServer: &http.Server{
			Addr:         fmt.Sprintf("%s:%s", config.Host, config.Port),
			Handler:      router,
			ReadTimeout:  DefaultReadTimeout,
			WriteTimeout: DefaultWriteTimeout,
			IdleTimeout:  DefaultIdleTimeout,
		},
	}

	// Setup routes
	server.setupRoutes(config.AllowOrigin)

	return server
}

func (s *Server) setupRoutes(allowOrigin string) {
	// Middleware - OPTIMIZED: Compression first for better performance
	s.router.Use(s.compressionMiddleware)
	s.router.Use(s.loggingMiddleware)
	s.router.Use(s.corsMiddleware(allowOrigin))
	s.router.Use(s.recoveryMiddleware)

	// Health check
	s.router.HandleFunc("/healthz", s.handleHealth).Methods("GET")
	
	// API documentation
	s.router.HandleFunc("/api", s.handleAPI).Methods("GET")
	
	// Conversion endpoints
	s.router.HandleFunc("/convert/epub", s.handleConvertEPUB).Methods("POST")
	s.router.HandleFunc("/convert/pdf", s.handleConvertPDF).Methods("POST")
	s.router.HandleFunc("/convert/html5", s.handleConvertHTML5).Methods("POST")
	s.router.HandleFunc("/convert/mobi", s.handleConvertMOBI).Methods("POST")
	s.router.HandleFunc("/convert/azw3", s.handleConvertAZW3).Methods("POST")
	s.router.HandleFunc("/convert/docbook5", s.handleConvertDocBook5).Methods("POST")
	
	// Root endpoint
	s.router.HandleFunc("/", s.handleRoot).Methods("GET")
}

func (s *Server) Start() error {
	return s.httpServer.ListenAndServe()
}

func (s *Server) Shutdown(ctx context.Context) error {
	return s.httpServer.Shutdown(ctx)
}

func (s *Server) handleRoot(w http.ResponseWriter, r *http.Request) {
	response := map[string]interface{}{
		"name":    "wikistr-asciidoctor",
		"status":  "ok",
		"version": "1.0.0",
		"message": "Visit /api for REST API documentation",
		"endpoints": map[string]string{
			"epub":    "/convert/epub",
			"html5":   "/convert/html5",
			"pdf":     "/convert/pdf",
			"mobi":    "/convert/mobi",
			"azw3":    "/convert/azw3",
			"health":  "/healthz",
			"api_docs": "/api",
		},
	}
	
	s.writeJSON(w, http.StatusOK, response)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	// Check if converter is ready
	converterReady := s.converter.IsReady()
	
	status := "ok"
	statusCode := http.StatusOK
	if !converterReady {
		status = "degraded"
		statusCode = http.StatusServiceUnavailable
	}

	response := map[string]interface{}{
		"name":    "wikistr-asciidoctor",
		"status":  status,
		"endpoints": map[string]string{
			"epub":   "/convert/epub",
			"html5":  "/convert/html5",
			"pdf":    "/convert/pdf",
			"mobi":   "/convert/mobi",
			"azw3":   "/convert/azw3",
		},
		"port":     s.httpServer.Addr,
		"converter_ready": converterReady,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	}
	
	s.writeJSON(w, statusCode, response)
}

func (s *Server) handleAPI(w http.ResponseWriter, r *http.Request) {
	response := map[string]interface{}{
		"name":        "wikistr-asciidoctor",
		"version":     "1.0.0",
		"description": "AsciiDoctor REST API for converting AsciiDoc content to various formats",
		"base_url":    fmt.Sprintf("%s://%s", r.URL.Scheme, r.Host),
		"endpoints": map[string]interface{}{
			"health": map[string]interface{}{
				"method":      "GET",
				"path":        "/healthz",
				"description": "Health check endpoint",
			},
			"convert_epub": map[string]interface{}{
				"method":      "POST",
				"path":        "/convert/epub",
				"description": "Convert AsciiDoc content to EPUB",
			},
			"convert_html5": map[string]interface{}{
				"method":      "POST",
				"path":        "/convert/html5",
				"description": "Convert AsciiDoc content to HTML5",
			},
			"convert_pdf": map[string]interface{}{
				"method":      "POST",
				"path":        "/convert/pdf",
				"description": "Convert AsciiDoc content to PDF",
			},
			"convert_mobi": map[string]interface{}{
				"method":      "POST",
				"path":        "/convert/mobi",
				"description": "Convert AsciiDoc content to MOBI (Kindle format, via EPUB)",
			},
			"convert_azw3": map[string]interface{}{
				"method":      "POST",
				"path":        "/convert/azw3",
				"description": "Convert AsciiDoc content to AZW3 (Kindle Format 8, via EPUB)",
			},
		},
	}
	
	s.writeJSON(w, http.StatusOK, response)
}

func (s *Server) writeJSON(w http.ResponseWriter, statusCode int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	
	if err := json.NewEncoder(w).Encode(data); err != nil {
		s.logger.Error("http", "Failed to encode JSON response", err, map[string]interface{}{
			"error_type": "encoding_error",
			"status_code": statusCode,
		})
	}
}
