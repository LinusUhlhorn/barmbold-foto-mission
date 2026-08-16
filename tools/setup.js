// Lokaler Einrichtungsassistent fuer das Foto-Mission-Template.
// Aufruf: npm run setup, danach http://localhost:5174 oeffnen.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_FILE = path.join(ROOT, 'config', 'party-config.js');
const PORT = Number(process.env.SETUP_PORT) || 5174;

const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

function currentValues() {
  const source = fs.readFileSync(CONFIG_FILE, 'utf8');
  const stringValue = (key) => {
    const match = source.match(new RegExp(`\\b${key}:\\s*(['"])(.*?)\\1`));
    return match ? match[2] : '';
  };
  const numberMatch = source.match(/\bage:\s*(\d+)/);
  const clean = (value) => /^\[.*\]$/.test(value) ? '' : value;
  return {
    name: clean(stringValue('birthdayPersonName')),
    age: numberMatch ? numberMatch[1] : '18',
    title: clean(stringValue('partyTitle')),
    date: clean(stringValue('partyDate')),
    giftedBy: stringValue('giftedBy'),
    publicUrl: stringValue('publicUrl') === 'https://example.com/' ? '' : stringValue('publicUrl'),
    supabaseUrl: clean(stringValue('url')),
    supabaseKey: clean(stringValue('anonKey')),
  };
}

function page(values, message = '', error = '') {
  const field = (name, label, options = {}) => `
    <label><span>${label}${options.required ? ' *' : ''}</span>
      <input name="${name}" type="${options.type || 'text'}" value="${escapeHtml(values[name])}"
        ${options.required ? 'required' : ''} ${options.min || ''} placeholder="${escapeHtml(options.placeholder || '')}">
      ${options.help ? `<small>${options.help}</small>` : ''}
    </label>`;
  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1"><title>Foto-Mission einrichten</title>
  <style>
    :root{color-scheme:dark;font:16px/1.5 system-ui;background:#07060f;color:#f4f1ff}*{box-sizing:border-box}
    body{margin:0;padding:32px 16px;background:radial-gradient(circle at top,#4c1d9544,transparent 45%)}
    main{max-width:720px;margin:auto;background:#12101f;border:1px solid #ffffff20;border-radius:24px;padding:clamp(22px,5vw,42px);box-shadow:0 24px 80px #0008}
    h1{margin:0 0 8px;font-size:clamp(2rem,6vw,3.5rem)}p{color:#bcb6d7}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
    label{display:grid;gap:7px;font-weight:700}label.wide{grid-column:1/-1}input{width:100%;font:inherit;color:inherit;background:#090814;border:1px solid #ffffff2b;border-radius:12px;padding:13px}
    input:focus{outline:2px solid #e9c877;outline-offset:2px}small{font-weight:400;color:#a9a3c8}.advanced{margin-top:24px;padding-top:20px;border-top:1px solid #ffffff20}
    details summary{cursor:pointer;font-weight:800;color:#e9c877}.actions{display:flex;gap:12px;align-items:center;margin-top:28px;flex-wrap:wrap}
    button{border:0;border-radius:999px;padding:14px 22px;font:700 1rem system-ui;background:#e9c877;color:#181020;cursor:pointer}.ok{color:#5ee0a8}.error{color:#ff8c8c}
    @media(max-width:600px){.grid{grid-template-columns:1fr}}
  </style></head><body><main><p>LOKALE EINRICHTUNG</p><h1>Foto-Mission einrichten</h1>
  <p>Fülle die fünf Pflichtfelder aus. Name und Alter werden automatisch in Überschriften, Texten, Missionen und im Hintergrunddesign eingesetzt.</p>
  ${message ? `<p class="ok">${escapeHtml(message)}</p>` : ''}${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
  <form method="post"><div class="grid">
    ${field('name','Name des Geburtstagskindes',{required:true,placeholder:'z. B. Alex'})}
    ${field('age','Alter',{required:true,type:'number',min:'min="1" max="120"',placeholder:'30'})}
    ${field('title','Titel der Feier',{required:true,placeholder:'z. B. Alex’ Dreißigster'})}
    ${field('date','Datum der Feier',{required:true,type:'date'})}
    ${field('publicUrl','Öffentliche Webadresse',{required:true,placeholder:'https://example.com/foto-mission/',help:'Daraus wird der QR-Code erzeugt. Der Schrägstrich am Ende wird automatisch ergänzt.'})}
    ${field('giftedBy','Kleiner Absender (optional)',{placeholder:'z. B. Eine Überraschung von …'})}
  </div><details class="advanced"><summary>Supabase und Foto-Upload einrichten (optional)</summary><div class="grid" style="margin-top:18px">
    ${field('supabaseUrl','Supabase Project URL',{placeholder:'https://abcdefgh.supabase.co'})}
    ${field('supabaseKey','Supabase Anon-/Publishable-Key',{placeholder:'sb_publishable_…',help:'Nie einen service_role-Key eintragen.'})}
  </div></details><div class="actions"><button type="submit">Konfiguration speichern</button><span>Danach: <code>npm test</code></span></div></form>
  </main></body></html>`;
}

function replaceString(source, key, value) {
  const pattern = new RegExp(`(\\b${key}:\\s*)(['"])(.*?)\\2`);
  if (!pattern.test(source)) throw new Error(`Konfigurationsfeld fehlt: ${key}`);
  return source.replace(pattern, `$1${JSON.stringify(value)}`);
}

function save(form) {
  const name = form.get('name')?.trim();
  const age = Number(form.get('age'));
  const title = form.get('title')?.trim();
  const date = form.get('date')?.trim();
  let publicUrl = form.get('publicUrl')?.trim();
  const giftedBy = form.get('giftedBy')?.trim() || '';
  const supabaseUrl = form.get('supabaseUrl')?.trim() || '[SUPABASE PROJECT URL]';
  const supabaseKey = form.get('supabaseKey')?.trim() || '[SUPABASE ANON KEY]';

  if (!name || !title || !date || !publicUrl) throw new Error('Bitte alle Pflichtfelder ausfüllen.');
  if (!Number.isInteger(age) || age < 1 || age > 120) throw new Error('Bitte ein gültiges Alter zwischen 1 und 120 eingeben.');
  const parsed = new URL(publicUrl);
  if (parsed.protocol !== 'https:') throw new Error('Die öffentliche Webadresse muss mit https:// beginnen.');
  if (!publicUrl.endsWith('/')) publicUrl += '/';
  if (/service_role/i.test(supabaseKey)) throw new Error('Ein service_role-Key darf niemals im Browser verwendet werden.');
  if ((supabaseUrl.startsWith('[')) !== (supabaseKey.startsWith('['))) throw new Error('Supabase-URL und Key bitte entweder beide eintragen oder beide leer lassen.');

  let source = fs.readFileSync(CONFIG_FILE, 'utf8');
  source = replaceString(source, 'birthdayPersonName', name);
  source = source.replace(/(\bage:\s*)\d+/, `$1${age}`);
  source = replaceString(source, 'partyTitle', title);
  source = replaceString(source, 'partyDate', date);
  source = replaceString(source, 'giftedBy', giftedBy);
  source = replaceString(source, 'publicUrl', publicUrl);
  source = replaceString(source, 'url', supabaseUrl);
  source = replaceString(source, 'anonKey', supabaseKey);
  fs.writeFileSync(CONFIG_FILE, source, 'utf8');
}

const server = http.createServer((request, response) => {
  if (request.method === 'GET') {
    response.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
    response.end(page(currentValues())); return;
  }
  if (request.method !== 'POST') { response.writeHead(405).end(); return; }
  let body = '';
  request.on('data', chunk => { body += chunk; if (body.length > 100_000) request.destroy(); });
  request.on('end', () => {
    const form = new URLSearchParams(body);
    try {
      save(form);
      response.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
      response.end(page(currentValues(), 'Gespeichert. Das Template ist jetzt personalisiert.'));
    } catch (error) {
      response.writeHead(400, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
      response.end(page(Object.fromEntries(form), '', error.message));
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\nFoto-Mission einrichten: http://localhost:${PORT}\nBeenden mit Strg + C\n`);
});
