import type { NostrEvent } from '@nostr/tools/pure';

export type EditorData = {
  title: string;
  summary: string;
  content: string;
  image?: string;
  author?: string;
  previous: ArticleCard | undefined;
  kind?: number; // Original event kind (for edit/fork operations)
  tags?: string[][]; // Original event tags (for kind 30040 which has no content)
};

export type Card =
  | WelcomeCard
  | NewCard
  | SearchCard
  | ArticleCard
  | RelayCard
  | SettingsCard
  | UserCard
  | EditorCard
  | BookCard
  | DiffCard;

export function serializeCardForRouter(card: Card) {
  const serialized = { ...card };

  if (serialized.back) {
    serialized.back = serializeCardForRouter(serialized.back);
  }

  switch (serialized.type) {
    case 'find':
      if (serialized.results) serialized.results = [...serialized.results].map(eventOutFromProxy);
      break;
    case 'article':
      if (serialized.actualEvent)
        serialized.actualEvent = eventOutFromProxy(serialized.actualEvent);
      break;
    case 'diff':
      if (serialized.results) serialized.results = [...serialized.results].map(eventOutFromProxy);
      break;
  }

  return serialized;
}

function eventOutFromProxy(event: NostrEvent): NostrEvent {
  return { ...event, tags: [...event.tags].map((tag) => [...tag]) };
}

export type WelcomeCard = {
  id: number;
  type: 'welcome';
  back?: Card;
};

export type NewCard = {
  id: number;
  type: 'new';
  back: undefined;
};

export type SearchCard = {
  id: number;
  type: 'find';
  back?: Card;
  data: string; // article title query
  preferredAuthors: string[];
  results?: NostrEvent[];
  seenCache?: { [id: string]: string[] };
};

export type ArticleCard = {
  id: number;
  type: 'article';
  back?: Card;
  data: [string, string]; // d-tag * pubkey
  relayHints: string[];
  actualEvent?: NostrEvent; // for when we already have it we can skip relays
  versions?: NostrEvent[];
};

export type RelayCard = {
  id: number;
  type: 'relay';
  back?: Card;
  data: string; // relay url
};

export type UserCard = {
  id: number;
  type: 'user';
  back?: Card;
  data: string; // user pubkey
};

export type SettingsCard = {
  id: number;
  type: 'settings';
  back?: Card;
};

export type EditorCard = {
  id: number;
  type: 'editor';
  back?: Card;
  data: EditorData;
};

export type BookCard = {
  id: number;
  type: 'book';
  back?: Card;
  data: string; // Book query like "John 3:16" or "[[John 1–3; 3:16; 6:14, 44 | KJV]]" or "[[Al-Fatiha 1-7 | SAHIH]]"
  bookType?: string; // Optional book type (bible, quran, catechism, etc.)
  results?: NostrEvent[];
  seenCache?: { [id: string]: string[] };
};


export type DiffCard = {
  id: number;
  type: 'diff';
  back?: Card;
  data: string; // diff query like "diff::John 3:16 KJV | NIV"
  selectedEvents?: NostrEvent[]; // the actual events to compare
  results?: NostrEvent[];
  seenCache?: { [id: string]: string[] };
};
