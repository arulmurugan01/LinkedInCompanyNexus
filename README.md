# 🔍 LinkedIn Company Scraper

A TypeScript-based LinkedIn company scraper with a real-time WebSocket API. Scrapes company profiles from LinkedIn search results and extracts detailed information including name, industry, location, website, phone, email, employee count, and more.

---

## ✨ Features

- 🏢 **Company data extraction** — name, tagline, industry, location, overview, website, phone, email, size, founded year, specialties
- 📄 **Multi-page scraping** — automatically paginate through search results
- ♾️ **Scrape all mode** — scrape every page until no results remain
- 🍪 **Cookie persistence** — saves login session so you don't log in every run
- 📡 **Real-time WebSocket logs** — watch live progress from any WebSocket client
- 🌐 **REST API** — trigger scraping via HTTP POST, check status anytime
- 💾 **Auto-save** — saves progress to JSON after every page in case of interruption
- 🔁 **Rate limiting protection** — built-in delays between requests to avoid LinkedIn blocks

---

## 📁 Project Structure

```
.
├── src/
│   ├── server.ts       # Express + Socket.IO API server
│   ├── scraper.ts      # Playwright-based LinkedIn scraper class
│   └── types.ts        # TypeScript interfaces
├── data/
│   ├── cookies.json            # Saved LinkedIn session (auto-generated)
│   └── results/
│       └── companies_data.json # Scraped output (auto-generated)
├── package.json
├── tsconfig.json
└── README.md
```

---

## ⚙️ Requirements

- Node.js 18+
- TypeScript
- Google Chrome installed
- A LinkedIn account (logged in manually on first run)

---

## 🚀 Installation

```bash
# Clone the repo
git clone https://github.com/arulmurugan01/linkedin-company-scraper.git
cd linkedin-company-scraper

# Install dependencies
npm install

# Install Playwright browsers
npx playwright install chrome
```

---

## ▶️ Running the Server

```bash
# Development (with ts-node)
npx ts-node src/server.ts

# Or compile and run
npx tsc && node dist/server.js
```

Server starts at:
```
HTTP  → http://localhost:3000
WS    → ws://localhost:3000
```

---

## 📡 API Reference

### `POST /api/scrape` — Start Scraping

**Request body:**
```json
{
  "searchUrl": "https://www.linkedin.com/search/results/companies/?keywords=software",
  "maxPages": 3,
  "scrapeAll": false
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `searchUrl` | string | ✅ Yes | LinkedIn company search URL |
| `maxPages` | number | No | Max pages to scrape (default: 3) |
| `scrapeAll` | boolean | No | If true, scrapes all pages ignoring maxPages |

**Response:**
```json
{
  "success": true,
  "message": "Scraping started. Connect to WebSocket for live logs.",
  "websocketUrl": "ws://localhost:3000"
}
```

---

### `GET /api/status` — Check Scraping Status

```json
{
  "isActive": true,
  "message": "Scraping in progress"
}
```

---

### `GET /api/health` — Health Check

```json
{
  "success": true,
  "message": "LinkedIn Scraper API",
  "websocket": "ws://localhost:3000"
}
```

---

## 📡 WebSocket Events

Connect to `ws://localhost:3000` to receive real-time updates.

| Event | Description | Payload |
|---|---|---|
| `log` | Live log message | `{ message, timestamp }` |
| `complete` | Scraping finished | `{ success, totalCompanies, companiesWithPhone, filepath, data }` |
| `error` | Scraping failed | `{ success: false, error }` |

**Example (browser console or wscat):**
```javascript
const socket = io('http://localhost:3000');
socket.on('log', ({ message }) => console.log(message));
socket.on('complete', (result) => console.log('Done:', result));
```

---

## 📦 Output Format

Results saved to `data/results/companies_data.json`:

```json
[
  {
    "url": "https://www.linkedin.com/company/example/about/",
    "company_name": "Example Corp",
    "tagline": "Building the future",
    "industry": "Software Development",
    "location": "Chennai, Tamil Nadu, India",
    "employee_count": "51-200 employees",
    "associated_members": "134 on LinkedIn",
    "overview": "We build scalable software...",
    "website": "https://example.com",
    "phone": "+911234567890",
    "email": "contact@example.com",
    "company_size": "51-200 employees",
    "headquarters": "Chennai, India",
    "founded": "2015",
    "specialties": "React, Node.js, AWS",
    "verified_date": "2023",
    "company_logo": "https://media.linkedin.com/..."
  }
]
```

---

## 🔐 Login & Session

On the **first run**, a browser window will open and prompt you to log in to LinkedIn manually. After login, cookies are saved to `data/cookies.json` and reused in future runs automatically.

If cookies expire, the browser will open again for re-login.

> ⚠️ Never commit `data/cookies.json` to version control — add it to `.gitignore`.

---

## 📝 .gitignore

```
node_modules/
dist/
data/cookies.json
data/results/
```

---

## ⚠️ Disclaimer

This tool is for **educational and personal use only**. Scraping LinkedIn may violate their [Terms of Service](https://www.linkedin.com/legal/user-agreement). Use responsibly and at your own risk. Add reasonable delays and avoid scraping at high volume.

---

## 🛠 Tech Stack

| Tool | Purpose |
|---|---|
| TypeScript | Language |
| Playwright | Browser automation |
| Express.js | HTTP API server |
| Socket.IO | Real-time WebSocket logs |
| Node.js fs | File I/O for cookies & results |
