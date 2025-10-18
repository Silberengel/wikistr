<script lang="ts">
  import { relayService } from '$lib/relayService';
  import { account, signer } from '$lib/nostr';
  import type { NIP78BookConfig } from '$lib/nip78';
  import { showToast } from '$lib/toast';

  export let onClose: () => void;
  export let onSuccess: () => void;

  let formData = {
    name: '',
    displayName: '',
    description: '',
    books: [{ fullName: '', abbreviations: '' }],
    versions: [{ abbrev: '', fullName: '' }],
    parsingRules: {
      bookPattern: '',
      chapterPattern: '^\\d+$',
      versePattern: '^\\d+(?:[-,\\s]\\d+)*$',
      versionPattern: ''
    }
  };

  let isSubmitting = false;
  let errorMessage = '';

  function addBook() {
    formData.books.push({ fullName: '', abbreviations: '' });
  }

  function removeBook(index: number) {
    if (formData.books.length > 1) {
      formData.books.splice(index, 1);
    }
  }

  function addVersion() {
    formData.versions.push({ abbrev: '', fullName: '' });
  }

  function removeVersion(index: number) {
    if (formData.versions.length > 1) {
      formData.versions.splice(index, 1);
    }
  }

  function validateForm(): string | null {
    if (!formData.name.trim()) return 'Book type name is required';
    if (!formData.displayName.trim()) return 'Display name is required';
    if (formData.books.some(book => !book.fullName.trim())) return 'All books must have a full name';
    if (formData.versions.some(version => !version.abbrev.trim() || !version.fullName.trim())) return 'All versions must have both abbreviation and full name';
    
    // Validate that all book names are unique
    const bookNames = formData.books.map(b => b.fullName.toLowerCase());
    if (new Set(bookNames).size !== bookNames.length) return 'Book names must be unique';
    
    // Validate that all version abbreviations are unique
    const versionAbbrevs = formData.versions.map(v => v.abbrev.toLowerCase());
    if (new Set(versionAbbrevs).size !== versionAbbrevs.length) return 'Version abbreviations must be unique';
    
    return null;
  }

  async function submitForm() {
    const validationError = validateForm();
    if (validationError) {
      errorMessage = validationError;
      return;
    }

    isSubmitting = true;
    errorMessage = '';

    try {
      // Convert form data to NIP78BookConfig format
      const books: { [fullName: string]: string[] } = {};
      formData.books.forEach(book => {
        const abbreviations = book.abbreviations
          .split(',')
          .map(abbr => abbr.trim())
          .filter(abbr => abbr.length > 0);
        books[book.fullName] = abbreviations.length > 0 ? abbreviations : [book.fullName];
      });

      const versions: { [abbrev: string]: string } = {};
      formData.versions.forEach(version => {
        versions[version.abbrev] = version.fullName;
      });

      const config: NIP78BookConfig = {
        app: 'Wikistr',
        type: 'book-config',
        name: formData.name.trim(),
        displayName: formData.displayName.trim(),
        books,
        versions,
        parsingRules: {
          bookPattern: formData.parsingRules.bookPattern || '.*',
          chapterPattern: formData.parsingRules.chapterPattern,
          versePattern: formData.parsingRules.versePattern,
          versionPattern: formData.parsingRules.versionPattern || '.*'
        },
        displayFormat: {
          bookChapterVerse: 'default',
          withVersion: 'default'
        }
      };

      // Create and publish the event
      if (!$account) {
        throw new Error('No account available. Please connect your account first.');
      }

      const event = await signer.signEvent({
        kind: 30078,
        content: JSON.stringify(config),
        tags: [
          ['d', 'wikistr-book-config'],
          ['app', 'Wikistr'],
          ['type', 'book-config'],
          ['name', config.name]
        ],
        created_at: Math.floor(Date.now() / 1000)
      });

      // Publish to relays
      await relayService.publishEvent(
        $account.pubkey,
        'wiki-write',
        event,
        false
      );
      
      showToast({
        type: 'success',
        title: 'Success',
        message: `Book configuration "${config.displayName}" published successfully!`
      });
      
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1000);

    } catch (error) {
      console.error('Failed to publish book configuration:', error);
      errorMessage = `Failed to publish: ${error instanceof Error ? error.message : 'Unknown error'}`;
    } finally {
      isSubmitting = false;
    }
  }
</script>

<div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
  <div class="rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto" style="background-color: var(--bg-primary);">
    <div class="p-6">
      <div class="flex justify-between items-center mb-6">
        <h2 class="text-2xl font-bold" style="color: var(--text-primary);">Create Book Configuration</h2>
        <button
          onclick={onClose}
          class="text-2xl transition-colors"
          style="color: var(--text-muted);"
        >
          ×
        </button>
      </div>

      {#if errorMessage}
        <div class="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
          <p class="text-red-800">{errorMessage}</p>
        </div>
      {/if}

      <form onsubmit={submitForm} class="space-y-6">
        <!-- Basic Information -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label for="name" class="block text-sm font-medium mb-1" style="color: var(--text-primary);">
              Book Type Name *
            </label>
            <input
              id="name"
              type="text"
              bind:value={formData.name}
              placeholder="e.g., torah, quran, hadith"
              class="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2"
              style="border-color: var(--border); background-color: var(--bg-primary); color: var(--text-primary);"
              required
            />
            <p class="text-xs mt-1" style="color: var(--text-muted);">Unique identifier (lowercase, no spaces)</p>
          </div>
          
          <div>
            <label for="displayName" class="block text-sm font-medium mb-1" style="color: var(--text-primary);">
              Display Name *
            </label>
            <input
              id="displayName"
              type="text"
              bind:value={formData.displayName}
              placeholder="e.g., Torah, Quran, Hadith"
              class="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2"
              style="border-color: var(--border); background-color: var(--bg-primary); color: var(--text-primary);"
              required
            />
            <p class="text-xs mt-1" style="color: var(--text-muted);">Human-readable name</p>
          </div>
        </div>

        <!-- Books Section -->
        <div>
          <div class="flex justify-between items-center mb-3">
            <h3 class="text-lg font-medium" style="color: var(--text-primary);">Books</h3>
            <button
              type="button"
              onclick={addBook}
              class="px-3 py-1 bg-blue-500 text-white rounded-md hover:bg-blue-600 text-sm"
            >
              + Add Book
            </button>
          </div>
          
          <div class="space-y-3">
            {#each formData.books as book, index}
              <div class="flex gap-3 items-center">
                <div class="flex-1">
                  <input
                    type="text"
                    bind:value={book.fullName}
                    placeholder="Full book name (e.g., Genesis, Surah Al-Fatiha)"
                    class="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2"
              style="border-color: var(--border); background-color: var(--bg-primary); color: var(--text-primary);"
                    required
                  />
                </div>
                <div class="flex-1">
                  <input
                    type="text"
                    bind:value={book.abbreviations}
                    placeholder="Abbreviations (comma-separated, e.g., Gen, Ge, Gn)"
                    class="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2"
              style="border-color: var(--border); background-color: var(--bg-primary); color: var(--text-primary);"
                  />
                </div>
                {#if formData.books.length > 1}
                  <button
                    type="button"
                    onclick={() => removeBook(index)}
                    class="px-2 py-2 bg-red-500 text-white rounded-md hover:bg-red-600"
                  >
                    ×
                  </button>
                {/if}
              </div>
            {/each}
          </div>
        </div>

        <!-- Versions Section -->
        <div>
          <div class="flex justify-between items-center mb-3">
            <h3 class="text-lg font-medium" style="color: var(--text-primary);">Versions</h3>
            <button
              type="button"
              onclick={addVersion}
              class="px-3 py-1 bg-blue-500 text-white rounded-md hover:bg-blue-600 text-sm"
            >
              + Add Version
            </button>
          </div>
          
          <div class="space-y-3">
            {#each formData.versions as version, index}
              <div class="flex gap-3 items-center">
                <div class="flex-1">
                  <input
                    type="text"
                    bind:value={version.abbrev}
                    placeholder="Version abbreviation (e.g., NIV, KJV, JPS)"
                    class="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2"
              style="border-color: var(--border); background-color: var(--bg-primary); color: var(--text-primary);"
                    required
                  />
                </div>
                <div class="flex-1">
                  <input
                    type="text"
                    bind:value={version.fullName}
                    placeholder="Full version name (e.g., New International Version)"
                    class="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2"
              style="border-color: var(--border); background-color: var(--bg-primary); color: var(--text-primary);"
                    required
                  />
                </div>
                {#if formData.versions.length > 1}
                  <button
                    type="button"
                    onclick={() => removeVersion(index)}
                    class="px-2 py-2 bg-red-500 text-white rounded-md hover:bg-red-600"
                  >
                    ×
                  </button>
                {/if}
              </div>
            {/each}
          </div>
        </div>

        <!-- Advanced Parsing Rules -->
        <details class="border rounded-md" style="border-color: var(--border);">
          <summary class="px-4 py-2 cursor-pointer transition-colors" style="background-color: var(--bg-secondary);">
            Advanced Parsing Rules (Optional)
          </summary>
          <div class="p-4 space-y-4">
            <div>
              <label for="bookPattern" class="block text-sm font-medium mb-1" style="color: var(--text-primary);">
                Book Pattern (Regex)
              </label>
              <input
                id="bookPattern"
                type="text"
                bind:value={formData.parsingRules.bookPattern}
                placeholder="Regex pattern for matching book names"
                class="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2"
              style="border-color: var(--border); background-color: var(--bg-primary); color: var(--text-primary);"
              />
            </div>
            
            <div>
              <label for="versionPattern" class="block text-sm font-medium mb-1" style="color: var(--text-primary);">
                Version Pattern (Regex)
              </label>
              <input
                id="versionPattern"
                type="text"
                bind:value={formData.parsingRules.versionPattern}
                placeholder="Regex pattern for matching version names"
                class="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2"
              style="border-color: var(--border); background-color: var(--bg-primary); color: var(--text-primary);"
              />
            </div>
          </div>
        </details>

        <!-- Submit Buttons -->
        <div class="flex justify-end gap-3 pt-4 border-t">
          <button
            type="button"
            onclick={onClose}
            class="px-4 py-2 border rounded-md transition-colors"
            style="border-color: var(--border); color: var(--text-primary); background-color: var(--bg-secondary);"
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            class="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Publishing...' : 'Publish Configuration'}
          </button>
        </div>
      </form>
    </div>
  </div>
</div>

