import { defineConfig } from 'oxlint';
import preset from '@jasonkuhrt/config-presets/oxlint';

export default defineConfig({
  ...preset,
  ignorePatterns: [...preset.ignorePatterns, '**/build/**'],
});
