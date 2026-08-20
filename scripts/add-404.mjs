/** Make the Pages fallback part of the artifact the browser suite exercises. */
import { copyFileSync } from 'node:fs';

copyFileSync('dist/index.html', 'dist/404.html');
console.log('added dist/404.html');
