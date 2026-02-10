const { chromium } = require('playwright');
require('dotenv').config();

class ShalomTracker {
    constructor() {
        this.browser = null;
        this.context = null;
        this.page = null;
        this.isLoggedIn = false;
        this.processing = false; // Simple lock
        this.credentials = {
            username: process.env.SHALOM_USER,
            password: process.env.SHALOM_PASS
        };
        this.redisClient = null;
    }

    setRedisClient(client) {
        this.redisClient = client;
    }

    async initialize() {
        if (this.browser && this.browser.isConnected()) return;

        console.log('Initializing persistent browser (Playwright)...');
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
        
        console.log('Tracker Browser launched');

        // Create context with specific User-Agent
        this.context = await this.browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });

        this.page = await this.context.newPage();
        
        // Block unnecessary resources to speed up
        await this.page.route('**/*', route => {
            const type = route.request().resourceType();
            if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
                route.abort();
            } else {
                route.continue();
            }
        });

        await this.login();
    }

    async login() {
        try {
            console.log('Navigating to rastrea.shalom.pe...');
            await this.page.goto('https://rastrea.shalom.pe/', { waitUntil: 'domcontentloaded', timeout: 60000 });

            // Wait for key elements to ensure page is ready
            try {
                await this.page.waitForSelector('input[type="email"], .main-content, button', { timeout: 10000 });
            } catch (e) {
                console.log('Page loaded but specific selectors not found immediately.');
            }

            const isLoginPage = await this.page.evaluate(() => {
                return !!document.querySelector('input[type="email"]');
            });

            if (isLoginPage) {
                console.log('Login page detected. Logging in...');
                if (!this.credentials.username || !this.credentials.password) {
                    console.warn('Login required but credentials missing. Please check .env credentials (SHALOM_USER, SHALOM_PASS).');
                    // We don't throw here to allow app to start, but tracking might fail if login is strictly required
                } else {
                    await this.page.fill('input[type="email"]', this.credentials.username);
                    await this.page.fill('input[type="password"]', this.credentials.password);
                    
                    // Try to find the button
                    const loginButton = this.page.locator('button', { hasText: 'Ingresar' }).first();
                    
                    if (await loginButton.count() > 0) {
                        await loginButton.click();
                        await this.page.waitForLoadState('domcontentloaded');
                        console.log('Login successful.');
                    } else {
                        throw new Error('Login button not found');
                    }
                }
            } else {
                console.log('Already logged in or no login required.');
            }
            this.isLoggedIn = true;
        } catch (error) {
            console.error('Login failed:', error);
            throw error;
        }
    }

    async trackPackage(orderNumber, orderCode) {
        const cacheKey = `tracking:${orderNumber}:${orderCode}`;
        
        // Check cache first
        if (this.redisClient) {
            try {
                const cachedData = await this.redisClient.get(cacheKey);
                if (cachedData) {
                    console.log(`Returning tracking data for ${orderNumber} from Redis cache`);
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
        let responseHandler = null;

        try {
            // Ensure browser is alive
            if (!this.browser || !this.browser.isConnected()) {
                await this.initialize();
            } else if (!this.isLoggedIn) {
                await this.login();
            }

            // Ensure we are on the tracker page
            const url = this.page.url();
            if (!url.includes('rastrea.shalom.pe')) {
                console.log('Page not on tracker. Navigating back...');
                await this.login(); 
            }

            console.log(`Tracking ${orderNumber} - ${orderCode}...`);
            
            const orderNumberSelector = 'input[placeholder="N° de Orden"]';
            const orderCodeSelector = 'input[placeholder="Código de Orden"]';

            await this.page.waitForSelector(orderNumberSelector, { timeout: 5000 });
            
            // Force set values via evaluate (Robust method for Vue/React)
            await this.page.evaluate(({sel, val}) => { 
                const el = document.querySelector(sel);
                if(el) {
                    el.value = val;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    el.dispatchEvent(new Event('blur', { bubbles: true }));
                }
            }, {sel: orderNumberSelector, val: orderNumber});

            await this.page.evaluate(({sel, val}) => { 
                const el = document.querySelector(sel);
                if(el) {
                    el.value = val;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    el.dispatchEvent(new Event('blur', { bubbles: true }));
                }
            }, {sel: orderCodeSelector, val: orderCode});
            
            // Wait for Vue to react
            await new Promise(r => setTimeout(r, 200));
            
            // Find the "Buscar" button
            const searchButton = this.page.locator('button', { hasText: 'Buscar' }).first();

            if (await searchButton.count() === 0) {
                throw new Error('Search button not found');
            }

            // SETUP RESPONSE INTERCEPTION
            const apiResponsePromise = new Promise((resolve, reject) => {
                const capturedData = {};

                const timeout = setTimeout(() => {
                    if (Object.keys(capturedData).length > 0) {
                        resolve(capturedData);
                    } else {
                        resolve(null); 
                    }
                }, 15000); 

                responseHandler = async (response) => {
                    const url = response.url();
                    const method = response.request().method();
                    
                    try {
                        if (url.includes('rastrea') && url.includes('buscar') && method === 'POST') {
                            console.log('[DEBUG] Matched Search API URL:', url);
                            const json = await response.json();
                            capturedData.search = json;
                        }

                        if (url.includes('rastrea') && url.includes('estados') && method === 'POST') {
                            console.log('[DEBUG] Matched Statuses API URL:', url);
                            const json = await response.json();
                            capturedData.statuses = json;
                        }

                        if (capturedData.search && capturedData.statuses) {
                            console.log('[DEBUG] Both APIs captured successfully');
                            clearTimeout(timeout);
                            resolve(capturedData);
                        }
                    } catch (e) {
                        // ignore
                    }
                };

                this.page.on('response', responseHandler);
            });
            
            // Click search
            await searchButton.click();
            
            const apiResult = await apiResponsePromise;

            if (!apiResult) {
                throw new Error('Timeout waiting for API response (or received null)');
            }

            // Cache the result
            if (this.redisClient) {
                try {
                    const ttl = parseInt(process.env.CACHE_TTL) || 300; // Default 5 minutes
                    // ioredis syntax: set(key, value, 'EX', ttl)
                    await this.redisClient.set(cacheKey, JSON.stringify(apiResult), 'EX', ttl); 
                    console.log(`Tracking data for ${orderNumber} cached in Redis for ${ttl}s`);
                } catch (err) {
                    console.error('Redis error (set):', err);
                }
            }

            return apiResult;

        } catch (error) {
            console.error("Error during tracking:", error);
            // Check if browser is closed
            if (!this.browser || !this.browser.isConnected()) {
                this.browser = null;
                this.isLoggedIn = false;
            }
            throw error;
        } finally {
            if (this.page && responseHandler) {
                this.page.off('response', responseHandler);
            }
            this.processing = false;
        }
    }
}

// Singleton instance
const tracker = new ShalomTracker();

module.exports = tracker;
