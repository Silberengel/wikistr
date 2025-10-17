import yaml from 'js-yaml';

// Dynamic theme type - will be determined by available theme files
export type ThemeType = string;

export interface ThemeConfig {
  name: string;
  title: string;
  tagline: string;
  description: string;
  accentColor: string;
  defaultMode: 'light' | 'dark';
  readingDirection: 'ltr' | 'rtl';
  relays: {
    wiki: string[];
    social: string[];
  };
  showBibleLinks: boolean;
  searchHelpText: string;
  typography: {
    fontFamily: string;
    fontFamilyHeading: string;
    fontFamilyMono: string;
  };
}

// Dynamic theme discovery and loading
// Themes are automatically discovered from the themes/ folder
// To add a new theme, simply create a new YAML file in src/lib/themes/
// No TypeScript code changes required!

// Dynamically import all YAML files from the themes folder
const themeModules = import.meta.glob('./themes/*.yml', { query: '?raw', import: 'default', eager: true });

// Extract theme names from file paths
const availableThemes = Object.keys(themeModules)
  .map(path => path.replace('./themes/', '').replace('.yml', ''))
  .sort();

// Log discovered themes
console.log(`🎨 Wikistr themes discovered: ${availableThemes.join(', ')}`);

// Theme configurations mapping
const themeConfigs: Record<string, string> = {};
Object.entries(themeModules).forEach(([path, content]) => {
  const themeName = path.replace('./themes/', '').replace('.yml', '');
  themeConfigs[themeName] = content as string;
});

// Cache for loaded themes
const themeCache = new Map<ThemeType, ThemeConfig>();

// Load theme configuration from YAML
function loadTheme(themeType: ThemeType): ThemeConfig {
  if (themeCache.has(themeType)) {
    return themeCache.get(themeType)!;
  }

  if (!availableThemes.includes(themeType)) {
    console.warn(`Theme '${themeType}' not found, falling back to 'wikistr'`);
    themeType = 'wikistr';
  }

  try {
    const config = yaml.load(themeConfigs[themeType]) as ThemeConfig;
    themeCache.set(themeType, config);
    return config;
  } catch (error) {
    console.error(`Failed to load theme '${themeType}':`, error);
    // Fallback to wikistr
    const config = yaml.load(themeConfigs['wikistr']) as ThemeConfig;
    themeCache.set(themeType, config);
    return config;
  }
}

// Get all available themes
export function getAvailableThemes(): ThemeType[] {
  return [...availableThemes];
}

// Check if a theme exists
export function isThemeAvailable(themeType: ThemeType): boolean {
  return availableThemes.includes(themeType);
}

// Get theme from environment variable, default to 'wikistr'
export function getCurrentTheme(): ThemeType {
  // Check for injected theme variable (set at build time)
  if (typeof __THEME__ !== 'undefined') {
    const theme = __THEME__ as ThemeType;
    return isThemeAvailable(theme) ? theme : 'wikistr';
  }
  
  // Default fallback - theme is injected at build time via vite config
  return 'wikistr';
}

// Color palette generation from accent color
export function generatePaletteFromAccent(accentColor: string) {
  // Convert hex to HSL for easier manipulation
  const hexToHsl = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;
    
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    
    return { h: h * 360, s: s * 100, l: l * 100 };
  };
  
  const hslToHex = (h: number, s: number, l: number) => {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const r = hue2rgb(p, q, h + 1/3);
    const g = hue2rgb(p, q, h);
    const b = hue2rgb(p, q, h - 1/3);
    
    const toHex = (c: number) => {
      const hex = Math.round(c * 255).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };
    
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  };
  
  const { h, s, l } = hexToHsl(accentColor);
  
  return {
    // Light mode palette
    light: {
      primary: '#ffffff',
      secondary: '#f8fafc',
      tertiary: '#f1f5f9',
      text: '#1e293b',
      textSecondary: '#475569',
      textMuted: '#64748b',
      border: '#e2e8f0',
      accent: accentColor,
      accentHover: hslToHex(h, s, Math.max(0, l - 10)),
      highlight: hslToHex(h, s, Math.max(0, l - 20)),
      pageBg: '#f1f5f9'
    },
    // Dark mode palette
    dark: {
      primary: '#0f172a',
      secondary: '#1e293b',
      tertiary: '#334155',
      text: '#f8fafc',
      textSecondary: '#cbd5e1',
      textMuted: '#94a3b8',
      border: '#475569',
      accent: accentColor,
      accentHover: hslToHex(h, s, Math.min(100, l + 10)),
      highlight: hslToHex(h, s, Math.min(100, l + 20)),
      pageBg: '#0f172a'
    }
  };
}

// Get theme configuration (synchronous for backward compatibility)
export function getThemeConfig(theme?: ThemeType): ThemeConfig {
  const currentTheme = theme || getCurrentTheme();
  return loadTheme(currentTheme);
}

// Get the default mode for a theme
export function getThemeDefaultMode(theme?: ThemeType): 'light' | 'dark' {
  const themeConfig = getThemeConfig(theme);
  return themeConfig.defaultMode || 'dark'; // fallback to dark if not specified
}
