/**
 * Tests for article download ToC functionality
 */

import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostr/tools/pure';

// Mock the download functions - we'll test the ToC generation logic
// This matches the implementation in articleDownload.ts
function generateMarkdownTOC(content: string): string {
  const lines = content.split('\n');
  const headings: Array<{ level: number; text: string; anchor: string }> = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Skip empty lines
    if (trimmed.length === 0) {
      continue;
    }
    
    // Check for Setext headers FIRST (before ATX) - they span two lines
    if (i < lines.length - 1) {
      const nextLine = lines[i + 1].trim();
      
      // Level 1: text followed by === (must be at least 3 = signs)
      if (/^=+$/.test(nextLine) && nextLine.length >= 3) {
        // Make sure current line is not already a header
        if (!trimmed.match(/^#+\s+/) && !trimmed.match(/^=+\s+/)) {
          const text = trimmed;
          const anchor = text
            .toLowerCase()
            .replace(/[^\w\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
          
          headings.push({ level: 1, text, anchor });
          i++; // Skip the underline line
          continue;
        }
      }
      
      // Level 2: text followed by --- (must be at least 3 - signs)
      if (/^-+$/.test(nextLine) && nextLine.length >= 3) {
        // Make sure current line is not already a header
        if (!trimmed.match(/^#+\s+/) && !trimmed.match(/^=+\s+/)) {
          const text = trimmed;
          const anchor = text
            .toLowerCase()
            .replace(/[^\w\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
          
          headings.push({ level: 2, text, anchor });
          i++; // Skip the underline line
          continue;
        }
      }
    }
    
    // Match ATX markdown headings: #, ##, ###, etc.
    const atxMatch = trimmed.match(/^(#+)\s+(.+)$/);
    if (atxMatch) {
      const level = atxMatch[1].length;
      const text = atxMatch[2].trim();
      // Generate anchor from heading text
      const anchor = text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      
      headings.push({ level, text, anchor });
      continue;
    }
  }
  
  if (headings.length === 0) {
    return '';
  }
  
  // Generate TOC with proper indentation
  let toc = '## Table of Contents\n\n';
  for (const heading of headings) {
    const indent = '  '.repeat(heading.level - 1);
    toc += `${indent}- [${heading.text}](#${heading.anchor})\n`;
  }
  toc += '\n';
  
  return toc;
}

describe('Markdown ToC Generation', () => {
  it('should generate ToC from markdown headings', () => {
    const content = `# Main Title

## Section 1
Content here

### Subsection 1.1
More content

## Section 2
Final content`;
    
    const toc = generateMarkdownTOC(content);
    
    expect(toc).toContain('## Table of Contents');
    expect(toc).toContain('- [Main Title](#main-title)');
    expect(toc).toContain('  - [Section 1](#section-1)');
    expect(toc).toContain('    - [Subsection 1.1](#subsection-11)');
    expect(toc).toContain('  - [Section 2](#section-2)');
  });
  
  it('should handle empty content', () => {
    const content = `Just some text
No headings here`;
    
    const toc = generateMarkdownTOC(content);
    expect(toc).toBe('');
  });
  
  it('should generate proper anchors with special characters', () => {
    const content = `# Title with Special Chars! (2024)
## Section: Sub-section
### Subsection #2`;
    
    const toc = generateMarkdownTOC(content);
    
    expect(toc).toContain('[Title with Special Chars! (2024)](#title-with-special-chars-2024)');
    expect(toc).toContain('[Section: Sub-section](#section-sub-section)');
    expect(toc).toContain('[Subsection #2](#subsection-2)');
  });
  
  it('should handle nested headings correctly', () => {
    const content = `# Level 1
## Level 2
### Level 3
#### Level 4
##### Level 5
###### Level 6`;
    
    const toc = generateMarkdownTOC(content);
    
    expect(toc).toContain('- [Level 1](#level-1)');
    expect(toc).toContain('  - [Level 2](#level-2)');
    expect(toc).toContain('    - [Level 3](#level-3)');
    expect(toc).toContain('      - [Level 4](#level-4)');
    expect(toc).toContain('        - [Level 5](#level-5)');
    expect(toc).toContain('          - [Level 6](#level-6)');
  });
  
  it('should handle single heading', () => {
    const content = `# Only One Heading`;
    
    const toc = generateMarkdownTOC(content);
    
    expect(toc).toContain('## Table of Contents');
    expect(toc).toContain('- [Only One Heading](#only-one-heading)');
  });
  
  it('should handle Setext headers with = underlines (level 1)', () => {
    const content = `Main Title
==========
Content here

## Section 2`;
    
    const toc = generateMarkdownTOC(content);
    
    // Main Title is a Setext level 1 header
    expect(toc).toContain('- [Main Title](#main-title)');
    // Section 2 is an ATX level 2 header, so it should be nested under Main Title
    expect(toc).toContain('  - [Section 2](#section-2)');
  });
  
  it('should handle Setext headers with - underlines (level 2)', () => {
    const content = `# Main Title

Subtitle
--------
Content here`;
    
    const toc = generateMarkdownTOC(content);
    
    expect(toc).toContain('- [Main Title](#main-title)');
    expect(toc).toContain('  - [Subtitle](#subtitle)');
  });
  
  it('should handle mixed ATX and Setext headers', () => {
    const content = `Main Title
==========
# ATX Header
## Another ATX

Setext Level 2
--------------
Content`;
    
    const toc = generateMarkdownTOC(content);
    
    // Main Title is Setext level 1
    expect(toc).toContain('- [Main Title](#main-title)');
    // ATX Header is level 1, but comes after Main Title, so it's a sibling at same level
    // Actually, in TOC generation, we just list all headings in order with their levels
    // So ATX Header (level 1) should be at same level as Main Title (level 1)
    expect(toc).toContain('- [ATX Header](#atx-header)');
    // Another ATX is level 2, nested under ATX Header
    expect(toc).toContain('  - [Another ATX](#another-atx)');
    // Setext Level 2 is level 2, so it should be at same level as Another ATX
    expect(toc).toContain('  - [Setext Level 2](#setext-level-2)');
  });
});

