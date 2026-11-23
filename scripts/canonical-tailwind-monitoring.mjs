import fs from 'node:fs';
import path from 'node:path';

const dir = path.join(process.cwd(), 'src/components/gis/monitoring');

/** Longest match first */
const reps = [
  ['z-[9999]', 'z-9999'],
  ['z-[2000]', 'z-2000'],
  ['z-[1200]', 'z-1200'],
  ['z-[1100]', 'z-1100'],
  ['z-[1010]', 'z-1010'],
  ['z-[1000]', 'z-1000'],
  ['shadow-[#00D2FF]/20', 'shadow-accent-primary/20'],
  ['border-t-[#0A0E1A]', 'border-t-background'],
  ['border-t-[#0a0e1a]', 'border-t-background'],
  ['border-[#0A0E1A]/30', 'border-background/30'],
  ['placeholder:text-[#8B9BB4]/50', 'placeholder:text-text-secondary/50'],
  ['focus:border-[#00D2FF]', 'focus:border-border-active'],
  ['focus:border-[#2C3B59]', 'focus:border-border-subtle'],
  ['hover:text-[#F0F6FC]', 'hover:text-text-primary'],
  ['hover:text-[#00D2FF]', 'hover:text-accent-primary'],
  ['hover:text-[#FFFFFF]', 'hover:text-white'],
  ['hover:text-[#E2E8F0]', 'hover:text-text-primary'],
  ['hover:bg-[#38BDF8]', 'hover:brightness-110'],
  ['hover:bg-[#25324E]', 'hover:bg-bg-surface-hover'],
  ['hover:bg-[#19233A]', 'hover:bg-bg-surface-hover'],
  ['hover:bg-[#162138]', 'hover:bg-bg-surface-hover'],
  ['hover:bg-[#1A2338]', 'hover:bg-bg-surface-hover'],
  ['hover:bg-[#12192B]', 'hover:bg-bg-surface'],
  ['hover:border-[#00D2FF]/50', 'hover:border-border-active/50'],
  ['hover:border-[#00D2FF]', 'hover:border-border-active'],
  ['hover:border-[#2C3B59]', 'hover:border-border-subtle'],
  ['divide-[#1E2942]/60', 'divide-border-subtle/60'],
  ['divide-[#1E2942]', 'divide-border-subtle'],
  ['border-[#1E2942]/60', 'border-border-subtle/60'],
  ['border-[#1E2942]/50', 'border-border-subtle/50'],
  ['border-[#00D2FF]/50', 'border-border-active/50'],
  ['border-[#00D2FF]/40', 'border-border-active/40'],
  ['border-[#00D2FF]/30', 'border-border-active/30'],
  ['border-[#00D2FF]/20', 'border-border-active/20'],
  ['border-[#00B4D8]/50', 'border-accent-secondary/50'],
  ['border-[#00B4D8]/40', 'border-accent-secondary/40'],
  ['border-[#00B4D8]/10', 'border-accent-secondary/10'],
  ['border-[#0284C7]/40', 'border-accent-secondary/40'],
  ['border-[#EF4444]/50', 'border-status-danger/50'],
  ['border-[#EF4444]/40', 'border-status-danger/40'],
  ['border-[#EF4444]/30', 'border-status-danger/30'],
  ['border-[#EF4444]/25', 'border-status-danger/25'],
  ['border-[#EF4444]/20', 'border-status-danger/20'],
  ['border-[#EF4444]/15', 'border-status-danger/15'],
  ['border-[#10B981]/50', 'border-status-success/50'],
  ['border-[#10B981]/40', 'border-status-success/40'],
  ['border-[#10B981]/30', 'border-status-success/30'],
  ['border-[#10B981]/25', 'border-status-success/25'],
  ['border-[#10B981]/20', 'border-status-success/20'],
  ['border-[#10B981]/15', 'border-status-success/15'],
  ['border-[#F59E0B]/10', 'border-status-warning/10'],
  ['bg-[#0E3A5D]/95', 'bg-bg-accent-surface/95'],
  ['bg-[#0E3A5D]/80', 'bg-bg-accent-surface/80'],
  ['bg-[#0E3A5D]/70', 'bg-bg-accent-surface/70'],
  ['bg-[#0E3A5D]/60', 'bg-bg-accent-surface/60'],
  ['bg-[#0E3A5D]/50', 'bg-bg-accent-surface/50'],
  ['bg-[#12192B]/90', 'bg-bg-surface/90'],
  ['bg-[#12192B]/60', 'bg-bg-surface/60'],
  ['bg-[#12192B]/50', 'bg-bg-surface/50'],
  ['bg-[#0D1322]/95', 'bg-bg-nav/95'],
  ['bg-[#0D1322]/60', 'bg-bg-nav/60'],
  ['bg-[#0D1322]/50', 'bg-bg-nav/50'],
  ['bg-[#00D2FF]/50', 'bg-accent-primary/50'],
  ['bg-[#00D2FF]/40', 'bg-accent-primary/40'],
  ['bg-[#00D2FF]/20', 'bg-accent-primary/20'],
  ['bg-[#00D2FF]/10', 'bg-accent-primary/10'],
  ['bg-[#10B981]/50', 'bg-status-success/50'],
  ['bg-[#10B981]/40', 'bg-status-success/40'],
  ['bg-[#10B981]/30', 'bg-status-success/30'],
  ['bg-[#10B981]/25', 'bg-status-success/25'],
  ['bg-[#10B981]/20', 'bg-status-success/20'],
  ['bg-[#10B981]/15', 'bg-status-success/15'],
  ['bg-[#10B981]/10', 'bg-status-success/10'],
  ['bg-[#EF4444]/50', 'bg-status-danger/50'],
  ['bg-[#EF4444]/40', 'bg-status-danger/40'],
  ['bg-[#EF4444]/30', 'bg-status-danger/30'],
  ['bg-[#EF4444]/25', 'bg-status-danger/25'],
  ['bg-[#EF4444]/20', 'bg-status-danger/20'],
  ['bg-[#EF4444]/15', 'bg-status-danger/15'],
  ['bg-[#F59E0B]/10', 'bg-status-warning/10'],
  ['bg-[#132238]', 'bg-bg-surface-hover'],
  ['bg-[#1A2338]', 'bg-bg-surface-hover'],
  ['bg-[#1E1420]', 'bg-bg-ground'],
  ['border-[#2A3958]', 'border-border-subtle'],
  ['border-[#2C3B59]', 'border-border-subtle'],
  ['border-[#1E2942]', 'border-border-subtle'],
  ['border-[#00D2FF]', 'border-border-active'],
  ['border-[#00B4D8]', 'border-accent-secondary'],
  ['border-[#EF4444]', 'border-status-danger'],
  ['border-[#10B981]', 'border-status-success'],
  ['border-[#F59E0B]', 'border-status-warning'],
  ['bg-[#090D18]', 'bg-bg-ground'],
  ['bg-[#0D1322]', 'bg-bg-nav'],
  ['bg-[#12192B]', 'bg-bg-surface'],
  ['bg-[#0E3A5D]', 'bg-bg-accent-surface'],
  ['bg-[#0A0E1A]', 'bg-bg-ground'],
  ['bg-[#0a0e1a]', 'bg-bg-ground'],
  ['bg-[#19233A]', 'bg-bg-surface-hover'],
  ['bg-[#00D2FF]', 'bg-accent-primary'],
  ['bg-[#10B981]', 'bg-status-success'],
  ['bg-[#EF4444]', 'bg-status-danger'],
  ['bg-[#0090E0]', 'bg-accent-primary'],
  ['bg-[#00A3FF]', 'bg-accent-primary'],
  ['text-[#7DD3FC]/80', 'text-sky-300/80'],
  ['text-[#7DD3FC]', 'text-sky-300'],
  ['text-[#F0F6FC]', 'text-text-primary'],
  ['text-[#FFFFFF]', 'text-white'],
  ['text-[#E2E8F0]', 'text-text-primary'],
  ['text-[#8B9BB4]', 'text-text-secondary'],
  ['text-[#566680]', 'text-text-muted'],
  ['text-[#00D2FF]', 'text-accent-primary'],
  ['text-[#00B4D8]', 'text-accent-secondary'],
  ['text-[#00BDE6]', 'text-accent-primary'],
  ['text-[#00A3FF]', 'text-accent-primary'],
  ['text-[#0090E0]', 'text-accent-primary'],
  ['text-[#10B981]', 'text-status-success'],
  ['text-[#34D399]', 'text-emerald-400'],
  ['text-[#15803D]', 'text-green-700'],
  ['text-[#65A30D]', 'text-lime-600'],
  ['text-[#F59E0B]', 'text-status-warning'],
  ['text-[#EF4444]', 'text-status-danger'],
  ['text-[#DC2626]', 'text-red-600'],
  ['text-[#F87171]', 'text-red-400'],
  ['text-[#BE185D]', 'text-rose-700'],
  ['text-[#0A0E1A]', 'text-background'],
  ['text-[#0a0e1a]', 'text-background'],
  ['ring-[#00D2FF]', 'ring-accent-primary'],
  ['from-[#00D2FF]', 'from-accent-primary'],
  ['to-[#0284C7]', 'to-accent-secondary'],
];

const counts = {};

for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.tsx'))) {
  const file = path.join(dir, name);
  let s = fs.readFileSync(file, 'utf8');
  const before = (s.match(/\[#|z-\[/g) || []).length;
  for (const [a, b] of reps) {
    if (s.includes(a)) s = s.split(a).join(b);
  }
  if (s !== fs.readFileSync(file, 'utf8')) {
    fs.writeFileSync(file, s);
  }
  const after = (s.match(/\[#|z-\[/g) || []).length;
  if (before > 0 || after > 0) counts[name] = { before, after };
}

console.log(JSON.stringify(counts, null, 2));
const leftovers = [];
for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.tsx'))) {
  const s = fs.readFileSync(path.join(dir, name), 'utf8');
  const m = s.match(/\[#[0-9A-Fa-f]{3,8}\]|z-\[\d+\]/g);
  if (m) leftovers.push({ name, uniq: [...new Set(m)] });
}
if (leftovers.length) console.log('LEFT', JSON.stringify(leftovers, null, 2));