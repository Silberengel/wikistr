import yaml from 'js-yaml';

// Dynamic theme type - will be determined by available theme files
export type ThemeType = string;

export interface ThemeConfig {
  name: string;
  title: string;
  tagline: string;
  description: string;
  brandColor: string;
  backgroundColor: string;
  textColor: string;
  accentColor: string;
  highlightColor: string;
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
    fontSize: {
      xs: string;
      sm: string;
      base: string;
      lg: string;
      xl: string;
      '2xl': string;
      '3xl': string;
      '4xl': string;
      '5xl': string;
      '6xl': string;
    };
  };
  styling: {
    headerStyle: string;
    buttonStyle: string;
    cardStyle: string;
    inputStyle: string;
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

// Get theme configuration (synchronous for backward compatibility)
export function getThemeConfig(theme?: ThemeType): ThemeConfig {
  const currentTheme = theme || getCurrentTheme();
  return loadTheme(currentTheme);
}
