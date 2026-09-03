import fs from 'fs';
import path from 'path';
const root = process.argv[2] || process.cwd();
let errors = [];
function fm(file) {
  let s = fs.readFileSync(file, 'utf8');
  // Normalize CRLF -> LF for Windows compatibility (CI was failing on CRLF frontmatter)
  s = s.replace(/\r\n/g, '\n');
  const m = s.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const obj = {};
  m[1].split('\n').forEach(l => {
    const i = l.indexOf(':');
    if (i > 0) { const k = l.slice(0, i).trim(); let v = l.slice(i + 1).trim().replace(/^['"]|['"]$/g, ''); obj[k] = v; }
  });
  return obj;
}
const reg = JSON.parse(fs.readFileSync(path.join(root, '.nexus/registry.json'), 'utf8'));
const agentDir = path.join(root, '.nexus/agent');
const files = fs.readdirSync(agentDir).filter(f => f.endsWith('.md'));
const regFiles = new Set(reg.agents.map(a => a.file));
reg.agents.forEach(a => {
  const fp = path.join(agentDir, a.file + '.md');
  if (!fs.existsSync(fp)) { errors.push('MISSING agent file: ' + a.file); return; }
  const f = fm(fp);
  if (!f || !f.description) errors.push('BAD frontmatter (no description): ' + a.file);
});
files.forEach(f => { if (!regFiles.has(f.replace(/\.md$/, ''))) errors.push('ORPHAN agent (not in registry): ' + f); });
const seen = {}; reg.agents.forEach(a => { seen[a.file] = (seen[a.file] || 0) + 1; });
Object.entries(seen).forEach(([k, v]) => { if (v > 1) errors.push('DUP agent in registry: ' + k + ' x' + v); });
const skillDir = path.join(root, '.nexus/skills');
const regSkills = new Set(reg.skills.map(s => s.dir));
reg.skills.forEach(s => {
  const fp = path.join(skillDir, s.dir, 'SKILL.md');
  if (!fs.existsSync(fp)) { errors.push('MISSING skill: ' + s.dir); return; }
  const f = fm(fp);
  if (!f || !f.name || !f.description) errors.push('BAD skill frontmatter: ' + s.dir);
});
fs.readdirSync(skillDir).forEach(d => { if (!regSkills.has(d)) errors.push('ORPHAN skill dir (not in registry): ' + d); });
const cmdDir = path.join(root, '.nexus/command');
fs.readdirSync(cmdDir).filter(f => f.endsWith('.md')).forEach(f => {
  const ff = fm(path.join(cmdDir, f));
  if (!ff || !ff.description) errors.push('BAD command frontmatter (no description): ' + f);
});
['config/offline-provider.jsonc', 'config/omniroute-provider.jsonc'].forEach(p => {
  try { JSON.parse(fs.readFileSync(path.join(root, p), 'utf8')); } catch (e) { errors.push('BAD JSON: ' + p + ' ' + e.message); }
});
console.log('Agents: registry=' + reg.agents.length + ' files=' + files.length);
console.log('Skills: registry=' + reg.skills.length + ' dirs=' + fs.readdirSync(skillDir).length);
console.log('Commands: ' + fs.readdirSync(cmdDir).filter(f => f.endsWith('.md')).length);
if (errors.length) { console.log('--- ERRORS: ' + errors.length + ' ---'); errors.slice(0, 50).forEach(e => console.log(' - ' + e)); process.exit(1); }
else console.log('--- VALIDATION PASSED (0 errors) ---');
