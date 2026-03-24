// CAPTCHA detection and solving without paid services
// Strategy:
// 1. Stealth: Make browser look human to avoid triggering CAPTCHAs
// 2. Checkbox: Auto-click "I'm not a robot" checkboxes
// 3. Turnstile: Click Cloudflare verify buttons
// 4. Vision: Send screenshot to LLM for simple text/math CAPTCHAs
// 5. Skip: Gracefully handle unsolvable image challenges

export class CaptchaSolver {
  constructor(browser, askLLM) {
    this.browser = browser;
    this.askLLM = askLLM;
  }

  // Detect if any CAPTCHA is present on page
  async detect() {
    const page = this.browser.page;
    if (!page) return { found: false };

    try {
      const result = await page.evaluate(() => {
        const found = [];

        // reCAPTCHA v2 checkbox iframe
        const recapFrames = document.querySelectorAll('iframe[src*="recaptcha"], iframe[title*="reCAPTCHA"]');
        if (recapFrames.length > 0) found.push('recaptcha_checkbox');

        // reCAPTCHA v2 challenge iframe (image grid)
        const recapChallenge = document.querySelectorAll('iframe[src*="recaptcha"][src*="bframe"]');
        if (recapChallenge.length > 0) found.push('recaptcha_image');

        // Cloudflare Turnstile
        const turnstile = document.querySelectorAll('iframe[src*="challenges.cloudflare.com"], .cf-turnstile, [data-sitekey]');
        if (turnstile.length > 0) found.push('turnstile');

        // hCaptcha
        const hcap = document.querySelectorAll('iframe[src*="hcaptcha"], .h-captcha');
        if (hcap.length > 0) found.push('hcaptcha');

        // Cloudflare challenge page
        if (document.title.includes('Just a moment') || document.title.includes('Attention Required')) {
          found.push('cloudflare_challenge');
        }

        // Generic "I'm not a robot" or verify buttons
        const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], div[role="button"]'));
        for (const b of buttons) {
          const text = (b.textContent || b.value || '').toLowerCase();
          if (text.includes('not a robot') || text.includes('verify') || text.includes('i am human')) {
            found.push('verify_button');
            break;
          }
        }

        // Simple text CAPTCHA (input near an image with captcha-related attributes)
        const captchaInputs = document.querySelectorAll('input[name*="captcha"], input[id*="captcha"], input[placeholder*="captcha"]');
        if (captchaInputs.length > 0) found.push('text_captcha');

        return found;
      });

      return { found: result.length > 0, types: result };
    } catch (e) {
      return { found: false, error: e.message };
    }
  }

  // Attempt to solve detected CAPTCHAs
  async solve() {
    const detection = await this.detect();
    if (!detection.found) return { solved: false, reason: 'no captcha detected' };

    const types = detection.types || [];

    // Try each type in order of solvability
    for (const type of types) {
      let result;
      switch (type) {
        case 'verify_button':
          result = await this.solveVerifyButton();
          if (result.solved) return result;
          break;

        case 'recaptcha_checkbox':
          result = await this.solveRecaptchaCheckbox();
          if (result.solved) return result;
          break;

        case 'turnstile':
          result = await this.solveTurnstile();
          if (result.solved) return result;
          break;

        case 'cloudflare_challenge':
          result = await this.solveCloudflareWait();
          if (result.solved) return result;
          break;

        case 'text_captcha':
          result = await this.solveTextCaptcha();
          if (result.solved) return result;
          break;

        case 'recaptcha_image':
          return { solved: false, reason: 'reCAPTCHA image challenge — cannot solve without paid service' };

        case 'hcaptcha':
          return { solved: false, reason: 'hCaptcha image challenge — cannot solve without paid service' };
      }
    }

    return { solved: false, reason: `Unsolvable CAPTCHA types: ${types.join(', ')}` };
  }

  // Click "I'm not a robot" / generic verify buttons
  async solveVerifyButton() {
    const page = this.browser.page;
    try {
      // Human-like mouse movement first
      await this.humanMouseMove(page);

      const clicked = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], div[role="button"], label, span'));
        for (const b of buttons) {
          const text = (b.textContent || b.value || '').toLowerCase();
          if (text.includes('not a robot') || text.includes('verify') || text.includes('i am human') || text.includes('continue')) {
            b.scrollIntoView({ block: 'center' });
            b.click();
            return true;
          }
        }
        return false;
      });

      if (clicked) {
        await page.waitForTimeout(3000);
        // Check if captcha is still there
        const still = await this.detect();
        return { solved: !still.found, reason: clicked ? 'clicked verify button' : 'button not found' };
      }
      return { solved: false, reason: 'verify button not found' };
    } catch (e) {
      return { solved: false, reason: e.message };
    }
  }

  // Click reCAPTCHA v2 checkbox inside iframe
  async solveRecaptchaCheckbox() {
    const page = this.browser.page;
    try {
      await this.humanMouseMove(page);

      // Find the reCAPTCHA iframe
      const frame = page.frames().find(f =>
        f.url().includes('recaptcha') && !f.url().includes('bframe')
      );

      if (!frame) return { solved: false, reason: 'reCAPTCHA iframe not found' };

      // Click the checkbox
      const checkbox = await frame.$('.recaptcha-checkbox-border, #recaptcha-anchor');
      if (checkbox) {
        // Move to it humanly
        const box = await checkbox.boundingBox();
        if (box) {
          await page.mouse.move(
            box.x + box.width / 2 + (Math.random() - 0.5) * 10,
            box.y + box.height / 2 + (Math.random() - 0.5) * 10,
            { steps: 15 + Math.floor(Math.random() * 10) }
          );
          await page.waitForTimeout(200 + Math.random() * 300);
        }
        await checkbox.click();
        await page.waitForTimeout(3000);

        // Check if it escalated to image challenge
        const after = await this.detect();
        if (after.types?.includes('recaptcha_image')) {
          return { solved: false, reason: 'reCAPTCHA escalated to image challenge' };
        }
        return { solved: !after.found, reason: 'clicked reCAPTCHA checkbox' };
      }
      return { solved: false, reason: 'checkbox element not found' };
    } catch (e) {
      return { solved: false, reason: e.message };
    }
  }

  // Handle Cloudflare Turnstile
  async solveTurnstile() {
    const page = this.browser.page;
    try {
      await this.humanMouseMove(page);

      // Turnstile is in an iframe
      const frame = page.frames().find(f =>
        f.url().includes('challenges.cloudflare.com')
      );

      if (frame) {
        // Try to find and click the checkbox/button inside
        const checkbox = await frame.$('input[type="checkbox"], .ctp-checkbox-label, label');
        if (checkbox) {
          const box = await checkbox.boundingBox();
          if (box) {
            await page.mouse.move(
              box.x + box.width / 2 + (Math.random() - 0.5) * 5,
              box.y + box.height / 2 + (Math.random() - 0.5) * 5,
              { steps: 12 + Math.floor(Math.random() * 8) }
            );
            await page.waitForTimeout(300 + Math.random() * 400);
          }
          await checkbox.click();
          await page.waitForTimeout(4000);

          const after = await this.detect();
          return { solved: !after.found, reason: 'clicked Turnstile checkbox' };
        }
      }

      // Fallback: try clicking any cf-turnstile container
      await page.evaluate(() => {
        const el = document.querySelector('.cf-turnstile iframe, [data-sitekey] iframe');
        if (el) el.click();
      });
      await page.waitForTimeout(4000);

      const after = await this.detect();
      return { solved: !after.found, reason: 'attempted Turnstile click' };
    } catch (e) {
      return { solved: false, reason: e.message };
    }
  }

  // Cloudflare "Just a moment..." wait page
  async solveCloudflareWait() {
    const page = this.browser.page;
    try {
      // These often resolve on their own after a few seconds
      for (let i = 0; i < 6; i++) {
        await page.waitForTimeout(3000);
        const title = await page.title();
        if (!title.includes('Just a moment') && !title.includes('Attention Required')) {
          return { solved: true, reason: 'Cloudflare challenge passed after waiting' };
        }
      }
      return { solved: false, reason: 'Cloudflare challenge did not resolve' };
    } catch (e) {
      return { solved: false, reason: e.message };
    }
  }

  // Use LLM vision to solve simple text/math CAPTCHAs
  async solveTextCaptcha() {
    const page = this.browser.page;
    try {
      // Take a screenshot and send to LLM
      const screenshot = await this.browser.screenshot();
      if (!screenshot) return { solved: false, reason: 'could not take screenshot' };

      const response = await this.askLLM(
        `You are looking at a screenshot of a webpage that has a CAPTCHA. Look at the CAPTCHA image and determine what text or answer needs to be entered. If it's a math problem, solve it. If it's distorted text, read it. Return ONLY valid JSON: { "answer": "the captcha answer", "confidence": "high|medium|low" }`,
        [
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${screenshot}` } },
          { type: 'text', text: 'What is the CAPTCHA answer? Look at any distorted text or math problem in the image.' }
        ]
      );

      if (response.answer && response.confidence !== 'low') {
        // Find the captcha input and type the answer
        const typed = await page.evaluate((answer) => {
          const inputs = document.querySelectorAll('input[name*="captcha"], input[id*="captcha"], input[placeholder*="captcha"], input[name*="verification"], input[aria-label*="captcha"]');
          for (const inp of inputs) {
            inp.focus();
            inp.value = answer;
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
          return false;
        }, response.answer);

        if (typed) {
          // Try to submit
          await page.keyboard.press('Enter');
          await page.waitForTimeout(3000);
          const after = await this.detect();
          return { solved: !after.found, reason: `entered CAPTCHA answer: ${response.answer}` };
        }
      }
      return { solved: false, reason: 'could not determine CAPTCHA answer' };
    } catch (e) {
      return { solved: false, reason: e.message };
    }
  }

  // Simulate human-like mouse movement to reduce CAPTCHA triggering
  async humanMouseMove(page) {
    try {
      const vw = 1280, vh = 800;
      const points = 3 + Math.floor(Math.random() * 4);
      for (let i = 0; i < points; i++) {
        await page.mouse.move(
          100 + Math.random() * (vw - 200),
          100 + Math.random() * (vh - 200),
          { steps: 8 + Math.floor(Math.random() * 12) }
        );
        await page.waitForTimeout(50 + Math.random() * 150);
      }
    } catch (e) {}
  }
}

// Browser stealth patches — apply before navigating
export async function applyStealthPatches(page) {
  await page.addInitScript(() => {
    // Override webdriver flag
    Object.defineProperty(navigator, 'webdriver', { get: () => false });

    // Override plugins to look populated
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
        { name: 'Native Client', filename: 'internal-nacl-plugin' },
      ]
    });

    // Override languages
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });

    // Override permissions
    const originalQuery = window.navigator.permissions?.query;
    if (originalQuery) {
      window.navigator.permissions.query = (params) =>
        params.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(params);
    }

    // Override chrome runtime
    window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {} };

    // Hide automation indicators
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;

    // Canvas fingerprint noise
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, attrs) {
      const ctx = origGetContext.call(this, type, attrs);
      if (type === '2d' && ctx) {
        const origGetImageData = ctx.getImageData;
        ctx.getImageData = function(...args) {
          const data = origGetImageData.apply(this, args);
          // Add tiny noise to a few pixels
          for (let i = 0; i < 5; i++) {
            const idx = Math.floor(Math.random() * data.data.length);
            data.data[idx] = Math.max(0, Math.min(255, data.data[idx] + (Math.random() > 0.5 ? 1 : -1)));
          }
          return data;
        };
      }
      return ctx;
    };

    // WebGL fingerprint
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(p) {
      if (p === 37445) return 'Intel Inc.';
      if (p === 37446) return 'Intel Iris OpenGL Engine';
      return getParameter.call(this, p);
    };
  });
}
