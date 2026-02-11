import { defineConfig } from 'vite';
import { resolve } from 'path';
import legacy from '@vitejs/plugin-legacy';
import { ViteMinifyPlugin } from 'vite-plugin-minify';
import obfuscator from 'vite-plugin-javascript-obfuscator';

export default defineConfig({
  base: './',
  esbuild: {
    drop: ['console', 'debugger'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    minify: 'esbuild', // 切换到 esbuild 以获得极速构建
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'Main.html'),
        admin: resolve(__dirname, 'Admin.html'),
        login: resolve(__dirname, 'Login.html'),
        welcome: resolve(__dirname, 'Welcome.html'),
        mobile: resolve(__dirname, 'Mobile.html'),
      },
      output: {
        entryFileNames: 'js/[name].[hash].js',
        chunkFileNames: 'js/[name].[hash].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name.endsWith('.css')) {
            return 'css/[name].[hash][extname]';
          }
          return 'assets/[name].[hash][extname]';
        },
      },
    },
  },
  plugins: [
    legacy({
      targets: ['defaults', 'not IE 11'],
    }),
    obfuscator({
      include: [/\.js$/],
      exclude: [/node_modules/],
      options: {
        compact: true,
        controlFlowFlattening: true, 
        controlFlowFlatteningThreshold: 0.25, // 降低阈值以提升速度
        deadCodeInjection: false, // 禁用注入死代码，这非常耗时
        identifierNamesGenerator: 'hexadecimal', 
        renameGlobals: true, 
        reservedNames: [
          'userEditor', 'api'
        ],
        selfDefending: true, 
        stringArray: true, 
        stringArrayEncoding: ['rc4'],
        stringArrayThreshold: 0.5, // 降低字符串数组比例
        unicodeEscapeSequence: false, 
      }
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'client-src'),
    },
  },
});
