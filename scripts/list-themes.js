#!/usr/bin/env node

/**
 * Script to list all available themes
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const themesDir = path.join(__dirname, '../src/lib/themes');

// Read all YAML files in the themes directory
const themeFiles = fs.readdirSync(themesDir)
  .filter(file => file.endsWith('.yml'))
  .map(file => file.replace('.yml', ''))
  .sort();

console.log('🎨 Available Wikistr themes:');
themeFiles.forEach(theme => {
  console.log(`  • ${theme}`);
});

console.log(`\n📁 Themes directory: ${themesDir}`);
console.log(`📊 Total themes: ${themeFiles.length}`);
