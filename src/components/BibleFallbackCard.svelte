<script lang="ts">
  import type { BookReference } from '$lib/books';
  import { generateBibleGatewayUrlForReference } from '$lib/bibleGatewayUtils';
  import BookFallbackCard from './BookFallbackCard.svelte';

  interface Props {
    parsedQuery: { references: BookReference[]; version?: string; versions?: string[] } | null;
    bibleGatewayUrl: string | null;
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
    bibleGatewayUrl,
    referenceOgPreviews,
    referenceOgLoading,
    referenceOgErrors,
    getReferenceKey,
    getReferenceKeyWithVersion,
    version,
    versionDisplayName,
    noWrapper = false
  }: Props = $props();

  function generateUrlForReference(ref: BookReference, refVersion?: string): string | null {
    return generateBibleGatewayUrlForReference(ref, refVersion || version || parsedQuery?.versions?.[0] || parsedQuery?.version);
  }
</script>

<BookFallbackCard
  {parsedQuery}
  serviceUrl={bibleGatewayUrl}
  serviceName="BibleGateway"
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

