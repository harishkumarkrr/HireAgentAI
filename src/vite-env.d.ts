/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_VOICE_MODEL: string
  readonly VITE_TTS_MODEL: string
  readonly VITE_GEMINI_API_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
