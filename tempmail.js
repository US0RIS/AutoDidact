const BASE = 'https://api.mail.tm';

export class TempMail {
  constructor() {
    this.address = null;
    this.password = null;
    this.token = null;
  }

  async createAccount() {
    const domainRes = await fetch(`${BASE}/domains`);
    const domainData = await domainRes.json();
    const domain = domainData['hydra:member']?.[0]?.domain;
    if (!domain) throw new Error('No temp mail domains available');

    const user = 'autodidact_' + Math.random().toString(36).slice(2, 10);
    this.address = `${user}@${domain}`;
    this.password = 'AutoD1dact_' + Math.random().toString(36).slice(2, 14) + '!';

    const createRes = await fetch(`${BASE}/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: this.address, password: this.password })
    });
    if (!createRes.ok) throw new Error(`Create failed: ${await createRes.text()}`);

    const loginRes = await fetch(`${BASE}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: this.address, password: this.password })
    });
    if (!loginRes.ok) throw new Error('Login failed');
    this.token = (await loginRes.json()).token;

    return { email: this.address, password: this.password };
  }

  async checkInbox() {
    if (!this.token) return [];
    const res = await fetch(`${BASE}/messages`, {
      headers: { Authorization: `Bearer ${this.token}` }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data['hydra:member'] || []).map(m => ({
      id: m.id,
      from: m.from?.address || 'unknown',
      subject: m.subject || '',
      intro: m.intro || '',
    }));
  }

  async readMessage(id) {
    if (!this.token) return null;
    const res = await fetch(`${BASE}/messages/${id}`, {
      headers: { Authorization: `Bearer ${this.token}` }
    });
    if (!res.ok) return null;
    const d = await res.json();
    const body = (d.text || '') + (d.html?.[0] || '');
    return {
      from: d.from?.address || '',
      subject: d.subject || '',
      text: d.text || '',
      html: d.html?.[0] || '',
      links: [...new Set((body.match(/https?:\/\/[^\s<>"')\]]+/g) || []))]
    };
  }
}
