import yaml from 'js-yaml';

// Dynamic theme type - will be determined by available theme files
export type ThemeType = string;

export interface ThemeConfig {
  name: string;
  title: string;
  tagline: string;
  description: string;
  accentColor: string;
  pageBackground?: string; // Optional custom page background color
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
export function generatePaletteFromAccent(accentColor: string, themeConfig?: ThemeConfig) {
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
    // Convert HSL values to 0-1 range
    const hNorm = h / 360;
    const sNorm = s / 100;
    const lNorm = l / 100;
    
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    
    const q = lNorm < 0.5 ? lNorm * (1 + sNorm) : lNorm + sNorm - lNorm * sNorm;
    const p = 2 * lNorm - q;
    const r = hue2rgb(p, q, hNorm + 1/3);
    const g = hue2rgb(p, q, hNorm);
    const b = hue2rgb(p, q, hNorm - 1/3);
    
    const toHex = (c: number) => {
      const hex = Math.round(c * 255).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };
    
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  };
  
  const { h, s, l } = hexToHsl(accentColor);
  
  // Generate derived background colors from accent color
  // Create contextually appropriate backgrounds: golden for warm colors, grayish for cool colors
  const deriveBackgroundColor = (hue: number, saturation: number, lightness: number) => {
    // Determine if the color is warm or cool based on hue
    // Warm colors: reds, oranges, yellows (0-60° and 300-360°)
    // Cool colors: blues, greens, purples (60-300°)
    const isWarm = (hue >= 0 && hue <= 60) || (hue >= 300 && hue <= 360);
    
    if (isWarm) {
      // For warm colors: use the target golden color #B8965A
      return '#B8965A';
    } else {
      // For cool colors: create a grayish, neutral background
      // Desaturate significantly and adjust lightness for a neutral gray
      const newLightness = Math.max(35, lightness * 0.7);
      const newSaturation = Math.max(15, saturation * 0.3); // Very low saturation for grayish look
      
      return hslToHex(hue, newSaturation, newLightness);
    }
  };

  // Use theme's pageBackground if provided, otherwise derive algorithmically
  const basePageBg = themeConfig?.pageBackground || deriveBackgroundColor(h, s, l);
  
  // Create mode-specific backgrounds
  const createModeSpecificBackground = (baseBg: string, isDarkMode: boolean) => {
    if (isDarkMode) {
      // For dark mode, make the background much darker
      const baseHsl = hexToHsl(baseBg);
      const darkerBg = hslToHex(baseHsl.h, baseHsl.s, Math.max(15, baseHsl.l * 0.3));
      return darkerBg;
    } else {
      // For light mode, use the base background as-is
      return baseBg;
    }
  };
  
  // Generate text colors that provide good contrast
  const deriveTextColors = (isDarkMode: boolean) => {
    if (isDarkMode) {
      // Dark mode: light text
      return {
        primary: '#f8fafc',
        secondary: '#cbd5e1', 
        muted: '#94a3b8'
      };
    } else {
      // Light mode: dark text
      return {
        primary: '#1a1a1a',
        secondary: '#2d2d2d',
        muted: '#404040'
      };
    }
  };
  
  const lightTextColors = deriveTextColors(false);
  const darkTextColors = deriveTextColors(true);

  return {
    // Light mode palette
    light: {
      primary: '#ffffff',
      secondary: '#f8fafc',
      tertiary: '#f1f5f9',
      text: lightTextColors.primary,
      textSecondary: lightTextColors.secondary,
      textMuted: lightTextColors.muted,
      border: '#e2e8f0',
      accent: accentColor,
      accentHover: hslToHex(h, s, Math.max(0, l - 10)),
      highlight: hslToHex(h, s, Math.max(0, l - 20)),
      pageBg: createModeSpecificBackground(basePageBg, false)
    },
    // Dark mode palette
    dark: {
      primary: '#0f172a',
      secondary: '#1e293b',
      tertiary: '#334155',
      text: darkTextColors.primary,
      textSecondary: darkTextColors.secondary,
      textMuted: darkTextColors.muted,
      border: '#475569',
      accent: accentColor,
      accentHover: hslToHex(h, s, Math.min(100, l + 10)),
      highlight: hslToHex(h, s, Math.min(100, l + 20)),
      pageBg: createModeSpecificBackground(basePageBg, true)
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
