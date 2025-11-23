/**
 * Tests for standalone link detection and rendering
 */

import { describe, it, expect } from 'vitest';
import { isStandaloneLink, extractNostrIdentifier } from '../src/lib/ogUtils';

describe('isStandaloneLink', () => {
  it('should detect standalone link in paragraph', () => {
    const paragraph = document.createElement('p');
    const link = document.createElement('a');
    link.href = 'https://example.com';
    link.textContent = 'https://example.com';
    paragraph.appendChild(link);
    
    expect(isStandaloneLink(link)).toBe(true);
  });

  it('should not detect link in list as standalone', () => {
    const list = document.createElement('ul');
    const listItem = document.createElement('li');
    const link = document.createElement('a');
    link.href = 'https://example.com';
    link.textContent = 'Example';
    listItem.appendChild(link);
    listItem.appendChild(document.createTextNode(' with more text'));
    list.appendChild(listItem);
    
    expect(isStandaloneLink(link)).toBe(false);
  });

  it('should detect standalone link in blockquote', () => {
    const blockquote = document.createElement('blockquote');
    const link = document.createElement('a');
    link.href = 'https://example.com';
    link.textContent = 'https://example.com';
    blockquote.appendChild(link);
    
    expect(isStandaloneLink(link)).toBe(true);
  });

  it('should not detect link with surrounding text as standalone', () => {
    const paragraph = document.createElement('p');
    paragraph.appendChild(document.createTextNode('Check out '));
    const link = document.createElement('a');
    link.href = 'https://example.com';
    link.textContent = 'this link';
    paragraph.appendChild(link);
    paragraph.appendChild(document.createTextNode(' for more info.'));
    
    expect(isStandaloneLink(link)).toBe(false);
  });

  it('should detect link that is most of paragraph content', () => {
    const paragraph = document.createElement('p');
    const link = document.createElement('a');
    link.href = 'https://example.com';
    link.textContent = 'https://example.com';
    paragraph.appendChild(link);
    paragraph.appendChild(document.createTextNode(' ')); // Just whitespace
    
    expect(isStandaloneLink(link)).toBe(true);
  });
});

describe('extractNostrIdentifier', () => {
  it('should extract npub from URL', () => {
    const url = 'https://example.com/nostr:npub1abc123456789012345678901234567890123456789012345678901234567890';
    const result = extractNostrIdentifier(url);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('npub');
    expect(result?.value).toContain('npub1');
  });

  it('should extract nevent from URL', () => {
    const url = 'https://example.com/nostr:nevent1abc123456789012345678901234567890123456789012345678901234567890';
    const result = extractNostrIdentifier(url);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('nevent');
  });

  it('should extract naddr from URL', () => {
    const url = 'https://example.com/nostr:naddr1abc123456789012345678901234567890123456789012345678901234567890';
    const result = extractNostrIdentifier(url);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('naddr');
  });

  it('should extract hex ID from URL', () => {
    const url = 'https://example.com/abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
    const result = extractNostrIdentifier(url);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('note');
  });

  it('should return null for non-Nostr URLs', () => {
    const url = 'https://example.com/article';
    const result = extractNostrIdentifier(url);
    expect(result).toBeNull();
  });

  it('should extract nprofile from URL', () => {
    const url = 'https://example.com/nostr:nprofile1abc123456789012345678901234567890123456789012345678901234567890';
    const result = extractNostrIdentifier(url);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('nprofile');
  });
});

describe('Standalone Link Detection in Profile About', () => {
  it('should detect link on its own line', () => {
    const text = 'https://example.com';
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);
    
    // When split with capturing group, we get ["", "https://example.com", ""]
    // Link is standalone if it's the only non-empty content
    const nonEmptyParts = parts.filter(p => p.trim().length > 0);
    const isStandalone = nonEmptyParts.length === 1 && urlRegex.test(nonEmptyParts[0]);
    expect(isStandalone).toBe(true);
  });

  it('should detect link at start with newline after', () => {
    const text = 'https://example.com\nSome text';
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);
    
    // Find the link index (URLs are at odd indices when split with capturing group)
    let linkIndex = -1;
    for (let i = 0; i < parts.length; i++) {
      if (urlRegex.test(parts[i])) {
        linkIndex = i;
        break;
      }
    }
    
    // Reset regex for next test
    urlRegex.lastIndex = 0;
    
    expect(linkIndex).toBeGreaterThanOrEqual(0);
    const prevPart = linkIndex > 0 ? parts[linkIndex - 1] : '';
    const nextPart = linkIndex < parts.length - 1 ? parts[linkIndex + 1] : '';
    // Link is at start if it's the first part or prev part is empty
    const isStandalone = 
      (linkIndex === 0 || !prevPart || prevPart.trim() === '') &&
      (!nextPart || nextPart.trim() === '' || nextPart.startsWith('\n'));
    expect(isStandalone).toBe(true);
  });

  it('should detect link at end with newline before', () => {
    const text = 'Some text\nhttps://example.com';
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);
    
    // Find the link index (URLs are at odd indices when split with capturing group)
    let linkIndex = -1;
    for (let i = 0; i < parts.length; i++) {
      if (urlRegex.test(parts[i])) {
        linkIndex = i;
        break;
      }
    }
    
    // Reset regex for next test
    urlRegex.lastIndex = 0;
    
    expect(linkIndex).toBeGreaterThanOrEqual(0);
    const prevPart = linkIndex > 0 ? parts[linkIndex - 1] : '';
    const nextPart = linkIndex < parts.length - 1 ? parts[linkIndex + 1] : '';
    // Link is at end if it's the last part or next part is empty
    // prevPart should end with newline or be empty
    const isStandalone = 
      (linkIndex === parts.length - 1 || !nextPart || nextPart.trim() === '') &&
      (!prevPart || prevPart.trim() === '' || prevPart.includes('\n'));
    expect(isStandalone).toBe(true);
  });

  it('should not detect link in middle of text as standalone', () => {
    const text = 'Check out https://example.com for more info';
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);
    
    // Find the link index
    let linkIndex = -1;
    for (let i = 0; i < parts.length; i++) {
      if (urlRegex.test(parts[i])) {
        linkIndex = i;
        break;
      }
    }
    
    expect(linkIndex).toBeGreaterThanOrEqual(0);
    const prevPart = parts[linkIndex - 1];
    const nextPart = parts[linkIndex + 1];
    const isStandalone = 
      parts.length === 1 ||
      (linkIndex === 0 && (!nextPart || nextPart.trim() === '')) ||
      (linkIndex === parts.length - 1 && (!prevPart || prevPart.trim() === '')) ||
      ((!prevPart || prevPart.trim() === '' || prevPart.endsWith('\n')) && 
       (!nextPart || nextPart.trim() === '' || nextPart.startsWith('\n')));
    expect(isStandalone).toBe(false);
  });

  it('should detect link surrounded by newlines as standalone', () => {
    const text = 'Some text\n\nhttps://example.com\n\nMore text';
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);
    
    // Find the link index (URLs are at odd indices when split with capturing group)
    let linkIndex = -1;
    for (let i = 0; i < parts.length; i++) {
      if (urlRegex.test(parts[i])) {
        linkIndex = i;
        break;
      }
    }
    
    // Reset regex for next test
    urlRegex.lastIndex = 0;
    
    expect(linkIndex).toBeGreaterThanOrEqual(0);
    const prevPart = linkIndex > 0 ? parts[linkIndex - 1] : '';
    const nextPart = linkIndex < parts.length - 1 ? parts[linkIndex + 1] : '';
    const isStandalone = 
      (linkIndex === 0 && (!nextPart || nextPart.trim() === '')) ||
      (linkIndex === parts.length - 1 && (!prevPart || prevPart.trim() === '')) ||
      ((!prevPart || prevPart.trim() === '' || prevPart.endsWith('\n')) && 
       (!nextPart || nextPart.trim() === '' || nextPart.startsWith('\n')));
    expect(isStandalone).toBe(true);
  });
});

