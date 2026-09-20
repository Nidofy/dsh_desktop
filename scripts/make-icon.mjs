// Build-only asset conversion. User artwork is never fetched at runtime.
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require = createRequire(new URL('../runtime/dsh/package.json', import.meta.url));
const sharp = require('sharp');
const sizes = [16, 24, 32, 48, 64, 128, 256];
const frames = await Promise.all(sizes.map(size => sharp('assets/icon-source.png').resize(size, size).png().toBuffer()));
const header = Buffer.alloc(6 + 16 * frames.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(frames.length, 4);
let offset = header.length;
frames.forEach((frame, i) => {
  const entry = 6 + i * 16;
  header[entry] = header[entry + 1] = sizes[i] % 256;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(frame.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += frame.length;
});
mkdirSync('src-tauri/icons', {recursive: true});
mkdirSync('src-tauri/generated', {recursive: true});
writeFileSync('src-tauri/icons/icon.ico', Buffer.concat([header, ...frames]));
writeFileSync('src-tauri/icons/icon.png', frames.at(-1));
writeFileSync('shell-ui/icon.png', frames.at(-1));
const wallpaper = await sharp('assets/wallpaper-transparent.png').resize(1080, 1080, {fit: 'inside'}).png().toBuffer();
writeFileSync('shell-ui/wallpaper.png', wallpaper);
const script = readFileSync('desktop-theme/inject.js', 'utf8')
  .replace('__WALLPAPER_DATA_URL__', `data:image/png;base64,${wallpaper.toString('base64')}`)
  .replace('__ICON_DATA_URL__', `data:image/png;base64,${frames.at(-1).toString('base64')}`);
writeFileSync('src-tauri/generated/desktop-theme.js', script);
console.log('Built user icon (7 sizes), transparent wallpaper, and offline desktop theme.');
