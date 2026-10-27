import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// This source distribution builds only public assets. Private data release,
// credential handling, and deployment exports remain outside this repository.
export default defineConfig({
  plugins: [react()],
  define: { __FWI_KA__: 'null', __FWI_KB__: 'null' },
  publicDir: false,
  build: {
    chunkSizeWarningLimit: 4000,
    sourcemap: false,
    rollupOptions: { input: { preview: 'index.html', app: 'app.html' } },
  },
});
