package main

import (
	"os"
	"time"
)

// Config holds all configuration for the asciidoctor server
// All environment variables are parsed here, not scattered throughout the codebase
type Config struct {
	// Server configuration
	Port        string
	Host        string
	AllowOrigin string

	// Conversion configuration
	ConversionTimeout time.Duration

	// Bundle configuration (for Ruby gems)
	BundlePath string
	BundleGemfile string

	// Temporary directory configuration
	TempDir string

	// Debug mode
	Debug bool
}

// LoadConfig loads configuration from environment variables
// This is the ONLY place where os.Getenv() should be called
func LoadConfig() (cfg Config) {
	// Server configuration
	cfg.Port = getEnvOrDefault("ASCIIDOCTOR_PORT", DefaultPort)
	cfg.Host = getEnvOrDefault("ASCIIDOCTOR_HOST", DefaultHost)
	cfg.AllowOrigin = getEnvOrDefault("ASCIIDOCTOR_ALLOW_ORIGIN", DefaultAllowOrigin)

	// Conversion timeout
	timeoutStr := getEnvOrDefault("ASCIIDOCTOR_CONVERSION_TIMEOUT", DefaultConversionTimeout.String())
	if parsed, err := time.ParseDuration(timeoutStr); err == nil {
		cfg.ConversionTimeout = parsed
	} else {
		cfg.ConversionTimeout = DefaultConversionTimeout
	}

	// Bundle configuration
	cfg.BundlePath = getEnvOrDefault("BUNDLE_PATH", DefaultBundlePath)
	cfg.BundleGemfile = getEnvOrDefault("BUNDLE_GEMFILE", DefaultBundleGemfile)

	// Temporary directory
	cfg.TempDir = getEnvOrDefault("TMPDIR", DefaultTempDir)

	// Debug mode
	cfg.Debug = os.Getenv("ASCIIDOCTOR_DEBUG") == "true"

	return
}

// getEnvOrDefault returns the environment variable value or a default
func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
