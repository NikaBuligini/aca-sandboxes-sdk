import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    effect: 'src/effect.ts',
  },
  outDir: 'build',
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  platform: 'neutral',
  deps: {
    neverBundle: [/^@azure\//, /^@effect\/platform(?:\/.*)?$/, /^effect(?:\/.*)?$/],
  },
});
