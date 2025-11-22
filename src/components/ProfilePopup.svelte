<script lang="ts">
  import { onMount } from 'svelte';
  import { relayService } from '$lib/relayService';
  import { nip19 } from '@nostr/tools';
  import { account, signer } from '$lib/nostr';
  import { sendZap, fetchZapReceipts, fetchLNURLPay } from '$lib/zaps';
  import UserBadge from './UserBadge.svelte';

  interface Props {
    pubkey: string;
    bech32: string;
    isOpen: boolean;
    onClose: () => void;
  }

  let { pubkey, bech32, isOpen, onClose }: Props = $props();
  
  let userData = $state<any>(null);
  let loading = $state(true);
  let isMobile = $state(false);
  let aboutElement = $state<HTMLElement>();
  let nip05Verified = $state(false);
  let nip05Verifying = $state(false);
  let nip05RetryCount = $state(0);
  let zapReceipts = $state<any[]>([]);
  let zapLoading = $state(false);
  let lnurlPayInfo = $state<{ allowsNostr?: boolean; nostrPubkey?: string } | null>(null);
  let editing = $state(false);
  let editFormData = $state<any>(null);
  let saving = $state(false);

  // Detect if we're on mobile
  onMount(() => {
    const checkMobile = () => {
      isMobile = window.innerWidth < 768;
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  });

  // Fetch user profile data
  async function fetchUserData() {
    if (!isOpen || !pubkey) return;
    
    loading = true;
    userData = null;
    
    try {
      // Decode npub to get hex pubkey if needed
      let hexPubkey = pubkey;
      let npub = pubkey;
      
      if (pubkey.startsWith('npub')) {
        try {
          const decoded = nip19.decode(pubkey);
          if (decoded.type === 'npub') {
            hexPubkey = decoded.data;
            npub = pubkey; // Keep original npub
          }
        } catch (e) {
          console.error('Failed to decode npub:', e);
          throw e;
        }
      } else {
        // If it's already a hex pubkey, encode it to npub for display
        try {
          npub = nip19.npubEncode(pubkey);
        } catch (e) {
          console.error('Failed to encode npub:', e);
          npub = pubkey; // Fallback to original
        }
      }
      
      // Check cache first before making relay queries
      const { contentCache } = await import('$lib/contentCache');
      const cachedEvents = await contentCache.getEvents('metadata');
      const cachedUserEvent = cachedEvents.find(cached => cached.event.pubkey === hexPubkey && cached.event.kind === 0);
      
      let result: any;
      if (cachedUserEvent) {
        console.log('ProfilePopup: Found cached metadata for', hexPubkey.slice(0, 8) + '...');
        result = { events: [cachedUserEvent.event], relays: cachedUserEvent.relays };
      } else {
        console.log('ProfilePopup: No cached metadata, loading from relays for', hexPubkey.slice(0, 8) + '...');
        
        // Fetch profile data with timeout
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Profile fetch timeout')), 10000)
        );
        
        const fetchPromise = relayService.queryEvents(
          'anonymous', // Always use anonymous for metadata requests - relays are determined by type
          'metadata-read',
          [{ kinds: [0], authors: [hexPubkey], limit: 1 }],
          {
            excludeUserContent: false,
            currentUserPubkey: undefined
          }
        );
        
        result = await Promise.race([fetchPromise, timeoutPromise]);
        
        // Store the metadata in cache for future use
        if (result.events.length > 0) {
          const eventsToStore = result.events.map((event: any) => ({
            event,
            relays: result.relays
          }));
          await contentCache.storeEvents('metadata', eventsToStore);
          console.log('ProfilePopup: Cached metadata for', hexPubkey.slice(0, 8) + '...');
        }
      }
      const userEvent = result.events.find((event: any) => event.pubkey === hexPubkey && event.kind === 0);
      
      // Also fetch kind 10133 (payto payment targets) - replaceable event
      let paytoEvent: any = null;
      try {
        // Check cache first
        const cachedPaytoEvent = cachedEvents.find(cached => cached.event.pubkey === hexPubkey && cached.event.kind === 10133);
        
        if (cachedPaytoEvent) {
          paytoEvent = cachedPaytoEvent.event;
        } else {
          const paytoResult = await relayService.queryEvents(
            'anonymous',
            'metadata-read',
            [{ kinds: [10133], authors: [hexPubkey], limit: 1 }],
            { excludeUserContent: false, currentUserPubkey: undefined }
          );
          if (paytoResult.events.length > 0) {
            // Get the latest replaceable event (highest created_at)
            paytoEvent = paytoResult.events.reduce((latest: any, current: any) => 
              current.created_at > (latest?.created_at || 0) ? current : latest
            );
            // Cache the payto event
            const eventsToStore = paytoResult.events.map((event: any) => ({
              event,
              relays: paytoResult.relays
            }));
            await contentCache.storeEvents('metadata', eventsToStore);
          }
        }
      } catch (e) {
        console.warn('Failed to fetch payto event:', e);
      }
      
      if (userEvent) {
        try {
          // Parse profile data from tags (preferred) and content (fallback)
          const profileData = parseProfileData(userEvent, paytoEvent);
          
          // Ensure arrays are always arrays, even if empty
          const websites = Array.isArray(profileData.websites) && profileData.websites.length > 0 
            ? profileData.websites 
            : (profileData.website ? [profileData.website] : []);
          const nip05s = Array.isArray(profileData.nip05s) && profileData.nip05s.length > 0 
            ? profileData.nip05s 
            : (profileData.nip05 ? [profileData.nip05] : []);
          const lud16s = Array.isArray(profileData.lud16s) && profileData.lud16s.length > 0 
            ? profileData.lud16s 
            : (profileData.lud16 ? [profileData.lud16] : []);
          
          userData = {
            pubkey: hexPubkey,
            npub: npub,
            display_name: profileData.display_name || profileData.name || 'Unknown',
            name: profileData.name || 'Unknown',
            about: profileData.about || '',
            picture: profileData.picture || '',
            banner: profileData.banner || '',
            website: profileData.website || '',
            websites: websites,
            lud16: profileData.lud16 || '',
            lud16s: lud16s,
            nip05: profileData.nip05 || '',
            nip05s: nip05s,
            payments: profileData.payments || [],
            bot: profileData.bot
          };
          
        } catch (e) {
          console.error('Failed to parse user metadata:', e);
          throw e;
        }
      } else {
        // No user event found - provide basic profile info
        userData = {
          pubkey: hexPubkey,
          npub: npub,
          display_name: hexPubkey.slice(0, 8) + '...',
          name: hexPubkey.slice(0, 8) + '...',
          about: 'Profile not found on relays. This user may not have published their metadata yet.',
          picture: '',
          banner: '',
          website: '',
          websites: [],
          lud16: '',
          lud16s: [],
          nip05: '',
          nip05s: [],
          payto: [],
          bot: undefined
        };
      }
    } catch (e) {
      console.error('ProfilePopup: Failed to fetch user data:', e);
      userData = {
        pubkey: pubkey,
        npub: pubkey,
        display_name: 'Profile Unavailable',
        name: 'Profile Unavailable',
        about: 'Unable to load profile data. This may be due to network issues or the profile not being found.',
        picture: '',
        banner: '',
        website: '',
        websites: [],
        lud16: '',
        lud16s: [],
        nip05: '',
        nip05s: [],
        payto: [],
        bot: undefined
      };
    } finally {
      loading = false;
    }
  }

  // Watch for isOpen prop changes
  $effect(() => {
    if (isOpen && pubkey) {
      // Reset NIP-05 states
      nip05Verifying = false;
      nip05Verified = false;
      nip05RetryCount = 0;
      
      // Set immediate fallback profile
      userData = {
        pubkey: pubkey,
        npub: pubkey,
        display_name: 'Loading...',
        name: 'Loading...',
        about: 'Loading profile data...',
        picture: '',
        banner: '',
        website: '',
        websites: [],
        lud16: '',
        lud16s: [],
        nip05: '',
        nip05s: [],
        payto: [],
        bot: undefined
      };
      loading = true; // Keep loading true until fetchUserData completes
      
      // Try to load real profile data in background with a safety timeout
      const safetyTimeout = setTimeout(() => {
        if (loading) {
          console.warn('ProfilePopup: Safety timeout reached, showing fallback profile');
          loading = false;
          userData = {
            pubkey: pubkey,
            npub: pubkey,
            display_name: pubkey.slice(0, 8) + '...',
            name: pubkey.slice(0, 8) + '...',
            about: 'Profile loading timed out. This may be due to network issues.',
            picture: '',
            banner: '',
            website: '',
            websites: [],
            lud16: '',
            lud16s: [],
            nip05: '',
            nip05s: [],
            payto: [],
            bot: undefined
          };
        }
      }, 15000); // 15 second safety timeout
      
      fetchUserData().finally(() => {
        clearTimeout(safetyTimeout);
      });
    } else if (!isOpen) {
      // Reset state when closing
      loading = false;
      userData = null;
    }
  });

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      onClose();
    }
  }

  // Process links in about text
  function processAboutLinks() {
    if (!aboutElement || !userData?.about) return;

    const text = userData.about;
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);

    aboutElement.innerHTML = '';

    parts.forEach((part: string) => {
      if (urlRegex.test(part)) {
        const link = document.createElement('a');
        link.href = part;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.className = 'text-blue-600 hover:text-blue-800 underline';
        link.textContent = part;
        aboutElement?.appendChild(link);
      } else {
        const textNode = document.createTextNode(part);
        aboutElement?.appendChild(textNode);
      }
    });
  }

  // Verify NIP-05
  async function verifyNip05() {
    if (!userData || !userData.nip05 || nip05Verifying || nip05Verified || nip05RetryCount >= 2) return;
    
    nip05Verifying = true;
    nip05RetryCount++;
    
    try {
      if (!userData || !userData.nip05) return;
      const [name, domain] = userData.nip05.split('@');
      
      // Validate domain exists and is not undefined
      if (!domain || domain === 'undefined' || domain === 'null' || domain.trim() === '') {
        console.warn('Invalid NIP-05 domain:', domain);
        nip05Verified = false;
        return;
      }
      
      const wellKnownUrl = `https://${domain}/.well-known/nostr.json?name=${name}`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch(wellKnownUrl, {
        signal: controller.signal,
        mode: 'cors'
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const data = await response.json();
        const names = data.names || {};
        const wellKnownPubkey = names[name];
        // Check userData is still valid after async operation
        if (userData && userData.pubkey) {
          nip05Verified = wellKnownPubkey === userData.pubkey;
        } else {
          nip05Verified = false;
        }
      } else {
        nip05Verified = false;
      }
      
      // Reset verifying state
      nip05Verifying = false;
    } catch (e) {
      console.error('NIP-05 verification failed:', e);
      nip05Verified = false;
    } finally {
      nip05Verifying = false;
    }
  }

  // Open NIP-05 well-known URL
  function openNip05WellKnown() {
    if (!userData?.nip05) return;
    
    const [name, domain] = userData.nip05.split('@');
    const wellKnownUrl = `https://${domain}/.well-known/nostr.json?name=${name}`;
    window.open(wellKnownUrl, '_blank', 'noopener,noreferrer');
  }

  // Check if user supports nostr zaps
  async function checkZapSupport() {
    if (!userData || !userData.lud16s || userData.lud16s.length === 0) {
      lnurlPayInfo = null;
      return;
    }

    // Check the first lightning address for zap support
    const lud16 = userData.lud16s[0];
    try {
      const lnurlPay = await fetchLNURLPay(lud16);
      if (lnurlPay) {
        lnurlPayInfo = {
          allowsNostr: lnurlPay.allowsNostr || false,
          nostrPubkey: lnurlPay.nostrPubkey
        };
      } else {
        lnurlPayInfo = null;
      }
    } catch (error) {
      console.error('Failed to check zap support:', error);
      lnurlPayInfo = null;
    }
  }

  // Send a zap to the user
  async function sendZapToUser() {
    if (!userData || !$account) {
      alert('Please log in to send zaps');
      return;
    }

    if (!lnurlPayInfo?.allowsNostr) {
      alert('This user does not support nostr zaps. Use the lightning address directly.');
      return;
    }

    try {
      // Prompt for amount
      const amountInput = prompt('Enter zap amount in sats (default: 1000):', '1000');
      if (amountInput === null) {
        return; // User cancelled
      }

      const amountSats = parseInt(amountInput) || 1000;
      const amountMillisats = amountSats * 1000;

      // Prompt for optional message
      const message = prompt('Enter optional zap message (or leave empty):', '');

      zapLoading = true;

      // Get relays from relay service
      const relays = await relayService.getRelaysForOperation($account.pubkey, 'social-write');
      
      // Send zap
      const result = await sendZap({
        recipientPubkey: userData.pubkey,
        amountMillisats,
        relays: relays.length > 0 ? relays : ['wss://relay.damus.io'], // Fallback relay
        content: message || undefined
      });

      if (result) {
        // Open invoice in lightning wallet
        const lightningUrl = `lightning:${result.invoice}`;
        try {
          window.location.href = lightningUrl;
        } catch (e) {
          // Fallback: copy to clipboard
          await navigator.clipboard.writeText(result.invoice);
          alert(`Zap invoice copied to clipboard!\n\n${result.invoice}\n\nPaste it into your lightning wallet.`);
        }

        // Refresh zap receipts after a delay
        setTimeout(() => {
          loadZapReceipts();
        }, 3000);
      }
    } catch (error) {
      console.error('Failed to send zap:', error);
      alert(`Failed to send zap: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      zapLoading = false;
    }
  }

  // Load zap receipts for this user
  async function loadZapReceipts() {
    if (!userData) return;

    try {
      const receipts = await fetchZapReceipts(userData.pubkey);
      zapReceipts = receipts;
    } catch (error) {
      console.error('Failed to load zap receipts:', error);
    }
  }

  // Handle payto click - open payto:// URI or handle specific types
  function handlePaytoClick(payto: { type: string; authority: string; uri: string }) {
    const type = payto.type.toLowerCase();
    const authority = payto.authority;
    const uri = payto.uri;

    // Lightning - use existing lightning invoice function
    if (type === 'lightning' && authority.includes('@')) {
      openLightningInvoice(authority);
      return;
    }

    // Bitcoin - try bitcoin: protocol, fallback to block explorer
    if (type === 'bitcoin') {
      try {
        window.location.href = `bitcoin:${authority}`;
      } catch (e) {
        const blockExplorerUrl = `https://blockstream.info/address/${authority}`;
        window.open(blockExplorerUrl, '_blank', 'noopener,noreferrer');
      }
      return;
    }

    // Ethereum - try ethereum: protocol, fallback to block explorer
    if (type === 'ethereum') {
      try {
        window.location.href = `ethereum:${authority}`;
      } catch (e) {
        const blockExplorerUrl = `https://etherscan.io/address/${authority}`;
        window.open(blockExplorerUrl, '_blank', 'noopener,noreferrer');
      }
      return;
    }

    // Monero - copy to clipboard
    if (type === 'monero') {
      navigator.clipboard.writeText(authority);
      alert(`Monero address copied to clipboard!\n\n${authority}\n\nPaste it into your Monero wallet.`);
      return;
    }

    // Nano - try nano: protocol or copy
    if (type === 'nano') {
      try {
        window.location.href = `nano:${authority}`;
      } catch (e) {
        navigator.clipboard.writeText(authority);
        alert(`Nano address copied to clipboard!\n\n${authority}`);
      }
      return;
    }

    // Stablecoins (USDT, USDC, DAI) - usually on Ethereum or Tron
    if (type === 'tether' || type === 'usdt' || type === 'usdc' || type === 'dai') {
      // Check if authority looks like an Ethereum address (starts with 0x)
      if (authority.startsWith('0x') && authority.length === 42) {
        // Ethereum-based stablecoin
        try {
          window.location.href = `ethereum:${authority}`;
        } catch (e) {
          const blockExplorerUrl = `https://etherscan.io/address/${authority}`;
          window.open(blockExplorerUrl, '_blank', 'noopener,noreferrer');
        }
      } else if (authority.startsWith('T') && authority.length === 34) {
        // Tron-based USDT
        const blockExplorerUrl = `https://tronscan.org/#/address/${authority}`;
        window.open(blockExplorerUrl, '_blank', 'noopener,noreferrer');
      } else {
        // Generic: copy to clipboard
        navigator.clipboard.writeText(authority);
        alert(`${type.toUpperCase()} address copied to clipboard!\n\n${authority}`);
      }
      return;
    }

    // PayPal - handle email addresses or PayPal.me links
    if (type === 'paypal') {
      if (authority.startsWith('http')) {
        window.open(authority, '_blank', 'noopener,noreferrer');
      } else if (authority.includes('@')) {
        // Email address - open PayPal.me with username
        const username = authority.split('@')[0];
        window.open(`https://paypal.me/${username}`, '_blank', 'noopener,noreferrer');
      } else if (authority.startsWith('paypal.me/')) {
        // Already a PayPal.me link
        window.open(`https://${authority}`, '_blank', 'noopener,noreferrer');
      } else {
        // Assume it's a PayPal.me username
        window.open(`https://paypal.me/${authority}`, '_blank', 'noopener,noreferrer');
      }
      return;
    }

    // Cash App, Venmo, Revolut - open web links
    if (type === 'cashme' || type === 'venmo' || type === 'revolut') {
      if (authority.startsWith('http')) {
        window.open(authority, '_blank', 'noopener,noreferrer');
      } else {
        // Try to construct URL
        if (type === 'cashme') {
          window.open(`https://cash.app/$${authority}`, '_blank', 'noopener,noreferrer');
        } else if (type === 'venmo') {
          window.open(`https://venmo.com/${authority}`, '_blank', 'noopener,noreferrer');
        } else if (type === 'revolut') {
          window.open(`https://revolut.me/${authority}`, '_blank', 'noopener,noreferrer');
        }
      }
      return;
    }

    // Generic: try payto:// protocol, fallback to copy
    try {
      window.location.href = uri;
    } catch (e) {
      navigator.clipboard.writeText(authority);
      alert(`${type} address copied to clipboard!\n\n${authority}`);
    }
  }

  // Open lightning invoice for a lightning address
  async function openLightningInvoice(lud16: string) {
    if (!lud16 || !lud16.includes('@')) {
      console.error('Invalid lightning address:', lud16);
      return;
    }

    try {
      const [username, domain] = lud16.split('@');
      
      // Step 1: Fetch LNURL from .well-known/lnurlp
      const lnurlEndpoint = `https://${domain}/.well-known/lnurlp/${username}`;
      const lnurlResponse = await fetch(lnurlEndpoint);
      
      if (!lnurlResponse.ok) {
        throw new Error(`Failed to fetch LNURL: ${lnurlResponse.statusText}`);
      }
      
      const lnurlData = await lnurlResponse.json();
      
      if (!lnurlData.callback) {
        throw new Error('No callback URL in LNURL response');
      }
      
      // Step 2: Prompt for amount (default to 1000 sats = 100000 millisats)
      const amountInput = prompt('Enter amount in sats (default: 1000):', '1000');
      if (amountInput === null) {
        return; // User cancelled
      }
      
      const amountSats = parseInt(amountInput) || 1000;
      const amountMillisats = amountSats * 1000;
      
      // Step 3: Fetch invoice from callback
      const callbackUrl = new URL(lnurlData.callback);
      callbackUrl.searchParams.set('amount', amountMillisats.toString());
      
      const invoiceResponse = await fetch(callbackUrl.toString());
      
      if (!invoiceResponse.ok) {
        throw new Error(`Failed to fetch invoice: ${invoiceResponse.statusText}`);
      }
      
      const invoiceData = await invoiceResponse.json();
      
      if (!invoiceData.pr) {
        throw new Error('No invoice (pr) in response');
      }
      
      // Step 4: Open invoice in lightning wallet
      // Try lightning: protocol first, then fallback to copying to clipboard
      const invoice = invoiceData.pr;
      const lightningUrl = `lightning:${invoice}`;
      
      // Try to open with lightning: protocol
      try {
        window.location.href = lightningUrl;
      } catch (e) {
        // If lightning: protocol doesn't work, copy to clipboard and show QR code option
        await navigator.clipboard.writeText(invoice);
        alert(`Invoice copied to clipboard!\n\n${invoice}\n\nPaste it into your lightning wallet.`);
      }
      
    } catch (error) {
      console.error('Failed to open lightning invoice:', error);
      alert(`Failed to generate lightning invoice: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Parse profile data from tags (preferred) and content (fallback)
  function parseProfileData(event: any, paytoEvent?: any): any {
    const result: any = {
      display_name: [],
      name: [],
      about: [],
      picture: [],
      banner: [],
      website: [],
      websites: [],
      lud16: [],
      lud16s: [],
      nip05: [],
      nip05s: [],
      payto: [], // Array of {type, authority, uri}
      bot: undefined // undefined means not present, true/false means explicitly set
    };
    
    // First, parse payto tags from kind 10133 event (NIP-A3) - primary source
    if (paytoEvent && paytoEvent.tags && Array.isArray(paytoEvent.tags)) {
      for (const tag of paytoEvent.tags) {
        if (!Array.isArray(tag) || tag.length < 3) continue;
        const tagName = tag[0];
        if (tagName.toLowerCase() === 'payto') {
          const type = (tag[1] || '').toLowerCase().trim();
          const authority = tag[2] || '';
          if (type && authority) {
            const uri = `payto://${type}/${encodeURIComponent(authority)}`;
            result.payto.push({
              type: type,
              authority: authority.trim(),
              uri: uri
            });
          }
        }
      }
    }
    
    // Then, parse from kind 0 event tags (preferred for profile data)
    if (event.tags && Array.isArray(event.tags)) {
      for (const tag of event.tags) {
        if (!Array.isArray(tag) || tag.length < 2) continue;
        
        const tagName = tag[0];
        const tagValue = tag[1];
        
        // Special handling for bot tag (boolean)
        if (tagName.toLowerCase() === 'bot') {
          // Default to true if present, only false if value is explicitly "false"
          const botValue = Array.isArray(tagValue) ? tagValue[0] : tagValue;
          result.bot = botValue !== 'false' && botValue !== false;
          continue;
        }
        
        // Special handling for payto tags: ["payto", type, authority, ...]
        if (tagName.toLowerCase() === 'payto' && Array.isArray(tag) && tag.length >= 3) {
          const type = (tag[1] || '').toLowerCase().trim();
          const authority = tag[2] || '';
          if (type && authority) {
            const uri = `payto://${type}/${encodeURIComponent(authority)}`;
            result.payto.push({
              type: type,
              authority: authority.trim(),
              uri: uri
            });
          }
          continue;
        }
        
        // Handle array tags - if tag[1] is an array, use all values
        if (Array.isArray(tagValue)) {
          for (const value of tagValue) {
            if (typeof value === 'string' && value.trim()) {
              addToResult(result, tagName, value.trim());
            }
          }
        } else if (typeof tagValue === 'string' && tagValue.trim()) {
          addToResult(result, tagName, tagValue.trim());
        }
      }
    }
    
    // Then, parse from content as fallback (only if tags didn't provide values)
    if (event.content) {
      try {
        const content = typeof event.content === 'string' ? JSON.parse(event.content) : event.content;
        
        // Only use content values if we don't have tag values
        if (result.display_name.length === 0 && content.display_name) {
          result.display_name.push(content.display_name);
        }
        if (result.name.length === 0 && content.name) {
          result.name.push(content.name);
        }
        if (result.about.length === 0 && content.about) {
          result.about.push(content.about);
        }
        if (result.picture.length === 0 && content.picture) {
          result.picture.push(content.picture);
        }
        if (result.banner.length === 0 && content.banner) {
          result.banner.push(content.banner);
        }
        if (result.website.length === 0 && content.website) {
          result.website.push(content.website);
        }
        if (result.lud16.length === 0 && content.lud16) {
          result.lud16.push(content.lud16);
        }
        if (result.nip05.length === 0 && content.nip05) {
          result.nip05.push(content.nip05);
        }
        // Parse bot from content as fallback (only if not already set from tags)
        if (result.bot === undefined && content.bot !== undefined) {
          result.bot = content.bot !== false && content.bot !== 'false';
        }
      } catch (e) {
        // If content is not JSON, treat it as a string (for kind 1)
        if (result.about.length === 0 && typeof event.content === 'string') {
          result.about.push(event.content);
        }
      }
    }
    
    // Normalize and deduplicate - convert arrays to single values or arrays
    const normalized: any = {};
    
    // For single-value fields, use first value; keep arrays for multi-value fields
    normalized.display_name = normalizeField(result.display_name);
    normalized.name = normalizeField(result.name);
    normalized.about = normalizeField(result.about);
    normalized.picture = normalizeField(result.picture);
    normalized.banner = normalizeField(result.banner);
    
    // For multi-value fields, keep as arrays and deduplicate
    normalized.websites = deduplicateArray(result.website.concat(result.websites));
    normalized.lud16s = deduplicateArray(result.lud16.concat(result.lud16s));
    normalized.nip05s = deduplicateArray(result.nip05.concat(result.nip05s));
    
    // Deduplicate payto targets
    normalized.payto = deduplicatePayto(result.payto);
    
    // Also set single-value versions for backward compatibility
    normalized.website = normalized.websites[0] || '';
    normalized.lud16 = normalized.lud16s[0] || '';
    normalized.nip05 = normalized.nip05s[0] || '';
    
    // Bot tag: default to undefined (not present), only set if explicitly present
    normalized.bot = result.bot;
    
    return normalized;
  }
  
  function addToResult(result: any, tagName: string, value: string) {
    const normalizedName = tagName.toLowerCase();
    
    switch (normalizedName) {
      case 'display_name':
      case 'displayname':
        result.display_name.push(value);
        break;
      case 'name':
        result.name.push(value);
        break;
      case 'about':
      case 'bio':
        result.about.push(value);
        break;
      case 'picture':
      case 'avatar':
        result.picture.push(value);
        break;
      case 'banner':
        result.banner.push(value);
        break;
      case 'website':
      case 'url':
        result.website.push(value);
        break;
      case 'lud16':
      case 'lightning':
        result.lud16.push(value);
        break;
      case 'nip05':
        result.nip05.push(value);
        break;
    }
  }
  
  function normalizeField(values: string[]): string {
    // Return first non-empty value, or empty string
    const filtered = values.filter(v => v && v.trim());
    return filtered[0] || '';
  }
  
  function deduplicateArray(values: string[]): string[] {
    // Normalize, remove duplicates and empty values, preserve order
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
      // Normalize: trim whitespace and convert to lowercase for comparison
      const normalized = (value || '').trim().toLowerCase();
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        // Keep original trimmed value for display (preserve case)
        result.push((value || '').trim());
      }
    }
    return result;
  }

  function deduplicatePayto(payto: any[]): any[] {
    // Normalize and remove duplicate payto targets (same type and authority)
    const seen = new Set<string>();
    const result: any[] = [];
    for (const target of payto) {
      // Normalize: trim and lowercase type and authority
      const normalizedType = (target.type || '').trim().toLowerCase();
      const normalizedAuthority = (target.authority || '').trim().toLowerCase();
      
      if (!normalizedType || !normalizedAuthority) {
        continue; // Skip invalid entries
      }
      
      const key = `${normalizedType}-${normalizedAuthority}`;
      if (!seen.has(key)) {
        seen.add(key);
        // Store normalized values but keep original formatting for display
        result.push({
          type: normalizedType,
          authority: target.authority.trim(), // Keep original case for display
          uri: target.uri || `payto://${normalizedType}/${encodeURIComponent(target.authority.trim())}`
        });
      }
    }
    return result;
  }

  // Payment type metadata from NIP-A3
  const paytoTypes: Record<string, { long: string; short: string; symbol: string }> = {
    bitcoin: { long: 'Bitcoin', short: 'BTC', symbol: '₿' },
    cashme: { long: 'Cash App', short: 'Cash App', symbol: '$' },
    ethereum: { long: 'Ethereum', short: 'ETH', symbol: 'Ξ' },
    lightning: { long: 'Lightning Network', short: 'LBTC', symbol: '丰' },
    monero: { long: 'Monero', short: 'XMR', symbol: 'ɱ' },
    nano: { long: 'Nano', short: 'XNO', symbol: 'Ӿ' },
    paypal: { long: 'PayPal', short: 'PayPal', symbol: '$' },
    revolut: { long: 'Revolut', short: 'Revolut', symbol: '' },
    tether: { long: 'Tether', short: 'USDT', symbol: '$' },
    usdt: { long: 'Tether', short: 'USDT', symbol: '$' },
    usdc: { long: 'USD Coin', short: 'USDC', symbol: '$' },
    dai: { long: 'Dai', short: 'DAI', symbol: '$' },
    venmo: { long: 'Venmo', short: 'Venmo', symbol: '$' }
  };

  function getPaytoTypeInfo(type: string) {
    const normalized = type.toLowerCase();
    return paytoTypes[normalized] || { long: type, short: type.toUpperCase(), symbol: '' };
  }

  // Initialize edit form data
  function initializeEditForm() {
    if (!userData) return;
    
    editFormData = {
      // Tag-based fields (single value)
      display_name: userData.display_name || '',
      name: userData.name || '',
      about: userData.about || '',
      picture: userData.picture || '',
      banner: userData.banner || '',
      // Tag-based fields (multi-value - only these three)
      websites: userData.websites && userData.websites.length > 0 ? [...userData.websites] : [''],
      nip05s: userData.nip05s && userData.nip05s.length > 0 ? [...userData.nip05s] : [''],
      lud16s: userData.lud16s && userData.lud16s.length > 0 ? [...userData.lud16s] : [''],
      // JSON content fields (single value)
      json_display_name: userData.display_name || '',
      json_name: userData.name || '',
      json_about: userData.about || '',
      json_picture: userData.picture || '',
      json_banner: userData.banner || '',
      json_website: userData.website || '',
      json_nip05: userData.nip05 || '',
      json_lud16: userData.lud16 || '',
      // Bot tag
      bot: userData.bot === true ? 'true' : (userData.bot === false ? 'false' : ''),
      // Payto payment targets
      payto: userData.payto && userData.payto.length > 0 
        ? userData.payto.map((p: any) => ({ type: p.type, authority: p.authority }))
        : [{ type: '', authority: '' }]
    };
  }

  // Add a new entry to a multi-value field
  function addFieldEntry(fieldName: string) {
    if (!editFormData) return;
    if (Array.isArray(editFormData[fieldName])) {
      editFormData[fieldName] = [...editFormData[fieldName], ''];
    }
  }

  // Remove an entry from a multi-value field
  function removeFieldEntry(fieldName: string, index: number) {
    if (!editFormData) return;
    if (Array.isArray(editFormData[fieldName]) && editFormData[fieldName].length > 1) {
      editFormData[fieldName] = editFormData[fieldName].filter((_: any, i: number) => i !== index);
    }
  }

  // Add a new payto entry
  function addPaytoEntry() {
    if (!editFormData) return;
    if (!Array.isArray(editFormData.payto)) {
      editFormData.payto = [];
    }
    editFormData.payto = [...editFormData.payto, { type: '', authority: '' }];
  }

  // Remove a payto entry
  function removePaytoEntry(index: number) {
    if (!editFormData) return;
    if (Array.isArray(editFormData.payto) && editFormData.payto.length > 1) {
      editFormData.payto = editFormData.payto.filter((_: any, i: number) => i !== index);
    }
  }

  // Save profile changes
  async function saveProfile() {
    if (!editFormData || !$account) return;
    
    saving = true;
    try {
      // Build tags for kind 0 event
      const tags: string[][] = [];
      
      // Add tag-based fields (single value)
      if (editFormData.display_name.trim()) {
        tags.push(['display_name', editFormData.display_name.trim()]);
      }
      if (editFormData.name.trim()) {
        tags.push(['name', editFormData.name.trim()]);
      }
      if (editFormData.about.trim()) {
        tags.push(['about', editFormData.about.trim()]);
      }
      if (editFormData.picture.trim()) {
        tags.push(['picture', editFormData.picture.trim()]);
      }
      if (editFormData.banner.trim()) {
        tags.push(['banner', editFormData.banner.trim()]);
      }
      
      // Add multi-value tag-based fields (only websites, nip05s, lud16s)
      editFormData.websites.filter((v: string) => v.trim()).forEach((v: string) => {
        tags.push(['website', v.trim()]);
      });
      editFormData.nip05s.filter((v: string) => v.trim()).forEach((v: string) => {
        tags.push(['nip05', v.trim()]);
      });
      editFormData.lud16s.filter((v: string) => v.trim()).forEach((v: string) => {
        tags.push(['lud16', v.trim()]);
      });
      
      // Add bot tag if set
      if (editFormData.bot === 'true' || editFormData.bot === 'false') {
        tags.push(['bot', editFormData.bot]);
      }
      
      // Build JSON content (single values only)
      const jsonContent: any = {};
      if (editFormData.json_display_name.trim()) jsonContent.display_name = editFormData.json_display_name.trim();
      if (editFormData.json_name.trim()) jsonContent.name = editFormData.json_name.trim();
      if (editFormData.json_about.trim()) jsonContent.about = editFormData.json_about.trim();
      if (editFormData.json_picture.trim()) jsonContent.picture = editFormData.json_picture.trim();
      if (editFormData.json_banner.trim()) jsonContent.banner = editFormData.json_banner.trim();
      if (editFormData.json_website.trim()) jsonContent.website = editFormData.json_website.trim();
      if (editFormData.json_nip05.trim()) jsonContent.nip05 = editFormData.json_nip05.trim();
      if (editFormData.json_lud16.trim()) jsonContent.lud16 = editFormData.json_lud16.trim();
      if (editFormData.bot === 'true' || editFormData.bot === 'false') {
        jsonContent.bot = editFormData.bot === 'true';
      }
      
      // Create kind 0 event
      const kind0Event = await signer.signEvent({
        kind: 0,
        tags,
        content: JSON.stringify(jsonContent),
        created_at: Math.floor(Date.now() / 1000)
      });
      
      // Publish kind 0 event (use social-write for profile metadata)
      await relayService.publishEvent(
        $account.pubkey,
        'social-write',
        kind0Event,
        false
      );
      
      // Create kind 10133 event for payto targets
      const paytoTags: string[][] = [];
      editFormData.payto.forEach((p: any) => {
        if (p.type.trim() && p.authority.trim()) {
          paytoTags.push(['payto', p.type.trim().toLowerCase(), p.authority.trim()]);
        }
      });
      
      if (paytoTags.length > 0) {
        const kind10133Event = await signer.signEvent({
          kind: 10133,
          tags: paytoTags,
          content: '',
          created_at: Math.floor(Date.now() / 1000)
        });
        
        // Publish kind 10133 event (use social-write for payment metadata)
        await relayService.publishEvent(
          $account.pubkey,
          'social-write',
          kind10133Event,
          false
        );
      }
      
      // Refresh profile data
      editing = false;
      await fetchUserData();
    } catch (error) {
      console.error('Failed to save profile:', error);
      alert(`Failed to save profile: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      saving = false;
    }
  }

  // Process links when userData changes
  $effect(() => {
    if (userData && aboutElement) {
      processAboutLinks();
    }
    
    // Verify NIP-05 when userData is loaded (max 2 attempts) - verify first one
    if (userData && userData.nip05 && !nip05Verifying && nip05RetryCount < 2) {
      verifyNip05();
    }

    // Check zap support and load zap receipts
    if (userData) {
      checkZapSupport();
      loadZapReceipts();
    }
  });
</script>

<!-- Profile Popup -->
{#if isOpen}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
    onclick={handleBackdropClick}
    onkeydown={(e) => {
      handleKeydown(e);
      if (e.key === 'Enter' || e.key === ' ') {
        handleBackdropClick(e as any);
      }
    }}
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    aria-label="Profile popup"
  >
    <div
      class="rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto"
      style="background-color: var(--bg-primary); border: 1px solid var(--border);"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      role="dialog"
      tabindex="-1"
    >
      <!-- Header -->
      <div class="flex items-center justify-between p-4" style="border-bottom: 1px solid var(--border);">
        <h3 class="text-lg font-semibold" style="color: var(--text-primary);">Profile</h3>
        <div class="flex items-center space-x-2">
          {#if $account && userData && $account.pubkey === userData.pubkey && !editing}
            <button
              onclick={() => {
                editing = true;
                initializeEditForm();
              }}
              class="px-3 py-1 rounded text-sm transition-colors"
              style="background-color: var(--accent); color: white;"
              title="Edit profile"
            >
              Edit
            </button>
          {/if}
          <button
            onclick={onClose}
            class="transition-colors hover:opacity-70"
            style="color: var(--text-secondary);"
            aria-label="Close profile"
          >
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- Content -->
      <div class="p-4">
        {#if loading}
          <div class="flex items-center justify-center py-8">
            <div class="w-8 h-8 border-4 rounded-full animate-spin" style="border-color: var(--border); border-top-color: var(--accent);"></div>
            <span class="ml-3" style="color: var(--text-secondary);">Loading profile...</span>
          </div>
        {:else if editing && editFormData}
          <!-- Edit Form -->
          <div class="space-y-4">
            <div class="flex items-center justify-between mb-4">
              <h4 class="text-lg font-semibold" style="color: var(--text-primary);">Edit Profile</h4>
              <div class="flex items-center space-x-2">
                <button
                  onclick={() => {
                    editing = false;
                    editFormData = null;
                  }}
                  class="px-3 py-1 rounded text-sm transition-colors"
                  style="background-color: var(--bg-secondary); color: var(--text-primary);"
                >
                  Cancel
                </button>
                <button
                  onclick={saveProfile}
                  disabled={saving}
                  class="px-3 py-1 rounded text-sm transition-colors"
                  style="background-color: var(--accent); color: white;"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>

            <!-- Tag-based Fields (Single value) -->
            <div class="space-y-4">
              <h5 class="font-semibold" style="color: var(--text-primary);">Tag-based Fields (Single value)</h5>
              
              <!-- Display Name -->
              <div>
                <label for="edit-display-name" class="block text-sm font-medium mb-1" style="color: var(--text-primary);">Display Name</label>
                <input
                  id="edit-display-name"
                  type="text"
                  bind:value={editFormData.display_name}
                  class="w-full px-3 py-2 rounded border"
                  style="background-color: var(--bg-secondary); border-color: var(--border); color: var(--text-primary);"
                  placeholder="Display name"
                />
              </div>

              <!-- Name -->
              <div>
                <label for="edit-name" class="block text-sm font-medium mb-1" style="color: var(--text-primary);">Name</label>
                <input
                  id="edit-name"
                  type="text"
                  bind:value={editFormData.name}
                  class="w-full px-3 py-2 rounded border"
                  style="background-color: var(--bg-secondary); border-color: var(--border); color: var(--text-primary);"
                  placeholder="Name"
                />
              </div>

              <!-- About -->
              <div>
                <label for="edit-about" class="block text-sm font-medium mb-1" style="color: var(--text-primary);">About</label>
                <textarea
                  id="edit-about"
                  bind:value={editFormData.about}
                  class="w-full px-3 py-2 rounded border"
                  style="background-color: var(--bg-secondary); border-color: var(--border); color: var(--text-primary);"
                  placeholder="About"
                  rows="3"
                ></textarea>
              </div>

              <!-- Picture -->
              <div>
                <label for="edit-picture" class="block text-sm font-medium mb-1" style="color: var(--text-primary);">Picture</label>
                <input
                  id="edit-picture"
                  type="text"
                  bind:value={editFormData.picture}
                  class="w-full px-3 py-2 rounded border"
                  style="background-color: var(--bg-secondary); border-color: var(--border); color: var(--text-primary);"
                  placeholder="Picture URL"
                />
              </div>

              <!-- Banner -->
              <div>
                <label for="edit-banner" class="block text-sm font-medium mb-1" style="color: var(--text-primary);">Banner</label>
                <input
                  id="edit-banner"
                  type="text"
                  bind:value={editFormData.banner}
                  class="w-full px-3 py-2 rounded border"
                  style="background-color: var(--bg-secondary); border-color: var(--border); color: var(--text-primary);"
                  placeholder="Banner URL"
                />
              </div>

              <!-- Bot Tag -->
              <div>
                <label for="edit-bot" class="block text-sm font-medium mb-1" style="color: var(--text-primary);">Bot</label>
                <select
                  id="edit-bot"
                  bind:value={editFormData.bot}
                  class="w-full px-3 py-2 rounded border"
                  style="background-color: var(--bg-secondary); border-color: var(--border); color: var(--text-primary);"
                >
                  <option value="">Not set</option>
                  <option value="true">True</option>
                  <option value="false">False</option>
                </select>
              </div>
            </div>

            <!-- Tag-based Fields (Multi-value) -->
            <div class="space-y-4 mt-6 pt-4 border-t" style="border-color: var(--border);">
              <h5 class="font-semibold" style="color: var(--text-primary);">Tag-based Fields (Multiple values allowed)</h5>
              
              <!-- Websites -->
              <div>
                <div class="block text-sm font-medium mb-1" style="color: var(--text-primary);">Websites</div>
                {#each editFormData.websites as website, i}
                  <div class="flex items-center space-x-2 mb-2">
                    <label for="edit-website-{i}" class="sr-only">Website {i + 1}</label>
                    <input
                      id="edit-website-{i}"
                      type="text"
                      bind:value={editFormData.websites[i]}
                      class="flex-1 px-3 py-2 rounded border"
                      style="background-color: var(--bg-secondary); border-color: var(--border); color: var(--text-primary);"
                      placeholder="Website URL"
                    />
                    {#if editFormData.websites.length > 1}
                      <button
                        onclick={() => removeFieldEntry('websites', i)}
                        class="px-2 py-1 rounded text-sm"
                        style="background-color: var(--bg-tertiary); color: var(--text-secondary);"
                      >
                        ×
                      </button>
                    {/if}
                  </div>
                {/each}
                <button
                  onclick={() => addFieldEntry('websites')}
                  class="mt-1 px-2 py-1 rounded text-sm"
                  style="background-color: var(--bg-secondary); color: var(--accent);"
                >
                  + Add
                </button>
              </div>

              <!-- NIP-05s -->
              <div>
                <div class="block text-sm font-medium mb-1" style="color: var(--text-primary);">NIP-05</div>
                {#each editFormData.nip05s as nip05, i}
                  <div class="flex items-center space-x-2 mb-2">
                    <label for="edit-nip05-{i}" class="sr-only">NIP-05 {i + 1}</label>
                    <input
                      id="edit-nip05-{i}"
                      type="text"
                      bind:value={editFormData.nip05s[i]}
                      class="flex-1 px-3 py-2 rounded border"
                      style="background-color: var(--bg-secondary); border-color: var(--border); color: var(--text-primary);"
                      placeholder="user@domain.com"
                    />
                    {#if editFormData.nip05s.length > 1}
                      <button
                        onclick={() => removeFieldEntry('nip05s', i)}
                        class="px-2 py-1 rounded text-sm"
                        style="background-color: var(--bg-tertiary); color: var(--text-secondary);"
                      >
                        ×
                      </button>
                    {/if}
                  </div>
                {/each}
                <button
                  onclick={() => addFieldEntry('nip05s')}
                  class="mt-1 px-2 py-1 rounded text-sm"
                  style="background-color: var(--bg-secondary); color: var(--accent);"
                >
                  + Add
                </button>
              </div>

              <!-- Lightning Addresses -->
              <div>
                <div class="block text-sm font-medium mb-1" style="color: var(--text-primary);">Lightning Addresses</div>
                {#each editFormData.lud16s as lud16, i}
                  <div class="flex items-center space-x-2 mb-2">
                    <label for="edit-lud16-{i}" class="sr-only">Lightning Address {i + 1}</label>
                    <input
                      id="edit-lud16-{i}"
                      type="text"
                      bind:value={editFormData.lud16s[i]}
                      class="flex-1 px-3 py-2 rounded border"
                      style="background-color: var(--bg-secondary); border-color: var(--border); color: var(--text-primary);"
                      placeholder="user@domain.com"
                    />
                    {#if editFormData.lud16s.length > 1}
                      <button
                        onclick={() => removeFieldEntry('lud16s', i)}
                        class="px-2 py-1 rounded text-sm"
                        style="background-color: var(--bg-tertiary); color: var(--text-secondary);"
                      >
                        ×
                      </button>
                    {/if}
                  </div>
                {/each}
                <button
                  onclick={() => addFieldEntry('lud16s')}
                  class="mt-1 px-2 py-1 rounded text-sm"
                  style="background-color: var(--bg-secondary); color: var(--accent);"
                >
                  + Add
                </button>
              </div>
            </div>

            <!-- JSON Content Fields (Single value) -->
            <div class="space-y-4 mt-6 pt-4 border-t" style="border-color: var(--border);">
              <h5 class="font-semibold" style="color: var(--text-primary);">JSON Content Fields (Single value only)</h5>
              
              <div>
                <label for="edit-json-display-name" class="block text-sm font-medium mb-1" style="color: var(--text-primary);">Display Name</label>
                <input
                  id="edit-json-display-name"
                  type="text"
                  bind:value={editFormData.json_display_name}
                  class="w-full px-3 py-2 rounded border"
                  style="background-color: var(--bg-secondary); border-color: var(--border); color: var(--text-primary);"
                  placeholder="Display name"
                />
              </div>

              <div>
                <label for="edit-json-name" class="block text-sm font-medium mb-1" style="color: var(--text-primary);">Name</label>
                <input
                  id="edit-json-name"
                  type="text"
                  bind:value={editFormData.json_name}
                  class="w-full px-3 py-2 rounded border"
                  style="background-color: var(--bg-secondary); border-color: var(--border); color: var(--text-primary);"
                  placeholder="Name"
                />
              </div>

              <div>
                <label for="edit-json-about" class="block text-sm font-medium mb-1" style="color: var(--text-primary);">About</label>
                <textarea
                  id="edit-json-about"
                  bind:value={editFormData.json_about}
                  class="w-full px-3 py-2 rounded border"
                  style="background-color: var(--bg-secondary); border-color: var(--border); color: var(--text-primary);"
                  placeholder="About"
                  rows="3"
                ></textarea>
              </div>

              <div>
                <label for="edit-json-picture" class="block text-sm font-medium mb-1" style="color: var(--text-primary);">Picture</label>
                <input
                  id="edit-json-picture"
                  type="text"
                  bind:value={editFormData.json_picture}
                  class="w-full px-3 py-2 rounded border"
                  style="background-color: var(--bg-secondary); border-color: var(--border); color: var(--text-primary);"
                  placeholder="Picture URL"
                />
              </div>

              <div>
                <label for="edit-json-banner" class="block text-sm font-medium mb-1" style="color: var(--text-primary);">Banner</label>
                <input
                  id="edit-json-banner"
                  type="text"
                  bind:value={editFormData.json_banner}
                  class="w-full px-3 py-2 rounded border"
                  style="background-color: var(--bg-secondary); border-color: var(--border); color: var(--text-primary);"
                  placeholder="Banner URL"
                />
              </div>

              <div>
                <label for="edit-json-website" class="block text-sm font-medium mb-1" style="color: var(--text-primary);">Website</label>
                <input
                  id="edit-json-website"
                  type="text"
                  bind:value={editFormData.json_website}
                  class="w-full px-3 py-2 rounded border"
                  style="background-color: var(--bg-secondary); border-color: var(--border); color: var(--text-primary);"
                  placeholder="Website URL"
                />
              </div>

              <div>
                <label for="edit-json-nip05" class="block text-sm font-medium mb-1" style="color: var(--text-primary);">NIP-05</label>
                <input
                  id="edit-json-nip05"
                  type="text"
                  bind:value={editFormData.json_nip05}
                  class="w-full px-3 py-2 rounded border"
                  style="background-color: var(--bg-secondary); border-color: var(--border); color: var(--text-primary);"
                  placeholder="user@domain.com"
                />
              </div>

              <div>
                <label for="edit-json-lud16" class="block text-sm font-medium mb-1" style="color: var(--text-primary);">Lightning Address</label>
                <input
                  id="edit-json-lud16"
                  type="text"
                  bind:value={editFormData.json_lud16}
                  class="w-full px-3 py-2 rounded border"
                  style="background-color: var(--bg-secondary); border-color: var(--border); color: var(--text-primary);"
                  placeholder="user@domain.com"
                />
              </div>
            </div>

            <!-- Payment Targets (Kind 10133) -->
            <div class="space-y-4 mt-6 pt-4 border-t" style="border-color: var(--border);">
              <h5 class="font-semibold" style="color: var(--text-primary);">Payment Methods (NIP-A3 payto)</h5>
              {#each editFormData.payto as payto, i}
                <div class="flex items-center space-x-2 mb-2">
                  <label for="edit-payto-type-{i}" class="sr-only">Payment Type</label>
                  <input
                    id="edit-payto-type-{i}"
                    type="text"
                    bind:value={editFormData.payto[i].type}
                    class="w-32 px-3 py-2 rounded border"
                    style="background-color: var(--bg-secondary); border-color: var(--border); color: var(--text-primary);"
                    placeholder="Type (e.g., bitcoin)"
                  />
                  <label for="edit-payto-authority-{i}" class="sr-only">Payment Authority</label>
                  <input
                    id="edit-payto-authority-{i}"
                    type="text"
                    bind:value={editFormData.payto[i].authority}
                    class="flex-1 px-3 py-2 rounded border"
                    style="background-color: var(--bg-secondary); border-color: var(--border); color: var(--text-primary);"
                    placeholder="Address/Authority"
                  />
                  {#if editFormData.payto.length > 1}
                    <button
                      onclick={() => removePaytoEntry(i)}
                      class="px-2 py-1 rounded text-sm"
                      style="background-color: var(--bg-tertiary); color: var(--text-secondary);"
                    >
                      ×
                    </button>
                  {/if}
                </div>
              {/each}
              <button
                onclick={addPaytoEntry}
                class="px-2 py-1 rounded text-sm"
                style="background-color: var(--bg-secondary); color: var(--accent);"
              >
                + Add Payment Method
              </button>
            </div>
          </div>
        {:else if userData}
          <!-- Profile Picture and Name -->
          <div class="flex items-center space-x-4 mb-6">
            {#if userData.picture}
              <img
                src={userData.picture}
                alt={userData.display_name}
                class="w-16 h-16 rounded-full object-cover"
                onerror={(e) => {
                  const target = e.target as HTMLImageElement;
                  if (target) target.style.display = 'none';
                }}
              />
            {:else}
              <div class="w-16 h-16 rounded-full flex items-center justify-center" style="background-color: var(--bg-tertiary);">
                <svg class="w-8 h-8" fill="currentColor" viewBox="0 0 20 20" style="color: var(--text-secondary);">
                  <path fill-rule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clip-rule="evenodd"/>
                </svg>
              </div>
            {/if}
            <div class="flex-1">
              <div class="flex items-center space-x-2">
                <h2 class="text-xl font-semibold" style="color: var(--text-primary);">{userData.display_name}</h2>
                {#if userData.bot === true}
                  <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" style="color: var(--accent);">
                    <title>Bot account</title>
                    <path fill-rule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clip-rule="evenodd"/>
                  </svg>
                {/if}
              </div>
              {#if userData.name && userData.name !== userData.display_name}
                <p style="color: var(--text-secondary);">@{userData.name}</p>
              {/if}
            </div>
          </div>

          <!-- Zap Button -->
          {#if $account && lnurlPayInfo?.allowsNostr}
            <div class="mb-6">
              <button
                onclick={sendZapToUser}
                disabled={zapLoading}
                class="w-full px-4 py-2 rounded transition-colors font-semibold flex items-center justify-center space-x-2"
                style="background-color: var(--accent); color: white;"
                title="Send a lightning zap"
              >
                {#if zapLoading}
                  <div class="w-4 h-4 border-2 rounded-full animate-spin" style="border-color: white; border-top-color: transparent;"></div>
                  <span>Sending zap...</span>
                {:else}
                  <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z"/>
                  </svg>
                  <span>⚡ Zap</span>
                {/if}
              </button>
            </div>
          {/if}

          <!-- About Section -->
          {#if userData.about}
            <div class="mb-6">
              <h4 class="font-semibold mb-2" style="color: var(--text-primary);">About</h4>
              <div class="whitespace-pre-wrap" style="color: var(--text-primary);" bind:this={aboutElement}>
                {userData.about}
              </div>
            </div>
          {/if}

          <!-- Websites -->
          {#if userData.websites && userData.websites.length > 0}
            <div class="mb-6">
              <h4 class="font-semibold mb-1" style="color: var(--text-primary);">Website{userData.websites.length > 1 ? 's' : ''}</h4>
              <div class="space-y-1">
                {#each userData.websites as website}
                  <div>
                    <a
                      href={website}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="underline break-all block"
                      style="color: var(--accent);"
                    >
                      {website}
                    </a>
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          <!-- NIP-05 -->
          {#if userData.nip05s && userData.nip05s.length > 0}
            <div class="mb-6">
              <h4 class="font-semibold mb-1">NIP-05{userData.nip05s.length > 1 ? 's' : ''}</h4>
              <div class="space-y-2">
                {#each userData.nip05s as nip05}
                  <div class="flex items-center space-x-2">
                    <button
                      onclick={() => {
                        const [name, domain] = nip05.split('@');
                        const wellKnownUrl = `https://${domain}/.well-known/nostr.json?name=${name}`;
                        window.open(wellKnownUrl, '_blank', 'noopener,noreferrer');
                      }}
                      class="font-mono underline cursor-pointer text-left"
                      style="color: var(--text-primary);"
                      title="Open well-known JSON"
                    >
                      {nip05}
                    </button>
                    {#if userData && nip05 === userData.nip05 && nip05Verifying && !nip05Verified}
                      <div class="w-4 h-4 border-2 rounded-full animate-spin" style="border-color: var(--border); border-top-color: var(--accent);"></div>
                    {:else if userData && nip05 === userData.nip05 && nip05Verified}
                      <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" style="color: #10b981;">
                        <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
                      </svg>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          <!-- Lightning -->
          {#if userData.lud16s && userData.lud16s.length > 0}
            <div class="mb-6">
              <h4 class="font-semibold mb-1">Lightning{userData.lud16s.length > 1 ? ' Addresses' : ''}</h4>
              <div class="space-y-2">
                {#each userData.lud16s as lud16}
                  <div class="flex items-center space-x-2">
                    <button
                      onclick={() => openLightningInvoice(lud16)}
                      class="font-mono underline cursor-pointer text-left flex-1"
                      style="color: var(--accent);"
                      title="Click to generate and open lightning invoice"
                    >
                      {lud16}
                    </button>
                    <button
                      onclick={(e) => {
                        e.stopPropagation();
                        navigator.clipboard.writeText(lud16);
                      }}
                      class="p-1 rounded transition-colors"
                      style="background-color: var(--bg-secondary);"
                      title="Copy lightning address"
                    >
                      <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" style="color: #f59e0b;">
                        <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z"/>
                        <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z"/>
                      </svg>
                    </button>
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          <!-- Payment Targets (NIP-A3 payto) -->
          {#if userData.payto && userData.payto.length > 0}
            <div class="mb-6">
              <h4 class="font-semibold mb-2" style="color: var(--text-primary);">Payment Methods</h4>
              <div class="space-y-2">
                {#each userData.payto as payto}
                  {@const typeInfo = getPaytoTypeInfo(payto.type)}
                  <div class="flex items-center justify-between p-2 rounded" style="background-color: var(--bg-secondary); border: 1px solid var(--border);">
                    <div class="flex-1">
                      <div class="flex items-center space-x-2">
                        {#if typeInfo.symbol}
                          <span class="text-lg" style="color: var(--text-primary);">{typeInfo.symbol}</span>
                        {/if}
                        <span class="font-semibold" style="color: var(--text-primary);">{typeInfo.long}</span>
                        <span class="text-sm" style="color: var(--text-secondary);">({typeInfo.short})</span>
                      </div>
                      <div class="font-mono text-sm mt-1 break-all" style="color: var(--text-primary);">
                        {payto.authority}
                      </div>
                    </div>
                    <div class="flex items-center space-x-1 ml-2">
                      <button
                        onclick={() => handlePaytoClick(payto)}
                        class="px-3 py-1 rounded text-sm transition-colors"
                        style="background-color: var(--accent); color: white;"
                        title="Open payment"
                      >
                        Pay
                      </button>
                      <button
                        onclick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(payto.authority);
                        }}
                        class="p-1 rounded transition-colors"
                        style="background-color: var(--bg-tertiary);"
                        title="Copy address"
                      >
                        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" style="color: var(--text-secondary);">
                          <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z"/>
                          <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          <!-- Zap Receipts -->
          {#if zapReceipts.length > 0}
            <div class="mb-6 pt-4 border-t" style="border-color: var(--border);">
              <h4 class="font-semibold mb-2" style="color: var(--text-primary);">Zaps Received ({zapReceipts.length})</h4>
              <div class="space-y-2 text-sm" style="color: var(--text-secondary);">
                {#each zapReceipts.slice(0, 5) as receipt}
                  <div class="flex items-center space-x-2">
                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" style="color: #f59e0b;">
                      <path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z"/>
                    </svg>
                    <span class="font-mono text-xs">
                      {new Date(receipt.created_at * 1000).toLocaleDateString()}
                    </span>
                  </div>
                {/each}
                {#if zapReceipts.length > 5}
                  <p class="text-xs" style="color: var(--text-secondary);">+{zapReceipts.length - 5} more</p>
                {/if}
              </div>
            </div>
          {/if}

          <!-- Technical Info -->
          <div class="pt-4 border-t" style="border-color: var(--border);">
            <h4 class="font-semibold mb-2" style="color: var(--text-primary);">Technical Info</h4>
            <div class="text-sm space-y-1" style="color: var(--text-secondary);">
              <p><span class="font-medium">Npub:</span>
                <a
                  href="https://jumble.imwald.eu/users/{userData.npub}"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="font-mono break-all underline ml-1"
                  style="color: var(--accent);"
                >
                  {userData.npub}
                </a>
              </p>
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
