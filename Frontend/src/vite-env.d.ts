/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_API_URL?: string;
    // Adicione outras variáveis de ambiente aqui
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
