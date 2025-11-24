/**
 * PDF Theme Configuration
 * Loads theme mappings from pdf-themes.yml
 * Supports custom themes via cache (stored in IndexedDB)
 * Cache takes precedence over the default file
 * Also supports uploading custom theme files (.yml) that are sent to the server
 */

import yaml from 'js-yaml';
import { get, set, del, keys } from 'idb-keyval';

export interface ThemeDefinition {
  server_name: string;
  description: string;
  file: string;
}

export interface ThemeConfig {
  themes: Record<string, ThemeDefinition>;
  default: string;
  themes_dir: string;
}

const CACHE_KEY = 'pdf-themes-config';
const CACHE_TIMESTAMP_KEY = 'pdf-themes-config-timestamp';
const THEME_FILE_PREFIX = 'pdf-theme-file-';

let themeConfig: ThemeConfig | null = null;
let loadingPromise: Promise<ThemeConfig> | null = null;

/**
 * Validate theme configuration structure
 */
function validateThemeConfig(config: any): config is ThemeConfig {
  if (!config || typeof config !== 'object') {
    return false;
  }

  // Check required top-level properties
  if (typeof config.default !== 'string' || !config.default) {
    return false;
  }

  if (typeof config.themes_dir !== 'string' || !config.themes_dir) {
    return false;
  }

  // Check themes object
  if (!config.themes || typeof config.themes !== 'object') {
    return false;
  }

  // Validate each theme
  for (const [key, theme] of Object.entries(config.themes)) {
    if (!theme || typeof theme !== 'object') {
      return false;
    }

    const themeDef = theme as any;
    if (typeof themeDef.server_name !== 'string' || !themeDef.server_name) {
      return false;
    }

    if (typeof themeDef.description !== 'string') {
      return false;
    }

    if (typeof themeDef.file !== 'string' || !themeDef.file) {
      return false;
    }
  }

  // Check that default theme exists
  if (!config.themes[config.default]) {
    return false;
  }

  return true;
}

/**
 * Validate theme file structure (AsciiDoctor theme YAML)
 */
export function validateThemeFile(yamlText: string): { valid: boolean; error?: string } {
  try {
    const parsed = yaml.load(yamlText) as any;
    
    // Basic structure check - theme files should be objects
    if (!parsed || typeof parsed !== 'object') {
      return { valid: false, error: 'Theme file must be a valid YAML object' };
    }

    // Check for common theme file properties (at least one should exist)
    const hasValidStructure = 
      parsed.font !== undefined ||
      parsed.base !== undefined ||
      parsed.page !== undefined ||
      parsed.heading !== undefined ||
      parsed.extends !== undefined;

    if (!hasValidStructure) {
      return { valid: false, error: 'Theme file does not appear to be a valid AsciiDoctor PDF theme. Expected properties like font, base, page, heading, or extends.' };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Failed to parse YAML'
    };
  }
}

/**
 * Save a custom theme file
 */
export async function saveThemeFile(filename: string, content: string): Promise<{ success: boolean; error?: string }> {
  // Validate filename
  if (!filename || !filename.endsWith('.yml') && !filename.endsWith('.yaml')) {
    return { success: false, error: 'Theme file must have .yml or .yaml extension' };
  }

  // Validate content
  const validation = validateThemeFile(content);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  try {
    const key = `${THEME_FILE_PREFIX}${filename}`;
    await set(key, content);
    console.log(`[pdfThemes] Saved theme file: ${filename}`);
    return { success: true };
  } catch (error) {
    console.error('[pdfThemes] Failed to save theme file:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save theme file'
    };
  }
}

/**
 * Get all uploaded theme files
 */
export async function getUploadedThemeFiles(): Promise<Array<{ filename: string; content: string }>> {
  try {
    const allKeys = await keys();
    const themeFileKeys = allKeys.filter(key => 
      typeof key === 'string' && key.startsWith(THEME_FILE_PREFIX)
    ) as string[];

    const files = await Promise.all(
      themeFileKeys.map(async (key) => {
        const filename = key.replace(THEME_FILE_PREFIX, '');
        const content = await get<string>(key);
        return { filename, content: content || '' };
      })
    );

    return files;
  } catch (error) {
    console.error('[pdfThemes] Failed to get uploaded theme files:', error);
    return [];
  }
}

/**
 * Delete a theme file
 */
export async function deleteThemeFile(filename: string): Promise<void> {
  const key = `${THEME_FILE_PREFIX}${filename}`;
  await del(key);
  console.log(`[pdfThemes] Deleted theme file: ${filename}`);
}

/**
 * Get theme file content by filename
 */
export async function getThemeFileContent(filename: string): Promise<string | null> {
  const key = `${THEME_FILE_PREFIX}${filename}`;
  return await get<string>(key) || null;
}

/**
 * Load theme configuration from cache or file
 * Cache takes precedence - only uses file if cache is empty
 */
async function loadThemeConfig(): Promise<ThemeConfig> {
  if (themeConfig) {
    return themeConfig;
  }

  // If already loading, return the existing promise
  if (loadingPromise) {
    return loadingPromise;
  }

  loadingPromise = (async () => {
    try {
      // First, try to load from cache (custom theme)
      const cachedConfig = await get<ThemeConfig>(CACHE_KEY);
      const cachedTimestamp = await get<number>(CACHE_TIMESTAMP_KEY);

      if (cachedConfig && cachedTimestamp && validateThemeConfig(cachedConfig)) {
        // Use cached config (newest one)
        themeConfig = cachedConfig;
        console.log('[pdfThemes] Loaded theme config from cache');
        return themeConfig;
      }

      // Fall back to loading from file
      const response = await fetch('/pdf-themes.yml');
      if (!response.ok) {
        throw new Error(`Failed to fetch pdf-themes.yml: ${response.statusText}`);
      }

      const yamlText = await response.text();
      const parsed = yaml.load(yamlText) as any;

      if (!validateThemeConfig(parsed)) {
        throw new Error('Invalid theme configuration structure in pdf-themes.yml');
      }

      themeConfig = parsed;
      console.log('[pdfThemes] Loaded theme config from file');
      return themeConfig;
    } catch (error) {
      console.error('[pdfThemes] Failed to load theme config:', error);
      // Return a minimal valid config to prevent crashes
      themeConfig = {
        themes: {
          classic: {
            server_name: 'classic-novel',
            description: 'Classic novel style with traditional typography',
            file: 'classic-novel-theme.yml'
          }
        },
        default: 'classic',
        themes_dir: '/app/deployment'
      };
      return themeConfig;
    } finally {
      loadingPromise = null;
    }
  })();

  return loadingPromise;
}

/**
 * Save custom theme configuration to cache
 * @param yamlText The YAML text to parse and save
 * @returns true if successful, false if validation failed
 */
export async function saveCustomThemeConfig(yamlText: string): Promise<{ success: boolean; error?: string }> {
  try {
    // Parse YAML
    const parsed = yaml.load(yamlText) as any;

    // Validate structure
    if (!validateThemeConfig(parsed)) {
      return {
        success: false,
        error: 'Invalid theme configuration structure. Required fields: themes (object), default (string), themes_dir (string). Each theme must have server_name, description, and file.'
      };
    }

    // Save to cache with timestamp
    await set(CACHE_KEY, parsed);
    await set(CACHE_TIMESTAMP_KEY, Date.now());

    // Clear cached config to force reload
    themeConfig = null;

    console.log('[pdfThemes] Saved custom theme config to cache');
    return { success: true };
  } catch (error) {
    console.error('[pdfThemes] Failed to save custom theme config:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to parse YAML'
    };
  }
}

/**
 * Clear custom theme cache and reload from file
 */
export async function clearCustomThemeCache(): Promise<void> {
  await del(CACHE_KEY);
  await del(CACHE_TIMESTAMP_KEY);
  themeConfig = null;
  console.log('[pdfThemes] Cleared custom theme cache');
}

/**
 * Get the server-side theme name for a client-side theme name
 */
export async function getServerThemeName(clientTheme: string): Promise<string> {
  const config = await loadThemeConfig();
  const theme = config.themes[clientTheme];
  return theme ? theme.server_name : config.themes[config.default].server_name;
}

/**
 * Get all available theme names
 */
export async function getAvailableThemes(): Promise<string[]> {
  const config = await loadThemeConfig();
  return Object.keys(config.themes);
}

/**
 * Get theme definition
 */
export async function getThemeDefinition(themeName: string): Promise<ThemeDefinition | null> {
  const config = await loadThemeConfig();
  return config.themes[themeName] || null;
}

/**
 * Get theme map as a Record for backward compatibility
 */
export async function getThemeMap(): Promise<Record<string, string>> {
  const config = await loadThemeConfig();
  const map: Record<string, string> = {};
  for (const [key, value] of Object.entries(config.themes)) {
    map[key] = value.server_name;
  }
  return map;
}

/**
 * Get default theme name
 */
export async function getDefaultTheme(): Promise<string> {
  const config = await loadThemeConfig();
  return config.default;
}

/**
 * Synchronous version for backward compatibility (loads from cache if available)
 * Note: This may return a stale config if async loading hasn't completed
 */
export function getServerThemeNameSync(clientTheme: string): string {
  if (!themeConfig) {
    // Try to load synchronously from cache (this is a best-effort)
    // In practice, callers should use the async version
    console.warn('[pdfThemes] getServerThemeNameSync called before config loaded, using fallback');
    return 'classic-novel';
  }
  const theme = themeConfig.themes[clientTheme];
  return theme ? theme.server_name : themeConfig.themes[themeConfig.default].server_name;
}

export function getThemeMapSync(): Record<string, string> {
  if (!themeConfig) {
    console.warn('[pdfThemes] getThemeMapSync called before config loaded, using fallback');
    return { classic: 'classic-novel' };
  }
  const map: Record<string, string> = {};
  for (const [key, value] of Object.entries(themeConfig.themes)) {
    map[key] = value.server_name;
  }
  return map;
}
