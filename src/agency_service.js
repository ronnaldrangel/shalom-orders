const { chromium } = require('playwright');

class AgencyService {
    constructor() {
        this.browser = null;
        this.processing = false;
        this.redisClient = null;
    }

    setRedisClient(client) {
        this.redisClient = client;
    }

    async initialize() {
        if (this.browser && this.browser.isConnected()) return;

        console.log('Initializing Agency Service browser (Playwright)...');
        this.browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu'
            ]
        });
        
        console.log('Agency Service Browser launched');
    }

    async getAgencies() {
        // Check cache first
        if (false && this.redisClient) {
            try {
                const cachedData = await this.redisClient.get('agencies_list');
                if (cachedData) {
                    console.log('Returning agencies from Redis cache');
                    return JSON.parse(cachedData);
                }
            } catch (err) {
                console.error('Redis error (get):', err);
            }
        }

        // Queue mechanism: Wait if currently processing
        while (this.processing) {
            await new Promise(r => setTimeout(r, 100));
        }

        this.processing = true;
        let context = null;
        let page = null;
        let responseHandler = null;

        try {
            // Ensure browser is alive
            if (!this.browser || !this.browser.isConnected()) {
                await this.initialize();
            }

            console.log('Creating new context and page...');
            context = await this.browser.newContext({
                 userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            });

            page = await context.newPage();
            
            // Block unnecessary resources to speed up
            await page.route('**/*', route => {
                const type = route.request().resourceType();
                if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
                    route.abort();
                } else {
                    route.continue();
                }
            });

            console.log('Navigating to agencias.shalom.pe...');
            
            // SETUP RESPONSE INTERCEPTION
            const apiResponsePromise = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    resolve(null); 
                }, 30000); // 30s timeout

                responseHandler = async (response) => {
                    const url = response.url();
                    const method = response.request().method();
                    
                    if (url.includes('agencias') && url.includes('listar') && method !== 'OPTIONS') {
                        console.log('[DEBUG] Matched Agencies API URL:', url);
                        try {
                            const json = await response.json();
                            console.log('[DEBUG] Agencies API Response captured successfully');
                            clearTimeout(timeout);
                            resolve(json);
                        } catch (e) {
                            console.log('[DEBUG] Error parsing JSON:', e.message);
                        }
                    }
                };

                page.on('response', responseHandler);
            });

            // We use goto to trigger the load.
            await page.goto('https://agencias.shalom.pe/', { waitUntil: 'domcontentloaded', timeout: 60000 });

            console.log('Waiting for agency API response...');
            const apiResult = await apiResponsePromise;
            
            if (!apiResult) {
                 throw new Error('Timeout waiting for Agency API response (or received null)');
            }

            // Cache the result
            if (false && this.redisClient) {
                try {
                    const ttl = parseInt(process.env.CACHE_TTL) || 300; // Default 5 minutes
                    // ioredis syntax: set(key, value, 'EX', ttl)
                    await this.redisClient.set('agencies_list', JSON.stringify(apiResult), 'EX', ttl);
                    console.log(`Agencies cached in Redis for ${ttl}s`);
                } catch (err) {
                    console.error('Redis error (set):', err);
                }
            }

            return apiResult;

        } catch (error) {
            console.error('Error getting agencies:', error);
            // If browser looks dead, reset
            if (this.browser && !this.browser.isConnected()) {
                this.browser = null;
            }
            throw error;
        } finally {
            // Cleanup listener
            if (page && responseHandler) {
                page.off('response', responseHandler);
            }
            
            // Close page and context to free resources
            if (page) {
                await page.close().catch(e => console.error('Error closing page:', e.message));
            }
            if (context) {
                await context.close().catch(e => console.error('Error closing context:', e.message));
            }

            this.processing = false;
        }
    }
}

module.exports = new AgencyService();
