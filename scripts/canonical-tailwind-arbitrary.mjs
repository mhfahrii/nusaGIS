import fs from 'node:fs';
import path from 'node:path';

const roots = [
  path.join(process.cwd(), 'src/components/gis/monitoring'),
  path.join(process.cwd(), 'src/components/gis'),
];

/** Urutan: yang lebih panjang / spesifik dulu */
const reps = [
  ['focus:outline-hidden', 'focus:outline-none'],
  ['outline-hidden', 'outline-none'],
  ['text-[10.5px]', 'text-2xs'],
  ['text-[9.5px]', 'text-3xs'],
  ['text-[11px]', 'text-caption'],
  ['text-[10px]', 'text-2xs'],
  ['text-[9px]', 'text-3xs'],
  ['min-w-[210px]', 'min-w-52.5'],
  ['min-w-[160px]', 'min-w-40'],
  ['min-w-[150px]', 'min-w-37.5'],
  ['min-w-[130px]', 'min-w-32.5'],
  ['max-w-[220px]', 'max-w-55'],
  ['max-w-[200px]', 'max-w-50'],
  ['max-w-[150px]', 'max-w-37.5'],
  ['z-[2000]', 'z-2000'],
  ['z-[1200]', 'z-1200'],
  ['z-[9999]', 'z-9999'],
];

let filesChanged = 0;
let total = 0;

function walkDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walkDir(full);
    else if (name.endsWith('.tsx') || name.endsWith('.ts')) processFile(full);
  }
}

function processFile(file) {
  let s = fs.readFileSync(file, 'utf8');
  const orig = s;
  for (const [a, b] of reps) {
    if (s.includes(a)) {
      const n = s.split(a).length - 1;
      total += n;
      s = s.split(a).join(b);
    }
  }
  if (s !== orig) {
    fs.writeFileSync(file, s);
    filesChanged += 1;
    console.log(path.relative(process.cwd(), file));
  }
}

for (const root of roots) walkDir(root);

console.log(`Done: ${total} replacements in ${filesChanged} files`);