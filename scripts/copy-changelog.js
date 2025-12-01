#!/usr/bin/env node
// Copy CHANGELOG.md to static folder before build
// This script runs from the project root (where package.json is located)

const fs = require('fs');
const path = require('path');

// Get the project root (parent of scripts directory, or current working directory)
// npm scripts always run from the package.json directory, so process.cwd() is the project root
const root = process.cwd();
const staticDir = path.join(root, 'static');
const changelogSrc = path.join(root, 'CHANGELOG.md');
const changelogDest = path.join(staticDir, 'CHANGELOG.md');

try {
  // Ensure static directory exists
  if (!fs.existsSync(staticDir)) {
    fs.mkdirSync(staticDir, { recursive: true });
    console.log(`Created directory: ${staticDir}`);
  }
  
  // Verify source file exists
  if (!fs.existsSync(changelogSrc)) {
    throw new Error(`Source file does not exist: ${changelogSrc}`);
  }
  
  // Copy CHANGELOG.md to static folder
  fs.copyFileSync(changelogSrc, changelogDest);
  console.log('✓ Copied CHANGELOG.md to static folder');
} catch (error) {
  console.error('Failed to copy CHANGELOG.md:', error.message);
  process.exit(1);
}

