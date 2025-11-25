/**
 * Centralized Book Configuration Manager
 * Manages built-in book types (custom configs are now managed via YAML in settings)
 */

import { writable, get } from 'svelte/store';
import type { BookType } from './books';
import { BOOK_TYPES } from './books';

// Centralized book configuration map
export const allBookTypes = writable<{ [name: string]: BookType }>({});

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
 * Loads built-in book types (custom configs are now managed via YAML in settings)
 */
export async function initializeBookConfigurations() {
  console.log('[bookConfig] Starting initializeBookConfigurations');
  try {
    // Set built-in book types
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
    if (!unsubscribeAllBookTypes) {
      console.log('[bookConfig] Setting up subscription to allBookTypes');
      try {
        if (typeof allBookTypes.subscribe !== 'function') {
          throw new Error('allBookTypes.subscribe is not a function');
        }
        
        unsubscribeAllBookTypes = allBookTypes.subscribe(updateBookAbbreviations);
        console.log('[bookConfig] ✓ Subscribed to allBookTypes successfully');
      } catch (err) {
        console.error('[bookConfig] ✗ Failed to subscribe to allBookTypes:', err);
        throw err;
      }
    }
    
    console.log('[bookConfig] ✓ initializeBookConfigurations completed successfully');
    return () => {};
  } catch (error) {
    console.error('[bookConfig] ✗ CRITICAL: Failed to initialize book configurations:', error);
    return () => {};
  }
}

/**
 * Refresh book configurations (now just reloads built-in types)
 */
export async function refreshBookConfigurations() {
  try {
    allBookTypes.set({ ...BOOK_TYPES });
    const currentTypes = get(allBookTypes);
    updateBookAbbreviations(currentTypes);
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
