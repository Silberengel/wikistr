# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [5.0.0] - 2025-11-24

### Added
- Cache relay system (kind 10432) for local event storage
- Cache browsing and editing module
- CHANGELOG.md for version tracking
- Bookmark functionality (kind 10003)
- Reading place tracking
- PDF theme management system
- Image and author fields in article editor
- JSON editing for events
- Quality control messages in viewers
- Search functionality in all viewers
- Responsive design improvements

### Changed
- Moved version display to bottom of Settings
- Moved relays section up in Settings
- Updated to Svelte 5.43.14
- Updated to SvelteKit 2.49.0
- Improved accessibility (ARIA roles, keyboard navigation)

### Fixed
- EPUB download 500 errors
- LaTeX viewer issues
- Wikilink rendering for book references
- Theme application in PDF/EPUB exports
- Whitespace issues in rendered documents
- Image rendering in exports
- Viewer launch issues

