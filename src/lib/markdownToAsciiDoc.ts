/**
 * Convert Markdown to AsciiDoc format
 * 
 * @param content - The markdown content to convert
 * @param options - Conversion options
 * @param options.convertLevel1ToLevel2 - If true, converts setext level 1 headers to AsciiDoc level 2 (for panel rendering)
 * @param options.allowBlankLinesInSetext - If true, allows blank lines between setext header text and underline
 * @param options.convertTables - If true, converts markdown tables to AsciiDoc tables
 * @param options.convertCodeBlocks - If true, converts markdown code blocks to AsciiDoc source blocks
 * @param options.convertStrikethrough - If true, converts strikethrough syntax
 * @param options.convertBlockquotes - If true, converts markdown blockquotes to AsciiDoc quotes
 * @param options.convertATXHeaders - If true, converts ATX-style headers (# Header) to AsciiDoc headers
 * @returns The converted AsciiDoc content
 */
export function convertMarkdownToAsciiDoc(
  content: string,
  options: {
    convertLevel1ToLevel2?: boolean;
    allowBlankLinesInSetext?: boolean;
    convertTables?: boolean;
    convertCodeBlocks?: boolean;
    convertStrikethrough?: boolean;
    convertBlockquotes?: boolean;
    convertATXHeaders?: boolean;
  } = {}
): string {
  if (!content) return content;

  const {
    convertLevel1ToLevel2 = false,
    allowBlankLinesInSetext = false,
    convertTables = false,
    convertCodeBlocks = false,
    convertStrikethrough = false,
    convertBlockquotes = false,
    convertATXHeaders = false
  } = options;

  let converted = content;

  // Convert setext-style headers FIRST (before ATX headers)
  // Setext headers use underlines: === for h1, --- for h2
  const headerLines = converted.split('\n');
  const processedHeaderLines: string[] = [];

  for (let i = 0; i < headerLines.length; i++) {
    const line = headerLines[i];
    const trimmedLine = line.trim();

    // Skip blank lines - they'll be preserved
    if (trimmedLine === '' && !allowBlankLinesInSetext) {
      processedHeaderLines.push(line);
      continue;
    }

    let foundUnderline = false;
    let underlineLevel = 0;
    let skipCount = 0;

    if (allowBlankLinesInSetext) {
      // Look ahead for setext underline (allowing blank lines in between)
      for (let j = i + 1; j < headerLines.length; j++) {
        const nextLine = headerLines[j];
        const trimmedNext = nextLine.trim();

        // If we hit a blank line, continue looking
        if (trimmedNext === '') {
          skipCount++;
          continue;
        }

        // Check if this line is a setext underline
        if (/^={3,}$/.test(trimmedNext)) {
          // Level 1 header (===)
          foundUnderline = true;
          underlineLevel = 1;
          skipCount++; // Count the underline line
          break;
        } else if (/^-{3,}$/.test(trimmedNext)) {
          // Level 2 header (---)
          foundUnderline = true;
          underlineLevel = 2;
          skipCount++; // Count the underline line
          break;
        } else {
          // Not a blank line or underline, stop looking
          break;
        }
      }
    } else {
      // Simple case: check next line only
      const nextLine = i + 1 < headerLines.length ? headerLines[i + 1] : '';
      if (nextLine && /^={3,}$/.test(nextLine.trim())) {
        foundUnderline = true;
        underlineLevel = 1;
        skipCount = 1;
      } else if (nextLine && /^-{3,}$/.test(nextLine.trim())) {
        foundUnderline = true;
        underlineLevel = 2;
        skipCount = 1;
      }
    }

    if (foundUnderline) {
      // Convert to AsciiDoc header
      let asciiDocLevel = underlineLevel;
      if (convertLevel1ToLevel2 && underlineLevel === 1) {
        // Convert level 1 to level 2 for panel rendering (level 1 is document title in AsciiDoc)
        asciiDocLevel = 2;
      } else if (convertLevel1ToLevel2 && underlineLevel === 2) {
        // Shift level 2 to level 3 to maintain hierarchy
        asciiDocLevel = 3;
      }
      const equals = '='.repeat(asciiDocLevel);
      processedHeaderLines.push(`${equals} ${trimmedLine}`);
      // Skip the blank lines and underline line
      i += skipCount;
    } else {
      processedHeaderLines.push(line);
    }
  }

  converted = processedHeaderLines.join('\n');

  // Convert ATX-style headers: # Title -> = Title, ## Section -> == Section, etc.
  if (convertATXHeaders) {
    converted = converted.replace(/^(#{1,6})\s+(.+)$/gm, (match, hashes, text) => {
      const level = hashes.length;
      const equals = '='.repeat(level);
      return `${equals} ${text}`;
    });
  }

  // Convert blockquotes: group consecutive lines starting with >
  if (convertBlockquotes) {
    const lines = converted.split('\n');
    const processed: string[] = [];
    let inBlockquote = false;
    let blockquoteLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed.startsWith('>')) {
        // Extract the quote text (remove > and optional space)
        const quoteText = trimmed.replace(/^>\s*/, '');
        if (!inBlockquote) {
          // Start new blockquote
          inBlockquote = true;
          blockquoteLines = [quoteText];
        } else {
          // Continue blockquote
          blockquoteLines.push(quoteText);
        }
      } else {
        // Not a blockquote line
        if (inBlockquote) {
          // End current blockquote
          if (blockquoteLines.length > 0) {
            processed.push('[quote]');
            processed.push('____');
            processed.push(...blockquoteLines);
            processed.push('____');
          }
          inBlockquote = false;
          blockquoteLines = [];
        }
        processed.push(line);
      }
    }

    // Handle blockquote at end of content
    if (inBlockquote && blockquoteLines.length > 0) {
      processed.push('[quote]');
      processed.push('____');
      processed.push(...blockquoteLines);
      processed.push('____');
    }

    converted = processed.join('\n');
  }

  // Convert strikethrough: ~~text~~ -> [line-through]#text#
  if (convertStrikethrough) {
    converted = converted.replace(/~~([^~]+)~~/g, '[line-through]#$1#');
  }

  // Convert code blocks: ```lang ... ``` -> [source,lang]
  // Do this BEFORE image/link conversion to protect code blocks
  if (convertCodeBlocks) {
    converted = converted.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
      const langAttr = lang ? `,${lang}` : '';
      return `[source${langAttr}]\n----\n${code.trim()}\n----`;
    });
  }

  // Convert images: ![alt](url) -> image::url[alt]
  // MUST be done BEFORE link conversion to avoid conflicts
  // Handle both with and without alt text: ![alt](url) or ![](url)
  // Also handle images with title: ![alt](url "title")
  converted = converted.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)/g, (match, alt, url, title) => {
    // AsciiDoc image syntax: image::url[alt text,title]
    // If title is provided, include it
    const altText = alt || '';
    const titlePart = title ? `,${title}` : '';
    return `image::${url}[${altText}${titlePart}]`;
  });

  // Also handle reference-style images: ![alt][ref] -> convert to image::url[alt] if we can find the ref
  converted = converted.replace(/!\[([^\]]*)\]\[([^\]]+)\]/g, (match, alt, ref) => {
    // Try to find the reference definition [ref]: url
    const refPattern = new RegExp(`^\\[${ref}\\]:\\s*(.+)$`, 'm');
    const refMatch = converted.match(refPattern);
    if (refMatch && refMatch[1]) {
      const url = refMatch[1].trim();
      return `image::${url}[${alt || ''}]`;
    }
    // If reference not found, keep the original (will be handled by AsciiDoctor)
    return match;
  });

  // Convert links: [text](url) -> link:url[text]
  // Must come AFTER image conversion to avoid matching ![alt](url) patterns
  converted = converted.replace(/(?<!!)\[([^\]]+)\]\(([^)]+)\)/g, 'link:$2[$1]');

  // Convert tables: | col1 | col2 | -> [cols="2,1,1,3"]
  if (convertTables) {
    const lines = converted.split('\n');
    const result: string[] = [];
    let inTable = false;
    let tableLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isTableRow = /^\s*\|[^|]*\|/.test(line);

      if (isTableRow) {
        if (!inTable) {
          inTable = true;
          tableLines = [];
        }
        tableLines.push(line);
      } else {
        // Process accumulated table if we were in one
        if (inTable && tableLines.length >= 2) {
          // Find separator row
          let separatorIndex = -1;
          for (let j = 0; j < tableLines.length; j++) {
            const cells = tableLines[j].split('|').map(c => c.trim()).filter(c => c.length > 0);
            if (cells.length > 0 && cells.every(cell => /^-+$/.test(cell))) {
              separatorIndex = j;
              break;
            }
          }

          if (separatorIndex !== -1) {
            // Valid table - convert it
            const firstRow = tableLines[0];
            const colCount = (firstRow.match(/\|/g) || []).length - 1;

            if (colCount >= 2) {
              // Use flexible column widths
              let colSpec = '';
              if (colCount === 4) {
                colSpec = '2*,1*,1*,3*'; // Name, Kind, d-tag, Tags
              } else if (colCount === 3) {
                colSpec = '2*,1*,2*';
              } else if (colCount === 2) {
                colSpec = '1*,2*';
              } else {
                colSpec = '1*,'.repeat(colCount).slice(0, -1);
              }

              let asciidocTable = `[cols="${colSpec}",options="header"]\n|===\n`;

              tableLines.forEach((row, index) => {
                // Skip separator rows
                const cells = row.split('|').map(c => c.trim()).filter(c => c.length > 0);
                if (cells.length > 0 && cells.every(cell => /^-+$/.test(cell))) {
                  return;
                }

                // Parse cells properly
                const allCells = row.split('|');
                const parsedCells = allCells.slice(1, -1).map(c => c.trim());

                // Build the row
                let rowContent = '';
                parsedCells.forEach(cell => {
                  if (index < separatorIndex) {
                    rowContent += `|*${cell}*`;
                  } else {
                    rowContent += `|${cell}`;
                  }
                });
                asciidocTable += rowContent + '\n';
              });

              asciidocTable += '|===';
              result.push(asciidocTable);
            } else {
              // Invalid table, keep original
              result.push(...tableLines);
            }
          } else {
            // No separator, keep original
            result.push(...tableLines);
          }

          inTable = false;
          tableLines = [];
        }

        result.push(line);
      }
    }

    // Handle table at end of document
    if (inTable && tableLines.length >= 2) {
      // Same processing as above
      let separatorIndex = -1;
      for (let j = 0; j < tableLines.length; j++) {
        const cells = tableLines[j].split('|').map(c => c.trim()).filter(c => c.length > 0);
        if (cells.length > 0 && cells.every(cell => /^-+$/.test(cell))) {
          separatorIndex = j;
          break;
        }
      }

      if (separatorIndex !== -1) {
        const firstRow = tableLines[0];
        const colCount = (firstRow.match(/\|/g) || []).length - 1;

        if (colCount >= 2) {
          let colSpec = '';
          if (colCount === 4) {
            colSpec = '2*,1*,1*,3*';
          } else if (colCount === 3) {
            colSpec = '2*,1*,2*';
          } else if (colCount === 2) {
            colSpec = '1*,2*';
          } else {
            colSpec = '1*,'.repeat(colCount).slice(0, -1);
          }

          let asciidocTable = `[cols="${colSpec}",options="header"]\n|===\n`;

          tableLines.forEach((row, index) => {
            const cells = row.split('|').map(c => c.trim()).filter(c => c.length > 0);
            if (cells.length > 0 && cells.every(cell => /^-+$/.test(cell))) {
              return;
            }

            const allCells = row.split('|');
            const parsedCells = allCells.slice(1, -1).map(c => c.trim());

            let rowContent = '';
            parsedCells.forEach(cell => {
              if (index < separatorIndex) {
                rowContent += `|*${cell}*`;
              } else {
                rowContent += `|${cell}`;
              }
            });
            asciidocTable += rowContent + '\n';
          });

          asciidocTable += '|===';
          result.push(asciidocTable);
        } else {
          result.push(...tableLines);
        }
      } else {
        result.push(...tableLines);
      }
    }

    converted = result.join('\n');
  }

  // Convert bold: **text** -> *text* (must be done before italic to avoid conflicts)
  // Match **text** but not ***text*** (which is bold+italic)
  converted = converted.replace(/\*\*([^*]+)\*\*/g, '*$1*');

  // Convert italic: *text* -> _text_ (but not if it's part of **text** which we just converted)
  // Match single asterisks that aren't preceded or followed by another asterisk
  converted = converted.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '_$1_');

  return converted;
}

