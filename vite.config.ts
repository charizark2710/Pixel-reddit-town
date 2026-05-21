import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { devvit } from '@devvit/start/vite';

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwind(), ...(command === 'build' ? [devvit()] : [])],
}));
