import base from './vitest.config';
import { mergeConfig } from 'vitest/config';
export default mergeConfig(base, {
  server: { fs: { allow: ['.', '/home/kain/onyx'] } },
});
