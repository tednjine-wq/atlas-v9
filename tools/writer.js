// tools/writer.js — ALWAYS run from the atlas-v9 folder:
//   node tools/writer.js tools/part1.txt
const fs = require('fs');
const path = require('path');

if (!fs.existsSync(path.join(process.cwd(), 'package.json'))) {
  console.error('ERROR: you are not in the atlas-v9 folder. Run: cd atlas-v9');
  process.exit(1);
}
const src = process.argv[2];
if (!src) { console.error('Usage: node tools/writer.js tools/part1.txt'); process.exit(1); }

const lines = fs.readFileSync(src, 'utf8').split(/\r?\n/);
let cur = null, buf = [], count = 0;

function flush() {
  if (!cur) return;
  fs.mkdirSync(path.dirname(cur), { recursive: true });
  fs.writeFileSync(cur, buf.join('\n').replace(/\n+$/, '') + '\n', 'utf8');
  count++;
  console.log('wrote', path.relative(process.cwd(), cur));
}

for (const line of lines) {
  const m = line.match(/^===ATLAS_FILE:\s*(\S+)\s*===$/);
  if (m) { flush(); cur = path.join(process.cwd(), m[1]); buf = []; }
  else if (cur !== null) buf.push(line);
}
flush();
console.log('DONE: ' + count + ' files written from ' + src);