#!/usr/bin/env node

/**
 * Script to discover book configurations from Nostr relays during build
 * This queries relays for NIP-78 book configuration events (kind 30078)
 */

import { pool } from '@nostr/gadgets/global';

// Default relays for querying book configurations
const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://freelay.sovbit.host',
  'wss://thecitadel.nostr1.com',
  'wss://bevo.nostr1.com',
  'wss://relay.snort.social',
  'wss://nostr21.com',
  'wss://relay.nostr.band'
];

async function discoverBookConfigurations() {
  console.log('📚 Discovering book configurations from Nostr relays...');
  
  try {
    let eventCount = 0;
    const bookConfigs = [];
    
    // Query relays for book configuration events (kind 30078)
    const subscription = pool.subscribeMany(DEFAULT_RELAYS, [
      { kinds: [30078], limit: 100 }
    ], {
      onevent: (event) => {
        eventCount++;
        console.log(`📄 Found event: kind=${event.kind}, pubkey=${event.pubkey.slice(0, 8)}...`);
        try {
          // Parse the event content to extract book configuration info
          const content = JSON.parse(event.content);
          const name = content.name || 'Unknown';
          const displayName = content.displayName || name;
          const bookCount = Object.keys(content.books || {}).length;
          
          console.log(`✅ Valid book config: ${displayName} (${bookCount} books)`);
          bookConfigs.push({
            name: displayName,
            bookCount,
            pubkey: event.pubkey.slice(0, 8)
          });
        } catch (error) {
          console.log(`❌ Invalid JSON in event: ${error.message}`);
        }
      },
      oneose: () => {
        console.log(`📡 Queried ${DEFAULT_RELAYS.length} relays`);
        console.log(`📖 Found ${eventCount} book configuration events`);
        
        if (bookConfigs.length > 0) {
          console.log('\n📚 Available book configurations:');
          bookConfigs.forEach((config, index) => {
            console.log(`  ${index + 1}. ${config.name} (${config.bookCount} books) - ${config.pubkey}...`);
          });
        } else {
          console.log('ℹ️  No valid book configurations found on relays');
        }
        
        console.log(`\n🌐 Relays queried: ${DEFAULT_RELAYS.join(', ')}`);
        subscription.close();
      }
    });
    
    // Timeout after 30 seconds
    setTimeout(() => {
      subscription.close();
      if (eventCount === 0) {
        console.log('⏰ Query timed out - no book configurations found');
      }
    }, 30000);
    
  } catch (error) {
    console.error('❌ Failed to discover book configurations:', error.message);
  }
}

// Run the discovery
discoverBookConfigurations();
