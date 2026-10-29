import { defineConfig } from 'vitest/config';

// The engine (public/engine/, produced by `npm run engine`) is copied verbatim into the build.
// public/ must only ever contain redistributable build output - never game data.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: false,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
