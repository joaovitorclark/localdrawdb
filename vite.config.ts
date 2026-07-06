import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function resolveApiPort(): number {
  if (process.env.API_PORT) return Number(process.env.API_PORT);
  const metaPath = path.resolve('.localdrawdb-dev.json');
  if (existsSync(metaPath)) {
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
        apiPort?: number;
        instances?: Array<{ slug: string | null; apiPort: number; webPort: number }>;
      };
      // New format: { instances: [...] }
      if (meta.instances && meta.instances.length > 0 && meta.instances[0].apiPort) {
        return meta.instances[0].apiPort;
      }
      // Legacy format: { apiPort }
      if (meta.apiPort) return meta.apiPort;
    } catch {
      /* fallback */
    }
  }
  return Number(process.env.PORT ?? 5174);
}

const apiPort = resolveApiPort();

// Frontend dev server faz proxy de /api -> Fastify do MESMO clone (porta em API_PORT).
// Build sai em dist/, servido pelo Fastify em produção.
export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.VITE_PORT ?? 5173),
    strictPort: true,
    proxy: {
      '/api': `http://127.0.0.1:${apiPort}`,
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('/node_modules/')) return;
          if (
            id.includes('/node_modules/react/') ||
            id.includes('/node_modules/react-dom/') ||
            id.includes('/node_modules/scheduler/')
          ) {
            return 'vendor-react';
          }
          if (
            id.includes('/node_modules/@xyflow/react/') ||
            id.includes('/node_modules/reactflow/')
          ) {
            return 'vendor-reactflow';
          }
        },
      },
    },
  },
});
