import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// `base` targets GitHub Pages project-site hosting (user.github.io/<repo>/).
// Override with BASE_PATH=/ for local or root-domain deploys.
export default defineConfig({
  plugins: [react()],
  base: process.env.BASE_PATH ?? '/pharma-timeline-tool/',
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
