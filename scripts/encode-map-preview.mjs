import sharp from 'sharp';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const source = new URL('../public/bh-bairros.svg', import.meta.url);
const output = new URL('../public/bh-bairros.webp', import.meta.url);
await sharp(await readFile(source))
  .resize({width:720}).webp({quality:82,effort:6}).toFile(fileURLToPath(output));
