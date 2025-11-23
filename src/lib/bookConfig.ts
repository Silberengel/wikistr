/**
 * Centralized Book Configuration Manager
 * Manages both built-in and dynamic book configurations from NIP-78 events
 */

import { writable, derived, get } from 'svelte/store';
import type { BookType } from './books';
import { BOOK_TYPES } from './books';
import { loadAndStoreBookConfigurations, customBookTypes, bookConfigurations } from './nip78';

// Centralized book configuration map
export const allBookTypes = writable<{ [name: string]: BookType }>({});
// Re-export bookConfigurations from nip78 to avoid duplicate stores
export { bookConfigurations };

// Derived store that combines built-in and custom book types
// Just export allBookTypes directly - no need for a passthrough derived store
export const availableBookTypes = allBookTypes;

// Derived store for book abbreviations
// Create a writable store that we'll update manually to avoid derived subscription issues
export const bookAbbreviations = writable<{ [type: string]: { [key: string]: string } }>({});

// Function to update book abbreviations from allBookTypes
function updateBookAbbreviations(allBookTypesValue: { [name: string]: BookType }) {
  try {
    console.log('[bookConfig] updateBookAbbreviations called with', Object.keys(allBookTypesValue).length, 'types');
    const abbreviations: { [type: string]: { [key: string]: string } } = {};
    
    Object.entries(allBookTypesValue).forEach(([typeName, bookType]) => {
      abbreviations[typeName] = {};
      Object.entries(bookType.books).forEach(([fullName, abbreviationsList]) => {
        abbreviationsList.forEach(abbr => {
          abbreviations[typeName][abbr.toLowerCase()] = fullName;
        });
        // Also add the full name itself
        abbreviations[typeName][fullName.toLowerCase()] = fullName;
      });
    });
    
    console.log('[bookConfig] Setting bookAbbreviations, types:', Object.keys(abbreviations).length);
    bookAbbreviations.set(abbreviations);
    console.log('[bookConfig] ✓ bookAbbreviations updated');
  } catch (err) {
    console.error('[bookConfig] ✗ Failed to update book abbreviations:', err);
    throw err;
  }
}

// Track subscription for cleanup
let unsubscribeAllBookTypes: (() => void) | null = null;

/**
 * Initialize the book configuration system
 * Loads built-in book types and custom configurations from NIP-78 events
 */
export async function initializeBookConfigurations() {
  console.log('[bookConfig] Starting initializeBookConfigurations');
  try {
    // Start with built-in book types
    console.log('[bookConfig] Setting built-in book types, count:', Object.keys(BOOK_TYPES).length);
    try {
      allBookTypes.set({ ...BOOK_TYPES });
      console.log('[bookConfig] ✓ Built-in book types set successfully');
    } catch (err) {
      console.error('[bookConfig] ✗ Failed to set built-in book types:', err);
      throw err;
    }
    
    // Initialize book abbreviations with current value
    console.log('[bookConfig] Initializing book abbreviations');
    try {
      const currentTypes = get(allBookTypes);
      console.log('[bookConfig] Got current types, count:', Object.keys(currentTypes).length);
      updateBookAbbreviations(currentTypes);
      console.log('[bookConfig] ✓ Book abbreviations initialized');
    } catch (err) {
      console.error('[bookConfig] ✗ Failed to initialize book abbreviations:', err);
      throw err;
    }
    
    // Subscribe to allBookTypes to keep bookAbbreviations in sync
    // Do this after stores are initialized to avoid timing issues
    if (!unsubscribeAllBookTypes) {
      console.log('[bookConfig] Setting up subscription to allBookTypes');
      try {
        console.log('[bookConfig] Checking allBookTypes:', {
          isObject: typeof allBookTypes === 'object',
          hasSubscribe: 'subscribe' in allBookTypes,
          subscribeType: typeof allBookTypes.subscribe
        });
        
        if (typeof allBookTypes.subscribe !== 'function') {
          throw new Error('allBookTypes.subscribe is not a function');
        }
        
        unsubscribeAllBookTypes = allBookTypes.subscribe(updateBookAbbreviations);
        console.log('[bookConfig] ✓ Subscribed to allBookTypes successfully');
      } catch (err) {
        console.error('[bookConfig] ✗ Failed to subscribe to allBookTypes:', err);
        console.error('[bookConfig] allBookTypes value:', allBookTypes);
        console.error('[bookConfig] allBookTypes type:', typeof allBookTypes);
        console.error('[bookConfig] allBookTypes keys:', Object.keys(allBookTypes));
        throw err;
      }
    } else {
      console.log('[bookConfig] Already subscribed to allBookTypes, skipping');
    }
    
    // Load custom configurations from NIP-78 events
    console.log('[bookConfig] Loading custom configurations from NIP-78');
    try {
      await loadAndStoreBookConfigurations();
      console.log('[bookConfig] ✓ Custom configurations loaded');
    } catch (err) {
      console.error('[bookConfig] ✗ Failed to load custom configurations:', err);
      // Don't throw - continue with built-in types only
    }
    
    // Get current custom book types and update the main map
    // Use get() for synchronous access instead of subscribe
    console.log('[bookConfig] Getting custom book types');
    try {
      console.log('[bookConfig] Checking customBookTypes:', {
        exists: !!customBookTypes,
        isObject: customBookTypes && typeof customBookTypes === 'object',
        hasSubscribe: customBookTypes && 'subscribe' in customBookTypes,
        subscribeType: customBookTypes && typeof (customBookTypes as any).subscribe
      });
      
      // Double-check that customBookTypes is actually a store before using get()
      if (customBookTypes && typeof customBookTypes === 'object' && 'subscribe' in customBookTypes) {
        const customTypes = get(customBookTypes);
        console.log('[bookConfig] Got custom types, count:', Object.keys(customTypes || {}).length);
        if (customTypes && Object.keys(customTypes).length > 0) {
          allBookTypes.update(current => ({ ...current, ...customTypes }));
          console.log('[bookConfig] ✓ Updated allBookTypes with custom types');
        } else {
          console.log('[bookConfig] No custom types to add');
        }
      } else {
        console.warn('[bookConfig] customBookTypes is not a valid store:', {
          customBookTypes,
          type: typeof customBookTypes
        });
      }
    } catch (err) {
      console.error('[bookConfig] ✗ Failed to get custom book types:', err);
      console.error('[bookConfig] Error details:', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined
      });
    }
    
    // Subscribe to future updates from customBookTypes
    // Check if customBookTypes is actually a store before subscribing
    console.log('[bookConfig] Setting up subscription to customBookTypes');
    let unsubscribe: (() => void) | null = null;
    try {
      console.log('[bookConfig] Checking customBookTypes for subscription:', {
        exists: !!customBookTypes,
        isObject: customBookTypes && typeof customBookTypes === 'object',
        hasSubscribe: customBookTypes && 'subscribe' in customBookTypes,
        subscribeType: customBookTypes && typeof (customBookTypes as any).subscribe
      });
      
      if (customBookTypes && 
          typeof customBookTypes === 'object' && 
          'subscribe' in customBookTypes &&
          typeof (customBookTypes as any).subscribe === 'function') {
        unsubscribe = (customBookTypes as any).subscribe((customTypes: any) => {
          console.log('[bookConfig] customBookTypes updated, count:', Object.keys(customTypes || {}).length);
          if (customTypes && Object.keys(customTypes).length > 0) {
            allBookTypes.update(current => ({ ...current, ...customTypes }));
          }
        });
        console.log('[bookConfig] ✓ Subscribed to customBookTypes successfully');
      } else {
        console.warn('[bookConfig] customBookTypes is not subscribable, skipping subscription');
      }
    } catch (err) {
      console.error('[bookConfig] ✗ Failed to subscribe to customBookTypes:', err);
      console.error('[bookConfig] Error details:', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        customBookTypes
      });
    }
    
    console.log('[bookConfig] ✓ initializeBookConfigurations completed successfully');
    return unsubscribe || (() => {});
  } catch (error) {
    console.error('[bookConfig] ✗ CRITICAL: Failed to initialize book configurations:', error);
    console.error('[bookConfig] Error details:', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : undefined
    });
    return () => {};
  }
}

/**
 * Refresh book configurations from Nostr events
 */
export async function refreshBookConfigurations() {
  try {
    await loadAndStoreBookConfigurations();
    
    // Update allBookTypes with the newly loaded custom types
    try {
      const customTypes = get(customBookTypes);
      if (customTypes && Object.keys(customTypes).length > 0) {
        allBookTypes.update(current => ({ ...current, ...customTypes }));
      }
    } catch (err) {
      console.warn('Failed to get custom book types after refresh:', err);
    }
  } catch (error) {
    console.error('Failed to refresh book configurations:', error);
  }
}

/**
 * Get a specific book type by name
 */
export function getBookType(name: string): BookType | undefined {
  try {
    // Use get() for synchronous access instead of subscribe
    const types = get(allBookTypes);
    return types[name];
  } catch (err) {
    console.error('[bookConfig] ✗ Failed to get book type:', name, err);
    return undefined;
  }
}

/**
 * Get all available book type names
 */
export function getAvailableBookTypeNames(): string[] {
  // Use get() for synchronous access instead of subscribe
  const types = get(allBookTypes);
  return Object.keys(types);
}

/**
 * Check if a book type exists
 */
export function hasBookType(name: string): boolean {
  return getBookType(name) !== undefined;
}

/**
 * Get book abbreviations for a specific type
 */
export function getBookAbbreviations(typeName: string): { [key: string]: string } {
  try {
    // Use get() for synchronous access instead of subscribe
    const abbrevs = get(bookAbbreviations);
    return abbrevs[typeName] || {};
  } catch (err) {
    console.error('[bookConfig] ✗ Failed to get book abbreviations:', typeName, err);
    return {};
  }
}

/**
 * Find book type by abbreviation
 */
export function findBookTypeByAbbreviation(abbreviation: string): { type: string; fullName: string } | null {
  try {
    // Use get() for synchronous access instead of subscribe
    const abbrevs = get(bookAbbreviations);
    for (const [typeName, typeAbbrevs] of Object.entries(abbrevs)) {
      const fullName = typeAbbrevs[abbreviation.toLowerCase()];
      if (fullName) {
        return { type: typeName, fullName };
      }
    }
    return null;
  } catch (err) {
    console.error('[bookConfig] ✗ Failed to find book type by abbreviation:', abbreviation, err);
    return null;
  }
}

/**
 * Get display name for a book type
 */
export function getBookTypeDisplayName(typeName: string): string {
  const bookType = getBookType(typeName);
  return bookType?.displayName || typeName;
}

/**
 * Get all book types as an array for iteration
 */
export function getAllBookTypesArray(): Array<{ name: string; type: BookType }> {
  try {
    // Use get() for synchronous access instead of subscribe
    const allTypes = get(allBookTypes);
    return Object.entries(allTypes).map(([name, type]) => ({ name, type }));
  } catch (err) {
    console.error('[bookConfig] ✗ Failed to get all book types array:', err);
    return [];
  }
}
