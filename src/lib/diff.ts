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
  };
  right: {
    title: string;
    content: string;
    version?: string;
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

/**
 * Simple text diff algorithm
 * Compares two texts and returns changes
 */
export function diffText(left: string, right: string): DiffChange[] {
  const leftLines = left.split('\n');
  const rightLines = right.split('\n');
  const changes: DiffChange[] = [];
  
  const maxLines = Math.max(leftLines.length, rightLines.length);
  
  for (let i = 0; i < maxLines; i++) {
    const leftLine = leftLines[i];
    const rightLine = rightLines[i];
    
    if (leftLine === undefined) {
      // Line added in right
      changes.push({
        type: 'added',
        rightLine: i + 1,
        rightText: rightLine
      });
    } else if (rightLine === undefined) {
      // Line removed from left
      changes.push({
        type: 'removed',
        leftLine: i + 1,
        leftText: leftLine
      });
    } else if (leftLine !== rightLine) {
      // Line modified
      changes.push({
        type: 'modified',
        leftLine: i + 1,
        rightLine: i + 1,
        leftText: leftLine,
        rightText: rightLine
      });
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
