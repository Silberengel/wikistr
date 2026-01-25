package main

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"runtime/debug"
	"strings"
	"time"

	"github.com/google/uuid"
)

// loggingMiddleware logs all HTTP requests with detailed information
func (s *Server) loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		requestID := uuid.New().String()

		// Add request ID to context
		ctx := context.WithValue(r.Context(), "request_id", requestID)
		r = r.WithContext(ctx)

		// Create response writer wrapper to capture status code
		wrapped := &responseWriter{
			ResponseWriter: w,
			statusCode:     http.StatusOK,
		}

		// Log request
		s.logger.Info("http", fmt.Sprintf("%s %s", r.Method, r.URL.Path), map[string]interface{}{
			"request_id":  requestID,
			"method":      r.Method,
			"path":        r.URL.Path,
			"remote_addr": r.RemoteAddr,
			"user_agent":  r.UserAgent(),
			"content_length": r.ContentLength,
		})

		// Process request
		next.ServeHTTP(wrapped, r)

		// Log response
		duration := time.Since(start)
		s.logger.Info("http", fmt.Sprintf("%s %s completed", r.Method, r.URL.Path), map[string]interface{}{
			"request_id":  requestID,
			"status_code": wrapped.statusCode,
			"duration_ms": duration.Milliseconds(),
			"duration":    duration.String(),
		})
	})
}

// corsMiddleware handles CORS headers
func (s *Server) corsMiddleware(allowOrigin string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Handle preflight
			if r.Method == "OPTIONS" {
				w.Header().Set("Access-Control-Allow-Origin", allowOrigin)
				w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Origin, Accept")
				w.Header().Set("Access-Control-Max-Age", "86400")
				w.WriteHeader(http.StatusNoContent)
				return
			}

			// Set CORS headers
			w.Header().Set("Access-Control-Allow-Origin", allowOrigin)
			w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Origin, Accept")

			next.ServeHTTP(w, r)
		})
	}
}

// recoveryMiddleware recovers from panics and logs detailed error information
func (s *Server) recoveryMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				// Get request ID from context
				requestID := "unknown"
				if id := r.Context().Value("request_id"); id != nil {
					requestID = id.(string)
				}

				// Get stack trace
				stack := string(debug.Stack())

				// Log panic with full details
				s.logger.Error("http", "Panic recovered", fmt.Errorf("%v", err), map[string]interface{}{
					"request_id":  requestID,
					"error_type":  "panic",
					"component":   "http_handler",
					"method":      r.Method,
					"path":        r.URL.Path,
					"stack_trace": stack,
					"operation":   "request_handling",
				})

				// Return error response
				errorResponse := map[string]interface{}{
					"error":      "Internal server error",
					"message":    "An unexpected error occurred. The error has been logged.",
					"request_id": requestID,
					"timestamp":  time.Now().UTC().Format(time.RFC3339),
				}

				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusInternalServerError)
				json.NewEncoder(w).Encode(errorResponse)
			}
		}()

		next.ServeHTTP(w, r)
	})
}

// responseWriter wraps http.ResponseWriter to capture status code
type responseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

// compressionMiddleware compresses responses with gzip when supported
func (s *Server) compressionMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Check if client supports gzip
		acceptEncoding := r.Header.Get("Accept-Encoding")
		if !strings.Contains(acceptEncoding, "gzip") {
			next.ServeHTTP(w, r)
			return
		}

		// Check if response should be compressed
		contentType := ""
		if ct := w.Header().Get("Content-Type"); ct != "" {
			contentType = ct
		}

		// Only compress text-based content
		shouldCompress := strings.HasPrefix(contentType, "text/") ||
			strings.HasPrefix(contentType, "application/json") ||
			strings.HasPrefix(contentType, "application/javascript") ||
			contentType == ""

		if !shouldCompress {
			next.ServeHTTP(w, r)
			return
		}

		// Create gzip writer
		gz := gzip.NewWriter(w)
		defer gz.Close()

		// Set headers
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Set("Vary", "Accept-Encoding")

		// Wrap response writer
		gzw := &gzipResponseWriter{
			ResponseWriter: w,
			Writer:        gz,
		}

		next.ServeHTTP(gzw, r)
	})
}

// gzipResponseWriter wraps http.ResponseWriter with gzip compression
type gzipResponseWriter struct {
	http.ResponseWriter
	Writer io.Writer
}

func (gzw *gzipResponseWriter) Write(b []byte) (int, error) {
	return gzw.Writer.Write(b)
}
