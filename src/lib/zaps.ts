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
 * Used for creating lightning invoices (not zaps)
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

