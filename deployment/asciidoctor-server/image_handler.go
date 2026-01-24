package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const (
	// ImageHandlerTimeout is the timeout for downloading images
	ImageHandlerTimeout = 30 * time.Second
)

// ImageHandler handles downloading and embedding images
type ImageHandler struct {
	logger   *Logger
	workDir  string
	client   *http.Client
	images   map[string]string // remote URL -> local filename
	imageDir string
}

func NewImageHandler(logger *Logger, workDir string) *ImageHandler {
	return &ImageHandler{
		logger:  logger,
		workDir: workDir,
		client: &http.Client{
			Timeout: ImageHandlerTimeout,
		},
		images: make(map[string]string),
	}
}

// ProcessImagesForHTML scans content for images and downloads remote ones temporarily for HTML embedding
// Does NOT modify the AsciiDoc content - keeps remote URLs as-is
// Images are downloaded to temp files, embedded as base64, then deleted
func (ih *ImageHandler) ProcessImagesForHTML(ctx context.Context, content string) error {
	// Create images directory (temporary, will be cleaned up)
	ih.imageDir = filepath.Join(ih.workDir, "images")
	if err := os.MkdirAll(ih.imageDir, FileModeDir); err != nil {
		return fmt.Errorf("failed to create images directory: %w", err)
	}

	// Find all image URLs in content
	imageURLs := ih.findImageURLs(content)
	coverImageURLs := ih.findCoverImageURLs(content)
	allURLs := append(imageURLs, coverImageURLs...)

	if len(allURLs) == 0 {
		ih.logger.Debug("image_handler", "No images found in content", nil)
		return nil
	}

	ih.logger.Info("image_handler", "Found images in content (will download temporarily for embedding)", map[string]interface{}{
		"total_images":     len(allURLs),
		"regular_images":   len(imageURLs),
		"cover_images":    len(coverImageURLs),
		"note":            "Images downloaded temporarily, will be deleted after embedding",
	})

	// Download remote images temporarily (for base64 embedding only)
	for _, url := range allURLs {
		if ih.isRemoteURL(url) {
			if err := ih.downloadImage(ctx, url); err != nil {
				ih.logger.Warn("image_handler", "Failed to download image", map[string]interface{}{
					"url":   url,
					"error": err.Error(),
				})
				// Continue with other images even if one fails
			}
		}
	}

	// Note: We do NOT modify the AsciiDoc content - remote URLs stay as-is
	// Images are only downloaded temporarily for base64 embedding in HTML output
	return nil
}

// EmbedImagesAsBase64 embeds downloaded images as base64 data URIs in HTML
func (ih *ImageHandler) EmbedImagesAsBase64(htmlContent string) string {
	if len(ih.images) == 0 {
		return htmlContent
	}

	ih.logger.Info("image_handler", "Embedding images as base64 data URIs", map[string]interface{}{
		"image_count": len(ih.images),
	})

	updatedHTML := htmlContent
	for remoteURL, localFilename := range ih.images {
		localPath := filepath.Join(ih.imageDir, localFilename)
		
		// Read image file
		imageData, err := os.ReadFile(localPath)
		if err != nil {
			ih.logger.Warn("image_handler", "Failed to read image for embedding", map[string]interface{}{
				"local_path": localPath,
				"error":      err.Error(),
			})
			continue
		}

		// Determine MIME type
		mimeType := ih.getMimeType(localFilename)
		
		// Encode as base64
		base64Data := base64.StdEncoding.EncodeToString(imageData)
		dataURI := fmt.Sprintf("data:%s;base64,%s", mimeType, base64Data)

	// Replace in HTML - match the remote URL in src attributes
	// Asciidoctor will have converted image::URL to <img src="URL">, so we match the URL
	// Also match local filename in case asciidoctor processed it differently
	patterns := []string{
		regexp.QuoteMeta(remoteURL),
		regexp.QuoteMeta(localFilename),
		// Also match just the filename part (in case path was modified)
		regexp.QuoteMeta(filepath.Base(remoteURL)),
	}

	for _, pattern := range patterns {
		// Match src="URL" or src='URL' and replace with data URI
		re := regexp.MustCompile(fmt.Sprintf(`src=["']([^"']*%s[^"']*)["']`, pattern))
		updatedHTML = re.ReplaceAllStringFunc(updatedHTML, func(match string) string {
			// Replace the entire src attribute value with data URI
			return fmt.Sprintf(`src="%s"`, dataURI)
		})
	}

		ih.logger.Debug("image_handler", "Embedded image", map[string]interface{}{
			"filename": localFilename,
			"size":     len(imageData),
			"mime_type": mimeType,
		})
	}

	return updatedHTML
}

// AddCoverImageToHTML adds cover image to HTML if present
func (ih *ImageHandler) AddCoverImageToHTML(htmlContent, content string) string {
	// Extract cover image from content
	coverImagePath := ih.extractCoverImage(content)
	if coverImagePath == "" {
		return htmlContent
	}

	ih.logger.Info("image_handler", "Found cover image", map[string]interface{}{
		"cover_image_path": coverImagePath,
	})

	// Check if we downloaded this image
	var localFilename string
	for _, filename := range ih.images {
		if filename == filepath.Base(coverImagePath) || strings.Contains(coverImagePath, filename) {
			localFilename = filename
			break
		}
	}

	if localFilename == "" {
		// Cover image not downloaded, use path as-is
		return ih.insertCoverImageHTML(htmlContent, coverImagePath, "")
	}

	// Read and embed cover image
	localPath := filepath.Join(ih.imageDir, localFilename)
	imageData, err := os.ReadFile(localPath)
	if err != nil {
		ih.logger.Warn("image_handler", "Failed to read cover image", map[string]interface{}{
			"local_path": localPath,
			"error":      err.Error(),
		})
		return ih.insertCoverImageHTML(htmlContent, coverImagePath, "")
	}

	mimeType := ih.getMimeType(localFilename)
	base64Data := base64.StdEncoding.EncodeToString(imageData)
	dataURI := fmt.Sprintf("data:%s;base64,%s", mimeType, base64Data)

	ih.logger.Info("image_handler", "Cover image embedded as base64", map[string]interface{}{
		"filename": localFilename,
		"size":     len(imageData),
	})

	return ih.insertCoverImageHTML(htmlContent, "", dataURI)
}

func (ih *ImageHandler) findImageURLs(content string) []string {
	var urls []string
	
	// Match image::url or image:url
	re := regexp.MustCompile(`image::?([^\s\[\]]+)`)
	matches := re.FindAllStringSubmatch(content, -1)
	for _, match := range matches {
		if len(match) > 1 {
			urls = append(urls, strings.TrimSpace(match[1]))
		}
	}

	// Also match image::url[attributes]
	re2 := regexp.MustCompile(`image::?([^\[]+)\[`)
	matches2 := re2.FindAllStringSubmatch(content, -1)
	for _, match := range matches2 {
		if len(match) > 1 {
			url := strings.TrimSpace(match[1])
			if url != "" {
				urls = append(urls, url)
			}
		}
	}

	// Remove duplicates
	seen := make(map[string]bool)
	var unique []string
	for _, url := range urls {
		if !seen[url] {
			seen[url] = true
			unique = append(unique, url)
		}
	}

	return unique
}

func (ih *ImageHandler) findCoverImageURLs(content string) []string {
	var urls []string
	
	// Match :front-cover-image: or :epub-cover-image:
	re := regexp.MustCompile(`^:(?:front-cover-image|epub-cover-image):\s*(.+)$`)
	matches := re.FindAllStringSubmatch(content, -1)
	for _, match := range matches {
		if len(match) > 1 {
			urls = append(urls, strings.TrimSpace(match[1]))
		}
	}

	return urls
}

func (ih *ImageHandler) extractCoverImage(content string) string {
	re := regexp.MustCompile(`^:front-cover-image:\s*(.+)$`)
	match := re.FindStringSubmatch(content)
	if len(match) > 1 {
		return strings.TrimSpace(match[1])
	}
	return ""
}

func (ih *ImageHandler) isRemoteURL(url string) bool {
	return strings.HasPrefix(url, "http://") || strings.HasPrefix(url, "https://")
}

func (ih *ImageHandler) downloadImage(ctx context.Context, url string) error {
	ih.logger.Info("image_handler", "Downloading image", map[string]interface{}{
		"url": url,
	})

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := ih.client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to download: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	// Determine filename
	filename := ih.getFilenameFromURL(url, resp)
	localPath := filepath.Join(ih.imageDir, filename)

	// Save file
	file, err := os.Create(localPath)
	if err != nil {
		return fmt.Errorf("failed to create file: %w", err)
	}
	defer file.Close()

	if _, err := io.Copy(file, resp.Body); err != nil {
		return fmt.Errorf("failed to write file: %w", err)
	}

	// Store mapping
	ih.images[url] = filename

	info, _ := os.Stat(localPath)
	ih.logger.Info("image_handler", "Image downloaded successfully", map[string]interface{}{
		"url":        url,
		"filename":   filename,
		"local_path": localPath,
		"size":       info.Size(),
	})

	return nil
}

func (ih *ImageHandler) getFilenameFromURL(url string, resp *http.Response) string {
	// Try to get filename from URL
	if filename := filepath.Base(url); filename != "" && filepath.Ext(filename) != "" {
		return filename
	}

	// Try Content-Disposition header
	if cd := resp.Header.Get("Content-Disposition"); cd != "" {
		re := regexp.MustCompile(`filename="?([^"]+)"?`)
		if match := re.FindStringSubmatch(cd); len(match) > 1 {
			return match[1]
		}
	}

	// Try Content-Type to determine extension
	contentType := resp.Header.Get("Content-Type")
	ext := ".jpg" // default
	if strings.Contains(contentType, "png") {
		ext = ".png"
	} else if strings.Contains(contentType, "gif") {
		ext = ".gif"
	} else if strings.Contains(contentType, "svg") {
		ext = ".svg"
	} else if strings.Contains(contentType, "webp") {
		ext = ".webp"
	}

	// Generate filename from URL hash
	return fmt.Sprintf("image_%d%s", len(url), ext)
}

// Cleanup removes all downloaded image files
func (ih *ImageHandler) Cleanup() {
	if ih.imageDir != "" {
		os.RemoveAll(ih.imageDir)
		ih.logger.Debug("image_handler", "Cleaned up temporary image files", map[string]interface{}{
			"image_dir": ih.imageDir,
		})
	}
}

func (ih *ImageHandler) getMimeType(filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))
	switch ext {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".svg":
		return "image/svg+xml"
	case ".webp":
		return "image/webp"
	default:
		return "image/jpeg"
	}
}

func (ih *ImageHandler) insertCoverImageHTML(htmlContent, imagePath, dataURI string) string {
	var imgTag string
	if dataURI != "" {
		imgTag = fmt.Sprintf(`<div style="text-align: center; margin: 2em 0;"><img src="%s" alt="Cover Image" style="max-width: 100%%; height: auto; max-width: 500px;"></div>`, dataURI)
	} else if imagePath != "" {
		imgTag = fmt.Sprintf(`<div style="text-align: center; margin: 2em 0;"><img src="%s" alt="Cover Image" style="max-width: 100%%; height: auto; max-width: 500px;"></div>`, imagePath)
	} else {
		return htmlContent
	}

	// Insert after <body> tag
	if strings.Contains(htmlContent, "<body>") {
		return strings.Replace(htmlContent, "<body>", "<body>\n"+imgTag, 1)
	} else if strings.Contains(htmlContent, "<body") {
		re := regexp.MustCompile(`<body[^>]*>`)
		return re.ReplaceAllStringFunc(htmlContent, func(match string) string {
			return match + "\n" + imgTag
		})
	} else {
		// No body tag, prepend
		return imgTag + "\n" + htmlContent
	}
}
