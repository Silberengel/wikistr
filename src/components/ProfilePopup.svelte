<script lang="ts">
  import { onMount } from 'svelte';
  import { relayService } from '$lib/relayService';
  import { nip19 } from '@nostr/tools';
  import { account, signer } from '$lib/nostr';
  import { fetchLNURLPay } from '$lib/zaps';
  import UserBadge from './UserBadge.svelte';
  import ProfileWebsiteOG from './ProfileWebsiteOG.svelte';
  import LinkOGCard from './LinkOGCard.svelte';
  import LinkFallback from './LinkFallback.svelte';
  import { isStandaloneLink, extractNostrIdentifier } from '$lib/ogUtils';
  import QRCode from 'qrcode';

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
  let standaloneLinks = $state<Array<{id: string, url: string, hasOG: boolean}>>([]);
  let nip05Verified = $state(false);
  let nip05Verifying = $state(false);
  let nip05RetryCount = $state(0);
  let editing = $state(false);
  let editFormData = $state<any>(null);
  let saving = $state(false);
  let showInvoiceModal = $state(false);
  let invoiceData = $state<{ invoice: string; amountSats: number; comment?: string } | null>(null);
  let showNpubQRModal = $state(false);
  let invoiceQRCode = $state<string | null>(null);
  let npubQRCode = $state<string | null>(null);

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
      const cachedEvents = contentCache.getEvents('profile');
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
          await contentCache.storeEvents('profile', eventsToStore);
          console.log('ProfilePopup: Cached metadata for', hexPubkey.slice(0, 8) + '...');
        }
      }
      const userEvent = result.events.find((event: any) => event.pubkey === hexPubkey && event.kind === 0);
      
      // Check cache for payto event first (fast path)
      let paytoEvent: any = null;
      const cachedPaytoEvent = cachedEvents.find(cached => cached.event.pubkey === hexPubkey && cached.event.kind === 10133);
      if (cachedPaytoEvent) {
        paytoEvent = cachedPaytoEvent.event;
      }
      
      // Display profile immediately with cached data (or without payto if not cached)
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
            payto: profileData.payto || [],
            identities: profileData.identities || [],
            bot: profileData.bot
          };
          
          // Mark loading as false early so UI updates immediately
          loading = false;
          
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
          identities: [],
          bot: undefined
        };
        loading = false;
      }
      
      // Fetch payto events in background if not already cached (non-blocking)
      if (!cachedPaytoEvent && userEvent) {
        // Don't await - let it run in background and update profile when done
        (async () => {
          try {
            const paytoResult = await relayService.queryEvents(
              'anonymous',
              'metadata-read',
              [{ kinds: [10133], authors: [hexPubkey], limit: 1 }],
              { excludeUserContent: false, currentUserPubkey: undefined }
            );
            if (paytoResult.events.length > 0) {
              // Get the latest replaceable event (highest created_at)
              const newPaytoEvent = paytoResult.events.reduce((latest: any, current: any) => 
                current.created_at > (latest?.created_at || 0) ? current : latest
              );
              // Cache the payto event
              const eventsToStore = paytoResult.events.map((event: any) => ({
                event,
                relays: paytoResult.relays
              }));
              await contentCache.storeEvents('profile', eventsToStore);
              
              // Update profile with payto data if userData still exists and matches
              if (userData && userData.pubkey === hexPubkey) {
                const updatedProfileData = parseProfileData(userEvent, newPaytoEvent);
                const websites = Array.isArray(updatedProfileData.websites) && updatedProfileData.websites.length > 0 
                  ? updatedProfileData.websites 
                  : (updatedProfileData.website ? [updatedProfileData.website] : []);
                const nip05s = Array.isArray(updatedProfileData.nip05s) && updatedProfileData.nip05s.length > 0 
                  ? updatedProfileData.nip05s 
                  : (updatedProfileData.nip05 ? [updatedProfileData.nip05] : []);
                const lud16s = Array.isArray(updatedProfileData.lud16s) && updatedProfileData.lud16s.length > 0 
                  ? updatedProfileData.lud16s 
                  : (updatedProfileData.lud16 ? [updatedProfileData.lud16] : []);
                
                userData = {
                  ...userData,
                  website: updatedProfileData.website || '',
                  websites: websites,
                  lud16: updatedProfileData.lud16 || '',
                  lud16s: lud16s,
                  nip05: updatedProfileData.nip05 || '',
                  nip05s: nip05s,
                  payments: updatedProfileData.payments || [],
                  payto: updatedProfileData.payto || [],
                  identities: updatedProfileData.identities || []
                };
              }
            }
          } catch (e) {
            console.warn('Failed to fetch payto event in background:', e);
            // Silently fail - profile already displayed
          }
        })();
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
        identities: [],
        bot: undefined
      };
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
      
      // Track if we've successfully loaded data to prevent timeout from overriding cached data
      let dataLoaded = false;
      
      // Try to load real profile data in background with a safety timeout
      const safetyTimeout = setTimeout(() => {
        // Only show timeout fallback if we haven't successfully loaded data yet
        // Check that userData is still the loading placeholder to avoid overwriting cached/loaded data
        const isStillLoadingPlaceholder = userData && 
          userData.display_name === 'Loading...' && 
          userData.about === 'Loading profile data...';
        
        if (loading && !dataLoaded && isStillLoadingPlaceholder) {
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
            identities: [],
            bot: undefined
          };
        }
      }, 15000); // 15 second safety timeout
      
      fetchUserData().then(() => {
        // Mark that we've successfully loaded data (even if it's empty/fallback profile)
        dataLoaded = true;
      }).finally(() => {
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
    
    // Clear previous standalone links
    standaloneLinks = [];
    const newStandaloneLinks: Array<{id: string, url: string, hasOG: boolean}> = [];

    parts.forEach((part: string, index: number) => {
      if (urlRegex.test(part)) {
        // Check if this link is standalone (on its own line)
        // A link is standalone if:
        // 1. It's the only content (parts.length === 1)
        // 2. It's at the start and followed by empty/newline (parts[1] is empty/whitespace)
        // 3. It's at the end and preceded by empty/newline (parts[index-1] is empty/whitespace)
        // 4. It's surrounded by empty/whitespace on both sides
        const prevPart = index > 0 ? parts[index - 1] : '';
        const nextPart = index < parts.length - 1 ? parts[index + 1] : '';
        const isStandalone = 
          parts.length === 1 || // Only link, no other text
          (index === 0 && (!nextPart || nextPart.trim() === '')) || // Link at start, nothing after
          (index === parts.length - 1 && (!prevPart || prevPart.trim() === '')) || // Link at end, nothing before
          ((!prevPart || prevPart.trim() === '' || prevPart.endsWith('\n')) && 
           (!nextPart || nextPart.trim() === '' || nextPart.startsWith('\n'))); // Link surrounded by whitespace/newlines
        
        if (isStandalone) {
          // This is a standalone link - replace with placeholder and render OG/fallback card
          const linkId = `profile-link-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          const placeholder = document.createElement('div');
          placeholder.id = linkId;
          placeholder.className = 'profile-standalone-link-placeholder';
          placeholder.dataset.url = part;
          
          // Check if it has Nostr identifier (will use fallback)
          const nostrId = extractNostrIdentifier(part);
          const hasOG = !nostrId; // If it has Nostr ID, we'll use fallback instead of OG
          placeholder.dataset.hasOg = hasOG.toString();
          
          aboutElement?.appendChild(placeholder);
          newStandaloneLinks.push({ id: linkId, url: part, hasOG });
        } else {
          // Regular inline link
          const link = document.createElement('a');
          link.href = part;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.className = 'underline';
          link.style.color = 'var(--accent)';
          link.style.transition = 'opacity 0.2s';
          link.onmouseenter = () => {
            link.style.opacity = '0.8';
          };
          link.onmouseleave = () => {
            link.style.opacity = '1';
          };
          link.textContent = part;
          aboutElement?.appendChild(link);
        }
      } else if (part.trim().length > 0) {
        // Only add non-empty text parts
        const textNode = document.createTextNode(part);
        aboutElement?.appendChild(textNode);
      }
    });
    
    // Update standalone links state
    if (newStandaloneLinks.length > 0) {
      standaloneLinks = newStandaloneLinks;
    }
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
      
      // Step 2: Prompt for amount (default: 1000 sats = 100000 millisats)
      const amountInput = prompt('Enter amount in sats (default: 1000):', '1000');
      if (amountInput === null) {
        return; // User cancelled
      }
      
      const amountSats = parseInt(amountInput) || 1000;
      const amountMillisats = amountSats * 1000;
      
      // Step 2.5: Prompt for optional comment/message
      const comment = prompt('Enter optional payment message/comment (or leave empty):', '');
      // If user cancels the comment prompt, treat it as empty string (not null)
      const paymentComment = comment === null ? '' : comment.trim();
      
      // Step 3: Fetch invoice from callback
      const callbackUrl = new URL(lnurlData.callback);
      callbackUrl.searchParams.set('amount', amountMillisats.toString());
      // Add comment if provided (LNURL-Pay supports comment parameter)
      if (paymentComment) {
        callbackUrl.searchParams.set('comment', paymentComment);
      }
      
      const invoiceResponse = await fetch(callbackUrl.toString());
      
      if (!invoiceResponse.ok) {
        throw new Error(`Failed to fetch invoice: ${invoiceResponse.statusText}`);
      }
      
      const invoiceResponseData = await invoiceResponse.json();
      
      if (!invoiceResponseData.pr) {
        throw new Error('No invoice (pr) in response');
      }
      
      // Step 4: Show invoice modal with QR code and copyable text
      const invoice = invoiceResponseData.pr;
      
      // Generate QR code for invoice first
      try {
        invoiceQRCode = await QRCode.toDataURL(invoice, {
          width: 300,
          margin: 2,
          color: {
            dark: '#000000',
            light: '#FFFFFF'
          }
        });
      } catch (e) {
        console.error('Failed to generate invoice QR code:', e);
        invoiceQRCode = null;
      }
      
      // Store invoice data and show modal after QR code is generated
      invoiceData = {
        invoice: invoice,
        amountSats: amountSats,
        comment: paymentComment || undefined
      };
      
      showInvoiceModal = true;
      
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
      identities: [], // Array of {platform, identity, proof, url} for i-tags (NIP-39)
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
        
        // Special handling for i-tags (NIP-39): ["i", "platform:identity", "proof"]
        if (tagName.toLowerCase() === 'i' && Array.isArray(tag) && tag.length >= 3) {
          const platformIdentity = (tag[1] || '').trim();
          const proof = tag[2] || '';
          
          if (platformIdentity && platformIdentity.includes(':')) {
            const [platform, ...identityParts] = platformIdentity.split(':');
            const identity = identityParts.join(':'); // In case identity itself contains ':'
            
            if (platform && identity) {
              const identityInfo = {
                platform: platform.toLowerCase(),
                identity: identity,
                proof: proof,
                url: getIdentityUrl(platform.toLowerCase(), identity, proof)
              };
              result.identities.push(identityInfo);
            }
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
    
    // Deduplicate identities (by platform:identity)
    normalized.identities = deduplicateIdentities(result.identities);
    
    // Also set single-value versions for backward compatibility
    normalized.website = normalized.websites[0] || '';
    normalized.lud16 = normalized.lud16s[0] || '';
    normalized.nip05 = normalized.nip05s[0] || '';
    
    // Bot tag: default to undefined (not present), only set if explicitly present
    normalized.bot = result.bot;
    
    return normalized;
  }
  
  // Get URL for an identity based on platform
  function getIdentityUrl(platform: string, identity: string, proof: string): string {
    switch (platform) {
      case 'github':
        return proof ? `https://gist.github.com/${identity}/${proof}` : `https://github.com/${identity}`;
      case 'twitter':
      case 'x':
        return proof ? `https://twitter.com/${identity}/status/${proof}` : `https://twitter.com/${identity}`;
      case 'mastodon':
        // Format: instance/@username or instance/@username
        if (identity.includes('/@')) {
          const [instance, username] = identity.split('/@');
          return proof ? `https://${instance}/${proof}` : `https://${instance}/@${username}`;
        }
        return proof ? `https://${identity}/${proof}` : `https://${identity}`;
      case 'telegram':
        return proof ? `https://t.me/${proof}` : `https://t.me/${identity}`;
      case 'substack':
        return `https://${identity}.substack.com`;
      case 'medium':
        return `https://medium.com/@${identity}`;
      case 'instagram':
        return `https://instagram.com/${identity}`;
      case 'facebook':
        return `https://facebook.com/${identity}`;
      case 'linkedin':
        return `https://linkedin.com/in/${identity}`;
      case 'youtube':
        return identity.startsWith('@') ? `https://youtube.com/${identity}` : `https://youtube.com/@${identity}`;
      case 'reddit':
        return `https://reddit.com/user/${identity}`;
      case 'discord':
        return `https://discord.com/users/${identity}`;
      default:
        // Generic fallback - try to construct a URL
        if (identity.includes('.')) {
          return `https://${identity}`;
        }
        return '';
    }
  }
  
  // Get icon SVG for a platform
  function getIdentityIcon(platform: string): string {
    switch (platform) {
      case 'github':
        return '<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>';
      case 'twitter':
      case 'x':
        return '<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';
      case 'mastodon':
        return '<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M23.264 9.153c0-5.25-3.244-9.153-8.001-9.153-1.736 0-3.376.75-4.536 1.95C9.528 1.8 7.888 1.05 6.152 1.05 1.395 1.05-1.849 5.403-1.849 10.653c0 1.2.15 2.4.45 3.6.3 1.2.75 2.4 1.35 3.45.6 1.05 1.35 2.1 2.25 3 .9.9 1.95 1.65 3.15 2.25 1.2.6 2.4 1.05 3.6 1.35 1.2.3 2.4.45 3.6.45 1.2 0 2.4-.15 3.6-.45 1.2-.3 2.4-.75 3.6-1.35 1.2-.6 2.25-1.35 3.15-2.25.9-.9 1.65-1.95 2.25-3 .6-1.05 1.05-2.25 1.35-3.45.3-1.2.45-2.4.45-3.6zm-1.5 7.5c-.3.9-.75 1.8-1.35 2.55-.6.75-1.35 1.5-2.25 2.1-.9.6-1.95 1.05-3 1.35-1.05.3-2.1.45-3.15.45-1.05 0-2.1-.15-3.15-.45-1.05-.3-2.1-.75-3-1.35-.9-.6-1.65-1.35-2.25-2.1-.6-.75-1.05-1.65-1.35-2.55-.3-.9-.45-1.8-.45-2.7 0-4.5 2.55-7.8 6.3-7.8 1.5 0 2.85.6 3.9 1.65 1.05 1.05 1.65 2.4 1.65 3.9v.9h3.6v-.9c0-1.5.6-2.85 1.65-3.9 1.05-1.05 2.4-1.65 3.9-1.65 3.75 0 6.3 3.3 6.3 7.8 0 .9-.15 1.8-.45 2.7z"/></svg>';
      case 'telegram':
        return '<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.161l-1.87 8.8c-.138.655-.497.815-1.006.505l-2.79-2.053-1.348 1.293c-.156.156-.289.289-.593.289l.21-2.98 5.16-4.66c.225-.2-.05-.31-.348-.11l-6.38 4.02-2.75-.86c-.6-.19-.614-.6.12-.89l10.74-4.14c.5-.19.94.11.78.69z"/></svg>';
      case 'substack':
        return '<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M22.539 8.242H1.46V5.406h21.08v2.836zM1.46 10.812V24l10.77 5.852L23 24V10.812H1.46zm21.08 1.73v8.8l-10.27 5.578-10.27-5.578v-8.8h20.54z"/></svg>';
      case 'medium':
        return '<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M13.54 12a6.8 6.8 0 01-6.77 6.82A6.8 6.8 0 010 12a6.8 6.8 0 016.77-6.82A6.8 6.8 0 0113.54 12zM20.96 12c0 3.54-1.51 6.42-3.38 6.42-1.87 0-3.39-2.88-3.39-6.42s1.52-6.42 3.39-6.42 3.38 2.88 3.38 6.42M24 12c0 3.17-.53 5.75-1.19 5.75-.66 0-1.19-2.58-1.19-5.75s.53-5.75 1.19-5.75C23.47 6.25 24 8.83 24 12z"/></svg>';
      case 'instagram':
        return '<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>';
      case 'facebook':
        return '<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>';
      case 'linkedin':
        return '<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>';
      case 'youtube':
        return '<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>';
      case 'reddit':
        return '<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"/></svg>';
      case 'discord':
        return '<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>';
      default:
        return '<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm-2 17l-5-5 1.414-1.414L10 14.172l7.586-7.586L19 8l-9 9z"/></svg>';
    }
  }
  
  // Deduplicate identities by platform:identity
  function deduplicateIdentities(identities: any[]): any[] {
    const seen = new Set<string>();
    const result: any[] = [];
    for (const identity of identities) {
      const key = `${identity.platform}:${identity.identity}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(identity);
      }
    }
    return result;
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


          <!-- About Section -->
          {#if userData.about}
            <div class="mb-6">
              <h4 class="font-semibold mb-2" style="color: var(--text-primary);">About</h4>
              <div class="whitespace-pre-wrap" style="color: var(--text-primary);" bind:this={aboutElement}>
                {userData.about}
              </div>
              <!-- Standalone Link OG/Fallback Cards -->
              {#each standaloneLinks as link (link.id)}
                <div class="mt-2">
                  {#if link.hasOG}
                    <LinkOGCard url={link.url} />
                  {:else}
                    <LinkFallback url={link.url} />
                  {/if}
                </div>
              {/each}
            </div>
          {/if}

          <!-- Websites -->
          {#if userData.websites && userData.websites.length > 0}
            <div class="mb-6">
              <h4 class="font-semibold mb-2" style="color: var(--text-primary);">Website{userData.websites.length > 1 ? 's' : ''}</h4>
              <div class="space-y-2">
                {#each userData.websites as website}
                  <ProfileWebsiteOG url={website} />
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
          {#if userData.identities && userData.identities.length > 0}
            <div class="mb-6">
              <h4 class="font-semibold mb-2" style="color: var(--text-primary);">External Identities</h4>
              <div class="space-y-2">
                {#each userData.identities as identity}
                  <div class="flex items-center space-x-2">
                    {#if identity.url}
                      <a
                        href={identity.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="flex items-center space-x-2 flex-1 hover:opacity-80 transition-opacity"
                        style="color: var(--accent);"
                      >
                        <span class="w-5 h-5 flex-shrink-0">{@html getIdentityIcon(identity.platform)}</span>
                        <span class="font-medium">{identity.platform}:</span>
                        <span class="truncate">{identity.identity}</span>
                      </a>
                    {:else}
                      <div class="flex items-center space-x-2 flex-1" style="color: var(--text-secondary);">
                        <span class="w-5 h-5 flex-shrink-0">{@html getIdentityIcon(identity.platform)}</span>
                        <span class="font-medium">{identity.platform}:</span>
                        <span class="truncate">{identity.identity}</span>
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>
          {/if}

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


          <!-- Technical Info -->
          <div class="pt-4 border-t" style="border-color: var(--border);">
            <h4 class="font-semibold mb-2" style="color: var(--text-primary);">Technical Info</h4>
            <div class="text-sm space-y-1" style="color: var(--text-secondary);">
              <div class="flex items-center justify-between">
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
                <button
                  onclick={async () => {
                    if (userData?.npub) {
                      try {
                        npubQRCode = await QRCode.toDataURL(userData.npub, {
                          width: 300,
                          margin: 2,
                          color: {
                            dark: '#000000',
                            light: '#FFFFFF'
                          }
                        });
                      } catch (e) {
                        console.error('Failed to generate npub QR code:', e);
                        npubQRCode = null;
                      }
                    }
                    showNpubQRModal = true;
                  }}
                  class="ml-2 p-2 rounded transition-colors hover:opacity-80"
                  style="background-color: var(--bg-secondary); color: var(--accent); border: 1px solid var(--border);"
                  title="Show QR code for npub"
                >
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<!-- Invoice Modal -->
{#if showInvoiceModal && invoiceData}
  <div
    class="fixed inset-0 z-[60] flex items-center justify-center bg-black bg-opacity-50"
    onclick={(e) => {
      if (e.target === e.currentTarget) {
        showInvoiceModal = false;
        invoiceQRCode = null;
      }
    }}
    onkeydown={(e) => {
      if (e.key === 'Escape') {
        showInvoiceModal = false;
        invoiceQRCode = null;
      }
    }}
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    aria-label="Lightning invoice"
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
        <h3 class="text-lg font-semibold" style="color: var(--text-primary);">Lightning Invoice</h3>
        <button
          onclick={() => {
            showInvoiceModal = false;
        invoiceQRCode = null;
            invoiceQRCode = null;
          }}
          class="transition-colors hover:opacity-70"
          style="color: var(--text-secondary);"
          aria-label="Close invoice"
        >
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>

      <!-- Content -->
      <div class="p-4">
        <div class="text-center mb-4">
          <p class="text-sm mb-2" style="color: var(--text-secondary);">Amount: {invoiceData.amountSats} sats</p>
          {#if invoiceData.comment}
            <p class="text-sm mt-2 italic" style="color: var(--text-secondary);">"{invoiceData.comment}"</p>
          {/if}
        </div>

        <!-- QR Code -->
        {#if invoiceQRCode}
          <div class="flex justify-center mb-4">
            <div class="p-4 rounded" style="background-color: white;">
              <img
                src={invoiceQRCode}
                alt="Lightning invoice QR code"
                class="w-64 h-64"
              />
            </div>
          </div>
        {:else}
          <div class="flex justify-center mb-4">
            <div class="p-4 rounded text-sm" style="background-color: var(--bg-secondary); color: var(--text-secondary);">
              Generating QR code...
            </div>
          </div>
        {/if}

        <!-- Invoice Text (Copyable) -->
        <div class="mb-4">
          <div class="block text-sm font-medium mb-2" style="color: var(--text-primary);">Invoice (click to copy):</div>
          <button
            type="button"
            class="w-full p-3 rounded border break-all font-mono text-xs cursor-pointer hover:opacity-80 transition-opacity text-left"
            style="background-color: var(--bg-secondary); border-color: var(--border); color: var(--text-primary);"
            onclick={async (e) => {
              if (!invoiceData) return;
              try {
                await navigator.clipboard.writeText(invoiceData.invoice);
                // Show temporary feedback
                const target = e.target as HTMLElement;
                if (target) {
                  const originalText = target.textContent;
                  target.textContent = 'Copied!';
                  setTimeout(() => {
                    if (target && originalText) {
                      target.textContent = originalText;
                    }
                  }, 2000);
                }
              } catch (err) {
                console.error('Failed to copy invoice:', err);
              }
            }}
            onkeydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (invoiceData) {
                  navigator.clipboard.writeText(invoiceData.invoice);
                }
              }
            }}
            title="Click to copy invoice"
          >
            {invoiceData.invoice}
          </button>
        </div>

        <!-- Actions -->
        <div class="flex flex-col space-y-2">
          <button
            onclick={async () => {
              if (!invoiceData) return;
              try {
                const lightningUrl = `lightning:${invoiceData.invoice}`;
                window.location.href = lightningUrl;
              } catch (e) {
                console.error('Failed to open lightning URL:', e);
              }
            }}
            class="w-full px-4 py-2 rounded transition-colors font-semibold flex items-center justify-center space-x-2"
            style="background-color: var(--accent); color: white;"
            title="Open in lightning wallet"
          >
            <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z"/>
            </svg>
            <span>Open in Lightning Wallet</span>
          </button>
          <button
            onclick={async () => {
              if (!invoiceData) return;
              try {
                await navigator.clipboard.writeText(invoiceData.invoice);
                alert('Invoice copied to clipboard!');
              } catch (e) {
                console.error('Failed to copy invoice:', e);
                alert('Failed to copy invoice. Please select and copy manually.');
              }
            }}
            class="w-full px-4 py-2 rounded transition-colors font-semibold"
            style="background-color: var(--bg-secondary); color: var(--text-primary); border: 1px solid var(--border);"
            title="Copy invoice to clipboard"
          >
            Copy Invoice
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<!-- Npub QR Code Modal -->
{#if showNpubQRModal && userData}
  <div
    class="fixed inset-0 z-[60] flex items-center justify-center bg-black bg-opacity-50"
    onclick={(e) => {
      if (e.target === e.currentTarget) {
        showNpubQRModal = false;
        npubQRCode = null;
      }
    }}
    onkeydown={(e) => {
      if (e.key === 'Escape') {
        showNpubQRModal = false;
        npubQRCode = null;
      }
    }}
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    aria-label="Npub QR code"
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
        <h3 class="text-lg font-semibold" style="color: var(--text-primary);">Nostr Public Key (npub)</h3>
        <button
          onclick={() => {
            showNpubQRModal = false;
        npubQRCode = null;
            npubQRCode = null;
          }}
          class="transition-colors hover:opacity-70"
          style="color: var(--text-secondary);"
          aria-label="Close QR code"
        >
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>

      <!-- Content -->
      <div class="p-4">
        <div class="text-center mb-4">
          <p class="text-sm mb-2" style="color: var(--text-secondary);">{userData.display_name || userData.name || 'User'}</p>
        </div>

        <!-- QR Code -->
        {#if npubQRCode}
          <div class="flex justify-center mb-4">
            <div class="p-4 rounded" style="background-color: white;">
              <img
                src={npubQRCode}
                alt="Npub QR code"
                class="w-64 h-64"
              />
            </div>
          </div>
        {:else}
          <div class="flex justify-center mb-4">
            <div class="p-4 rounded text-sm" style="background-color: var(--bg-secondary); color: var(--text-secondary);">
              Generating QR code...
            </div>
          </div>
        {/if}

        <!-- Npub Text (Copyable) -->
        <div class="mb-4">
          <div class="block text-sm font-medium mb-2" style="color: var(--text-primary);">Npub (click to copy):</div>
          <button
            type="button"
            class="w-full p-3 rounded border break-all font-mono text-xs cursor-pointer hover:opacity-80 transition-opacity text-left"
            style="background-color: var(--bg-secondary); border-color: var(--border); color: var(--text-primary);"
            onclick={async (e) => {
              if (!userData) return;
              try {
                await navigator.clipboard.writeText(userData.npub);
                // Show temporary feedback
                const target = e.target as HTMLElement;
                if (target) {
                  const originalText = target.textContent;
                  target.textContent = 'Copied!';
                  setTimeout(() => {
                    if (target && originalText) {
                      target.textContent = originalText;
                    }
                  }, 2000);
                }
              } catch (err) {
                console.error('Failed to copy npub:', err);
              }
            }}
            onkeydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (userData) {
                  navigator.clipboard.writeText(userData.npub);
                }
              }
            }}
            title="Click to copy npub"
          >
            {userData.npub}
          </button>
        </div>

        <!-- Actions -->
        <div class="flex flex-col space-y-2">
          <button
            onclick={async () => {
              if (!userData) return;
              try {
                await navigator.clipboard.writeText(userData.npub);
                alert('Npub copied to clipboard!');
              } catch (e) {
                console.error('Failed to copy npub:', e);
                alert('Failed to copy npub. Please select and copy manually.');
              }
            }}
            class="w-full px-4 py-2 rounded transition-colors font-semibold"
            style="background-color: var(--accent); color: white;"
            title="Copy npub to clipboard"
          >
            Copy Npub
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
