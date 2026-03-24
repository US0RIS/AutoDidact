import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Agent } from './agent.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(join(__dirname, 'public')));

wss.on('connection', (ws) => {
  console.log('[server] Dashboard connected');
  let agent = null;

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw);

      if (msg.type === 'start') {
        if (agent) await agent.stop();
        agent = new Agent({
          serperKey: msg.serperKey,
          openrouterKey: msg.openrouterKey,
          model: msg.model,
          delay: msg.delay || 8,
          emit: (type, data) => {
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ type, ...data }));
            }
          }
        });
        agent.run();
      }

      if (msg.type === 'stop') {
        if (agent) { await agent.stop(); agent = null; }
      }

      if (msg.type === 'set_delay') {
        if (agent) agent.delay = msg.delay;
      }
    } catch (e) {
      console.error('[server]', e.message);
    }
  });

  ws.on('close', async () => {
    console.log('[server] Dashboard disconnected');
    if (agent) { await agent.stop(); agent = null; }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════╗`);
  console.log(`  ║        A U T O D I D A C T  v2       ║`);
  console.log(`  ║      full autonomous web agent       ║`);
  console.log(`  ╠══════════════════════════════════════╣`);
  console.log(`  ║  Dashboard: http://localhost:${PORT}      ║`);
  console.log(`  ╚══════════════════════════════════════╝\n`);
});
