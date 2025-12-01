<script lang="ts">
  import type { BookReference } from '$lib/books';
  import { generateSefariaUrlForReference } from '$lib/sefariaUtils';
  import BookFallbackCard from './BookFallbackCard.svelte';

  interface Props {
    parsedQuery: { references: BookReference[]; version?: string; versions?: string[] } | null;
    sefariaUrl: string | null;
    referenceOgPreviews: Map<string, { title?: string; description?: string; image?: string } | null>;
    referenceOgLoading: Map<string, boolean>;
    referenceOgErrors: Map<string, string | null>;
    getReferenceKey: (ref: BookReference) => string;
    getReferenceKeyWithVersion?: (ref: BookReference, version?: string) => string;
    version?: string;
    versionDisplayName?: string;
    noWrapper?: boolean;
  }

  let {
    parsedQuery,
    sefariaUrl,
    referenceOgPreviews,
    referenceOgLoading,
    referenceOgErrors,
    getReferenceKey,
    getReferenceKeyWithVersion,
    version,
    versionDisplayName,
    noWrapper = false
  }: Props = $props();

  function generateUrlForReference(ref: BookReference): string | null {
    return generateSefariaUrlForReference(ref);
  }
</script>

<BookFallbackCard
  {parsedQuery}
  serviceUrl={sefariaUrl}
  serviceName="Sefaria"
  {referenceOgPreviews}
  {referenceOgLoading}
  {referenceOgErrors}
  {getReferenceKey}
  {getReferenceKeyWithVersion}
  generateUrlForReference={generateUrlForReference}
  {version}
  {versionDisplayName}
  {noWrapper}
/>

