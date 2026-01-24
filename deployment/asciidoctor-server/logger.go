package main

import (
	"encoding/json"
	"fmt"
	"os"
	"time"
)

// Logger provides structured logging with detailed error information
type Logger struct {
	enableDebug bool
}

func NewLogger() *Logger {
	enableDebug := os.Getenv("ASCIIDOCTOR_DEBUG") == "true"
	return &Logger{
		enableDebug: enableDebug,
	}
}

// LogEntry represents a structured log entry
type LogEntry struct {
	Timestamp   string                 `json:"timestamp"`
	Level       string                 `json:"level"`
	Component   string                 `json:"component"`
	Message     string                 `json:"message"`
	Error       *ErrorDetails          `json:"error,omitempty"`
	Fields      map[string]interface{} `json:"fields,omitempty"`
	RequestID   string                 `json:"request_id,omitempty"`
}

// ErrorDetails provides detailed error information
type ErrorDetails struct {
	Type        string `json:"type"`
	Message     string `json:"message"`
	Stack       string `json:"stack,omitempty"`
	Actionable  string `json:"actionable,omitempty"` // What the user/admin should do
	Component   string `json:"component,omitempty"`   // Which component failed
	Operation   string `json:"operation,omitempty"`   // What operation was being performed
}

func (l *Logger) log(level, component, message string, err error, fields map[string]interface{}) {
	entry := LogEntry{
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Level:     level,
		Component: component,
		Message:   message,
		Fields:    fields,
	}

	if err != nil {
		entry.Error = l.extractErrorDetails(err, fields)
	}

	// Output as JSON for easy parsing by log aggregators
	jsonData, jsonErr := json.Marshal(entry)
	if jsonErr != nil {
		// Fallback to simple format if JSON encoding fails
		fmt.Fprintf(os.Stderr, "[%s] %s [%s] %s", entry.Timestamp, level, component, message)
		if err != nil {
			fmt.Fprintf(os.Stderr, " - Error: %v", err)
		}
		fmt.Fprintln(os.Stderr)
		return
	}

	// Write to stderr (Docker will capture this)
	fmt.Fprintln(os.Stderr, string(jsonData))
}

func (l *Logger) extractErrorDetails(err error, fields map[string]interface{}) *ErrorDetails {
	details := &ErrorDetails{
		Type:    "unknown_error",
		Message: err.Error(),
	}

	// Extract component and operation from fields if available
	if fields != nil {
		if comp, ok := fields["component"].(string); ok {
			details.Component = comp
		}
		if op, ok := fields["operation"].(string); ok {
			details.Operation = op
		}
		if errType, ok := fields["error_type"].(string); ok {
			details.Type = errType
		}
	}

	// Provide actionable guidance based on error type
	details.Actionable = l.getActionableGuidance(details.Type, details.Component)

	return details
}

func (l *Logger) getActionableGuidance(errorType, component string) string {
	guidance := map[string]string{
		"conversion_timeout": "The document conversion exceeded the timeout limit. Try: 1) Breaking the document into smaller sections, 2) Increasing ASCIIDOCTOR_CONVERSION_TIMEOUT environment variable, 3) Checking server resources (CPU/memory)",
		"conversion_failed": "The document conversion failed. Check: 1) AsciiDoc syntax is valid, 2) Required images are accessible, 3) Asciidoctor CLI tools are installed and working (run: asciidoctor --version)",
		"file_operation_error": "File operation failed. Check: 1) Disk space is available, 2) File permissions are correct, 3) Temp directory is writable",
		"command_execution_error": "Failed to execute asciidoctor command. Check: 1) Ruby and asciidoctor gems are installed, 2) PATH includes asciidoctor binaries, 3) Required dependencies (Java for PlantUML, etc.) are available",
		"invalid_request": "Invalid request received. Check: 1) Request body is valid JSON, 2) Required fields (content, title) are present, 3) Content size is within limits (50MB)",
		"initialization_error": "Server initialization failed. Check: 1) All required environment variables are set, 2) Dependencies are installed, 3) Port is not already in use",
		"server_error": "HTTP server error occurred. Check: 1) Port is available, 2) Network configuration is correct, 3) Server logs for detailed error information",
		"shutdown_error": "Error during server shutdown. This may indicate: 1) Active requests were not completed, 2) Resources were not properly released",
	}

	if guidance, ok := guidance[errorType]; ok {
		return guidance
	}

	return "Check server logs and system status. If the error persists, restart the container and check Docker logs."
}

func (l *Logger) Info(component, message string, fields map[string]interface{}) {
	l.log("INFO", component, message, nil, fields)
}

func (l *Logger) Warn(component, message string, fields map[string]interface{}) {
	l.log("WARN", component, message, nil, fields)
}

func (l *Logger) Error(component, message string, err error, fields map[string]interface{}) {
	l.log("ERROR", component, message, err, fields)
}

func (l *Logger) Debug(component, message string, fields map[string]interface{}) {
	if l.enableDebug {
		l.log("DEBUG", component, message, nil, fields)
	}
}
