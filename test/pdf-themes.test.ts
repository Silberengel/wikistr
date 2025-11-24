/**
 * Unit tests for PDF theme configuration and file upload functionality
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  saveCustomThemeConfig,
  saveThemeFile,
  getUploadedThemeFiles,
  deleteThemeFile,
  validateThemeFile,
  clearCustomThemeCache,
  getAvailableThemes,
  getThemeFileContent
} from '../src/lib/pdfThemes';
import { get, set, del, keys } from 'idb-keyval';

// Mock idb-keyval
vi.mock('idb-keyval', () => {
  const store = new Map<string, any>();
  return {
    get: vi.fn((key: string) => Promise.resolve(store.get(key))),
    set: vi.fn((key: string, value: any) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    del: vi.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
    keys: vi.fn(() => Promise.resolve(Array.from(store.keys())))
  };
});

describe('PDF Theme Configuration', () => {
  beforeEach(async () => {
    // Clear all stored data before each test
    const allKeys = await keys();
    for (const key of allKeys) {
      await del(key);
    }
  });

  describe('validateThemeFile', () => {
    it('should validate a valid theme file', () => {
      const validTheme = `extends: default
font:
  catalog:
    Liberation Sans:
      normal: /usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf
base:
  font_size: 12
  line_height: 1.6`;

      const result = validateThemeFile(validTheme);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject invalid YAML', () => {
      const invalidYaml = 'invalid: yaml: content: [';
      const result = validateThemeFile(invalidYaml);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should reject non-theme YAML objects', () => {
      const nonTheme = `name: test
value: 123`;
      const result = validateThemeFile(nonTheme);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('valid AsciiDoctor PDF theme');
    });
  });

  describe('saveThemeFile', () => {
    it('should save a valid theme file', async () => {
      const filename = 'my-theme.yml';
      const content = `extends: default
font:
  catalog:
    Liberation Sans:
      normal: /usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf
base:
  font_size: 12`;

      const result = await saveThemeFile(filename, content);
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();

      const savedContent = await getThemeFileContent(filename);
      expect(savedContent).toBe(content);
    });

    it('should reject files without .yml or .yaml extension', async () => {
      const result = await saveThemeFile('my-theme.txt', 'content');
      expect(result.success).toBe(false);
      expect(result.error).toContain('.yml or .yaml extension');
    });

    it('should reject invalid theme content', async () => {
      const result = await saveThemeFile('my-theme.yml', 'invalid: yaml: [');
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('getUploadedThemeFiles', () => {
    it('should return empty array when no files uploaded', async () => {
      const files = await getUploadedThemeFiles();
      expect(files).toEqual([]);
    });

    it('should return all uploaded theme files', async () => {
      const file1 = { filename: 'theme1.yml', content: 'content1' };
      const file2 = { filename: 'theme2.yml', content: 'content2' };

      await saveThemeFile(file1.filename, file1.content);
      await saveThemeFile(file2.filename, file2.content);

      const files = await getUploadedThemeFiles();
      expect(files.length).toBe(2);
      expect(files).toContainEqual(file1);
      expect(files).toContainEqual(file2);
    });
  });

  describe('deleteThemeFile', () => {
    it('should delete an uploaded theme file', async () => {
      const filename = 'my-theme.yml';
      const content = `extends: default
base:
  font_size: 12`;

      await saveThemeFile(filename, content);
      let files = await getUploadedThemeFiles();
      expect(files.length).toBe(1);

      await deleteThemeFile(filename);
      files = await getUploadedThemeFiles();
      expect(files.length).toBe(0);
    });
  });

  describe('saveCustomThemeConfig', () => {
    it('should save a valid theme configuration', async () => {
      const config = `themes:
  my-theme:
    server_name: my-theme
    description: My custom theme
    file: my-theme.yml
default: my-theme
themes_dir: /app/deployment`;

      const result = await saveCustomThemeConfig(config);
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();

      const themes = await getAvailableThemes();
      expect(themes).toContain('my-theme');
    });

    it('should reject invalid theme configuration', async () => {
      const invalidConfig = `themes:
  my-theme:
    server_name: my-theme
default: my-theme`;

      const result = await saveCustomThemeConfig(invalidConfig);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should reject configuration with missing required fields', async () => {
      const invalidConfig = `themes:
  my-theme:
    server_name: my-theme
    description: Test
    file: my-theme.yml`;

      const result = await saveCustomThemeConfig(invalidConfig);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should reject configuration where default theme does not exist', async () => {
      const invalidConfig = `themes:
  my-theme:
    server_name: my-theme
    description: Test
    file: my-theme.yml
default: non-existent
themes_dir: /app/deployment`;

      const result = await saveCustomThemeConfig(invalidConfig);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('clearCustomThemeCache', () => {
    it('should clear custom theme configuration', async () => {
      const config = `themes:
  my-theme:
    server_name: my-theme
    description: My custom theme
    file: my-theme.yml
default: my-theme
themes_dir: /app/deployment`;

      await saveCustomThemeConfig(config);
      let themes = await getAvailableThemes();
      expect(themes).toContain('my-theme');

      await clearCustomThemeCache();
      // After clearing, should fall back to default file (which may not have my-theme)
      themes = await getAvailableThemes();
      // The exact themes depend on the default file, but my-theme should not be there
      expect(themes).not.toContain('my-theme');
    });
  });

  describe('Multiple theme files', () => {
    it('should handle multiple theme files correctly', async () => {
      const theme1 = `extends: default
base:
  font_size: 12`;
      const theme2 = `extends: default
base:
  font_size: 14`;

      await saveThemeFile('theme1.yml', theme1);
      await saveThemeFile('theme2.yml', theme2);

      const files = await getUploadedThemeFiles();
      expect(files.length).toBe(2);
      expect(files.find(f => f.filename === 'theme1.yml')?.content).toBe(theme1);
      expect(files.find(f => f.filename === 'theme2.yml')?.content).toBe(theme2);
    });

    it('should allow deleting individual theme files', async () => {
      await saveThemeFile('theme1.yml', 'content1');
      await saveThemeFile('theme2.yml', 'content2');
      await saveThemeFile('theme3.yml', 'content3');

      let files = await getUploadedThemeFiles();
      expect(files.length).toBe(3);

      await deleteThemeFile('theme2.yml');
      files = await getUploadedThemeFiles();
      expect(files.length).toBe(2);
      expect(files.find(f => f.filename === 'theme2.yml')).toBeUndefined();
      expect(files.find(f => f.filename === 'theme1.yml')).toBeDefined();
      expect(files.find(f => f.filename === 'theme3.yml')).toBeDefined();
    });
  });

  describe('Theme file content retrieval', () => {
    it('should retrieve theme file content by filename', async () => {
      const filename = 'my-theme.yml';
      const content = `extends: default
base:
  font_size: 12
  line_height: 1.6`;

      await saveThemeFile(filename, content);
      const retrieved = await getThemeFileContent(filename);
      expect(retrieved).toBe(content);
    });

    it('should return null for non-existent theme file', async () => {
      const retrieved = await getThemeFileContent('non-existent.yml');
      expect(retrieved).toBeNull();
    });
  });
});

