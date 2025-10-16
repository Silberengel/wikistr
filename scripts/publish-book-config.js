#!/usr/bin/env node

/**
 * Generic script to publish book configurations as NIP-78 events
 * Usage: node scripts/publish-book-config.js <config-file.json> [relays-file.json]
 * Example: node scripts/publish-book-config.js jane-eyre-book-config.json
 * Example: node scripts/publish-book-config.js jane-eyre-book-config.json custom-relays.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SimplePool, nip19 } from '@nostr/tools';
import { getPublicKey, finalizeEvent } from '@nostr/tools/pure';
import WebSocket from 'ws';

// Default write relays (from src/lib/defaults.ts)
const DEFAULT_WRITE_RELAYS = [
  'wss://relay.damus.io',
  'wss://freelay.sovbit.host',
  'wss://thecitadel.nostr1.com',
  'wss://bevo.nostr1.com'
];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get command line arguments
const configFile = process.argv[2];
const relaysFile = process.argv[3];

if (!configFile) {
  console.error('❌ Usage: node scripts/publish-book-config.js <config-file.json> [relays-file.json]');
  console.error('   Example: node scripts/publish-book-config.js jane-eyre-book-config.json');
  console.error('   Example: node scripts/publish-book-config.js jane-eyre-book-config.json custom-relays.json');
  process.exit(1);
}

// Get private key from environment variable
const privateKey = process.env.PUBLISHING_KEY;
if (!privateKey) {
  console.error('❌ PUBLISHING_KEY environment variable not set');
  console.error('   Please export your private key: export PUBLISHING_KEY=your_private_key');
  process.exit(1);
}

// Parse private key (hex or nsec format)
let parsedPrivateKey;
try {
  if (privateKey.startsWith('nsec')) {
    // Bech32 nsec format
    const decoded = nip19.decode(privateKey);
    if (decoded.type !== 'nsec') {
      throw new Error('Not an nsec key');
    }
    parsedPrivateKey = decoded.data;
  } else if (/^[a-fA-F0-9]{64}$/.test(privateKey)) {
    // Hex format
    parsedPrivateKey = privateKey;
  } else {
    throw new Error('Invalid format');
  }
} catch (error) {
  console.error('❌ Invalid private key format');
  console.error('   Private key must be either:');
  console.error('   - 64 hex characters (e.g., abc123...)');
  console.error('   - nsec bech32 format (e.g., nsec1...)');
  process.exit(1);
}

// Read the book configuration
const configPath = path.join(__dirname, configFile);
if (!fs.existsSync(configPath)) {
  console.error(`❌ Configuration file not found: ${configFile}`);
  console.error(`   Looking for: ${configPath}`);
  process.exit(1);
}

const bookConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Load relays (custom or default)
let relays = DEFAULT_WRITE_RELAYS;
if (relaysFile) {
  const relaysPath = path.join(__dirname, relaysFile);
  if (!fs.existsSync(relaysPath)) {
    console.error(`❌ Relays file not found: ${relaysFile}`);
    console.error(`   Looking for: ${relaysPath}`);
    process.exit(1);
  }
  try {
    const customRelays = JSON.parse(fs.readFileSync(relaysPath, 'utf8'));
    if (Array.isArray(customRelays)) {
      relays = customRelays;
    } else {
      console.error('❌ Invalid relays file: must contain an array of relay URLs');
      process.exit(1);
    }
  } catch (error) {
    console.error(`❌ Failed to parse relays file: ${error.message}`);
    process.exit(1);
  }
}

// Validate required fields
if (!bookConfig.name || !bookConfig.displayName) {
  console.error('❌ Invalid book configuration: missing required fields (name, displayName)');
  process.exit(1);
}

// Create the NIP-78 event structure
const event = {
  kind: 30078,
  pubkey: "", // Will be filled after signing
  created_at: Math.floor(Date.now() / 1000),
  content: JSON.stringify(bookConfig),
  tags: [
    ["d", `${bookConfig.name}-book-config`],
    ["name", `${bookConfig.displayName} Book Configuration`],
    ["about", bookConfig.description || `Book configuration for ${bookConfig.displayName}`],
    ["t", "book-config"],
    ["t", bookConfig.name],
    ...(bookConfig.tags || []).map(tag => ["t", tag])
  ]
};

// Sign the event
const pubkey = getPublicKey(parsedPrivateKey);
event.pubkey = pubkey;

const signedEvent = finalizeEvent(event, parsedPrivateKey);

// Publish the event to relays
console.log(`📚 Publishing ${bookConfig.displayName} Book Configuration...`);
console.log(`🔑 Pubkey: ${pubkey}`);
console.log(`🌐 Publishing to ${relays.length} relays:`);
relays.forEach((relay, index) => {
  console.log(`   ${index + 1}. ${relay}`);
});

// Debug: Show the event structure
console.log(`\n🔍 Event structure:`);
console.log(`   Kind: ${signedEvent.kind}`);
console.log(`   Pubkey: ${signedEvent.pubkey}`);
console.log(`   Created: ${new Date(signedEvent.created_at * 1000).toISOString()}`);
console.log(`   Tags: ${JSON.stringify(signedEvent.tags)}`);
console.log(`   Content length: ${signedEvent.content.length} chars`);

const pool = new SimplePool({
  websocketImplementation: WebSocket
});

// Publish to all relays
async function publishToRelays() {
  const results = [];
  
  for (const relay of relays) {
    try {
      const r = await pool.ensureRelay(relay);
      await r.publish(signedEvent);
      console.log(`✅ Published to ${relay}`);
      results.push({ relay, success: true });
    } catch (error) {
      console.log(`❌ Failed to publish to ${relay}: ${error.message}`);
      results.push({ relay, success: false, error: error.message });
    }
  }
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log(`\n📊 Publishing Results:`);
  console.log(`   ✅ Successful: ${successful.length}/${relays.length}`);
  console.log(`   ❌ Failed: ${failed.length}/${relays.length}`);
  
  if (successful.length > 0) {
    console.log(`\n✅ Successful relays:`);
    successful.forEach(result => {
      console.log(`   • ${result.relay}`);
    });
  }
  
  if (failed.length > 0) {
    console.log(`\n❌ Failed relays:`);
    failed.forEach(result => {
      console.log(`   • ${result.relay}: ${result.error}`);
    });
  }
  
  if (successful.length > 0) {
    console.log(`\n🎉 Book configuration published successfully!`);
    console.log(`   Run "npm run book-configs" to verify discovery.`);
  } else {
    console.log(`\n💥 Failed to publish to any relays.`);
    console.log(`   Check your internet connection and relay availability.`);
  }
  
  // Close the pool
  try {
    pool.close();
  } catch (error) {
    // Ignore close errors
  }
  process.exit(successful.length > 0 ? 0 : 1);
}

// Run the publishing
publishToRelays();
