<script lang="ts">
  import type { BookReference } from '$lib/books';
  import BibleFallbackCard from './BibleFallbackCard.svelte';
  import TorahFallbackCard from './TorahFallbackCard.svelte';
  import QuranFallbackCard from './QuranFallbackCard.svelte';

  interface Props {
    parsedQuery: { references: BookReference[]; version?: string; versions?: string[] } | null;
    bibleGatewayUrl: string | null;
    sefariaUrl?: string | null;
    quranComUrl?: string | null;
    referenceOgPreviews: Map<string, { title?: string; description?: string; image?: string } | null>;
    referenceOgLoading: Map<string, boolean>;
    referenceOgErrors: Map<string, string | null>;
    // Helper functions for getting reference keys
    getReferenceKey: (ref: BookReference) => string;
    getReferenceKeyWithVersion?: (ref: BookReference, version?: string) => string;
    // Optional: version for version-specific cards
    version?: string;
    // Optional: version display name
    versionDisplayName?: string;
    // Optional: if true, don't wrap in version card container (for use inside existing version cards)
    noWrapper?: boolean;
    // Only show BibleGateway fallback if bookType is 'bible'
    showBibleGateway?: boolean;
    // Only show Sefaria fallback if bookType is 'torah'
    showSefaria?: boolean;
    // Only show quran.com fallback if bookType is 'quran'
    showQuranCom?: boolean;
  }

  let {
    parsedQuery,
    bibleGatewayUrl,
    sefariaUrl = null,
    quranComUrl = null,
    referenceOgPreviews,
    referenceOgLoading,
    referenceOgErrors,
    getReferenceKey,
    getReferenceKeyWithVersion,
    version,
    versionDisplayName,
    noWrapper = false,
    showBibleGateway = false,
    showSefaria = false,
    showQuranCom = false
  }: Props = $props();
</script>

{#if parsedQuery && parsedQuery.references.length > 0}
  {#if showSefaria}
    <TorahFallbackCard
      {parsedQuery}
      {sefariaUrl}
      {referenceOgPreviews}
      {referenceOgLoading}
      {referenceOgErrors}
      {getReferenceKey}
      {getReferenceKeyWithVersion}
      {version}
      {versionDisplayName}
      {noWrapper}
    />
  {:else if showQuranCom}
    <QuranFallbackCard
      {parsedQuery}
      quranComUrl={quranComUrl}
      {referenceOgPreviews}
      {referenceOgLoading}
      {referenceOgErrors}
      {getReferenceKey}
      {getReferenceKeyWithVersion}
      {version}
      {versionDisplayName}
      {noWrapper}
    />
  {:else if showBibleGateway}
    <BibleFallbackCard
      {parsedQuery}
      {bibleGatewayUrl}
      {referenceOgPreviews}
      {referenceOgLoading}
      {referenceOgErrors}
      {getReferenceKey}
      {getReferenceKeyWithVersion}
      {version}
      {versionDisplayName}
      {noWrapper}
    />
  {/if}
{/if}
