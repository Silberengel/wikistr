package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

func (s *Server) handleConvertEPUB(w http.ResponseWriter, r *http.Request) {
	s.handleConvert(w, r, "epub", s.converter.ConvertToEPUB)
}

func (s *Server) handleConvertPDF(w http.ResponseWriter, r *http.Request) {
	s.handleConvert(w, r, "pdf", s.converter.ConvertToPDF)
}

func (s *Server) handleConvertHTML5(w http.ResponseWriter, r *http.Request) {
	s.handleConvert(w, r, "html5", s.converter.ConvertToHTML5)
}

func (s *Server) handleConvertMOBI(w http.ResponseWriter, r *http.Request) {
	s.handleConvert(w, r, "mobi", s.converter.ConvertToMOBI)
}

func (s *Server) handleConvertAZW3(w http.ResponseWriter, r *http.Request) {
	s.handleConvert(w, r, "azw3", s.converter.ConvertToAZW3)
}

func (s *Server) handleConvertDocBook5(w http.ResponseWriter, r *http.Request) {
	s.handleConvert(w, r, "docbook5", s.converter.ConvertToDocBook5)
}

type convertFunc func(context.Context, *ConvertRequest) (*ConvertResult, error)

func (s *Server) handleConvert(w http.ResponseWriter, r *http.Request, format string, convertFn convertFunc) {
	startTime := time.Now()
	requestID := r.Context().Value("request_id").(string)

	// Parse request body
	var req ConvertRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.logger.Error("http", fmt.Sprintf("Failed to parse %s conversion request", format), err, map[string]interface{}{
			"request_id":  requestID,
			"error_type":  "invalid_request",
			"component":   "http_handler",
			"operation":   "parse_request",
			"format":      format,
		})

		s.writeError(w, http.StatusBadRequest, "Invalid JSON", "Request body must be valid JSON with 'content' and 'title' fields", requestID)
		return
	}

	// Validate request
	if req.Content == "" {
		s.writeError(w, http.StatusBadRequest, "Missing content", "The 'content' field is required and cannot be empty", requestID)
		return
	}

	if req.Title == "" {
		req.Title = "Document"
	}

	// Log request details
	contentSize := len(req.Content)
	s.logger.Info("converter", fmt.Sprintf("Received %s conversion request", format), map[string]interface{}{
		"request_id":   requestID,
		"format":       format,
		"title":        req.Title,
		"author":       req.Author,
		"content_size": contentSize,
	})

	// Check content size limit
	if contentSize > MaxContentSize {
		s.writeError(w, http.StatusRequestEntityTooLarge, "Content too large",
			fmt.Sprintf("Content size (%d bytes) exceeds maximum allowed size (%d bytes)", contentSize, MaxContentSize),
			requestID)
		return
	}

	// Prepare authors array - combine single author and authors array
	authors := req.Authors
	if len(authors) == 0 && req.Author != "" {
		// If only single author is provided, use it
		authors = []string{req.Author}
	}
	
	// Validate and fix AsciiDoc syntax (auto-adds document header if missing)
	fixedContent, err := s.converter.ValidateAndFixAsciiDoc(req.Content, req.Title, authors, req.Pubkey, req.Version, req.Description, req.Summary, req.PublishedOn, req.CreatedAt)
	if err != nil {
		s.logger.Error("converter", fmt.Sprintf("AsciiDoc validation failed for %s conversion", format), err, map[string]interface{}{
			"request_id":  requestID,
			"error_type":  "validation_failed",
			"component":   "converter",
			"operation":   "validate_asciidoc",
			"format":      format,
		})

		s.writeError(w, http.StatusBadRequest, "Invalid AsciiDoc",
			fmt.Sprintf("AsciiDoc validation failed: %s", err.Error()),
			requestID)
		return
	}
	
	// Use the fixed content (may have had header added)
	req.Content = fixedContent

	// Create context with timeout
	ctx, cancel := context.WithTimeout(r.Context(), s.converter.timeout)
	defer cancel()

	// Perform conversion
	result, err := convertFn(ctx, &req)
	if err != nil {
		// Check if it's a timeout
		if ctx.Err() == context.DeadlineExceeded {
			s.logger.Error("converter", fmt.Sprintf("%s conversion timed out", format), err, map[string]interface{}{
				"request_id":  requestID,
				"error_type":  "conversion_timeout",
				"component":   "converter",
				"operation":   "conversion",
				"format":      format,
				"duration_ms": time.Since(startTime).Milliseconds(),
			})

			s.writeError(w, http.StatusGatewayTimeout, "Conversion timeout",
				fmt.Sprintf("Conversion exceeded the maximum time limit. The document may be too large or complex. Try breaking it into smaller sections or increase ASCIIDOCTOR_CONVERSION_TIMEOUT."),
				requestID)
			return
		}

		s.logger.Error("converter", fmt.Sprintf("%s conversion failed", format), err, map[string]interface{}{
			"request_id":  requestID,
			"error_type":  "conversion_failed",
			"component":   "converter",
			"operation":   "conversion",
			"format":      format,
			"duration_ms": time.Since(startTime).Milliseconds(),
		})

		s.writeError(w, http.StatusInternalServerError, "Conversion failed",
			"Document conversion failed. Check AsciiDoc syntax and ensure all required dependencies are installed.",
			requestID)
		return
	}

	// Read result file
	file, err := os.Open(result.FilePath)
	if err != nil {
		s.logger.Error("converter", fmt.Sprintf("Failed to open %s output file", format), err, map[string]interface{}{
			"request_id":  requestID,
			"error_type":  "file_operation_error",
			"component":   "converter",
			"operation":   "read_output",
			"format":      format,
			"file_path":   result.FilePath,
		})

		s.writeError(w, http.StatusInternalServerError, "Failed to read output",
			"Conversion succeeded but failed to read the output file.",
			requestID)
		return
	}
	defer file.Close()
	
	// Clean up temp file and its parent directory after response is sent
	workDir := filepath.Dir(result.FilePath)
	defer func() {
		os.Remove(result.FilePath) // Remove the output file
		os.RemoveAll(workDir)       // Remove the entire work directory (including input files, images, etc.)
	}()

	// Set headers
	filename := sanitizeFilename(req.Title) + "." + filepath.Ext(result.FilePath)[1:]
	w.Header().Set("Content-Type", result.MimeType)
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	w.Header().Set("Content-Length", fmt.Sprintf("%d", result.Size))

	// Stream file to response
	if _, err := io.Copy(w, file); err != nil {
		s.logger.Error("http", fmt.Sprintf("Failed to stream %s response", format), err, map[string]interface{}{
			"request_id":  requestID,
			"error_type":  "server_error",
			"component":   "http_handler",
			"operation":   "stream_response",
			"format":      format,
		})
		return
	}

	// Log success
	s.logger.Info("converter", fmt.Sprintf("%s conversion completed successfully", format), map[string]interface{}{
		"request_id":  requestID,
		"format":      format,
		"output_size": result.Size,
		"duration_ms": time.Since(startTime).Milliseconds(),
		"duration":    time.Since(startTime).String(),
	})
}

func (s *Server) writeError(w http.ResponseWriter, statusCode int, errorType, message, requestID string) {
	errorResponse := map[string]interface{}{
		"error":      errorType,
		"message":    message,
		"request_id": requestID,
		"timestamp":  time.Now().UTC().Format(time.RFC3339),
	}

	s.writeJSON(w, statusCode, errorResponse)
}

func sanitizeFilename(filename string) string {
	// Remove or replace invalid filename characters
	invalid := []rune{'/', '\\', ':', '*', '?', '"', '<', '>', '|'}
	result := []rune(filename)
	for i, r := range result {
		for _, inv := range invalid {
			if r == inv {
				result[i] = '_'
				break
			}
		}
	}
	return string(result)
}
