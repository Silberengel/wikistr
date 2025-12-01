# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [5.2.0] - 2025-12-01

### Support Quran and Torah with fallback cards

### Fixed
- Cache browser responsive to mobile layout
- Payment methods can be updated
- Cache browser expanded cards always dark-bg/light-txt
- Adjust OpenGraph to display relevant images
- Expand display in the OG fallback cards
- Display placeholder only on each event, not each header


## [5.1.0] - 2025-12-01

### Added
- Console log in Settings modal

### Changed
- Made Download modal logs more explicit
- Made d-tag suppression less strict

### Fixed
- Downloads of all types for all article events should be more stable
- Deep refactor of downloading
- Share button uses correct naddr, regardless of kind
- Made version display in Settings modal more automated

## [5.0.0] - 2025-11-28

### Added
- Cache relay system (kind 10432) for local event storage
- Cache browsing and editing module
- CHANGELOG.md for version tracking
- Bookmark functionality (kind 10003)
- Reading place tracking
- Image and author fields in article editor
- JSON editing for events
- Export of articles and publications
- kind 10133 payto addresses on profile
- Opengraph rendering
- Proxy server

### Changed
- Moved version display to bottom of Settings
- Moved relays section up in Settings
- Updated to Svelte 5.43.14
- Updated to SvelteKit 2.49.0
- Improved accessibility (ARIA roles, keyboard navigation)
- Profiles allow for arrays in website, lightning wallet and NIP-05 fields

### Fixed
- Wikilink rendering for book references
- Article diff has better library
