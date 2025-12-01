<script lang="ts">
  import type { BookReference } from '$lib/books';
  import { generateExploreQuranUrlForReference } from '$lib/exploreQuranUtils';
  import BookFallbackCard from './BookFallbackCard.svelte';

  interface Props {
    parsedQuery: { references: BookReference[]; version?: string; versions?: string[] } | null;
    exploreQuranUrl: string | null;
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
    exploreQuranUrl,
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
    return generateExploreQuranUrlForReference(ref);
  }
</script>

<BookFallbackCard
  {parsedQuery}
  serviceUrl={exploreQuranUrl}
  serviceName="ExploreQuran"
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

