import { chromium, Page, ElementHandle } from 'playwright';
import { promises as fs } from 'fs';
import { JobData, CompanyData, ScrapeOptions } from './types';

// ─── XPath roots ─────────────────────────────────────────────────────────────
const ROOT   = '/html/body/div[1]/div[2]/div[2]/div[2]/main/div/div';
const LIST   = `${ROOT}/div[1]/div`;
const DETAIL = `${ROOT}/div[2]`;

// ─── Timing helpers ───────────────────────────────────────────────────────────

const rand  = (min: number, max: number) =>
    Math.floor(Math.random() * (max - min + 1)) + min;
const randF = (min: number, max: number) =>
    Math.random() * (max - min) + min;

const humanDelay = async (minMs: number, maxMs: number): Promise<void> => {
    const delay = (rand(minMs, maxMs) + rand(minMs, maxMs)) / 2;
    await new Promise(r => setTimeout(r, delay));
};

const maybeReadingPause = async (): Promise<void> => {
    if (Math.random() < 0.15) await humanDelay(2500, 6000);
};

// ─── Stealth script ───────────────────────────────────────────────────────────

const STEALTH_SCRIPT = `
(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    const plugins = [
        { name: 'Chrome PDF Plugin',  filename: 'internal-pdf-viewer',              description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer',  filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client',      filename: 'internal-nacl-plugin',             description: '' },
    ];
    Object.defineProperty(navigator, 'plugins', {
        get: () => { const a = [...plugins]; Object.defineProperty(a, 'length', { value: a.length }); return a; },
    });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    const _origQuery = window.navigator.permissions?.query?.bind(navigator.permissions);
    if (_origQuery) {
        navigator.permissions.query = (p) =>
            p.name === 'notifications'
                ? Promise.resolve({ state: 'default', onchange: null })
                : _origQuery(p);
    }
    if (!window.chrome) {
        window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}), app: {} };
    }
    Object.defineProperty(screen, 'availWidth',  { get: () => 1280 });
    Object.defineProperty(screen, 'availHeight', { get: () => 800  });
    const patchWebGL = (ctx) => {
        if (!ctx) return;
        const orig = ctx.prototype.getParameter;
        ctx.prototype.getParameter = function(p) {
            if (p === 37445) return 'Intel Inc.';
            if (p === 37446) return 'Intel Iris OpenGL Engine';
            return orig.call(this, p);
        };
    };
    patchWebGL(window.WebGLRenderingContext);
    patchWebGL(window.WebGL2RenderingContext);
    Object.defineProperty(navigator, 'connection', {
        get: () => ({ effectiveType: '4g', rtt: 50, downlink: 10, saveData: false }),
    });
    try { Object.defineProperty(window, 'frameElement', { get: () => null }); } catch (_) {}
    const origUA = navigator.userAgent;
    if (origUA.includes('HeadlessChrome')) {
        Object.defineProperty(navigator, 'userAgent', {
            get: () => origUA.replace('HeadlessChrome', 'Chrome'),
        });
    }
    if (navigator.getBattery) {
        navigator.getBattery = () =>
            Promise.resolve({ charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1.0 });
    }
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
    Object.defineProperty(navigator, 'deviceMemory',        { get: () => 8 });
    const nativeToString = Function.prototype.toString;
    Function.prototype.toString = function() {
        if (this === navigator.permissions?.query) return 'function query() { [native code] }';
        return nativeToString.call(this);
    };
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
})();
`;

// ─── Mouse / scroll ───────────────────────────────────────────────────────────

async function humanMouseMove(page: Page, toX: number, toY: number): Promise<void> {
    const fromX = toX + rand(-250, 250);
    const fromY = toY + rand(-200, 200);
    const steps = rand(14, 28);
    for (let i = 0; i <= steps; i++) {
        const t     = i / steps;
        const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
        await page.mouse.move(
            fromX + (toX - fromX) * eased + randF(-1.5, 1.5),
            fromY + (toY - fromY) * eased + randF(-1.5, 1.5),
        );
        await humanDelay(8, 28);
    }
}

async function humanScroll(page: Page, direction: 'down' | 'up' = 'down'): Promise<void> {
    for (let i = 0; i < rand(2, 5); i++) {
        await page.mouse.wheel(0, rand(80, 300) * (direction === 'down' ? 1 : -1));
        await humanDelay(60, 320);
    }
}

// ─── UA pool ──────────────────────────────────────────────────────────────────

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
];
const randomUA = () => USER_AGENTS[rand(0, USER_AGENTS.length - 1)];

// ─── Inline cleaner (must be self-contained for page.evaluate) ────────────────

const CLEAN_FN_SRC = `
const clean = (s) =>
    s.replace(/WITH_REPLACED/g, 'with')
     .replace(/'{2,}/g, "'")
     .replace(/\\u00a0/g, ' ')
     .replace(/\\s{2,}/g, ' ')
     .trim();
`;

// ─── Scraper class ────────────────────────────────────────────────────────────

export class LinkedInJobScraper {
    private outputFile = 'data/results/jobs_data.json';
    private jobs: JobData[] = [];
    private onLog?: (message: string) => void;

    constructor(onLog?: (message: string) => void) {
        this.onLog = onLog;
    }

    private log(msg: string) { console.log(msg); this.onLog?.(msg); }

    // ── Stealth setup ─────────────────────────────────────────────────────────

    private async stealthPage(page: Page): Promise<void> {
        await page.addInitScript(STEALTH_SCRIPT);
        await page.route('**/*', async (route) => {
            const url = route.request().url();
            const blocked = [
                'px.ads.linkedin.com', 'snap.licdn.com', 'bat.bing.com',
                'doubleclick.net', 'google-analytics.com', 'analytics.js',
                'fingerprintjs', 'clarity.ms', 'hotjar.com', 'sentry.io',
                'newrelic.com', 'datadome', 'perimeterx', 'recaptcha',
            ].some(p => url.includes(p));
            blocked ? await route.abort() : await route.continue();
        });
    }

    // ── Save ──────────────────────────────────────────────────────────────────

    async saveData(): Promise<void> {
        await fs.mkdir('data/results', { recursive: true });
        await fs.writeFile(this.outputFile, JSON.stringify(this.jobs, null, 2));
        this.log(`✓ Saved ${this.jobs.length} jobs → ${this.outputFile}`);
    }

    // ── Card helpers ──────────────────────────────────────────────────────────

    private async waitForCardList(page: Page): Promise<void> {
        try {
            await page.waitForSelector(`xpath=${LIST}/div[1]`, { timeout: 12_000 });
        } catch {
            this.log('⚠  Card list not detected — waiting and continuing');
            await humanDelay(4000, 6000);
        }
    }

    private async countJobCards(page: Page): Promise<number> {
        try {
            const total: number = await page.$$eval(
                `xpath=${LIST}/div/div/div/div`, els => els.length,
            );
            return Math.max(0, total - 1);
        } catch { return 0; }
    }

    private async clickCard(page: Page, index: number): Promise<boolean> {
        const card = await page.$(`xpath=${LIST}/div[${index}]/div/div/div/div/div`);
        if (!card) return false;

        await card.scrollIntoViewIfNeeded();
        await humanDelay(300, 800);

        const box = await card.boundingBox();
        if (box) {
            await humanMouseMove(
                page,
                box.x + randF(box.width  * 0.2, box.width  * 0.8),
                box.y + randF(box.height * 0.2, box.height * 0.8),
            );
            await humanDelay(80, 260);
        }

        await page.keyboard.press('Escape');
        await humanDelay(120, 280);

        try { await card.click({ timeout: 5000 }); }
        catch { try { await card.dispatchEvent('click'); } catch { return false; } }

        try {
            await page.waitForSelector(
                `xpath=${DETAIL}//a[contains(@href,"/jobs/view/")]`, { timeout: 8000 },
            );
        } catch {}

        await humanDelay(600, 1600);
        await humanScroll(page, 'down');
        await maybeReadingPause();
        return true;
    }

    // ── Pagination ────────────────────────────────────────────────────────────

    private async hasNextPage(page: Page): Promise<boolean> {
        try {
            const btn = await page.$('[data-testid="pagination-controls-next-button-visible"]');
            if (!btn) return false;
            return (await btn.getAttribute('disabled')) === null;
        } catch { return false; }
    }

    private async goToNextPage(page: Page, currentPage: number): Promise<boolean> {
        try {
            const btn = await page.$('[data-testid="pagination-controls-next-button-visible"]');
            if (!btn) return false;

            this.log(`⏭  Navigating to page ${currentPage + 1}...`);
            await btn.scrollIntoViewIfNeeded();

            const box = await btn.boundingBox();
            if (box) {
                await humanMouseMove(
                    page,
                    box.x + randF(box.width  * 0.3, box.width  * 0.7),
                    box.y + randF(box.height * 0.3, box.height * 0.7),
                );
                await humanDelay(180, 480);
            }

            await btn.click();
            await page.waitForSelector(`xpath=${LIST}/div[1]`, { timeout: 18_000 });
            await humanDelay(1800, 3800);
            await humanScroll(page, 'up');
            await humanDelay(500, 1200);
            return true;
        } catch (e) {
            this.log(`✗ Next page navigation failed: ${(e as Error).message}`);
            return false;
        }
    }

    // ── About the job ─────────────────────────────────────────────────────────

    private async extractAboutJob(
        page: Page,
    ): Promise<{ heading: string | null; content: string[] }[]> {
        try {
            await page.waitForSelector('[data-testid="expandable-text-box"]', { timeout: 6000 });
        } catch {
            this.log('⚠  expandable-text-box not found');
            return [];
        }

        // Click "…more" if the button is visible
        try {
            const expandBtn = await page.$('[data-testid="expandable-text-button"]');
            if (expandBtn) {
                await page.evaluate(btn => (btn as HTMLElement).click(), expandBtn);
                await humanDelay(500, 1000);
                this.log('✓ Expanded "About the job"');
            }
        } catch {}

        // After expansion there may be multiple expandable-text-box elements
        // (one for about_job, one for about_company). Take the FIRST one.
        const boxes = await page.$$('[data-testid="expandable-text-box"]');
        const el = boxes[0];
        if (!el) return [];

        return el.evaluate((container) => {
            const clean = (s: string) =>
                s.replace(/WITH_REPLACED/g, 'with')
                 .replace(/'{2,}/g, "'")
                 .replace(/\u00a0/g, ' ')
                 .replace(/\s{2,}/g, ' ')
                 .trim();

            const sections: { heading: string | null; content: string[] }[] = [];
            let cur: { heading: string | null; content: string[] } = { heading: null, content: [] };
            let insideStrong = 0;

            const pushCur = () => {
                cur.content = cur.content.map(clean).filter(Boolean);
                if (cur.heading !== null || cur.content.length > 0) sections.push(cur);
            };

            const walk = (node: Node): void => {
                if (node.nodeType === Node.TEXT_NODE) {
                    const t = clean(node.textContent ?? '');
                    if (t) cur.content.push(t);
                    return;
                }
                if (!(node instanceof Element)) return;
                const tag = node.tagName.toUpperCase();

                if (tag === 'BUTTON' || node.getAttribute('data-testid') === 'expandable-text-button') return;

                if (tag === 'STRONG' || tag === 'B') {
                    insideStrong++;
                    if (insideStrong === 1) {
                        const heading = clean(node.textContent ?? '');
                        if (heading) { pushCur(); cur = { heading, content: [] }; }
                        insideStrong--;
                        return;
                    }
                    const t = clean(node.textContent ?? '');
                    if (t) cur.content.push(t);
                    insideStrong--;
                    return;
                }

                if (tag === 'UL' || tag === 'OL') {
                    for (const li of Array.from(node.querySelectorAll(':scope > li'))) {
                        const t = clean(li.textContent ?? '');
                        if (t) cur.content.push(t);
                    }
                    return;
                }

                if (tag === 'BR') return;
                for (const child of Array.from(node.childNodes)) walk(child);
            };

            for (const child of Array.from(container.childNodes)) walk(child);
            pushCur();
            return sections;
        });
    }

    // ── About the company ─────────────────────────────────────────────────────
    //
    // Structure (from provided HTML):
    //   <h2>About the company</h2>
    //   <a href="/company/...">  ← company link
    //     <img src="...logo..."> ← logo
    //     <p>CompanyName</p>
    //     <p>228,810 followers</p>
    //   </a>
    //   <p>Software Development</p> • <p>501-1000 employees</p> • <p>670 on LinkedIn</p>
    //   <span data-testid="expandable-text-box">About text…</span>

    private async extractAboutCompany(page: Page): Promise<CompanyData | null> {
        try {
            // Find the section that contains the "About the company" h2
            const section = await page.evaluateHandle(() => {
                const h2 = Array.from(document.querySelectorAll('h2'))
                    .find(el => el.textContent?.trim() === 'About the company');
                if (!h2) return null;
                // Walk up until we hit a top-level section wrapper
                let node: HTMLElement | null = h2.parentElement;
                while (node && !node.matches('div[class]')) node = node.parentElement;
                // Go up one more level to capture the full card
                return node?.parentElement?.parentElement ?? null;
            });

            if (!section || (await section.jsonValue()) === null) {
                this.log('⚠  "About the company" section not found');
                return null;
            }

            const el = section.asElement();
            if (!el) return null;

            // Expand the company description if truncated
            try {
                const expandBtns = await el.$$('[data-testid="expandable-text-button"]');
                for (const btn of expandBtns) {
                    await page.evaluate(b => (b as HTMLElement).click(), btn);
                    await humanDelay(300, 700);
                }
            } catch {}

            return el.evaluate((container): CompanyData => {
                const clean = (s: string) =>
                    s.replace(/\u00a0/g, ' ').replace(/\s{2,}/g, ' ').trim();

                const result: CompanyData = {
                    company_url: null,
                    company_name: null,
                    company_logo: null,
                    followers: null,
                    industry: null,
                    employee_count: null,
                    linkedin_employees: null,
                    about: null,
                };

                // ── Company link URL ──────────────────────────────────────
                const companyLink = container.querySelector('a[href*="/company/"]') as HTMLAnchorElement | null;
                if (companyLink) {
                    result.company_url = companyLink.href;

                    // All <p> tags inside the link block
                    const ps = Array.from(companyLink.querySelectorAll('p'));

                    // First <p> = company name
                    if (ps[0]) result.company_name = clean(ps[0].textContent ?? '');

                    // Second <p> containing "followers"
                    const followerP = ps.find(p => p.textContent?.includes('followers'));
                    if (followerP) result.followers = clean(followerP.textContent ?? '');
                }

                // ── Logo ──────────────────────────────────────────────────
                const logo = container.querySelector('img[src*="company-logo"]') as HTMLImageElement | null;
                if (logo) result.company_logo = logo.src;

                // ── Metadata row (industry • employees • linkedin count) ───
                // These live as individual <p> elements separated by " • " <p> tags
                // Strategy: collect all <p> texts OUTSIDE the company link, filter " • "
                const allParas = Array.from(container.querySelectorAll('p'))
                    .filter(p => !companyLink?.contains(p))          // exclude link block
                    .map(p => clean(p.textContent ?? ''))
                    .filter(t => t && t !== '•' && t !== ' • ');

                // Assign by content pattern
                for (const t of allParas) {
                    if (!result.industry && !t.includes('employee') && !t.includes('LinkedIn') && !t.includes('Interested') && !t.includes('follow')) {
                        result.industry = t;
                    } else if (!result.employee_count && t.includes('employee')) {
                        result.employee_count = t;
                    } else if (!result.linkedin_employees && t.includes('LinkedIn')) {
                        result.linkedin_employees = t;
                    }
                }

                // ── About text ────────────────────────────────────────────
                const aboutSpan = container.querySelector('[data-testid="expandable-text-box"]');
                if (aboutSpan) {
                    const btn = aboutSpan.querySelector('[data-testid="expandable-text-button"]');
                    const btnText = btn ? clean(btn.textContent ?? '') : '';
                    let text = clean(aboutSpan.textContent ?? '');
                    if (btnText) text = text.replace(btnText, '').trim();
                    result.about = text || null;
                }

                return result;
            });

        } catch (e) {
            console.error('about_company extraction failed:', e);
            return null;
        }
    }

    // ── Full job detail extraction ────────────────────────────────────────────

    private async extractJobDetails(page: Page, pageNumber: number): Promise<JobData | null> {
        const job: JobData = {
            job_id: null, job_title: null, job_url: null,
            company_name: null, company_logo: null,
            company: null,
            location: null, posted_date: null, total_applicants: null,
            job_type_pills: [], apply_type: null,
            about_job: [], page_number: pageNumber,
        };

        // Job title + URL + ID
        try {
            const a = await page.$(`xpath=${DETAIL}//a[contains(@href,"/jobs/view/")]`);
            if (a) {
                job.job_title = (await a.textContent())?.trim() ?? null;
                const href = await a.getAttribute('href');
                if (href) {
                    const url = new URL(href, 'https://www.linkedin.com');
                    job.job_url = `https://www.linkedin.com/jobs/view/${url.pathname.split('/jobs/view/')[1]?.split('/')[0]}`;
                    job.job_id  = url.pathname.match(/\/jobs\/view\/(\d+)/)?.[1] ?? null;
                }
            }
        } catch {}

        // Company logo (header)
        try {
            const logo = await page.$(`xpath=${DETAIL}//img[contains(@alt,"logo") or contains(@alt,"Logo")]`);
            if (logo) job.company_logo = await logo.getAttribute('src');
        } catch {}

        // Company name (header)
        try {
            const a = await page.$(`xpath=${DETAIL}//a[contains(@href,"/company/")]`);
            if (a) job.company_name = (await a.textContent())?.trim() ?? null;
        } catch {}

        // Location
        try {
            const el = await page.$(`xpath=${DETAIL}//p//span[1]`);
            if (el) job.location = (await el.textContent())?.trim() ?? null;
        } catch {}

        // Posted date
        try {
            const el = await page.$(
                'xpath=/html/body/div[1]/div[2]/div[2]/div[2]/main/div/div/div[2]/div/div[2]/div/div/div/div[1]/div/div[2]/div/div[1]/p/span[4]',
            );
            if (el) job.posted_date = (await el.textContent())?.trim() ?? null;
        } catch {}

        // Total applicants
        try {
            const el = await page.$(
               `xpath=/html/body/div/div[2]/div[2]/div[2]/main/div/div/div[2]/div/div[2]/div/div/div/div[1]/div/div[2]/div/div[1]/p/span[7]`,
            );
            if (el) job.total_applicants = (await el.textContent())?.trim() ?? null;
        } catch {}

        // Job type pills
        try {
            const pillsXPath = `${DETAIL}/div/div[2]/div/div/div/div[1]/div/div[2]/div/div[2]`;
            const container  = await page.$(`xpath=${pillsXPath}`);
            if (container) {
                for (const btn of await container.$$('button')) {
                    const spans = await btn.$$('span');
                    for (let s = spans.length - 1; s >= 0; s--) {
                        const t = (await spans[s].textContent())?.trim();
                        if (t && !t.includes('<')) { job.job_type_pills.push(t); break; }
                    }
                }
            }
        } catch {}

        // Apply type
        try {
            const easyApply = await page.$(`xpath=${DETAIL}//a[contains(@aria-label,"Easy Apply")]`);
            if (easyApply) {
                job.apply_type = 'Easy Apply';
            } else {
                const applyEl = await page.$(`xpath=${DETAIL}//a[contains(@aria-label,"Apply")]`);
                if (applyEl) job.apply_type = (await applyEl.textContent())?.trim() ?? 'Apply';
            }
        } catch {}

        // About the job
        job.about_job = await this.extractAboutJob(page);
        this.log(`✓ about_job: ${job.about_job.length} sections`);

        // Scroll down to reveal "About the company" section
        await humanScroll(page, 'down');
        await humanDelay(600, 1400);
        await humanScroll(page, 'down');
        await humanDelay(400, 800);

        // About the company
        job.company = await this.extractAboutCompany(page);
        if (job.company) {
            this.log(`✓ about_company: ${job.company.company_name ?? 'unknown'} | ${job.company.industry ?? ''} | ${job.company.employee_count ?? ''}`);
        }

        return job;
    }

    // ── Per-page loop ─────────────────────────────────────────────────────────

    private async scrapeCurrentPage(page: Page, pageNumber: number): Promise<number> {
        await this.waitForCardList(page);
        await humanDelay(1200, 2800);
        await humanMouseMove(page, rand(200, 900), rand(200, 600));

        const cardCount = await this.countJobCards(page);
        this.log(`📄 Page ${pageNumber}: found ${cardCount} job cards`);

        let processed = 0;
        for (let i = 1; i <= cardCount; i++) {
            this.log(`📌 [Page ${pageNumber}] Processing card ${i}/${cardCount}`);

            if (!await this.clickCard(page, i)) {
                this.log(`⚠  Card ${i} not clickable — skipping`);
                continue;
            }

            const job = await this.extractJobDetails(page, pageNumber);
            if (job) {
                this.jobs.push(job);
                processed++;
                this.log(`✓ ${job.job_title ?? 'Unknown'} @ ${job.company_name ?? 'Unknown'}`);
            }

            const base  = rand(900, 2000);
            const extra = (i % rand(5, 7) === 0) ? rand(3000, 8000) : 0;
            await humanDelay(base + extra, base + extra + 600);
        }

        return processed;
    }

    // ── Entry point ───────────────────────────────────────────────────────────

    async run(options: ScrapeOptions): Promise<JobData[]> {
        const { searchUrl, maxPages = 0 } = options;   // maxPages 0 = unlimited
        this.jobs = [];

        const BRAVE_USER_DATA =
            'C:\\Users\\MK\\AppData\\Local\\BraveSoftware\\Brave-Browser\\User Data';
        const BRAVE_EXE =
            'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';

        const vpW = rand(1260, 1360);
        const vpH = rand(760, 860);

        const context = await chromium.launchPersistentContext(BRAVE_USER_DATA, {
            headless: false,
            executablePath: BRAVE_EXE,
            viewport:          { width: vpW, height: vpH },
            userAgent:         randomUA(),
            locale:            'en-US',
            timezoneId:        'America/New_York',
            colorScheme:       'light',
            deviceScaleFactor: 1,
            args: [
                '--disable-blink-features=AutomationControlled',
                '--test-type',
                '--profile-directory=Default',
                '--no-sandbox',
                '--disable-infobars',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-first-run',
                '--no-default-browser-check',
                '--ignore-certificate-errors',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                '--disable-ipc-flooding-protection',
                '--metrics-recording-only',
                '--disable-breakpad',
                '--disable-component-update',
                '--mute-audio',
                '--disable-sync',
                '--window-position=0,0',
                `--window-size=${vpW},${vpH}`,
            ],
            extraHTTPHeaders: {
                'Accept-Language':    'en-US,en;q=0.9',
                'sec-ch-ua':          '"Chromium";v="124", "Brave";v="124", "Not-A.Brand";v="99"',
                'sec-ch-ua-mobile':   '?0',
                'sec-ch-ua-platform': '"Windows"',
            },
        });

        const page = await context.newPage();
        await this.stealthPage(page);
        await page.setExtraHTTPHeaders({
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        });

        try {
            // ── Session check ─────────────────────────────────────────────
            this.log('🔐 Checking LinkedIn session...');
            await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
            await humanDelay(3000, 5500);
            await humanScroll(page, 'down');
            await humanDelay(700, 2000);
            await humanScroll(page, 'up');
            await humanDelay(500, 1200);

            if (page.url().includes('login') || page.url().includes('checkpoint')) {
                this.log('⚠  Session expired — please log in manually (2-minute window)...');
                try {
                    await page.waitForURL('**/feed/**', { timeout: 120_000 });
                    this.log('✓ Login successful');
                } catch {
                    this.log('✗ Login timed out — exiting');
                    return [];
                }
            } else {
                this.log('✓ Already logged in');
            }

            // ── Navigate to search ────────────────────────────────────────
            await humanDelay(1500, 3200);
            this.log(`🔍 Navigating to: ${searchUrl}`);
            await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
            await humanDelay(3500, 6500);
            await humanScroll(page, 'down');
            await humanDelay(800, 2200);
            await humanScroll(page, 'up');
            await humanDelay(600, 1400);

            // ── Paginated scrape ──────────────────────────────────────────
            let currentPage = 1;

            while (true) {
                await this.scrapeCurrentPage(page, currentPage);

                // Stop if maxPages reached
                if (maxPages > 0 && currentPage >= maxPages) {
                    this.log(`🛑 maxPages limit reached (${maxPages}). Stopping.`);
                    break;
                }

                if (!await this.hasNextPage(page)) {
                    this.log(`🏁 No more pages after page ${currentPage}.`);
                    break;
                }

                await humanDelay(3500, 8000);

                if (!await this.goToNextPage(page, currentPage)) {
                    this.log('⚠  Could not go to next page. Stopping.');
                    break;
                }

                currentPage++;
            }

            await this.saveData();
            this.log(`\n🎉 Done! ${this.jobs.length} jobs across ${currentPage} page(s)`);
            return this.jobs;

        } finally {
            await context.close();
        }
    }
}