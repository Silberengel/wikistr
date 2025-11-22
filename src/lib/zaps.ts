import type { EventTemplate, Event } from '@nostr/tools/pure';
import { signer } from './nostr';
import { relayService } from './relayService';
import { nip19 } from '@nostr/tools';

export interface ZapConfig {
  recipientPubkey: string;
  recipientLnurl?: string; // Optional lnurl from profile
  eventId?: string; // Optional event being zapped
  eventKind?: number; // Optional kind of event being zapped
  eventCoordinate?: string; // Optional event coordinate (a tag)
  content?: string; // Optional zap message
  amountMillisats: number;
  relays: string[];
}

export interface LNURLPayResponse {
  callback: string;
  minSendable: number;
  maxSendable: number;
  allowsNostr?: boolean;
  nostrPubkey?: string;
  metadata: string;
}

/**
 * Fetch LNURL pay request from a lightning address
 */
export async function fetchLNURLPay(lud16: string): Promise<LNURLPayResponse | null> {
  try {
    const [username, domain] = lud16.split('@');
    if (!username || !domain) {
      throw new Error('Invalid lightning address format');
    }

    const lnurlEndpoint = `https://${domain}/.well-known/lnurlp/${username}`;
    const response = await fetch(lnurlEndpoint);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch LNURL: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data as LNURLPayResponse;
  } catch (error) {
    console.error('Failed to fetch LNURL pay:', error);
    return null;
  }
}

/**
 * Encode lnurl as bech32
 * Note: This is a simplified version. For production, use a proper bech32 library.
 * The lnurl tag in zap requests is optional, so we can skip encoding if needed.
 */
function encodeLNURL(url: string): string {
  // If it's already a lnurl bech32 string, return as-is
  if (url.startsWith('lnurl')) {
    return url;
  }
  // For now, we'll skip bech32 encoding and just use the URL
  // The lnurl tag is optional in zap requests anyway
  // In a full implementation, you'd use a bech32 library here
  return url;
}

/**
 * Create and sign a zap request event (kind 9734)
 */
async function createZapRequest(config: ZapConfig): Promise<Event> {
  const tags: string[][] = [
    ['relays', ...config.relays],
    ['amount', config.amountMillisats.toString()],
    ['p', config.recipientPubkey]
  ];

  if (config.lnurl) {
    tags.push(['lnurl', config.lnurl]);
  }

  if (config.eventId) {
    tags.push(['e', config.eventId]);
  }

  if (config.eventCoordinate) {
    tags.push(['a', config.eventCoordinate]);
  }

  if (config.eventKind !== undefined) {
    tags.push(['k', config.eventKind.toString()]);
  }

  const eventTemplate: EventTemplate = {
    kind: 9734,
    content: config.content || '',
    tags,
    created_at: Math.floor(Date.now() / 1000)
  };

  return await signer.signEvent(eventTemplate);
}

/**
 * Send zap request to LNURL callback and get invoice
 */
export async function sendZap(config: ZapConfig): Promise<{ invoice: string; zapRequest: Event } | null> {
  try {
    // Step 1: Get recipient's lightning address and LNURL
    let lnurlPay: LNURLPayResponse | null = null;
    let lnurl: string | undefined = config.recipientLnurl;

    // If no lnurl provided, we need to fetch the recipient's profile to get their lud16
    if (!lnurl && !config.recipientLnurl) {
      // Fetch recipient's profile to get lud16
      const profileResult = await relayService.queryEvents(
        'anonymous',
        'metadata-read',
        [{ kinds: [0], authors: [config.recipientPubkey], limit: 1 }],
        { excludeUserContent: false, currentUserPubkey: undefined }
      );

      if (profileResult.events.length > 0) {
        const profileEvent = profileResult.events[0];
        let profileContent: any = {};
        
        try {
          profileContent = JSON.parse(profileEvent.content);
        } catch (e) {
          // Try parsing from tags
          if (profileEvent.tags) {
            const lud16Tag = profileEvent.tags.find(tag => 
              Array.isArray(tag) && tag.length >= 2 && 
              (tag[0].toLowerCase() === 'lud16' || tag[0].toLowerCase() === 'lightning')
            );
            if (lud16Tag && Array.isArray(lud16Tag[1])) {
              profileContent.lud16 = lud16Tag[1][0];
            } else if (lud16Tag) {
              profileContent.lud16 = lud16Tag[1];
            }
          }
        }

        const lud16 = profileContent.lud16;
        if (lud16) {
          lnurlPay = await fetchLNURLPay(lud16);
          if (lnurlPay) {
            // Encode the lnurl
            lnurl = encodeLNURL(`https://${lud16.split('@')[1]}/.well-known/lnurlp/${lud16.split('@')[0]}`);
          }
        }
      }
    } else if (config.recipientLnurl) {
      // If lnurl is provided, fetch the LNURL pay endpoint
      // Extract domain from lnurl or use a different approach
      // For now, we'll assume the lnurl is already a lightning address
      if (config.recipientLnurl.includes('@')) {
        lnurlPay = await fetchLNURLPay(config.recipientLnurl);
      }
    }

    if (!lnurlPay) {
      throw new Error('Could not fetch LNURL pay endpoint for recipient');
    }

    // Check if nostr zaps are supported
    if (!lnurlPay.allowsNostr || !lnurlPay.nostrPubkey) {
      throw new Error('Recipient does not support nostr zaps');
    }

    // Step 2: Create and sign zap request
    const zapRequest = await createZapRequest({
      ...config,
      lnurl: lnurl || config.recipientLnurl
    });

    // Step 3: Send zap request to callback
    const callbackUrl = new URL(lnurlPay.callback);
    callbackUrl.searchParams.set('amount', config.amountMillisats.toString());
    callbackUrl.searchParams.set('nostr', encodeURIComponent(JSON.stringify(zapRequest)));
    if (lnurl) {
      callbackUrl.searchParams.set('lnurl', lnurl);
    }

    const callbackResponse = await fetch(callbackUrl.toString());
    if (!callbackResponse.ok) {
      throw new Error(`Failed to get invoice: ${callbackResponse.statusText}`);
    }

    const invoiceData = await callbackResponse.json();
    if (!invoiceData.pr) {
      throw new Error('No invoice in response');
    }

    return {
      invoice: invoiceData.pr,
      zapRequest
    };
  } catch (error) {
    console.error('Failed to send zap:', error);
    throw error;
  }
}

/**
 * Validate a zap receipt (kind 9735)
 */
export function validateZapReceipt(
  zapReceipt: Event,
  expectedRecipientPubkey: string,
  expectedLNURLPubkey: string,
  zapRequest?: Event
): boolean {
  // Check that the zap receipt is from the correct LNURL provider
  if (zapReceipt.pubkey !== expectedLNURLPubkey) {
    return false;
  }

  // Check that it's a zap receipt
  if (zapReceipt.kind !== 9735) {
    return false;
  }

  // Check that the recipient matches
  const pTag = zapReceipt.tags.find(tag => tag[0] === 'p');
  if (!pTag || pTag[1] !== expectedRecipientPubkey) {
    return false;
  }

  // If we have the zap request, validate against it
  if (zapRequest) {
    const amountTag = zapRequest.tags.find(tag => tag[0] === 'amount');
    if (amountTag) {
      const expectedAmount = parseInt(amountTag[1]);
      // Parse bolt11 to get amount (simplified - would need proper bolt11 parsing)
      const bolt11Tag = zapReceipt.tags.find(tag => tag[0] === 'bolt11');
      if (bolt11Tag) {
        // In a real implementation, we'd parse the bolt11 invoice to get the amount
        // For now, we'll just check that the description matches
        const descriptionTag = zapReceipt.tags.find(tag => tag[0] === 'description');
        if (descriptionTag) {
          try {
            const requestFromDescription = JSON.parse(descriptionTag[1]);
            if (requestFromDescription.id !== zapRequest.id) {
              return false;
            }
          } catch (e) {
            return false;
          }
        }
      }
    }
  }

  return true;
}

/**
 * Fetch zap receipts for a pubkey or event
 */
export async function fetchZapReceipts(
  recipientPubkey?: string,
  eventId?: string
): Promise<Event[]> {
  const filters: any[] = [{
    kinds: [9735]
  }];

  if (recipientPubkey) {
    filters[0]['#p'] = [recipientPubkey];
  }

  if (eventId) {
    filters[0]['#e'] = [eventId];
  }

  const result = await relayService.queryEvents(
    'anonymous',
    'social-read',
    filters,
    { excludeUserContent: false, currentUserPubkey: undefined }
  );

  return result.events;
}

