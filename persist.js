import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, 'data', 'knowledge.json');

export function loadKnowledge() {
  try {
    if (existsSync(DATA_PATH)) {
      const raw = readFileSync(DATA_PATH, 'utf-8');
      const data = JSON.parse(raw);
      console.log(`[persist] Loaded ${data.facts?.length || 0} facts, ${Object.keys(data.topics || {}).length} topics`);
      return data;
    }
  } catch (e) {
    console.error('[persist] Load failed:', e.message);
  }
  return { facts: [], topics: {}, signups: [] };
}

export function saveKnowledge(data) {
  try {
    writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('[persist] Save failed:', e.message);
  }
}
