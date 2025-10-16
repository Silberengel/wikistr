import wikistrConfig from './themes/wikistr.yml?raw';
import biblestrConfig from './themes/biblestr.yml?raw';
import quranstrConfig from './themes/quranstr.yml?raw';
import torahstrConfig from './themes/torahstr.yml?raw';
import yaml from 'js-yaml';

export type ThemeType = 'wikistr' | 'biblestr' | 'quranstr' | 'torahstr';

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

// Theme-specific relays take priority over default relays
// Each theme can have its own specialized relay sets (e.g., Arabic relays, regional relays, etc.)
// The relayService will use theme relays first, then fall back to defaults
//
// Example: To create a theme with Arabic relays, add:
// 1. Create src/lib/themes/arabic.yml
// 2. Add import: import arabicConfig from './themes/arabic.yml?raw';
// 3. Add to loadTheme function

// Cache for loaded themes
const themeCache = new Map<ThemeType, ThemeConfig>();

// Load theme configuration from YAML
function loadTheme(themeType: ThemeType): ThemeConfig {
  if (themeCache.has(themeType)) {
    return themeCache.get(themeType)!;
  }

  let config: ThemeConfig;
  
  switch (themeType) {
    case 'wikistr':
      config = yaml.load(wikistrConfig) as ThemeConfig;
      break;
    case 'biblestr':
      config = yaml.load(biblestrConfig) as ThemeConfig;
      break;
    case 'quranstr':
      config = yaml.load(quranstrConfig) as ThemeConfig;
      break;
    case 'torahstr':
      config = yaml.load(torahstrConfig) as ThemeConfig;
      break;
    default:
      config = yaml.load(wikistrConfig) as ThemeConfig;
      break;
  }

  themeCache.set(themeType, config);
  return config;
}

// Export themes object that loads from YAML
export const themes: Record<ThemeType, ThemeConfig> = {
  get wikistr() { return loadTheme('wikistr'); },
  get biblestr() { return loadTheme('biblestr'); },
  get quranstr() { return loadTheme('quranstr'); },
  get torahstr() { return loadTheme('torahstr'); }
};

// Get theme from environment variable, default to 'wikistr'
export function getCurrentTheme(): ThemeType {
  // Check for injected theme variable (set at build time)
  if (typeof __THEME__ !== 'undefined') {
    const theme = __THEME__ as ThemeType;
    return theme && theme in themes ? theme : 'wikistr';
  }
  
  // Default fallback - theme is injected at build time via vite config
  return 'wikistr';
}

export function getThemeConfig(theme?: ThemeType): ThemeConfig {
  const currentTheme = theme || getCurrentTheme();
  return themes[currentTheme];
}
