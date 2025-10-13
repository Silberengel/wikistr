<script lang="ts">
  import type { EventTemplate } from '@nostr/tools/pure';
  import AsciidocContent from '$components/AsciidocContent.svelte';
  import { DEFAULT_WIKI_RELAYS } from '$lib/defaults';
  import { wikiKind, account, signer, loadBlockedRelays } from '$lib/nostr';
  import type { ArticleCard, Card, EditorCard, EditorData } from '$lib/types.ts';
  import {
    getTagOr,
    next,
    preprocessContentForAsciidoc,
    unique,
    urlWithoutScheme,
    deduplicateRelays
  } from '$lib/utils';
  import { pool } from '@nostr/gadgets/global';
  import { loadRelayList } from '@nostr/gadgets/lists';
  import { normalizeIdentifier } from '@nostr/tools/nip54';

  interface Props {
    replaceSelf: (card: Card) => void;
    card: Card;
  }

  let { replaceSelf, card }: Props = $props();

  const editorCard = card as EditorCard;

  let data = $state<EditorData>({ ...editorCard.data });
  let error = $state<string | undefined>();
  let targets: { url: string; status: 'pending' | 'success' | 'failure'; message?: string }[] =
    $state([]);
  let previewing = $state(false);


  async function publish() {
    const [relayListItems, blockedRelays] = await Promise.all([
      loadRelayList($account!.pubkey),
      loadBlockedRelays($account!.pubkey)
    ]);
    
    const writeRelays = relayListItems.items.filter((ri) => ri.write).map((ri) => ri.url);
    const normalizedBlocked = new Set(deduplicateRelays(blockedRelays));
    
    // Combine write relays with defaults, normalize and deduplicate
    const allRelays = unique(writeRelays, DEFAULT_WIKI_RELAYS);
    const normalizedRelays = deduplicateRelays(allRelays);
    
    // Filter out blocked relays
    const finalRelays = normalizedRelays.filter(url => !normalizedBlocked.has(url));
    
    targets = finalRelays.map((url) => ({ url, status: 'pending' }));
    error = undefined;

    data.title = data.title.trim();

    let eventTemplate: EventTemplate = {
      kind: wikiKind,
      tags: [['d', normalizeIdentifier(data.title)]],
      content: data.content.trim(),
      created_at: Math.round(Date.now() / 1000)
    };
    if (data.title !== eventTemplate.tags[0][1]) eventTemplate.tags.push(['title', data.title]);
    if (data.summary) eventTemplate.tags.push(['summary', data.summary]);

    try {
      let event = await signer.signEvent(eventTemplate);
      let successes: string[] = [];

      await Promise.all(
        targets.map(async (target, i) => {
          try {
            const r = await pool.ensureRelay(target.url);
            await r.publish(event);
            target.status = 'success';
            successes.push(target.url);
          } catch (err) {
            target.status = 'failure';
            target.message = String(err);
          }
          targets[i] = target;
          targets = targets;
        })
      );

      if (successes.length) {
        setTimeout(() => {
          replaceSelf({
            id: next(),
            type: 'article',
            data: [getTagOr(event, 'd'), event.pubkey],
            actualEvent: event,
            relayHints: successes
          } as ArticleCard);
        }, 1400);
      }
    } catch (err) {
      error = String(err);
      targets = []; // setting this will hide the publish report dialog
      return;
    }
  }
</script>

<div class="my-4 font-bold text-4xl">
  {#if editorCard.data.content}
    Editing an article
  {:else}
    Creating an article
  {/if}
</div>
{#if data}
  <div class="mt-2">
    <label class="flex items-center"
      >Title
      <input
        placeholder="example: Greek alphabet"
        bind:value={data.title}
        class="shadow-sm focus:ring-primary-500 focus:border-primary-500 block w-full sm:text-sm border-gray-300 rounded-md ml-2"
      /></label
    >
  </div>
  <div class="mt-2">
    <!-- svelte-ignore a11y_label_has_associated_control -->
    <label>
      Article
      {#if previewing}
        <div class="prose prose-p:my-0 prose-li:my-0">
          <AsciidocContent 
            event={{ 
              content: data.content, 
              pubkey: $account?.pubkey || '', 
              created_at: Math.floor(Date.now() / 1000),
              kind: 30023,
              tags: [],
              id: '',
              sig: ''
            } as any}
            createChild={() => {}}
          />
        </div>
      {:else}
        <textarea
          placeholder="The **Greek alphabet** has been used to write the [[Greek language]] sincie the late 9th or early 8th century BC. The Greek alphabet is the ancestor of the [[Latin]] and [[Cyrillic]] scripts."
          bind:value={data.content}
          class="h-64 shadow-sm focus:ring-primary-500 focus:border-primary-500 block w-full sm:text-sm border-gray-300 rounded-md"
        ></textarea>
      {/if}
    </label>
  </div>
  <div class="mt-2">
    <details>
      <summary>Add a summary?</summary>
      <label
        >Summary
        <textarea
          bind:value={data.summary}
          placeholder="The Greek alphabet is the earliest known alphabetic script to have distict letters for vowels. The Greek alphabet existed in many local variants."
          class="shadow-sm focus:ring-primary-500 focus:border-primary-500 block w-full sm:text-sm border-gray-300 rounded-md"
        ></textarea></label
      >
    </details>
  </div>
{/if}

<!-- Submit -->
{#if targets.length > 0}
  <div class="mt-2">
    Publishing to:
    {#each targets as target}
      <div class="flex items-center mt-1">
        <div
          class="p-1 rounded"
          class:bg-sky-100={target.status === 'pending'}
          class:bg-red-200={target.status === 'failure'}
          class:bg-emerald-200={target.status === 'success'}
        >
          {urlWithoutScheme(target.url)}
        </div>
        <div class="ml-1 text-xs uppercase font-mono">{target.status}</div>
        <div class="ml-1 text-sm">{target.message || ''}</div>
      </div>
    {/each}
  </div>
{:else}
  {#if error}
    <div class="mt-2 bg-red-200 px-2 py-1 rounded">
      <span class="font-bold">ERROR:</span>
      {error}
    </div>
  {/if}
  <div class="mt-2 flex justify-between">
    <button
      onclick={publish}
      class="cursor-pointer inline-flex items-center px-4 py-2 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
      >Save</button
    >
    <button
      onclick={() => {
        previewing = !previewing;
      }}
      class="cursor-pointer inline-flex items-center px-4 py-2 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-primary-500 hover:bg-primary-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-400"
      >{#if previewing}Edit{:else}Preview{/if}</button
    >
  </div>
{/if}
