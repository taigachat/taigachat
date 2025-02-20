import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default {
    // Consult https://svelte.dev/docs#compile-time-svelte-preprocess
    // for more information about preprocessors
    preprocess: vitePreprocess(),
    compilerOptions: {
        compatibility: {
            componentApi: 4, // TODO: Remove if we ever get around the migrating to version 5 of svelte.
        },
    },
};
