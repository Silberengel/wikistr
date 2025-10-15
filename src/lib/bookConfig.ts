/**
 * Centralized Book Configuration Manager
 * Manages both built-in and dynamic book configurations from NIP-78 events
 */

import { writable, derived } from 'svelte/store';
import type { BookType } from './books';
import { BOOK_TYPES } from './books';
import { loadAndStoreBookConfigurations, customBookTypes } from './nip78';

// Centralized book configuration map
export const allBookTypes = writable<{ [name: string]: BookType }>({});
export const bookConfigurations = writable<any[]>([]);

// Derived store that combines built-in and custom book types
export const availableBookTypes = derived(
  [allBookTypes],
  ([$allBookTypes]) => $allBookTypes
);

// Derived store for book abbreviations
export const bookAbbreviations = derived(
  [allBookTypes],
  ([$allBookTypes]) => {
    const abbreviations: { [type: string]: { [key: string]: string } } = {};
    
    Object.entries($allBookTypes).forEach(([typeName, bookType]) => {
      abbreviations[typeName] = {};
      Object.entries(bookType.books).forEach(([fullName, abbreviationsList]) => {
        abbreviationsList.forEach(abbr => {
          abbreviations[typeName][abbr.toLowerCase()] = fullName;
        });
        // Also add the full name itself
        abbreviations[typeName][fullName.toLowerCase()] = fullName;
      });
    });
    
    return abbreviations;
  }
);

/**
 * Initialize the book configuration system
 * Loads built-in book types and custom configurations from NIP-78 events
 */
export async function initializeBookConfigurations() {
  try {
    console.log('Initializing book configurations...');
    
    // Start with built-in book types
    allBookTypes.set({ ...BOOK_TYPES });
    
    // Load custom configurations from NIP-78 events
    await loadAndStoreBookConfigurations();
    
    // Subscribe to custom book types and update the main map
    const unsubscribe = customBookTypes.subscribe((customTypes) => {
      if (Object.keys(customTypes).length > 0) {
        allBookTypes.update(current => ({ ...current, ...customTypes }));
        console.log(`Added ${Object.keys(customTypes).length} custom book types`);
      }
    });
    
    console.log('Book configurations initialized successfully');
    return unsubscribe;
  } catch (error) {
    console.error('Failed to initialize book configurations:', error);
    return () => {};
  }
}

/**
 * Refresh book configurations from Nostr events
 */
export async function refreshBookConfigurations() {
  try {
    console.log('Refreshing book configurations...');
    await loadAndStoreBookConfigurations();
    console.log('Book configurations refreshed');
  } catch (error) {
    console.error('Failed to refresh book configurations:', error);
  }
}

/**
 * Get a specific book type by name
 */
export function getBookType(name: string): BookType | undefined {
  let bookType: BookType | undefined;
  
  // Subscribe to the store to get current value
  const unsubscribe = allBookTypes.subscribe(types => {
    bookType = types[name];
  });
  
  unsubscribe();
  return bookType;
}

/**
 * Get all available book type names
 */
export function getAvailableBookTypeNames(): string[] {
  let names: string[] = [];
  
  const unsubscribe = allBookTypes.subscribe(types => {
    names = Object.keys(types);
  });
  
  unsubscribe();
  return names;
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
  let abbreviations: { [key: string]: string } = {};
  
  const unsubscribe = bookAbbreviations.subscribe(abbrevs => {
    abbreviations = abbrevs[typeName] || {};
  });
  
  unsubscribe();
  return abbreviations;
}

/**
 * Find book type by abbreviation
 */
export function findBookTypeByAbbreviation(abbreviation: string): { type: string; fullName: string } | null {
  let result: { type: string; fullName: string } | null = null;
  
  const unsubscribe = bookAbbreviations.subscribe(abbrevs => {
    for (const [typeName, typeAbbrevs] of Object.entries(abbrevs)) {
      const fullName = typeAbbrevs[abbreviation.toLowerCase()];
      if (fullName) {
        result = { type: typeName, fullName };
        return;
      }
    }
  });
  
  unsubscribe();
  return result;
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
  let types: Array<{ name: string; type: BookType }> = [];
  
  const unsubscribe = allBookTypes.subscribe(allTypes => {
    types = Object.entries(allTypes).map(([name, type]) => ({ name, type }));
  });
  
  unsubscribe();
  return types;
}
