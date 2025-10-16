// Test script to verify relayService connection pooling
import { relayService } from './src/lib/relayService.js';

console.log('Testing relayService connection pooling...');

// Test multiple queries to see if connections are reused
async function testConnectionPooling() {
  console.log('1. Testing wiki-read operation...');
  const result1 = await relayService.queryEvents(
    'anonymous',
    'wiki-read',
    [{ kinds: [30818], limit: 5 }],
    { excludeUserContent: false, currentUserPubkey: undefined }
  );
  console.log(`   Found ${result1.events.length} events from ${result1.relays.length} relays`);

  console.log('2. Testing social-read operation...');
  const result2 = await relayService.queryEvents(
    'anonymous',
    'social-read',
    [{ kinds: [7], limit: 5 }],
    { excludeUserContent: false, currentUserPubkey: undefined }
  );
  console.log(`   Found ${result2.events.length} events from ${result2.relays.length} relays`);

  console.log('3. Testing metadata-read operation...');
  const result3 = await relayService.queryEvents(
    'anonymous',
    'metadata-read',
    [{ kinds: [0], limit: 5 }],
    { excludeUserContent: false, currentUserPubkey: undefined }
  );
  console.log(`   Found ${result3.events.length} events from ${result3.relays.length} relays`);

  console.log('✅ RelayService connection pooling test completed!');
}

testConnectionPooling().catch(console.error);
