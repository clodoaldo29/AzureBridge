/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_API_URL: string;
    // Add any other env variables here
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
