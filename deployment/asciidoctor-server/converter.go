package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
)

// Converter handles AsciiDoc to various format conversions
type Converter struct {
	logger          *Logger
	config          Config
	timeout         time.Duration
	tempDir         string
	asciidoctorPath string
	ready           bool
}

func NewConverter(logger *Logger, cfg Config) (converter *Converter, err error) {
	// Find asciidoctor command
	asciidoctorPath, err := findAsciidoctor(logger, cfg)
	if err != nil {
		logger.Error("converter", "Failed to find asciidoctor", err, map[string]interface{}{
			"error_type": "asciidoctor_not_found",
			"bundle_path": cfg.BundlePath,
			"path":        os.Getenv("PATH"), // PATH is system-level, not configurable
		})
		return
	}

	// Create temp directory
	tempDir := filepath.Join(cfg.TempDir, "asciidoctor-server")
	if err = os.MkdirAll(tempDir, FileModeDir); err != nil {
		err = fmt.Errorf("failed to create temp directory: %w", err)
		return
	}

	converter = &Converter{
		logger:          logger,
		config:          cfg,
		timeout:         cfg.ConversionTimeout,
		tempDir:         tempDir,
		asciidoctorPath: asciidoctorPath,
		ready:           true,
	}

	// Verify asciidoctor is working
	if err = converter.verify(); err != nil {
		logger.Warn("converter", "Asciidoctor verification failed, but continuing", map[string]interface{}{
			"error_type": "verification_warning",
			"error":      err.Error(),
		})
		converter.ready = false
		err = nil // Don't fail initialization, just mark as not ready
	} else {
		logger.Info("converter", "Asciidoctor converter initialized", map[string]interface{}{
			"asciidoctor_path": asciidoctorPath,
			"temp_dir":         tempDir,
			"timeout":          cfg.ConversionTimeout.String(),
		})
	}

	return
}

func findAsciidoctor(logger *Logger, cfg Config) (path string, err error) {
	// Try bundle exec first (most reliable when using bundle install --path)
	if bundleCmd, lookErr := exec.LookPath("bundle"); lookErr == nil {
		ctx, cancel := context.WithTimeout(context.Background(), CommandTimeout)
		cmd := exec.CommandContext(ctx, bundleCmd, "exec", "asciidoctor", "--version")
		// Set bundle environment correctly
		if absGemfile, absErr := filepath.Abs(cfg.BundleGemfile); absErr == nil {
			if _, statErr := os.Stat(absGemfile); statErr == nil {
				cmd.Env = append(os.Environ(),
					"BUNDLE_GEMFILE="+absGemfile,
					"BUNDLE_PATH="+cfg.BundlePath,
				)
				cmd.Dir = filepath.Dir(absGemfile)
			}
		}
		runErr := cmd.Run()
		cancel()
		if runErr == nil {
			if logger != nil {
				logger.Info("converter", "Found asciidoctor via bundle exec", map[string]interface{}{
					"method": "bundle exec",
				})
			}
			// Return "bundle" as the command, we'll use bundle exec in the actual conversion
			path = "bundle"
			return
		}
	}
	
	// Try multiple possible bundle paths
	// When using bundle install --path, executables are in vendor/bundle/ruby/<version>/bin/
	bundlePaths := []string{
		filepath.Join(cfg.BundlePath, "bin", "asciidoctor"),
		filepath.Join("/app", "deployment", "vendor", "bundle", "bin", "asciidoctor"),
	}
	
	// Also check ruby version subdirectories
	if rubyDirs, globErr := filepath.Glob(filepath.Join(cfg.BundlePath, "ruby", "*", "bin", "asciidoctor")); globErr == nil {
		bundlePaths = append(bundlePaths, rubyDirs...)
	}
	// Also check the direct ruby/bin path
	bundlePaths = append(bundlePaths, filepath.Join(cfg.BundlePath, "ruby", "bin", "asciidoctor"))
	
	for _, bundleBinPath := range bundlePaths {
		if info, statErr := os.Stat(bundleBinPath); statErr == nil {
			// Check if it's executable
			if info.Mode().Perm()&ExecutablePermission != 0 {
				// Verify it works with bundle exec or directly
				ctx, cancel := context.WithTimeout(context.Background(), CommandTimeout)
				var cmd *exec.Cmd
				// Try with bundle exec first
				if bundleCmd, lookErr := exec.LookPath("bundle"); lookErr == nil {
					cmd = exec.CommandContext(ctx, bundleCmd, "exec", bundleBinPath, "--version")
					if absGemfile, absErr := filepath.Abs(cfg.BundleGemfile); absErr == nil {
						cmd.Env = append(os.Environ(),
							"BUNDLE_GEMFILE="+absGemfile,
							"BUNDLE_PATH="+cfg.BundlePath,
						)
					}
				} else {
					cmd = exec.CommandContext(ctx, bundleBinPath, "--version")
				}
				runErr := cmd.Run()
				cancel()
				if runErr == nil {
					if logger != nil {
						logger.Info("converter", "Found asciidoctor in bundle path", map[string]interface{}{
							"path": bundleBinPath,
						})
					}
					path = bundleBinPath
					return
				}
			}
		} else if logger != nil {
			logger.Info("converter", "Checking bundle path", map[string]interface{}{
				"path":  bundleBinPath,
				"error": statErr.Error(),
			})
		}
	}

	// Check common locations
	paths := []string{
		"/usr/local/bin/asciidoctor",
		"/usr/bin/asciidoctor",
		"asciidoctor", // In PATH
	}

	for _, checkPath := range paths {
		if info, statErr := os.Stat(checkPath); statErr == nil {
			// Check if it's executable
			if info.Mode().Perm()&ExecutablePermission != 0 {
				// Verify it works
				ctx, cancel := context.WithTimeout(context.Background(), CommandTimeout)
				cmd := exec.CommandContext(ctx, checkPath, "--version")
				runErr := cmd.Run()
				cancel()
				if runErr == nil {
					path = checkPath
					return
				}
			}
		}
	}

	// Try to find in PATH
	if foundPath, lookErr := exec.LookPath("asciidoctor"); lookErr == nil {
		ctx, cancel := context.WithTimeout(context.Background(), CommandTimeout)
		cmd := exec.CommandContext(ctx, foundPath, "--version")
		runErr := cmd.Run()
		cancel()
		if runErr == nil {
			path = foundPath
			return
		}
	}

	err = fmt.Errorf("asciidoctor command not found in PATH or common locations (checked bundle paths: %v)", bundlePaths)
	return
}

func (c *Converter) verify() (err error) {
	ctx, cancel := context.WithTimeout(context.Background(), VerifyTimeout)
	defer cancel()

	var cmd *exec.Cmd
	if c.asciidoctorPath == "bundle" {
		bundlePath, lookErr := exec.LookPath("bundle")
		if lookErr != nil {
			err = fmt.Errorf("bundle command not found: %w", lookErr)
			return
		}
		cmd = exec.CommandContext(ctx, bundlePath, "exec", "asciidoctor", "--version")
		// Set bundle environment
		if absGemfile, absErr := filepath.Abs(c.config.BundleGemfile); absErr == nil {
			if _, statErr := os.Stat(absGemfile); statErr == nil {
				cmd.Env = append(os.Environ(),
					"BUNDLE_GEMFILE="+absGemfile,
					"BUNDLE_PATH="+c.config.BundlePath,
				)
			}
		}
		// Note: cmd.Dir will be set to workDir later for the conversion
	} else {
		cmd = exec.CommandContext(ctx, c.asciidoctorPath, "--version")
	}
	output, runErr := cmd.CombinedOutput()
	if runErr != nil {
		err = fmt.Errorf("asciidoctor version check failed: %w (output: %s)", runErr, string(output))
		return
	}

	c.logger.Debug("converter", "Asciidoctor version check successful", map[string]interface{}{
		"output": strings.TrimSpace(string(output)),
	})

	return nil
}

func (c *Converter) IsReady() bool {
	return c.ready
}

// ValidateAndFixAsciiDoc validates AsciiDoc content and automatically fixes common issues
// If no document header is found, it adds one using the provided metadata
// Returns the (possibly modified) content and any error
func (c *Converter) ValidateAndFixAsciiDoc(content string, title string, authors []string, pubkey string, version string, description string, summary string, publishedOn string, createdAt string) (string, error) {
	// Check if content is empty
	trimmed := strings.TrimSpace(content)
	if len(trimmed) == 0 {
		return "", fmt.Errorf("AsciiDoc content is empty")
	}

	// Check if content starts with a document header (= Title)
	// AsciiDoc documents should start with a level-0 heading
	lines := strings.Split(trimmed, "\n")
	foundHeader := false
	
	for _, line := range lines {
		trimmedLine := strings.TrimSpace(line)
		// Skip empty lines and comments
		if trimmedLine == "" || strings.HasPrefix(trimmedLine, "//") {
			continue
		}
		// Check for document header (= Title)
		if strings.HasPrefix(trimmedLine, "=") && !strings.HasPrefix(trimmedLine, "==") {
			foundHeader = true
			break
		}
		// If we hit non-header content before finding a header, it's invalid
		if !strings.HasPrefix(trimmedLine, ":") && !strings.HasPrefix(trimmedLine, "[") {
			break
		}
	}

	// If no header found, add one using the title, author, and version
	if !foundHeader {
		// Use title from request, or fallback to "Document"
		headerTitle := title
		if headerTitle == "" {
			headerTitle = "Document"
		} else {
			// Convert to Title Case (capitalize first letter of each word)
			headerTitle = toTitleCase(headerTitle)
		}
		
		// Build document header
		var header strings.Builder
		header.WriteString(fmt.Sprintf("= %s\n", headerTitle))
		
		// Default version to "1.0" if not provided
		versionValue := version
		if versionValue == "" {
			versionValue = "1.0"
		}
		
		// Handle multiple authors - join with semicolon for AsciiDoc format
		// If no authors provided, default to npub format of pubkey
		authorLine := ""
		authorAttr := ""
		if len(authors) > 0 {
			// Use provided authors array
			authorLine = strings.Join(authors, "; ")
			authorAttr = strings.Join(authors, "; ")
		} else if pubkey != "" {
			// Default to npub format of pubkey if no authors provided
			npub := encodePubkeyToNpub(pubkey)
			authorLine = npub
			authorAttr = npub
		}
		
		// Add author line if we have authors
		if authorLine != "" {
			header.WriteString(fmt.Sprintf("%s\n", authorLine))
		}
		
		// Add revision date line if publishedOn is provided (AsciiDoc format: date after author)
		if publishedOn != "" {
			// Format: YYYY-MM-DD (AsciiDoc expects this format)
			header.WriteString(fmt.Sprintf("%s\n", publishedOn))
		}
		
		// Add version attribute (always add since we default to 1.0)
		header.WriteString(fmt.Sprintf(":version: %s\n", versionValue))
		
		// Add revnumber (revision number) - same as version
		header.WriteString(fmt.Sprintf(":revnumber: %s\n", versionValue))
		
		// Add revdate (revision date) from publishedOn
		if publishedOn != "" {
			header.WriteString(fmt.Sprintf(":revdate: %s\n", publishedOn))
		}
		
		// Add author attribute if provided (for metadata)
		if authorAttr != "" {
			header.WriteString(fmt.Sprintf(":author: %s\n", authorAttr))
		}
		
		// Add pubkey attribute if pubkey is provided (when authors are also provided)
		// Only add if we have explicit authors (not defaulted from pubkey)
		if pubkey != "" && len(authors) > 0 {
			npub := encodePubkeyToNpub(pubkey)
			header.WriteString(fmt.Sprintf(":pubkey: %s\n", npub))
		}
		
		// Add created date attribute if provided
		if createdAt != "" {
			// If createdAt is a timestamp, convert to YYYY-MM-DD
			createdDate := formatDate(createdAt)
			if createdDate != "" {
				header.WriteString(fmt.Sprintf(":created: %s\n", createdDate))
			}
		}
		
		// Add description attribute if provided
		if description != "" {
			header.WriteString(fmt.Sprintf(":description: %s\n", description))
		}
		
		// Add summary attribute if provided (if different from description)
		if summary != "" && summary != description {
			header.WriteString(fmt.Sprintf(":summary: %s\n", summary))
		}
		
		// Add blank line before content
		header.WriteString("\n")
		
		// Prepend document header to content
		fixedContent := header.String() + content
		
		c.logger.Info("converter", "Added missing document header to AsciiDoc content", map[string]interface{}{
			"operation": "validate_and_fix",
			"added_title": headerTitle,
			"added_authors": len(authors),
			"used_pubkey_as_author": len(authors) == 0 && pubkey != "",
			"added_version": versionValue,
			"added_published_on": publishedOn != "",
			"added_created_at": createdAt != "",
			"added_description": description != "",
			"added_summary": summary != "",
			"added_pubkey": pubkey != "" && len(authors) > 0,
		})
		
		return fixedContent, nil
	}

	return content, nil
}

// toTitleCase converts a string to Title Case (capitalizes first letter of each word)
// Handles hyphens by treating them as word separators
func toTitleCase(s string) string {
	if s == "" {
		return s
	}
	
	// Replace hyphens with spaces, then convert to title case
	words := strings.Fields(strings.ReplaceAll(s, "-", " "))
	result := make([]string, 0, len(words))
	
	for _, word := range words {
		if len(word) == 0 {
			continue
		}
		// Capitalize first letter, lowercase the rest
		runes := []rune(word)
		runes[0] = unicode.ToUpper(runes[0])
		for i := 1; i < len(runes); i++ {
			runes[i] = unicode.ToLower(runes[i])
		}
		result = append(result, string(runes))
	}
	
	return strings.Join(result, " ")
}

// encodePubkeyToNpub encodes a hex pubkey to npub format (bech32)
// If pubkey is already in npub format, returns it as-is
// If pubkey is hex (64 chars), attempts to encode to npub
// Note: Full bech32 encoding requires a library. For now, accepts npub directly.
// If hex is provided, returns it as-is (client should send npub format)
func encodePubkeyToNpub(pubkey string) string {
	if pubkey == "" {
		return ""
	}
	
	// If already in npub format, return as-is
	if strings.HasPrefix(pubkey, "npub1") {
		return pubkey
	}
	
	// If it's hex format (64 characters), we need bech32 encoding
	// For now, return hex as-is - client should send npub format
	// TODO: Add bech32 library (e.g., github.com/nbd-wtf/go-nostr) for proper encoding
	if len(pubkey) == 64 {
		// Check if it's valid hex
		if matched, _ := regexp.MatchString(`^[0-9a-fA-F]{64}$`, pubkey); matched {
			// Return hex for now - proper npub encoding requires bech32 library
			// Client should send npub format directly
			return pubkey
		}
	}
	
	// Return as-is if we can't determine format
	return pubkey
}

// formatDate converts a date string (timestamp or YYYY-MM-DD) to YYYY-MM-DD format
func formatDate(dateStr string) string {
	if dateStr == "" {
		return ""
	}
	
	// If it's already in YYYY-MM-DD format, return as-is
	if matched, _ := regexp.MatchString(`^\d{4}-\d{2}-\d{2}$`, dateStr); matched {
		return dateStr
	}
	
	// Try to parse as Unix timestamp (seconds)
	if timestamp, err := strconv.ParseInt(dateStr, 10, 64); err == nil {
		// Check if it's in seconds (10 digits) or milliseconds (13 digits)
		if timestamp > 1e12 {
			// Milliseconds
			timestamp = timestamp / 1000
		}
		t := time.Unix(timestamp, 0)
		return t.Format("2006-01-02")
	}
	
	// Try to parse as RFC3339 or other common formats
	formats := []string{
		time.RFC3339,
		time.RFC3339Nano,
		"2006-01-02T15:04:05Z",
		"2006-01-02T15:04:05Z07:00",
		"2006-01-02 15:04:05",
	}
	
	for _, format := range formats {
		if t, err := time.Parse(format, dateStr); err == nil {
			return t.Format("2006-01-02")
		}
	}
	
	// If we can't parse it, return empty string
	return ""
}

// ConvertRequest represents a conversion request
type ConvertRequest struct {
	Content     string   `json:"content"`
	Title       string   `json:"title"`
	Author      string   `json:"author"`      // Single author (for backward compatibility)
	Authors     []string `json:"authors,omitempty"` // Multiple authors
	Pubkey      string   `json:"pubkey,omitempty"`  // Hex pubkey (will be encoded to npub if needed)
	Version     string   `json:"version,omitempty"`
	Description string   `json:"description,omitempty"`
	Summary     string   `json:"summary,omitempty"`
	PublishedOn string   `json:"published_on,omitempty"` // Publication date (YYYY-MM-DD)
	CreatedAt   string   `json:"created_at,omitempty"`   // Creation date (YYYY-MM-DD or timestamp)
	Image       string   `json:"image,omitempty"`         // Cover image URL
	Theme       string   `json:"theme,omitempty"`
}

// ConvertResult represents the result of a conversion
type ConvertResult struct {
	FilePath string
	Size     int64
	MimeType string
}

func (c *Converter) ConvertToEPUB(ctx context.Context, req *ConvertRequest) (*ConvertResult, error) {
	return c.convert(ctx, req, "epub3", "epub")
}

func (c *Converter) ConvertToPDF(ctx context.Context, req *ConvertRequest) (*ConvertResult, error) {
	return c.convert(ctx, req, "pdf", "pdf")
}

func (c *Converter) ConvertToHTML5(ctx context.Context, req *ConvertRequest) (*ConvertResult, error) {
	// For HTML5, we need special handling for image embedding
	return c.convertHTML5(ctx, req)
}

func (c *Converter) ConvertToMOBI(ctx context.Context, req *ConvertRequest) (*ConvertResult, error) {
	// Convert via EPUB: AsciiDoc → EPUB → MOBI
	return c.convertViaEPUB(ctx, req, "mobi")
}

func (c *Converter) ConvertToAZW3(ctx context.Context, req *ConvertRequest) (*ConvertResult, error) {
	// Convert via EPUB: AsciiDoc → EPUB → AZW3
	return c.convertViaEPUB(ctx, req, "azw3")
}

func (c *Converter) convert(ctx context.Context, req *ConvertRequest, backend, extension string) (*ConvertResult, error) {
	// Create temp directory for this conversion
	workDir, err := os.MkdirTemp(c.tempDir, "convert-*")
	if err != nil {
		return nil, fmt.Errorf("failed to create temp work directory: %w", err)
	}
	defer os.RemoveAll(workDir) // Clean up entire work directory

	// Create input file
	inputPath := filepath.Join(workDir, "input.adoc")
	if err := os.WriteFile(inputPath, []byte(req.Content), FileModeFile); err != nil {
		return nil, fmt.Errorf("failed to write content to temp file: %w", err)
	}

	// Determine output path
	outputPath := filepath.Join(workDir, fmt.Sprintf("output.%s", extension))

	// Build asciidoctor command
	// If asciidoctorPath is "bundle", use bundle exec
	var cmd *exec.Cmd
	if c.asciidoctorPath == "bundle" {
		bundlePath, err := exec.LookPath("bundle")
		if err != nil {
			return nil, fmt.Errorf("bundle command not found: %w", err)
		}
		cmd = exec.CommandContext(ctx, bundlePath, "exec", "asciidoctor",
			"-b", backend,
			"-D", workDir,
			"-o", filepath.Base(outputPath),
			"-a", fmt.Sprintf("title=%s", req.Title),
		)
		// Set bundle environment
		bundlePathEnv := os.Getenv("BUNDLE_PATH")
		if bundlePathEnv == "" {
			bundlePathEnv = "/app/deployment/vendor/bundle"
		}
		// Gemfile is at /app/deployment/Gemfile
		gemfilePath := "/app/deployment/Gemfile"
		if _, err := os.Stat(gemfilePath); err == nil {
			cmd.Env = append(os.Environ(),
				"BUNDLE_GEMFILE="+gemfilePath,
				"BUNDLE_PATH="+bundlePathEnv,
			)
		}
		// Note: cmd.Dir will be set to workDir later for the conversion
	} else {
		cmd = exec.CommandContext(ctx, c.asciidoctorPath,
			"-b", backend,
			"-D", workDir,
			"-o", filepath.Base(outputPath),
			"-a", fmt.Sprintf("title=%s", req.Title),
		)
	}

	// Add author(s) if provided - use authors array if available, otherwise fall back to single author
	// If no authors provided, default to npub format of pubkey
	authors := req.Authors
	if len(authors) == 0 && req.Author != "" {
		authors = []string{req.Author}
	} else if len(authors) == 0 && req.Pubkey != "" {
		// Default to npub format of pubkey if no authors provided
		npub := encodePubkeyToNpub(req.Pubkey)
		authors = []string{npub}
	}
	if len(authors) > 0 {
		// Join multiple authors with semicolon for asciidoctor
		authorAttr := strings.Join(authors, "; ")
		cmd.Args = append(cmd.Args, "-a", fmt.Sprintf("author=%s", authorAttr))
	}
	
	// Add version/revnumber (default to 1.0 if not provided)
	versionValue := req.Version
	if versionValue == "" {
		versionValue = "1.0"
	}
	cmd.Args = append(cmd.Args, "-a", fmt.Sprintf("revnumber=%s", versionValue))
	
	// Add revdate (revision date) from publishedOn if provided
	if req.PublishedOn != "" {
		cmd.Args = append(cmd.Args, "-a", fmt.Sprintf("revdate=%s", req.PublishedOn))
	}
	
	// Add created date if provided
	if req.CreatedAt != "" {
		createdDate := formatDate(req.CreatedAt)
		if createdDate != "" {
			cmd.Args = append(cmd.Args, "-a", fmt.Sprintf("created=%s", createdDate))
		}
	}
	
	// Add pubkey attribute if pubkey is provided (when authors are explicitly provided)
	// Only add if we have explicit authors (not defaulted from pubkey)
	hasExplicitAuthors := len(req.Authors) > 0 || req.Author != ""
	if req.Pubkey != "" && hasExplicitAuthors {
		npub := encodePubkeyToNpub(req.Pubkey)
		cmd.Args = append(cmd.Args, "-a", fmt.Sprintf("pubkey=%s", npub))
	}

	// Add cover image if provided (for EPUB, PDF, DocBook5, MOBI, AZW3)
	if req.Image != "" {
		cmd.Args = append(cmd.Args, "-a", fmt.Sprintf("front-cover-image=%s", req.Image))
	}

	// Add common attributes
	cmd.Args = append(cmd.Args,
		"-a", "toc",
		"-a", "stem",
		"-a", "doctype=book",
		"-a", "allow-uri-read",
	)

	// Add input file (relative to workDir since we set Dir)
	cmd.Args = append(cmd.Args, filepath.Base(inputPath))
	
	// Set working directory to workDir so relative paths work
	cmd.Dir = workDir

	// Execute conversion with timeout
	conversionCtx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()

	c.logger.Info("converter", fmt.Sprintf("Starting %s conversion", backend), map[string]interface{}{
		"operation":      "conversion",
		"backend":        backend,
		"input_file":     inputPath,
		"output_file":    outputPath,
		"work_dir":       workDir,
		"content_length":  len(req.Content),
		"timeout":        c.timeout.String(),
		"command":       strings.Join(cmd.Args, " "),
	})

	startTime := time.Now()
	output, err := cmd.CombinedOutput()
	duration := time.Since(startTime)

	if err != nil {
		// Check if it's a timeout
		if conversionCtx.Err() == context.DeadlineExceeded {
			return nil, fmt.Errorf("conversion timeout after %s: %w", c.timeout, err)
		}

		c.logger.Error("converter", fmt.Sprintf("%s conversion failed", backend), err, map[string]interface{}{
			"error_type":    "conversion_failed",
			"component":     "converter",
			"operation":      "conversion",
			"backend":       backend,
			"duration_ms":   duration.Milliseconds(),
			"command_output": string(output),
		})

		return nil, fmt.Errorf("conversion failed: %w (output: %s)", err, string(output))
	}

	// Check if output file was created
	info, err := os.Stat(outputPath)
	if err != nil {
		// List files in work directory for debugging
		files, _ := os.ReadDir(workDir)
		fileList := make([]string, 0, len(files))
		for _, f := range files {
			fileList = append(fileList, f.Name())
		}
		
		c.logger.Error("converter", "Output file not found after conversion", err, map[string]interface{}{
			"error_type":    "file_operation_error",
			"component":     "converter",
			"operation":      "verify_output",
			"backend":       backend,
			"expected_path": outputPath,
			"work_dir":      workDir,
			"files_in_dir":  fileList,
		})
		
		return nil, fmt.Errorf("output file not created at %s (files in dir: %v): %w", outputPath, fileList, err)
	}

	if info.Size() == 0 {
		return nil, fmt.Errorf("output file is empty")
	}

	// Determine MIME type
	mimeType := getMimeType(extension)

	c.logger.Info("converter", fmt.Sprintf("%s conversion completed", backend), map[string]interface{}{
		"operation":    "conversion",
		"backend":      backend,
		"output_file":  outputPath,
		"output_size":  info.Size(),
		"duration_ms":  duration.Milliseconds(),
		"duration":     duration.String(),
	})

	return &ConvertResult{
		FilePath: outputPath,
		Size:     info.Size(),
		MimeType: mimeType,
	}, nil
}

func (c *Converter) convertHTML5(ctx context.Context, req *ConvertRequest) (*ConvertResult, error) {
	// Create temp directory for this conversion
	workDir, err := os.MkdirTemp(c.tempDir, "convert-*")
	if err != nil {
		return nil, fmt.Errorf("failed to create temp work directory: %w", err)
	}
	defer os.RemoveAll(workDir) // Clean up entire work directory

	// Process images for HTML embedding (download temporarily, but don't modify AsciiDoc content)
	imageHandler := NewImageHandler(c.logger, workDir)
	if err := imageHandler.ProcessImagesForHTML(ctx, req.Content); err != nil {
		c.logger.Warn("converter", "Failed to process some images, continuing with conversion", map[string]interface{}{
			"error": err.Error(),
		})
		// Continue even if image processing fails - asciidoctor can still fetch them
	}
	defer imageHandler.Cleanup() // Clean up downloaded images after embedding

	// Create input file with ORIGINAL content (keep remote URLs as-is)
	// Images will be embedded as base64 in the HTML output, but AsciiDoc content stays unchanged
	inputPath := filepath.Join(workDir, "input.adoc")
	if err := os.WriteFile(inputPath, []byte(req.Content), FileModeFile); err != nil {
		return nil, fmt.Errorf("failed to write content to temp file: %w", err)
	}

	// Determine output path
	outputPath := filepath.Join(workDir, "output.html")

	// Build asciidoctor command
	// If asciidoctorPath is "bundle", use bundle exec
	var cmd *exec.Cmd
	if c.asciidoctorPath == "bundle" {
		bundlePath, err := exec.LookPath("bundle")
		if err != nil {
			return nil, fmt.Errorf("bundle command not found: %w", err)
		}
		cmd = exec.CommandContext(ctx, bundlePath, "exec", "asciidoctor",
			"-b", "html5",
			"-D", workDir,
			"-o", filepath.Base(outputPath),
			"-a", fmt.Sprintf("title=%s", req.Title),
			"-a", "standalone",
			// Note: Removed "noheader" and "nofooter" to allow title page to appear
			// Title page will show title, author, version, and revdate
		)
		// Set bundle environment
		if absGemfile, absErr := filepath.Abs(c.config.BundleGemfile); absErr == nil {
			if _, statErr := os.Stat(absGemfile); statErr == nil {
				cmd.Env = append(os.Environ(),
					"BUNDLE_GEMFILE="+absGemfile,
					"BUNDLE_PATH="+c.config.BundlePath,
				)
			}
		}
		// Note: cmd.Dir will be set to workDir later for the conversion
	} else {
		cmd = exec.CommandContext(ctx, c.asciidoctorPath,
			"-b", "html5",
			"-D", workDir,
			"-o", filepath.Base(outputPath),
			"-a", fmt.Sprintf("title=%s", req.Title),
			"-a", "standalone",
			// Note: Removed "noheader" and "nofooter" to allow title page to appear
			// Title page will show title, author, version, and revdate
		)
	}

	// Add author(s) if provided - use authors array if available, otherwise fall back to single author
	// If no authors provided, default to npub format of pubkey
	authors := req.Authors
	if len(authors) == 0 && req.Author != "" {
		authors = []string{req.Author}
	} else if len(authors) == 0 && req.Pubkey != "" {
		// Default to npub format of pubkey if no authors provided
		npub := encodePubkeyToNpub(req.Pubkey)
		authors = []string{npub}
	}
	if len(authors) > 0 {
		// Join multiple authors with semicolon for asciidoctor
		authorAttr := strings.Join(authors, "; ")
		cmd.Args = append(cmd.Args, "-a", fmt.Sprintf("author=%s", authorAttr))
	}
	
	// Add version/revnumber (default to 1.0 if not provided)
	versionValue := req.Version
	if versionValue == "" {
		versionValue = "1.0"
	}
	cmd.Args = append(cmd.Args, "-a", fmt.Sprintf("revnumber=%s", versionValue))
	
	// Add revdate (revision date) from publishedOn if provided
	if req.PublishedOn != "" {
		cmd.Args = append(cmd.Args, "-a", fmt.Sprintf("revdate=%s", req.PublishedOn))
	}
	
	// Add created date if provided
	if req.CreatedAt != "" {
		createdDate := formatDate(req.CreatedAt)
		if createdDate != "" {
			cmd.Args = append(cmd.Args, "-a", fmt.Sprintf("created=%s", createdDate))
		}
	}
	
	// Add pubkey attribute if pubkey is provided (when authors are explicitly provided)
	// Only add if we have explicit authors (not defaulted from pubkey)
	hasExplicitAuthors := len(req.Authors) > 0 || req.Author != ""
	if req.Pubkey != "" && hasExplicitAuthors {
		npub := encodePubkeyToNpub(req.Pubkey)
		cmd.Args = append(cmd.Args, "-a", fmt.Sprintf("pubkey=%s", npub))
	}

	// Add cover image if provided (for HTML5 title page)
	if req.Image != "" {
		cmd.Args = append(cmd.Args, "-a", fmt.Sprintf("front-cover-image=%s", req.Image))
	}

	// Add common attributes
	cmd.Args = append(cmd.Args,
		"-a", "toc",
		"-a", "stem",
		"-a", "doctype=book",
		"-a", "allow-uri-read",
		"-a", "imagesdir=images",
	)

	// Add input file
	cmd.Args = append(cmd.Args, filepath.Base(inputPath))
	
	// Set working directory
	cmd.Dir = workDir

	// Execute conversion with timeout
	conversionCtx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()

	c.logger.Info("converter", "Starting html5 conversion", map[string]interface{}{
		"operation":      "conversion",
		"backend":        "html5",
		"input_file":     inputPath,
		"output_file":    outputPath,
		"work_dir":       workDir,
		"content_length": len(req.Content),
		"timeout":        c.timeout.String(),
	})

	startTime := time.Now()
	output, err := cmd.CombinedOutput()
	duration := time.Since(startTime)

	if err != nil {
		if conversionCtx.Err() == context.DeadlineExceeded {
			return nil, fmt.Errorf("conversion timeout after %s: %w", c.timeout, err)
		}

		c.logger.Error("converter", "html5 conversion failed", err, map[string]interface{}{
			"error_type":    "conversion_failed",
			"component":     "converter",
			"operation":      "conversion",
			"backend":       "html5",
			"duration_ms":   duration.Milliseconds(),
			"command_output": string(output),
		})

		return nil, fmt.Errorf("conversion failed: %w (output: %s)", err, string(output))
	}

	// Read HTML output
	htmlContent, err := os.ReadFile(outputPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read HTML output: %w", err)
	}

	// Embed images as base64 data URIs
	htmlWithImages := imageHandler.EmbedImagesAsBase64(string(htmlContent))

	// Add cover image if present (use original content to find cover image attribute)
	htmlWithCover := imageHandler.AddCoverImageToHTML(htmlWithImages, req.Content)

	// Ensure complete HTML document
	finalHTML := ensureCompleteHTML(htmlWithCover, req.Title)

	// Write final HTML to output file
	if err := os.WriteFile(outputPath, []byte(finalHTML), FileModeFile); err != nil {
		return nil, fmt.Errorf("failed to write final HTML: %w", err)
	}

	// Check file size
	info, err := os.Stat(outputPath)
	if err != nil {
		return nil, fmt.Errorf("output file not created: %w", err)
	}

	if info.Size() == 0 {
		return nil, fmt.Errorf("output file is empty")
	}

	c.logger.Info("converter", "html5 conversion completed", map[string]interface{}{
		"operation":    "conversion",
		"backend":      "html5",
		"output_file":  outputPath,
		"output_size":  info.Size(),
		"duration_ms":  duration.Milliseconds(),
		"duration":     duration.String(),
	})

	return &ConvertResult{
		FilePath: outputPath,
		Size:     info.Size(),
		MimeType: "text/html; charset=utf-8",
	}, nil
}

// ConvertToDocBook5 converts AsciiDoc content to DocBook5 XML
func (c *Converter) ConvertToDocBook5(ctx context.Context, req *ConvertRequest) (*ConvertResult, error) {
	return c.convert(ctx, req, "docbook5", "xml")
}

func ensureCompleteHTML(htmlContent, title string) string {
	if strings.Contains(htmlContent, "<!doctype") || strings.Contains(htmlContent, "<!DOCTYPE") {
		return htmlContent
	}

	return fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>%s</title>
</head>
<body>
%s
</body>
</html>`, title, htmlContent)
}

// convertViaEPUB converts AsciiDoc to Kindle format via EPUB intermediate
func (c *Converter) convertViaEPUB(ctx context.Context, req *ConvertRequest, kindleFormat string) (*ConvertResult, error) {
	// First, convert to EPUB
	epubResult, err := c.ConvertToEPUB(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("failed to generate EPUB for %s conversion: %w", kindleFormat, err)
	}
	defer os.Remove(epubResult.FilePath) // Clean up EPUB after conversion

	// Find Calibre's ebook-convert command
	ebookConvertPath, err := findEbookConvert()
	if err != nil {
		return nil, fmt.Errorf("ebook-convert not found (Calibre required for %s): %w", kindleFormat, err)
	}

	// Create temp directory for Kindle conversion
	workDir, err := os.MkdirTemp(c.tempDir, "kindle-*")
	if err != nil {
		return nil, fmt.Errorf("failed to create temp work directory: %w", err)
	}
	defer os.RemoveAll(workDir)

	// Determine output path
	outputPath := filepath.Join(workDir, fmt.Sprintf("output.%s", kindleFormat))

	c.logger.Info("converter", fmt.Sprintf("Converting EPUB to %s", kindleFormat), map[string]interface{}{
		"operation":      "kindle_conversion",
		"format":         kindleFormat,
		"epub_file":      epubResult.FilePath,
		"output_file":    outputPath,
		"epub_size":      epubResult.Size,
	})

	// Run ebook-convert: epub -> kindle format
	cmd := exec.CommandContext(ctx, ebookConvertPath,
		epubResult.FilePath,
		outputPath,
	)

	startTime := time.Now()
	output, err := cmd.CombinedOutput()
	duration := time.Since(startTime)

	if err != nil {
		c.logger.Error("converter", fmt.Sprintf("%s conversion failed", kindleFormat), err, map[string]interface{}{
			"error_type":    "kindle_conversion_failed",
			"component":     "converter",
			"operation":      "kindle_conversion",
			"format":        kindleFormat,
			"duration_ms":   duration.Milliseconds(),
			"command_output": string(output),
		})

		return nil, fmt.Errorf("failed to convert EPUB to %s: %w (output: %s)", kindleFormat, err, string(output))
	}

	// Check if output file was created
	info, err := os.Stat(outputPath)
	if err != nil {
		// List files in work directory for debugging
		files, _ := os.ReadDir(workDir)
		fileList := make([]string, 0, len(files))
		for _, f := range files {
			fileList = append(fileList, f.Name())
		}

		c.logger.Error("converter", fmt.Sprintf("%s output file not found", kindleFormat), err, map[string]interface{}{
			"error_type":    "file_operation_error",
			"component":     "converter",
			"operation":      "verify_output",
			"format":        kindleFormat,
			"expected_path": outputPath,
			"work_dir":      workDir,
			"files_in_dir":  fileList,
		})

		return nil, fmt.Errorf("output file not created at %s (files in dir: %v): %w", outputPath, fileList, err)
	}

	if info.Size() == 0 {
		return nil, fmt.Errorf("output file is empty")
	}

	mimeType := getMimeType(kindleFormat)

	c.logger.Info("converter", fmt.Sprintf("%s conversion completed", kindleFormat), map[string]interface{}{
		"operation":    "kindle_conversion",
		"format":       kindleFormat,
		"output_file":  outputPath,
		"output_size":  info.Size(),
		"duration_ms":  duration.Milliseconds(),
		"duration":     duration.String(),
	})

	return &ConvertResult{
		FilePath: outputPath,
		Size:     info.Size(),
		MimeType: mimeType,
	}, nil
}

func findEbookConvert() (string, error) {
	// Check common locations
	paths := []string{
		"/usr/bin/ebook-convert",
		"/usr/local/bin/ebook-convert",
		"ebook-convert", // In PATH
	}

	for _, path := range paths {
		if _, err := os.Stat(path); err == nil {
			// Verify it's executable
			if exec.Command(path, "--version").Run() == nil {
				return path, nil
			}
		}
	}

	// Try to find in PATH
	if path, err := exec.LookPath("ebook-convert"); err == nil {
		return path, nil
	}

	return "", fmt.Errorf("ebook-convert command not found (install Calibre)")
}

func getMimeType(extension string) string {
	switch extension {
	case "epub":
		return "application/epub+zip"
	case "pdf":
		return "application/pdf"
	case "html":
		return "text/html; charset=utf-8"
	case "mobi":
		return "application/x-mobipocket-ebook"
	case "azw3":
		return "application/vnd.amazon.ebook"
	default:
		return "application/octet-stream"
	}
}
