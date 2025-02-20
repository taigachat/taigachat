import pluginJs from "@eslint/js";
import tselint from "typescript-eslint";
import globals from "globals";
import * as svelteParser from "svelte-eslint-parser";
import * as typescriptParser from "@typescript-eslint/parser";
import eslintPluginSvelte from "eslint-plugin-svelte";

export default [
    {
        ignores: ["Build/", "index.js", "task.mjs", "vite.config.mjs", "Tools/artifact_tool.ts"],
    },
    {
        languageOptions: {
            ecmaVersion: 2020,
            sourceType: "module",
            globals: {
                ...globals.browser,
                ...globals.es2020,
                RequestCache: false,
                EcdsaParams: false,
                EcKeyImportParams: false,
                MediaDeviceKind: false,
                PushSubscriptionJSON: false,
            },
        },
    },
    ...tselint.config(pluginJs.configs.recommended, tselint.configs.recommended),
    ...eslintPluginSvelte.configs["flat/recommended"],
    {
        files: ["**/*.svelte"],
        languageOptions: {
            parser: svelteParser,
            parserOptions: {
                parser: {
                    // Specify a parser for each lang.
                    ts: typescriptParser,
                    typescript: typescriptParser,
                },
                project: "./tsconfig.json",
                extraFileExtensions: [".svelte"],
            },
        },
    },
    {
        rules: {
            "@typescript-eslint/no-unused-vars": [
                "warn",
                { varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", argsIgnorePattern: "^_" },
            ],

            "no-undef": "warn",
        },
    },
];
