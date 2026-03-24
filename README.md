# AUTODIDACT v2

Autonomous AI with **unrestricted internet access**. It can do everything you can do online.

## Capabilities

| Capability | How |
|---|---|
| **Search** | Serper API (web + video) |
| **Read pages** | Headless Chromium via Playwright |
| **Watch YouTube** | Extracts video transcripts/captions |
| **Sign up for sites** | Auto-fills forms with temp email identity |
| **Temp email** | mail.tm — creates disposable email, checks inbox |
| **Click verification links** | Reads emails, identifies verify URLs, navigates to them |
| **Solve CAPTCHAs** | Clicks checkboxes, handles Cloudflare/Turnstile, uses LLM vision for text CAPTCHAs |
| **Stealth browsing** | Anti-detection patches (webdriver, plugins, canvas fingerprint, etc.) |
| **Download & read files** | PDFs, text files, CSVs directly from URLs |
| **Vision** | Sends screenshots to LLM during signups for visual page understanding |
| **Persistent memory** | Knowledge saves to disk, survives restarts |
| **Browse freely** | Navigate, click, type, scroll — full browser automation |

## What it CANNOT do

- Solve image-grid CAPTCHAs (reCAPTCHA "select all buses", hCaptcha)
- OAuth logins (Sign in with Google/GitHub)
- 2FA via SMS or authenticator apps
- Make purchases (no payment method)
- Access .onion/Tor sites
- Process audio/video (reads transcripts only, not media)

## Setup on Replit

### 1. Create Repl
- Go to [replit.com](https://replit.com) → **Create Repl** → **Node.js** → name it `autodidact`

### 2. Upload files
Delete default files, then upload maintaining this structure:
```
├── .replit
├── replit.nix
├── package.json
├── index.js
├── agent.js
├── browser.js
├── captcha.js
├── tempmail.js
├── persist.js
├── filereader.js
├── data/
│   └── knowledge.json
└── public/
    └── index.html
```

### 3. Install
In Replit Shell:
```bash
npm install
npx playwright install chromium
```

### 4. Run
Click **Run** or:
```bash
npm start
```

### 5. Configure
Paste your **Serper** and **OpenRouter** API keys in the dashboard, pick a model, hit **LET IT THINK**.

## API Keys (both have free tiers)

| Service | Free Tier | Get it |
|---|---|---|
| Serper | 2,500 searches | [serper.dev](https://serper.dev) |
| OpenRouter | Pay-per-use (cheap) | [openrouter.ai](https://openrouter.ai) |

## Cost per hour (8s delay)

- Gemini 2.5 Flash: ~$0.15
- GPT-4o Mini: ~$0.25
- DeepSeek V3: ~$0.10
- Claude Sonnet 4: ~$1.50

## Architecture

```
Your Browser (dashboard viewer)
     ↕ WebSocket
Node.js Server
     ↕
Agent Brain (agent.js)
  ├── LLM via OpenRouter (reasoning + vision)
  ├── Serper (web + video search)
  ├── Playwright (headless Chromium w/ stealth)
  ├── CAPTCHA solver (checkbox + turnstile + vision)
  ├── mail.tm (temp email)
  ├── File reader (PDFs, text)
  └── Persistent storage (data/knowledge.json)
```

## Files

| File | Purpose |
|---|---|
| `index.js` | Express + WebSocket server |
| `agent.js` | Autonomous brain — decides what to learn and how |
| `browser.js` | Playwright wrapper with stealth patches |
| `captcha.js` | CAPTCHA detection, checkbox clicking, Turnstile, vision solving |
| `tempmail.js` | Disposable email via mail.tm |
| `filereader.js` | Download and extract text from PDFs/docs |
| `persist.js` | Save/load knowledge between sessions |
| `public/index.html` | Dashboard UI |
