<script lang="ts">
  import { onMount } from 'svelte';

  let updateAvailable = $state(false);
  let isDismissed = $state(false);
  let isUpdating = $state(false);

  onMount(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    // Check if user already dismissed this session
    const dismissed = sessionStorage.getItem('versionUpdateDismissed');
    if (dismissed === 'true') {
      isDismissed = true;
    }

    let registration: ServiceWorkerRegistration | null = null;

    const checkForUpdates = async () => {
      try {
        registration = await navigator.serviceWorker.ready;
        if (!registration) return;

        // Check if there's a waiting service worker (new version ready)
        if (registration.waiting) {
          // There's already a new version waiting
          updateAvailable = true;
        }

        // Listen for updates
        const handleUpdateFound = () => {
          const newWorker = registration?.installing;
          if (!newWorker) return;

          const handleStateChange = () => {
            if (newWorker.state === 'installed') {
              // New version installed
              if (navigator.serviceWorker.controller) {
                // There's a new version ready (not the first install)
                updateAvailable = true;
              }
            }
          };

          newWorker.addEventListener('statechange', handleStateChange);
        };

        registration.addEventListener('updatefound', handleUpdateFound);

        // Check for updates periodically
        const checkInterval = setInterval(() => {
          if (registration) {
            registration.update();
          }
        }, 60000); // Check every minute

        // Initial update check
        registration.update();
      } catch (error) {
        console.error('Error checking for updates', error);
      }
    };

    checkForUpdates();
  });

  function handleUpdate() {
    isUpdating = true;
    // Reload the page to activate the new service worker
    window.location.reload();
  }

  function handleDismiss() {
    isDismissed = true;
    // Store dismissal in localStorage to avoid showing it again this session
    sessionStorage.setItem('versionUpdateDismissed', 'true');
  }
</script>

{#if updateAvailable && !isDismissed}
  <div class="bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800 px-4 py-3">
    <div class="flex items-center justify-between gap-4">
      <div class="flex items-center gap-3 flex-1">
        <svg class="h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        <div class="flex-1">
          <p class="text-sm font-medium text-blue-800 dark:text-blue-200">
            A new version is available
          </p>
          <p class="text-xs text-blue-600 dark:text-blue-300">
            Click update to get the latest features and improvements
          </p>
        </div>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <button
          onclick={handleUpdate}
          disabled={isUpdating}
          class="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {#if isUpdating}
            <svg class="h-4 w-4 mr-2 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Updating...
          {:else}
            <svg class="h-4 w-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Update
          {/if}
        </button>
        <button
          onclick={handleDismiss}
          class="h-8 w-8 flex items-center justify-center text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 rounded"
          aria-label="Dismiss update banner"
          title="Dismiss"
        >
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  </div>
{/if}

