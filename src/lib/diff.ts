/**
 * Diff functionality for WikiStr
 * Handles comparing Bible versions, wiki articles, and other content
 */

export interface DiffResult {
  type: 'bible' | 'wiki' | 'article';
  left: {
    title: string;
    content: string;
    version?: string;
    pubkey?: string;
  };
  right: {
    title: string;
    content: string;
    version?: string;
    pubkey?: string;
  };
  changes: DiffChange[];
}

export interface DiffChange {
  type: 'added' | 'removed' | 'modified';
  leftLine?: number;
  rightLine?: number;
  leftText?: string;
  rightText?: string;
}

/**
 * Parse diff query from search bar
 * Examples:
 * - "diff::John 3:16 KJV | NIV" (Bible versions)
 * - "diff::bible:John 3:16 | KJV NIV" (Bible with multiple versions)
 * - "diff::article1 | article2" (Wiki d-tags)
 * - "diff::article1 | 'Some Title'" (d-tag vs title search)
 * - "diff::article1; article2; article3" (Multiple d-tags)
 */
export function parseDiffQuery(query: string): { 
  type: 'bible' | 'wiki' | 'mixed';
  left: string; 
  right: string;
  items?: string[]; // For multiple items
} | null {
  if (!query.startsWith('diff::')) {
    return null;
  }

  const content = query.substring(6).trim();
  
  // Handle Bible diff queries
  if (content.startsWith('bible:') || content.includes('KJV') || content.includes('NIV') || content.includes('ESV')) {
    if (content.includes(' | ')) {
      const [left, right] = content.split(' | ').map(s => s.trim());
      return { type: 'bible', left, right };
    }
    return { type: 'bible', left: content, right: content };
  }
  
  // Handle pipe separation (most common)
  if (content.includes(' | ')) {
    const [left, right] = content.split(' | ').map(s => s.trim());
    return { type: 'wiki', left, right };
  }
  
  // Handle semicolon separation (multiple items)
  if (content.includes(';')) {
    const items = content.split(';').map(s => s.trim()).filter(s => s.length > 0);
    if (items.length >= 2) {
      return { 
        type: 'wiki', 
        left: items[0], 
        right: items[1],
        items: items.slice(2) // Additional items for multi-way diff
      };
    }
  }
  
  // Single item - could be d-tag or title
  return { type: 'wiki', left: content, right: content };
}

/**
 * Check if a query is a diff query
 */
export function isDiffQuery(query: string): boolean {
  return query.startsWith('diff::');
}

import { diffLines, type Change } from 'diff';

/**
 * Simple text diff algorithm using the 'diff' library
 * Compares two texts and returns changes
 */
export function diffText(left: string, right: string): DiffChange[] {
  const changes: DiffChange[] = [];
  const lineDiffs = diffLines(left, right);
  
  let leftLineNum = 1;
  let rightLineNum = 1;
  
  for (const part of lineDiffs) {
    const lines = part.value.split('\n');
    // Remove the last empty line if the string ends with \n
    if (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }
    
    if (part.added) {
      // Lines added in right
      for (const line of lines) {
        if (line !== '') {
          changes.push({
            type: 'added',
            rightLine: rightLineNum,
            rightText: line
          });
        }
        rightLineNum++;
      }
    } else if (part.removed) {
      // Lines removed from left
      for (const line of lines) {
        if (line !== '') {
          changes.push({
            type: 'removed',
            leftLine: leftLineNum,
            leftText: line
          });
        }
        leftLineNum++;
      }
    } else {
      // Unchanged lines - just advance line numbers
      leftLineNum += lines.length;
      rightLineNum += lines.length;
    }
  }
  
  return changes;
}

/**
 * Generate diff title
 */
export function generateDiffTitle(left: string, right: string): string {
  return `Diff: ${left} vs ${right}`;
}

/**
 * Format diff change for display
 */
export function formatDiffChange(change: DiffChange): string {
  switch (change.type) {
    case 'added':
      return `+${change.rightLine}: ${change.rightText}`;
    case 'removed':
      return `-${change.leftLine}: ${change.leftText}`;
    case 'modified':
      return `~${change.leftLine}: ${change.leftText} → ${change.rightText}`;
    default:
      return '';
  }
}
