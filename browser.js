import { chromium } from 'playwright';
import { applyStealthPatches } from './captcha.js';

export class Browser {
  constructor(emit) {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.emit = emit;
  }

  async launch() {
    const launchOptions = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
      ]
    };

    if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
      launchOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    }

    this.browser = await chromium.launch(launchOptions);
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      locale: 'en-US',
      timezoneId: 'America/New_York',
      geolocation: { latitude: 40.7128, longitude: -74.0060 },
      permissions: ['geolocation'],
    });
    this.page = await this.context.newPage();

    // Apply stealth patches
    await applyStealthPatches(this.page);

    // Block heavy media
    await this.page.route('**/*.{mp4,webm,ogg,mp3,wav,flac,avi,mkv}', route => route.abort());

    this.emit('thought', { kind: 'system', text: 'Browser launched (stealth Chromium)' });
  }

  async navigate(url) {
    try {
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await this.page.waitForTimeout(2000);
      try { await this.page.waitForLoadState('networkidle', { timeout: 5000 }); } catch {}

      const result = { success: true, url: this.page.url(), title: await this.page.title() };

      // Auto-send screenshot on every navigation
      const ss = await this.screenshot();
      if (ss) this.emit('screenshot', { image: ss, url: result.url });

      return result;
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async screenshot() {
    try {
      const buffer = await this.page.screenshot({ type: 'jpeg', quality: 55 });
      return buffer.toString('base64');
    } catch { return null; }
  }

  async readPage() {
    try {
      // Wait a bit for SPAs to render
      await this.page.waitForTimeout(500);

      const text = await this.page.evaluate(() => {
        // Remove noise
        document.querySelectorAll(
          'script,style,nav,footer,header,aside,iframe,noscript,' +
          '[role="banner"],[role="navigation"],[role="complementary"],' +
          '.cookie-banner,.cookie-consent,.popup,.modal,.overlay,.ad,.ads,.sidebar,.advertisement'
        ).forEach(el => el.remove());

        const main = document.querySelector('article') ||
                     document.querySelector('[role="main"]') ||
                     document.querySelector('main') ||
                     document.body;

        return main?.innerText || document.body?.innerText || '';
      });

      let clean = text.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
      if (clean.length > 6000) clean = clean.slice(0, 6000) + '\n...[truncated]';
      return clean;
    } catch (e) {
      return `[Error reading page: ${e.message}]`;
    }
  }

  async getPageInfo() {
    try {
      return await this.page.evaluate(() => {
        const els = Array.from(document.querySelectorAll(
          'input,textarea,select,button,[role="button"],a[href]'
        )).slice(0, 50);

        return {
          url: window.location.href,
          title: document.title,
          elements: els.map((el, i) => ({
            index: i,
            tag: el.tagName.toLowerCase(),
            type: el.getAttribute('type') || '',
            name: el.getAttribute('name') || '',
            id: el.getAttribute('id') || '',
            placeholder: el.getAttribute('placeholder') || '',
            text: (el.innerText || el.value || '').trim().slice(0, 60),
            ariaLabel: el.getAttribute('aria-label') || '',
            href: (el.getAttribute('href') || '').slice(0, 120),
          }))
        };
      });
    } catch {
      return { url: '', title: '', elements: [] };
    }
  }

  async clickByIndex(index) {
    try {
      const clicked = await this.page.evaluate((idx) => {
        const els = Array.from(document.querySelectorAll(
          'input,textarea,select,button,[role="button"],a[href]'
        )).slice(0, 50);
        if (els[idx]) {
          els[idx].scrollIntoView({ block: 'center' });
          els[idx].click();
          return true;
        }
        return false;
      }, index);
      if (!clicked) return { success: false, error: `Element ${index} not found` };
      await this.page.waitForTimeout(2000);

      // Auto-send screenshot after click
      const ss = await this.screenshot();
      if (ss) this.emit('screenshot', { image: ss, url: this.page.url() });

      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async typeByIndex(index, text) {
    try {
      const done = await this.page.evaluate((idx, val) => {
        const els = Array.from(document.querySelectorAll(
          'input,textarea,select,button,[role="button"],a[href]'
        )).slice(0, 50);
        const el = els[idx];
        if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && el.tagName !== 'SELECT')) return false;

        el.scrollIntoView({ block: 'center' });
        el.focus();

        if (el.tagName === 'SELECT') {
          // Try to find matching option
          const opts = Array.from(el.options);
          const match = opts.find(o => o.text.toLowerCase().includes(val.toLowerCase()) || o.value.toLowerCase().includes(val.toLowerCase()));
          if (match) { el.value = match.value; }
          else { el.value = val; }
        } else {
          el.value = val;
        }

        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
        return true;
      }, index, text);

      if (!done) return { success: false, error: `Element ${index} not fillable` };
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async scroll(direction = 'down') {
    try {
      await this.page.mouse.wheel(0, direction === 'down' ? 600 : -600);
      await this.page.waitForTimeout(1000);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async pressKey(key) {
    try {
      await this.page.keyboard.press(key);
      await this.page.waitForTimeout(500);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async close() {
    try { if (this.browser) await this.browser.close(); } catch {}
    this.browser = null; this.context = null; this.page = null;
  }
}
