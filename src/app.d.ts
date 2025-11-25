// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface Platform {}
	}

	// Vite build-time constants
	const __THEME__: string;
	const __VERSION__: string;
	const __CHANGELOG__: string | { added?: string[]; changed?: string[]; fixed?: string[] } | null;
}

export {};
