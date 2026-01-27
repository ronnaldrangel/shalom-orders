const { chromium } = require('playwright');
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');

// Lazy initialization of Prisma client
let prisma = null;
const getPrisma = () => {
  if (!prisma) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const adapter = new PrismaPg(pool);
    prisma = new PrismaClient({ adapter });
  }
  return prisma;
};

class TenantManager {
  constructor() {
    this.instances = new Map();
    this.initialized = false;
    this.browser = null;
  }

  // Initialize and restore sessions from database
  async initialize() {
    if (this.initialized) return;

    console.log('Initializing TenantManager...');

    try {
      if (!this.browser) {
        console.log('Launching shared browser instance...');
        this.browser = await chromium.launch({
          headless: process.env.HEADLESS !== 'false',
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage' // Crucial for Docker environments
          ]
        });
      }

      const db = getPrisma();
      const dbInstances = await db.instance.findMany({
        where: { isActive: true }
      });

      console.log(`Found ${dbInstances.length} active instances in database`);

      for (const dbInstance of dbInstances) {
        try {
          await this._restoreInstance(dbInstance);
          console.log(`Restored instance ${dbInstance.id}`);
        } catch (error) {
          console.error(`Failed to restore instance ${dbInstance.id}:`, error.message);
          await db.instance.update({
            where: { id: dbInstance.id },
            data: { isActive: false }
          });
        }
      }

      this.initialized = true;
      console.log('TenantManager initialized successfully');
    } catch (error) {
      console.error('TenantManager initialization error:', error.message);
      this.initialized = true;
    }
  }

  async _restoreInstance(dbInstance) {
    if (!this.browser) await this.initialize();

    let context;

    if (dbInstance.storageState) {
      try {
        const storageState = JSON.parse(dbInstance.storageState);
        context = await this.browser.newContext({ storageState });
        console.log(`Restored storage state for instance ${dbInstance.id}`);
      } catch (error) {
        console.error('Failed to parse storage state, creating new context');
        context = await this.browser.newContext();
      }
    } else {
      context = await this.browser.newContext();
    }

    const page = await context.newPage();
    
    // Optimize: Block unnecessary resources
    await page.route('**/*.{png,jpg,jpeg,gif,svg,css,woff,woff2}', route => route.abort());

    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(20000);

    await page.goto('https://pro.shalom.pe', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this._wait(2000);

    const currentUrl = page.url();
    const isLoggedIn = !currentUrl.includes('login');

    this.instances.set(dbInstance.apiKey, {
      id: dbInstance.id,
      apiKey: dbInstance.apiKey,
      context,
      page,
      createdAt: dbInstance.createdAt,
      username: isLoggedIn ? dbInstance.username : null,
      lastShipmentTime: null
    });

    const db = getPrisma();
    await db.instance.update({
      where: { id: dbInstance.id },
      data: { lastUsedAt: new Date() }
    });

    return { isLoggedIn, username: dbInstance.username };
  }

  _wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async _saveStorageState(apiKey) {
    const instance = this.getInstance(apiKey);
    if (!instance) return;

    try {
      const storageState = await instance.context.storageState();
      const db = getPrisma();
      await db.instance.update({
        where: { apiKey },
        data: {
          storageState: JSON.stringify(storageState),
          lastUsedAt: new Date()
        }
      });
      console.log(`Saved storage state for instance ${instance.id}`);
    } catch (error) {
      console.error('Failed to save storage state:', error.message);
    }
  }

  async createInstance() {
    await this.initialize();

    const apiKey = uuidv4();
    const id = uuidv4();

    console.log(`Creating instance ${id} with API Key ${apiKey}`);

    const db = getPrisma();
    await db.instance.create({
      data: {
        id,
        apiKey,
        isActive: true
      }
    });

    const browser = await chromium.launch({
      headless: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(20000);

    await page.goto('https://pro.shalom.pe/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this._wait(1500);

    this.instances.set(apiKey, {
      id,
      apiKey,
      browser,
      context,
      page,
      createdAt: new Date(),
      username: null,
      lastShipmentTime: null
    });

    return { apiKey, id };
  }

  getInstance(apiKey) {
    return this.instances.get(apiKey);
  }

  async getStatus(apiKey) {
    await this.initialize();

    const instance = this.getInstance(apiKey);
    if (!instance) return null;

    const { page, username } = instance;
    const currentUrl = page.url();
    const isLoggedIn = !currentUrl.includes('login') && username !== null;

    return {
      isLoggedIn,
      username: isLoggedIn ? username : null,
      url: currentUrl
    };
  }

  async login(apiKey, username, password, retries = 3) {
    await this.initialize();

    const instance = this.getInstance(apiKey);
    if (!instance) throw new Error('Instance not found');

    const { page } = instance;

    if (!page.url().includes('login')) {
      if (!instance.username) {
        instance.username = username;
        const db = getPrisma();
        await db.instance.update({
          where: { apiKey },
          data: { username }
        });
      }
      await this._saveStorageState(apiKey);
      return { success: true, message: 'Already logged in', url: page.url() };
    }

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`Attempting login for instance ${instance.id} (Attempt ${attempt}/${retries})`);
        if (attempt > 1) await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });

        await page.waitForSelector('input[type="text"], input[type="email"]', { timeout: 8000 });

        const emailInput = await page.$('input[type="email"]') || await page.$('input[type="text"]');
        await emailInput.fill(username);

        const passwordInput = await page.$('input[type="password"]');
        await passwordInput.fill(password);

        const submitButton = await page.$('button[type="submit"]');
        if (submitButton) {
          await Promise.all([
            page.waitForLoadState('domcontentloaded', { timeout: 10000 }),
            submitButton.click()
          ]);
        } else {
          await page.keyboard.press('Enter');
          await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
        }

        const currentUrl = page.url();
        if (!currentUrl.includes('login')) {
          instance.username = username;

          const db = getPrisma();
          await db.instance.update({
            where: { apiKey },
            data: { username }
          });
          await this._saveStorageState(apiKey);

          return { success: true, message: 'Login successful', url: currentUrl };
        }

        const content = await page.content();
        if (content.includes('incorrectas') || content.includes('error')) {
          if (attempt < retries) {
            await this._wait(1000);
            continue;
          }
          return { success: false, message: 'Invalid credentials' };
        }

      } catch (error) {
        console.error(`Login error:`, error.message);
        if (attempt === retries) return { success: false, message: error.message };
        await this._wait(1000);
      }
    }
    return { success: false, message: 'Login failed' };
  }

  async logout(apiKey) {
    await this.initialize();

    const instance = this.getInstance(apiKey);
    if (!instance) throw new Error('Instance not found');
    const { page, context } = instance;

    await context.clearCookies();
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    instance.username = null;

    const db = getPrisma();
    await db.instance.update({
      where: { apiKey },
      data: {
        username: null,
        storageState: null
      }
    });

    await page.goto('https://pro.shalom.pe/login', { waitUntil: 'domcontentloaded', timeout: 20000 });
    return { success: true, message: 'Logged out' };
  }

  async closeInstance(apiKey) {
    await this.initialize();

    const instance = this.getInstance(apiKey);
    if (instance) {
      await instance.browser.close();
      this.instances.delete(apiKey);

      const db = getPrisma();
      await db.instance.update({
        where: { apiKey },
        data: { isActive: false }
      });

      return true;
    }
    return false;
  }

  async listInstances() {
    await this.initialize();

    const db = getPrisma();
    const dbInstances = await db.instance.findMany({
      where: { isActive: true },
      select: {
        id: true,
        apiKey: true,
        username: true,
        createdAt: true,
        lastUsedAt: true
      }
    });

    return dbInstances.map(i => ({
      id: i.id,
      apiKey: i.apiKey,
      username: i.username,
      createdAt: i.createdAt,
      lastUsedAt: i.lastUsedAt,
      inMemory: this.instances.has(i.apiKey)
    }));
  }

  async registerShipment(apiKey, shipmentData) {
    await this.initialize();

    const instance = this.getInstance(apiKey);
    if (!instance) throw new Error('Instance not found');
    const { page } = instance;

    console.log(`[${instance.id}] Starting shipment registration...`);
    const startTime = Date.now();

    try {
      console.log(`[${instance.id}] Resetting Vue state...`);
      await page.goto('https://pro.shalom.pe/#/home', { waitUntil: 'commit', timeout: 15000 });
      await page.goto('https://pro.shalom.pe/#/envios', { waitUntil: 'domcontentloaded', timeout: 15000 });

      await page.getByText('¿Qué tipo de producto', { exact: false }).waitFor({ state: 'visible', timeout: 8000 });

      const typeMap = { 'sobre': 'Sobre', 'xxs': 'Caja Paquete XXS', 'xs': 'Caja Paquete XS', 's': 'Caja Paquete S', 'm': 'Caja Paquete M', 'l': 'Caja Paquete L', 'custom': 'Otra Medida' };
      const typeName = typeMap[shipmentData.productType.toLowerCase()] || 'Sobre';

      console.log(`[${instance.id}] Step 1: Product type: ${typeName}`);
      await page.getByText(typeName, { exact: true }).first().click();
      await page.getByRole('button', { name: 'Continuar' }).click();

      await page.getByText('¿A dónde', { exact: false }).waitFor({ state: 'visible', timeout: 8000 });

      console.log(`[${instance.id}] Step 2: Origin & Destination`);
      await this._selectLocationFast(page, 'Origen', shipmentData.origin);
      await this._selectLocationFast(page, 'Destino', shipmentData.destination);

      await page.getByRole('button', { name: 'Continuar' }).click();
      await this._wait(800);

      console.log(`[${instance.id}] Step 3: Warranty`);
      if (!shipmentData.warranty) {
        await page.getByText('No deseo Garantía').click().catch(() => { });
      }
      await page.getByRole('button', { name: 'Continuar' }).click();

      const dniInput = page.locator('input[placeholder="DNI"]').nth(1);
      await dniInput.waitFor({ state: 'visible', timeout: 8000 });

      console.log(`[${instance.id}] Step 4: Recipient DNI`);
      await dniInput.fill(shipmentData.recipient.documentNumber);

      await this._wait(2000);

      await page.getByRole('button', { name: 'Continuar' }).click();
      await this._wait(800);

      console.log(`[${instance.id}] Step 5: Secure Billing`);
      if (!shipmentData.secureBilling) {
        await page.getByText('No deseo el servicio').click().catch(() => { });
      }
      await page.getByRole('button', { name: 'Continuar' }).click();
      await this._wait(800);

      console.log(`[${instance.id}] Step 6: Checking for Sworn Declaration...`);
      const declaracionVisible = await page.getByText('Declaración Jurada').isVisible().catch(() => false);

      if (declaracionVisible) {
        console.log(`[${instance.id}] Sworn Declaration detected`);
        const contentType = shipmentData.contentType || 'Documentos';
        await page.getByText(contentType, { exact: true }).click().catch(() =>
          page.getByText('Documentos', { exact: true }).click()
        );
        await this._wait(300);
      }

      console.log(`[${instance.id}] Step 7: Security Code`);
      const code = shipmentData.securityCode || '5858';

      await page.getByRole('button', { name: code[0], exact: true }).waitFor({ state: 'visible', timeout: 8000 });

      for (const digit of code) {
        await page.getByRole('button', { name: digit, exact: true }).click();
        await this._wait(150);
      }

      await page.getByRole('button', { name: 'Continuar' }).click();

      await page.getByText('Registrado', { exact: false }).waitFor({ state: 'visible', timeout: 10000 }).catch(() => { });
      await this._wait(500);

      const result = await this._getRegistrationResult(page);

      const elapsed = Date.now() - startTime;
      console.log(`[${instance.id}] Registration completed in ${elapsed}ms`);

      instance.lastShipmentTime = Date.now();

      await this._saveStorageState(apiKey);

      return result;

    } catch (error) {
      console.error(`[${instance.id}] Registration failed:`, error.message);
      throw error;
    }
  }

  async _selectLocationFast(page, placeholder, text) {
    const multiselect = page.locator('.multiselect').filter({ hasText: placeholder }).first();
    await multiselect.click();

    const input = page.getByPlaceholder(placeholder).first();
    await input.fill(text);
    await this._wait(1500);

    await page.keyboard.press('ArrowDown');
    await this._wait(200);
    await page.keyboard.press('Enter');

    await this._wait(400);
  }

  async _getRegistrationResult(page) {
    const content = await page.content();
    if (content.includes('Registrado')) {
      const regMatch = content.match(/([A-Z]\d+)\s*-\s*(\d+)/);
      const priceMatch = content.match(/S\/\s*([\d.]+)/);
      return {
        success: true,
        registrationNumber: regMatch ? `${regMatch[1]} - ${regMatch[2]}` : null,
        price: priceMatch ? parseFloat(priceMatch[1]) : null,
        message: 'Shipment registered successfully'
      };
    }
    const errorMsg = await page.locator('.swal2-title').innerText().catch(() => 'Unknown error');
    return { success: false, message: errorMsg };
  }

  async shutdown() {
    console.log('Shutting down TenantManager...');

    for (const [apiKey, instance] of this.instances) {
      try {
        await this._saveStorageState(apiKey);
        await instance.context.close();
      } catch (error) {
        console.error(`Error closing instance ${instance.id}:`, error.message);
      }
    }
    
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }

    const db = getPrisma();
    await db.$disconnect();
    console.log('TenantManager shutdown complete');
  }
}

module.exports = new TenantManager();
