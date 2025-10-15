<script lang="ts">
  import { toasts, dismissToast } from '$lib/toast';
  import type { Toast } from '$lib/toast';

  function getToastClasses(toast: Toast): string {
    const baseClasses = "flex items-start p-4 mb-2 rounded-lg shadow-lg border max-w-md";
    
    switch (toast.type) {
      case 'success':
        return `${baseClasses} bg-green-50 border-green-200 text-green-800`;
      case 'error':
        return `${baseClasses} bg-red-50 border-red-200 text-red-800`;
      case 'warning':
        return `${baseClasses} bg-yellow-50 border-yellow-200 text-yellow-800`;
      case 'info':
      default:
        return `${baseClasses} bg-blue-50 border-blue-200 text-blue-800`;
    }
  }

  function getIcon(toast: Toast): string {
    switch (toast.type) {
      case 'success':
        return '✅';
      case 'error':
        return '❌';
      case 'warning':
        return '⚠️';
      case 'info':
      default:
        return 'ℹ️';
    }
  }
</script>

<!-- Toast Container -->
<div class="fixed top-4 right-4 z-50 space-y-2">
  {#each $toasts as toast (toast.id)}
    <div class={getToastClasses(toast)}>
      <div class="flex-shrink-0 mr-3">
        <span class="text-lg">{getIcon(toast)}</span>
      </div>
      <div class="flex-1 min-w-0">
        <h4 class="text-sm font-semibold">{toast.title}</h4>
        <p class="text-sm mt-1">{toast.message}</p>
      </div>
      <div class="flex-shrink-0 ml-3">
        <button
          onclick={() => dismissToast(toast.id)}
          class="text-gray-400 hover:text-gray-600 focus:outline-none"
          aria-label="Dismiss notification"
        >
          <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"></path>
          </svg>
        </button>
      </div>
    </div>
  {/each}
</div>
