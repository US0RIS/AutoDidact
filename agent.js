import { Browser } from './browser.js';
import { TempMail } from './tempmail.js';
import { CaptchaSolver } from './captcha.js';
import { loadKnowledge, saveKnowledge } from './persist.js';
import { downloadAndRead, findDownloadLinks } from './filereader.js';

export class Agent {
  constructor({ serperKey, openrouterKey, model, delay, emit }) {
    this.serperKey = serperKey;
    this.orKey = openrouterKey;
    this.model = model;
    this.delay = delay;
    this.emit = emit;
    this.running = false;
    this.browser = null;
    this.mail = new TempMail();
    this.captcha = null;

    // Load persisted knowledge
    const saved = loadKnowledge();
    this.facts = saved.facts || [];
    this.topics = saved.topics || {};
    this.savedSignups = saved.signups || [];

    this.searchCount = 0;
    this.videoCount = 0;
    this.pagesRead = 0;
    this.signupCount = this.savedSignups.length;
    this.filesRead = 0;
    this.emailAddress = null;
    this.emailPassword = null;

    this.saveInterval = null;
  }

  async run() {
    this.running = true;

    // Launch browser
    this.browser = new Browser(this.emit);
    try {
      await this.browser.launch();
    } catch (e) {
      this.emit('thought', { kind: 'error', text: `Browser failed: ${e.message}` });
      this.running = false;
      return;
    }

    // Init CAPTCHA solver with vision-capable LLM
    this.captcha = new CaptchaSolver(this.browser, this.askLLM.bind(this));

    // Create temp email
    try {
      this.emit('thought', { kind: 'system', text: 'Creating temp email...' });
      const acct = await this.mail.createAccount();
      this.emailAddress = acct.email;
      this.emailPassword = acct.password;
      this.emit('thought', { kind: 'system', text: `Email: ${this.emailAddress}` });
    } catch (e) {
      this.emit('thought', { kind: 'system', text: `Email failed: ${e.message}` });
    }

    // Report loaded knowledge
    if (this.facts.length > 0) {
      this.emit('thought', { kind: 'system', text: `Loaded ${this.facts.length} facts from previous sessions across ${Object.keys(this.topics).length} topics.` });
    }

    // Auto-save every 30s
    this.saveInterval = setInterval(() => this.persist(), 30000);

    this.emitStats();

    try {
      await this.mainLoop();
    } catch (e) {
      this.emit('thought', { kind: 'error', text: `Agent crashed: ${e.message}` });
    }

    this.persist();
    clearInterval(this.saveInterval);
    await this.browser.close();
    this.running = false;
  }

  async stop() {
    this.running = false;
    this.persist();
    if (this.saveInterval) clearInterval(this.saveInterval);
    if (this.browser) await this.browser.close();
    this.emit('thought', { kind: 'system', text: 'Agent stopped. Knowledge saved.' });
  }

  persist() {
    saveKnowledge({
      facts: this.facts,
      topics: this.topics,
      signups: this.savedSignups,
    });
  }

  sleep(s) { return new Promise(r => setTimeout(r, s * 1000)); }

  emitStats() {
    this.emit('stats', {
      facts: this.facts.length,
      searches: this.searchCount,
      videos: this.videoCount,
      pages: this.pagesRead,
      signups: this.signupCount,
      files: this.filesRead,
      topics: Object.keys(this.topics).length,
      email: this.emailAddress,
    });
  }

  // ========== LLM ==========
  async askLLM(system, userContent, expectJSON = true) {
    const messages = [{ role: 'system', content: system }];

    if (typeof userContent === 'string') {
      messages.push({ role: 'user', content: userContent });
    } else {
      // Vision: array of content parts
      messages.push({ role: 'user', content: userContent });
    }

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.orKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://autodidact.app',
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: 0.9,
        max_tokens: 1500,
      })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`LLM ${res.status}: ${err.slice(0, 300)}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';

    if (expectJSON) {
      return JSON.parse(text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim());
    }
    return text;
  }

  // LLM call with screenshot (vision)
  async askLLMWithVision(system, textPrompt, screenshotB64) {
    const content = [
      { type: 'text', text: textPrompt },
    ];
    if (screenshotB64) {
      content.push({
        type: 'image_url',
        image_url: { url: `data:image/jpeg;base64,${screenshotB64}` }
      });
    }
    return this.askLLM(system, content, true);
  }

  // ========== SERPER ==========
  async serperSearch(query) {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': this.serperKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: 6 })
    });
    if (!res.ok) throw new Error(`Serper ${res.status}`);
    this.searchCount++;
    return res.json();
  }

  async serperVideoSearch(query) {
    const res = await fetch('https://google.serper.dev/videos', {
      method: 'POST',
      headers: { 'X-API-KEY': this.serperKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: 4 })
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.videos || []).filter(v => v.link?.includes('youtube.com'));
  }

  // ========== YOUTUBE ==========
  async fetchTranscript(url) {
    const id = url.match(/[?&]v=([^&]+)/)?.[1] || url.split('/').pop();
    if (!id) return null;

    try {
      await this.browser.navigate(`https://www.youtube.com/watch?v=${id}`);
      await this.browser.page.waitForTimeout(3000);

      const captionUrl = await this.browser.page.evaluate(() => {
        for (const s of document.querySelectorAll('script')) {
          const m = s.textContent.match(/"captionTracks":\[.*?"baseUrl":"(.*?)"/);
          if (m) return m[1].replace(/\\u0026/g, '&');
        }
        return null;
      });

      if (captionUrl) {
        await this.browser.navigate(captionUrl);
        const xml = await this.browser.readPage();
        if (xml?.length > 50) {
          let clean = xml.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
          if (clean.length > 5000) clean = clean.slice(0, 5000) + '...';
          return clean;
        }
      }

      // Fallback: read video page description
      const pageText = await this.browser.readPage();
      return pageText?.length > 200 ? pageText.slice(0, 3000) : null;
    } catch { return null; }
  }

  // ========== CAPTCHA HANDLING ==========
  async handleCaptcha() {
    const detection = await this.captcha.detect();
    if (!detection.found) return;

    this.emit('thought', { kind: 'action', text: `CAPTCHA detected: ${detection.types.join(', ')}` });
    this.emit('thinking', { text: 'Attempting to solve CAPTCHA...' });

    const result = await this.captcha.solve();
    this.emit('thinking', null);

    if (result.solved) {
      this.emit('thought', { kind: 'system', text: `CAPTCHA solved: ${result.reason}` });
    } else {
      this.emit('thought', { kind: 'reflecting', text: `CAPTCHA failed: ${result.reason}` });
    }
    return result;
  }

  // ========== MAIN LOOP ==========
  async mainLoop() {
    this.emit('thinking', { text: 'Forming initial curiosity...' });

    let goal;
    try {
      const knownTopics = Object.keys(this.topics).join(', ');
      goal = await this.askLLM(
        `You are a deeply curious autonomous mind with FULL internet access: real browser, search engine, temp email, signup ability, file downloads, YouTube transcripts, and CAPTCHA handling.

${knownTopics ? `You already know about: ${knownTopics}` : 'You know nothing yet.'}

Pick something you genuinely want to explore. Be specific and surprising. Return ONLY valid JSON:
{ "topic": "short label", "question": "specific question", "why": "one sentence", "approach": "search|browse|video|signup|download|check_email" }`,
        'What are you curious about right now? Be weird, specific, and genuinely curious. You have the entire internet.'
      );
    } catch (e) {
      this.emit('thinking', null);
      this.emit('thought', { kind: 'error', text: `Curiosity failed: ${e.message}` });
      await this.sleep(3);
      if (this.running) return this.mainLoop();
      return;
    }

    this.emit('thinking', null);
    this.emit('thought', { kind: 'curiosity', text: `"${goal.question}"`, detail: goal.why });

    let currentGoal = goal;

    while (this.running) {
      try {
        await this.executeGoal(currentGoal);
      } catch (e) {
        this.emit('thought', { kind: 'error', text: `Error: ${e.message}` });
      }

      this.emitStats();
      await this.sleep(this.delay);
      if (!this.running) break;

      // Decide next
      this.emit('thinking', { text: 'Deciding what to explore next...' });
      try {
        const recent = this.facts.slice(-15).map(f => f.text).join('; ');
        const allTopics = Object.keys(this.topics).join(', ');

        currentGoal = await this.askLLM(
          `You are an autonomous learner. You have: browser, search, temp email (${this.emailAddress || 'none'}), file downloads, YouTube, CAPTCHA handling.

Known topics: ${allTopics || 'none'}
Recent facts: ${recent || 'none'}

What next? Follow threads, pivot to new topics, watch a video, sign up for something, download a paper. Return ONLY valid JSON:
{ "topic": "label", "question": "what you want", "why": "one sentence", "approach": "search|browse|video|signup|download|check_email" }`,
          'What next? Chase whatever genuinely interests you.'
        );
      } catch (e) {
        this.emit('thinking', null);
        this.emit('thought', { kind: 'error', text: `Planning failed: ${e.message}` });
        await this.sleep(3);
        continue;
      }

      this.emit('thinking', null);
      this.emit('thought', { kind: 'curiosity', text: `"${currentGoal.question}"`, detail: currentGoal.why });
    }
  }

  async executeGoal(goal) {
    const fn = {
      search: () => this.doSearch(goal),
      browse: () => this.doBrowse(goal),
      video: () => this.doVideo(goal),
      signup: () => this.doSignup(goal),
      download: () => this.doDownload(goal),
      check_email: () => this.doCheckEmail(goal),
    }[goal.approach] || (() => this.doSearch(goal));

    await fn();
  }

  // ========== SEARCH + READ ==========
  async doSearch(goal) {
    this.emit('thought', { kind: 'searching', text: goal.question });
    this.emit('thinking', { text: 'Searching...' });

    let results;
    try { results = await this.serperSearch(goal.question); }
    catch (e) { this.emit('thinking', null); this.emit('thought', { kind: 'error', text: `Search failed: ${e.message}` }); return; }
    this.emit('thinking', null);

    const snippets = (results.organic || []).slice(0, 5)
      .map((r, i) => `[${i + 1}] "${r.title}" — ${r.snippet || ''} (${r.link})`).join('\n');

    // Ask LLM which pages to read (with vision of current state)
    this.emit('thinking', { text: 'Deciding what to read...' });
    let plan;
    try {
      plan = await this.askLLM(
        'Pick 1-2 URLs to read in full. Return ONLY JSON: { "read_urls": ["url1"], "reasoning": "why" }',
        `Search: "${goal.question}"\n\nResults:\n${snippets}`
      );
    } catch { plan = { read_urls: [] }; }
    this.emit('thinking', null);

    let fullContent = '';
    for (const url of (plan.read_urls || []).slice(0, 2)) {
      this.emit('thought', { kind: 'reading', text: url });
      this.emit('thinking', { text: `Reading ${safeHostname(url)}...` });

      const nav = await this.browser.navigate(url);
      if (nav.success) {
        // Check for CAPTCHAs
        await this.handleCaptcha();

        const text = await this.browser.readPage();
        if (text?.length > 100) {
          fullContent += `\n\n--- ${url} ---\n${text}`;
          this.pagesRead++;
        }

        // Check for downloadable files
        const downloads = await findDownloadLinks(this.browser.page);
        if (downloads.length > 0) {
          this.emit('thought', { kind: 'system', text: `Found ${downloads.length} downloadable file(s): ${downloads.map(d => d.ext || d.text).join(', ')}` });
        }

        // Send screenshot for vision
        const ss = await this.browser.screenshot();
        if (ss) this.emit('screenshot', { image: ss, url });
      }
      this.emit('thinking', null);
    }

    await this.digest(goal.question, snippets, fullContent);
  }

  // ========== BROWSE ==========
  async doBrowse(goal) {
    let url = goal.question.match(/https?:\/\/[^\s]+/)?.[0];
    if (!url) {
      this.emit('thinking', { text: 'Finding site...' });
      try {
        const r = await this.serperSearch(goal.question);
        url = r.organic?.[0]?.link;
      } catch {}
      this.emit('thinking', null);
    }
    if (!url) { this.emit('thought', { kind: 'error', text: 'No URL found' }); return; }

    this.emit('thought', { kind: 'browsing', text: url });
    this.emit('thinking', { text: `Loading...` });

    const nav = await this.browser.navigate(url);
    if (!nav.success) { this.emit('thinking', null); this.emit('thought', { kind: 'error', text: nav.error }); return; }

    await this.handleCaptcha();
    const text = await this.browser.readPage();
    this.pagesRead++;

    const ss = await this.browser.screenshot();
    if (ss) this.emit('screenshot', { image: ss, url });
    this.emit('thinking', null);

    await this.digest(goal.question, '', `\n\n--- ${url} ---\n${text}`);
  }

  // ========== VIDEO ==========
  async doVideo(goal) {
    this.emit('thinking', { text: 'Searching videos...' });
    let videos;
    try { videos = await this.serperVideoSearch(goal.question); } catch { return this.doSearch(goal); }
    this.emit('thinking', null);

    if (!videos?.length) { this.emit('thought', { kind: 'reflecting', text: 'No videos found, falling back to search.' }); return this.doSearch(goal); }

    const vid = videos[0];
    this.emit('thought', { kind: 'watching', text: vid.title || 'Video', detail: vid.link });
    this.emit('thinking', { text: `Watching "${(vid.title || '').slice(0, 50)}"...` });

    const transcript = await this.fetchTranscript(vid.link);
    this.emit('thinking', null);

    if (transcript?.length > 100) {
      this.videoCount++;
      const ss = await this.browser.screenshot();
      if (ss) this.emit('screenshot', { image: ss, url: vid.link });
      await this.digest(goal.question, `Video: "${vid.title}"`, `\n\n--- Transcript: "${vid.title}" ---\n${transcript}`);
    } else {
      this.emit('thought', { kind: 'reflecting', text: 'No transcript available.' });
      const text = await this.browser.readPage();
      if (text) await this.digest(goal.question, '', `\n\n--- Video page ---\n${text}`);
    }
  }

  // ========== SIGNUP ==========
  async doSignup(goal) {
    if (!this.emailAddress) { this.emit('thought', { kind: 'error', text: 'No temp email.' }); return; }

    let url = goal.question.match(/https?:\/\/[^\s]+/)?.[0];
    if (!url) {
      this.emit('thinking', { text: 'Finding signup page...' });
      try { url = (await this.serperSearch(goal.question + ' sign up register')).organic?.[0]?.link; } catch {}
      this.emit('thinking', null);
    }
    if (!url) { this.emit('thought', { kind: 'error', text: 'No signup page found.' }); return; }

    this.emit('thought', { kind: 'browsing', text: `Signup: ${url}` });
    await this.browser.navigate(url);
    await this.handleCaptcha();

    const username = 'autodidact_' + Date.now().toString(36).slice(-6);

    for (let step = 0; step < 20; step++) {
      if (!this.running) break;

      const pageInfo = await this.browser.getPageInfo();
      const ss = await this.browser.screenshot();
      if (ss) this.emit('screenshot', { image: ss, url: pageInfo.url });

      const elList = pageInfo.elements.map(e =>
        `[${e.index}] <${e.tag}${e.type ? ` type="${e.type}"` : ''}${e.name ? ` name="${e.name}"` : ''}${e.placeholder ? ` placeholder="${e.placeholder}"` : ''}${e.id ? ` id="${e.id}"` : ''}> ${e.text || e.ariaLabel || ''}`
      ).join('\n');

      this.emit('thinking', { text: `Analyzing page (step ${step + 1})...` });

      let action;
      try {
        // Use vision so the LLM can see the page
        action = await this.askLLMWithVision(
          `You are filling out a signup form. Email: ${this.emailAddress} | Password: ${this.emailPassword} | Name: Auto Didact | Username: ${username}

Page: ${pageInfo.title} (${pageInfo.url})
Elements:\n${elList || '(none)'}

Return ONLY JSON: { "action": "click|type|scroll|press_key|navigate|done|give_up", "target_index": 0, "value": "", "key": "Enter", "url": "", "reasoning": "why" }`,
          'What next to complete signup? Look at the screenshot and the elements.',
          ss
        );
      } catch (e) {
        this.emit('thinking', null);
        this.emit('thought', { kind: 'error', text: `Action failed: ${e.message}` });
        break;
      }

      this.emit('thinking', null);
      this.emit('thought', {
        kind: 'action',
        text: `${action.action}${action.target_index != null ? ` [${action.target_index}]` : ''}${action.value ? ` "${action.value}"` : ''}`,
        detail: action.reasoning
      });

      let result;
      switch (action.action) {
        case 'click': result = await this.browser.clickByIndex(action.target_index); break;
        case 'type': result = await this.browser.typeByIndex(action.target_index, action.value || ''); break;
        case 'scroll': result = await this.browser.scroll(action.value || 'down'); break;
        case 'press_key': result = await this.browser.pressKey(action.key || 'Enter'); break;
        case 'navigate': result = await this.browser.navigate(action.url); break;
        case 'done':
          this.signupCount++;
          this.savedSignups.push({ url: pageInfo.url, email: this.emailAddress, time: Date.now() });
          this.emit('thought', { kind: 'system', text: `Signup complete: ${pageInfo.url}` });
          this.persist();
          return;
        case 'give_up':
          this.emit('thought', { kind: 'reflecting', text: `Signup abandoned: ${action.reasoning}` });
          return;
      }

      if (result && !result.success) {
        this.emit('thought', { kind: 'error', text: `Failed: ${result.error}` });
      }

      // Check for CAPTCHAs after each action
      await this.handleCaptcha();
      await this.sleep(1);
    }
  }

  // ========== DOWNLOAD FILES ==========
  async doDownload(goal) {
    // Search for the file
    this.emit('thinking', { text: 'Searching for files...' });
    let results;
    try { results = await this.serperSearch(goal.question + ' filetype:pdf OR filetype:csv OR filetype:txt'); }
    catch (e) { this.emit('thinking', null); return this.doSearch(goal); }
    this.emit('thinking', null);

    // Find direct file links
    const fileLinks = (results.organic || []).filter(r => {
      const url = r.link || '';
      return /\.(pdf|csv|txt|json|xml|doc|docx|xls|xlsx)(\?|$)/i.test(url);
    });

    if (fileLinks.length === 0) {
      this.emit('thought', { kind: 'reflecting', text: 'No direct file links found, falling back to search.' });
      return this.doSearch(goal);
    }

    const target = fileLinks[0];
    this.emit('thought', { kind: 'reading', text: `Downloading: ${target.title || target.link}` });
    this.emit('thinking', { text: 'Reading file...' });

    try {
      const fileData = await downloadAndRead(this.browser.page, target.link);
      this.emit('thinking', null);

      if (fileData?.text) {
        this.filesRead++;
        this.emit('thought', { kind: 'reading', text: `Read ${fileData.type} file (${fileData.pages ? fileData.pages + ' pages' : fileData.text.length + ' chars'})` });
        await this.digest(goal.question, '', `\n\n--- Downloaded file: ${target.link} ---\n${fileData.text}`);
      } else {
        this.emit('thought', { kind: 'error', text: 'Could not read file contents.' });
      }
    } catch (e) {
      this.emit('thinking', null);
      this.emit('thought', { kind: 'error', text: `Download failed: ${e.message}` });
    }
  }

  // ========== CHECK EMAIL ==========
  async doCheckEmail() {
    if (!this.emailAddress) { this.emit('thought', { kind: 'error', text: 'No email.' }); return; }

    this.emit('thought', { kind: 'system', text: `Checking: ${this.emailAddress}` });
    this.emit('thinking', { text: 'Checking inbox...' });

    try {
      const messages = await this.mail.checkInbox();
      this.emit('thinking', null);

      if (!messages.length) { this.emit('thought', { kind: 'reflecting', text: 'Inbox empty.' }); return; }

      this.emit('thought', { kind: 'reading', text: `${messages.length} email(s)` });

      const full = await this.mail.readMessage(messages[0].id);
      if (!full) return;

      this.emit('thought', { kind: 'reading', text: `From ${full.from}: "${full.subject}"`, detail: full.text.slice(0, 200) });

      if (full.links?.length) {
        this.emit('thinking', { text: 'Checking for verification links...' });
        try {
          const decision = await this.askLLM(
            `Email links:\n${full.links.map((l, i) => `[${i}] ${l}`).join('\n')}\nSubject: ${full.subject}\nBody: ${full.text.slice(0, 400)}\n\nWhich link verifies the account? Return JSON: { "click_index": 0, "reasoning": "" } Use -1 if none.`,
            'Which link?'
          );
          this.emit('thinking', null);

          if (decision.click_index >= 0 && full.links[decision.click_index]) {
            const vUrl = full.links[decision.click_index];
            this.emit('thought', { kind: 'action', text: 'Clicking verification link', detail: vUrl });
            await this.browser.navigate(vUrl);
            await this.handleCaptcha();
            const ss = await this.browser.screenshot();
            if (ss) this.emit('screenshot', { image: ss, url: vUrl });
            this.emit('thought', { kind: 'system', text: 'Verification link clicked.' });
          }
        } catch { this.emit('thinking', null); }
      }
    } catch (e) {
      this.emit('thinking', null);
      this.emit('thought', { kind: 'error', text: `Email error: ${e.message}` });
    }
  }

  // ========== DIGEST ==========
  async digest(question, snippets, fullContent) {
    this.emit('thinking', { text: 'Processing...' });

    const recent = this.facts.slice(-10).map(f => f.text).join('; ');

    let digest;
    try {
      digest = await this.askLLM(
        `You are an autonomous learner. Extract specific facts from what you just read.

You already know: ${recent || 'nothing'}
Known topics: ${Object.keys(this.topics).join(', ') || 'none'}

Return ONLY JSON:
{
  "facts_learned": ["specific fact with names/dates/numbers", ...],
  "topic_label": "short category",
  "reflection": "one sentence — what surprised you",
  "connections": ["related existing topic labels"]
}`,
        `Researching: "${question}"\n\n${snippets}\n${fullContent || ''}`
      );
    } catch (e) {
      this.emit('thinking', null);
      this.emit('thought', { kind: 'error', text: `Digest failed: ${e.message}` });
      return;
    }

    this.emit('thinking', null);

    const label = digest.topic_label || 'general';
    if (!this.topics[label]) this.topics[label] = { count: 0 };

    (digest.facts_learned || []).forEach(f => {
      this.facts.push({ text: f, topic: label, time: Date.now() });
      this.topics[label].count++;
    });

    if (digest.facts_learned?.length) {
      this.emit('thought', { kind: 'learning', facts: digest.facts_learned });
    }

    if (digest.connections?.length) {
      this.emit('thought', { kind: 'connecting', text: `Connects to: ${digest.connections.join(', ')}` });
    }

    if (digest.reflection) {
      this.emit('thought', { kind: 'reflecting', text: digest.reflection });
    }

    this.emit('node', { label, connections: digest.connections || [] });
    this.emitStats();
  }
}

function safeHostname(url) {
  try { return new URL(url).hostname; } catch { return url; }
}
