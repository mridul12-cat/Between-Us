import { defineConfig } from 'vitest/config';
export default defineConfig({test:{include:['tests/**/*.test.ts','src/sign/vendor/*.test.ts'],environment:'node'}});
