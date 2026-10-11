import { build } from 'esbuild';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { crc32 } from 'node:zlib';
const folder = 'dist-obsidian/jarvis-obsidian';
await mkdir(folder, { recursive: true });
await build({ entryPoints: ['obsidian-plugin/main.ts'], bundle: true, format: 'cjs', platform: 'browser', target: 'es2022', external: ['obsidian'], minify: true, outfile: folder + '/main.js' });
for (const name of ['manifest.json', 'styles.css']) await copyFile('obsidian-plugin/' + name, folder + '/' + name);
// Portable, uncompressed ZIP: no dependency on a system zip binary on Render.
const parts = []; const directory = []; let offset = 0;
for (const name of ['manifest.json', 'main.js', 'styles.css']) {
  const data = await readFile(folder + '/' + name); const filename = Buffer.from('jarvis-obsidian/' + name); const crc = crc32(data);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(33, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(33, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42);
  parts.push(local, filename, data); directory.push(central, filename); offset += local.length + filename.length + data.length;
}
const central = Buffer.concat(directory); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(3, 8); end.writeUInt16LE(3, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
await mkdir('dist/downloads', { recursive: true });
await writeFile('dist/downloads/jarvis-obsidian.zip', Buffer.concat([...parts, central, end]));
console.log('Plugin Android/desktop: dist/downloads/jarvis-obsidian.zip');
