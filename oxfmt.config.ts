import { defineConfig } from 'oxfmt';
import preset from '@jasonkuhrt/config-presets/oxfmt';

export default defineConfig({
  ...preset,
  ignorePatterns: [...preset.ignorePatterns, 'build'],
});
