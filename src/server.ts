// src/server.ts
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { LinkedInJobScraper } from './scraper';
import { ScrapeOptions } from './types';

const app        = express();
const httpServer = createServer(app);
const io         = new Server(httpServer, { cors: { origin: '*' } });

app.use(express.json());

let activeScraper: LinkedInJobScraper | null = null;
let isScrapingActive = false;

// ── WebSocket ──────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

function broadcastLog(message: string) {
    io.emit('log', { message, timestamp: new Date().toISOString() });
}

// ── Routes ─────────────────────────────────────────────────────────────────────

/**
 * POST /api/scrape
 *
 * Body (JSON):
 * {
 *   "searchUrl" : "https://www.linkedin.com/jobs/search/?keywords=..."  ← required
 *   "maxPages"  : 3          ← optional, default 3
 *   "scrapeAll" : false      ← optional, ignores maxPages and scrapes until last page
 *   "startPage" : 2          ← optional, resume from this page (skips pages already done)
 * }
 *
 * Example resume call:
 *   POST /api/scrape  { "searchUrl": "...", "startPage": 3 }
 *   → picks up from page 3 and merges with existing data/results/jobs_data.json
 */
app.post('/api/scrape', async (req, res) => {
    if (isScrapingActive) {
        return res.status(400).json({ success: false, error: 'Scraping already in progress' });
    }

    const { searchUrl, maxPages = 3 }: ScrapeOptions = req.body;

    if (!searchUrl) {
        return res.status(400).json({ success: false, error: 'searchUrl is required' });
    }

    isScrapingActive = true;

    res.json({
        success: true,
        message: `Scraping started Connect to WebSocket for live logs.`,
        websocketUrl: 'ws://localhost:3000',
    });

    (async () => {
        try {
            activeScraper = new LinkedInJobScraper(broadcastLog);
            const jobs = await activeScraper.run({ searchUrl, maxPages });

            const easyApply = jobs.filter(j => j.apply_type?.toLowerCase().includes('easy')).length;

            broadcastLog(`\n🎉 Complete! Saved ${jobs.length} jobs (${easyApply} Easy Apply)`);

            io.emit('complete', {
                success:    true,
                totalJobs:  jobs.length,
                easyApply,
                filepath:   'data/results/jobs_data.json',
                data:       jobs,
            });

        } catch (error) {
            broadcastLog(`❌ Error: ${(error as Error).message}`);
            io.emit('error', { success: false, error: (error as Error).message });
        } finally {
            isScrapingActive = false;
            activeScraper    = null;
        }
    })();
});

/** GET /api/status — check if scraping is running */
app.get('/api/status', (_req, res) => {
    res.json({
        isActive: isScrapingActive,
        message:  isScrapingActive ? 'Scraping in progress' : 'Idle',
    });
});

/** GET /api/health — basic health check */
app.get('/api/health', (_req, res) => {
    res.json({
        success:   true,
        message:   'LinkedIn Job Scraper API (new SDUI layout)',
        websocket: 'ws://localhost:3000',
    });
});

// ── Start server ───────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════╗
║        LinkedIn Job Scraper (v2)           ║
╠════════════════════════════════════════════╣
║  HTTP:  http://localhost:${PORT}           ║
║  WS:    ws://localhost:${PORT}             ║
╠════════════════════════════════════════════╣
║  POST /api/scrape  — Start / Resume        ║
║  GET  /api/status  — Running status        ║
║  GET  /api/health  — Health check          ║
╠════════════════════════════════════════════╣
║  /api/scrape body params:                  ║
║    searchUrl  (required)                   ║
║    maxPages   (default: 3)                 ║
║    scrapeAll  (default: false)             ║
║    startPage  (resume mid-scrape)          ║
╚════════════════════════════════════════════╝
    `);
});
