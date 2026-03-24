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
