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
    this.isShuttingDown = false;
  }

  // Initialize and restore sessions from database
  async initialize() {
    if (this.initialized || this.isShuttingDown) return;

    console.log('Initializing TenantManager...');

    try {
      if (!this.browser) {
        if (this.isShuttingDown) return;
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
      const dbInstances = await db.instance.findMany();

      console.log(`Found ${dbInstances.length} instances in database`);

      for (const dbInstance of dbInstances) {
        if (this.isShuttingDown) {
          console.log('Initialization aborted due to shutdown');
          break;
        }
        try {
          await this._restoreInstance(dbInstance);
          console.log(`Restored instance ${dbInstance.id}`);
        } catch (error) {
          console.error(`Failed to restore instance ${dbInstance.id}:`, error.message);
        }
      }

      this.initialized = true;
      if (!this.isShuttingDown) {
        console.log('TenantManager initialized successfully');
      }
    } catch (error) {
      if (!this.isShuttingDown) {
        console.error('TenantManager initialization error:', error.message);
      }
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
    let isLoggedIn = !currentUrl.includes('login');

    // Auto-login if session expired and credentials exist
    if (!isLoggedIn && dbInstance.username && dbInstance.password) {
      console.log(`[${dbInstance.id}] Session expired, attempting auto-login with stored credentials...`);
      const loginResult = await this._attemptLogin(page, dbInstance.username, dbInstance.password, dbInstance.id);
      if (loginResult.success) {
        isLoggedIn = true;
        console.log(`[${dbInstance.id}] Auto-login successful`);
      } else {
        console.error(`[${dbInstance.id}] Auto-login failed: ${loginResult.message}`);
      }
    }

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

    if (isLoggedIn) {
      await this._saveStorageState(dbInstance.apiKey);
    }

    return { isLoggedIn, username: dbInstance.username };
  }

  _wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async _saveStorageState(apiKey) {
    const instance = this.getInstance(apiKey);
    if (!instance) return;

    // Don't try to save state if context is closed or we are shutting down abruptly
    if (this.isShuttingDown && (!instance.context || !instance.context.browser())) return;

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
      // Ignore errors if shutting down
      if (!this.isShuttingDown && !error.message.includes('Target page, context or browser has been closed')) {
        console.error('Failed to save storage state:', error.message);
      }
    }
  }

  async createInstance() {
    await this.initialize();

    if (!this.browser) {
      // Ensure browser is launched if initialize didn't do it (though it should)
      console.log('Browser not ready, launching...');
      this.browser = await chromium.launch({
        headless: process.env.HEADLESS !== 'false',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage'
        ]
      });
    }

    const apiKey = uuidv4();
    const id = uuidv4();

    console.log(`Creating instance ${id} with API Key ${apiKey}`);

    const db = getPrisma();
    await db.instance.create({
      data: {
        id,
        apiKey
      }
    });

    const context = await this.browser.newContext();
    const page = await context.newPage();

    // Optimize: Block unnecessary resources
    await page.route('**/*.{png,jpg,jpeg,gif,svg,css,woff,woff2}', route => route.abort());

    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(20000);

    await page.goto('https://pro.shalom.pe/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this._wait(1500);

    this.instances.set(apiKey, {
      id,
      apiKey,
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

  async getOrRestoreInstance(apiKey) {
    let instance = this.getInstance(apiKey);
    if (instance) return instance;

    const db = getPrisma();
    const dbInstance = await db.instance.findFirst({
      where: { apiKey }
    });

    if (!dbInstance) return null;

    await this._restoreInstance(dbInstance);
    instance = this.getInstance(apiKey);
    return instance || null;
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

  async _attemptLogin(page, username, password, instanceId, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`Attempting login for instance ${instanceId} (Attempt ${attempt}/${retries})`);
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
          return { success: true, url: currentUrl };
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

  async login(apiKey, username, password, retries = 3) {
    await this.initialize();

    const instance = await this.getOrRestoreInstance(apiKey);
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

    const result = await this._attemptLogin(page, username, password, instance.id, retries);

    if (result.success) {
      instance.username = username;

      const db = getPrisma();
      await db.instance.update({
        where: { apiKey },
        data: { username }
      });
      await this._saveStorageState(apiKey);

      return { success: true, message: 'Login successful', url: result.url };
    }

    return result;
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
      try {
        if (instance.context) {
          await instance.context.close();
        }
      } catch (error) {
        console.error(`Error closing context for instance ${instance.id}:`, error.message);
      }

      this.instances.delete(apiKey);
    }

    try {
      const db = getPrisma();
      await db.instance.delete({
        where: { apiKey }
      });
      return true;
    } catch (error) {
      // Ignore if record doesn't exist (P2025)
      if (error.code !== 'P2025') {
        console.error(`Error deleting instance from DB:`, error.message);
      }
      return false;
    }
  }

  async listInstances() {
    await this.initialize();

    const db = getPrisma();
    const dbInstances = await db.instance.findMany({
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

    const instance = await this.getOrRestoreInstance(apiKey);
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
      await page.getByText('No deseo Garantía').click().catch(() => { });
      await page.getByRole('button', { name: 'Continuar' }).click();

      const dniInput = page.locator('input[placeholder="DNI"]').nth(1);
      await dniInput.waitFor({ state: 'visible', timeout: 8000 });

      console.log(`[${instance.id}] Step 4: Recipient DNI`);
      await dniInput.fill(shipmentData.recipient.documentNumber);

      // Wait for potential autocomplete
      await this._wait(2000);

      // Explicitly fill Name and Phone
      const nameInput = page.locator('input[placeholder="Nombre"], input[placeholder="Nombres"], input[placeholder="Nombre Completo"]').first();
      
      if (shipmentData.recipient.name && await nameInput.isVisible()) {
        const currentName = await nameInput.inputValue();
        if (!currentName || currentName.trim() === '') {
          console.log(`[${instance.id}] Name not autocompleted, filling manually: ${shipmentData.recipient.name}`);
          await nameInput.fill(shipmentData.recipient.name);
        } else {
           console.log(`[${instance.id}] Name autocompleted (${currentName}), skipping manual fill.`);
        }
      }

      if (shipmentData.recipient.phone) {
        console.log(`[${instance.id}] Filling recipient phone: ${shipmentData.recipient.phone}`);
        const phoneInput = page.locator('input[placeholder="Teléfono"], input[placeholder="Celular"], input[placeholder="Móvil"]').first();
        if (await phoneInput.isVisible()) {
          await phoneInput.fill(shipmentData.recipient.phone);
        }
      }

      await page.getByRole('button', { name: 'Continuar' }).click();
      await this._wait(800);

      console.log(`[${instance.id}] Step 5: Secure Billing`);
      // User removed secureBilling from API, always default to "No deseo"
      await page.getByText('No deseo el servicio').click().catch(() => { });
      await page.getByRole('button', { name: 'Continuar' }).click();
      await this._wait(800);

      console.log(`[${instance.id}] Step 6: Checking for Sworn Declaration...`);
      // Use a race condition or a quick check, sometimes it appears immediately
      const declaracionLocator = page.getByText('Declaración Jurada', { exact: false });
      
      try {
        // Wait briefly to see if it appears
        await declaracionLocator.waitFor({ state: 'visible', timeout: 3000 });
        console.log(`[${instance.id}] Sworn Declaration detected`);
        
        const contentType = shipmentData.contentType || 'Documentos';
        
        // Try to click the specific content type, fallback to 'Documentos'
        const contentOption = page.getByText(contentType, { exact: true });
        if (await contentOption.isVisible()) {
             await contentOption.click();
        } else {
             await page.getByText('Documentos', { exact: true }).click();
        }
        await this._wait(500);
      } catch (e) {
        // Not visible, continue
        console.log(`[${instance.id}] No Sworn Declaration popup detected.`);
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
      console.error(`[${instance.id}] Shipment registration error:`, error);
      
      // Capture error screenshot
      try {
        await page.screenshot({ path: `error-${instance.id}-${Date.now()}.png` });
      } catch (e) { }

      return {
        success: false,
        error: error.message,
        details: 'Registration failed'
      };
    }
  }

  async registerMassiveShipment(apiKey, filePath, securityCode = '8002') {
    await this.initialize();
    const instance = await this.getOrRestoreInstance(apiKey);
    if (!instance) throw new Error('Instance not found');
    const { page } = instance;

    console.log(`[${instance.id}] Starting massive shipment registration...`);
    const startTime = Date.now();

    try {
      console.log(`[${instance.id}] Navigating to shipment list...`);
      await page.goto('https://pro.shalom.pe/#/envios/list', { waitUntil: 'domcontentloaded', timeout: 15000 });
      // Force reload to ensure clean state as requested
      await page.reload({ waitUntil: 'domcontentloaded' });
      await this._wait(2000);

      // Upload Excel
      console.log(`[${instance.id}] Uploading Excel file: ${filePath}`);
      const filePromise = page.waitForEvent('filechooser');
      
      const massiveBtn = page.getByText('Carga masiva de envíos', { exact: false });
      if (await massiveBtn.isVisible()) {
          await massiveBtn.click();
      } else {
          // Check if it is inside "Registra" menu
          console.log(`[${instance.id}] Massive button not visible, checking menu...`);
          const registraMenu = page.locator('text=Registra').first();
          if (await registraMenu.isVisible()) {
              await registraMenu.click();
              await this._wait(500);
              if (await massiveBtn.isVisible()) {
                  await massiveBtn.click();
              } else {
                  throw new Error('Massive shipment button not found even after opening menu');
              }
          } else {
              throw new Error('Massive shipment button not found');
          }
      }
      
      const fileChooser = await filePromise;
      await fileChooser.setFiles(filePath);

      // Handle "Subida exitosa" dialog
      await page.getByRole('button', { name: 'OK' }).waitFor({ state: 'visible', timeout: 10000 });
      await page.getByRole('button', { name: 'OK' }).click();
      await this._wait(1000);

      // Set Security Code
      console.log(`[${instance.id}] Setting security code: ${securityCode}`);
      // Try to find the button by title or image inside
      const keyButton = page.locator('button[title="Clave de seguridad masiva"]');
      if (await keyButton.isVisible()) {
          await keyButton.click();
      } else {
          // Fallback if title selector fails, try by icon context or position
          // Based on previous snapshots, it's near the delete button
          await page.locator('.btn-warning').first().click(); 
      }
      
      await page.getByRole('button', { name: 'Sí' }).click(); // Confirm "Quiere ingresar clave..."

      // Fill code digits
      const code = securityCode.toString();
      await page.locator('.input-keyCode-1').fill(code[0]);
      await page.locator('.input-keyCode-2').fill(code[1]);
      await page.locator('.input-keyCode-3').fill(code[2]);
      await page.locator('.input-keyCode-4').fill(code[3]);

      await page.getByText('GENERAR').click();
      
      // Confirm "Se ha asignado la clave..."
      await page.getByRole('button', { name: 'Confirmar' }).waitFor({ state: 'visible' });
      await page.getByRole('button', { name: 'Confirmar' }).click();
      await this._wait(1000);

      // Continue and Finalize
      console.log(`[${instance.id}] Finalizing registration...`);
      // Click "Continuar" (using specific class to avoid ambiguity with origin/destination continue buttons)
      // Use .btn-continuar which is specific to the footer action
      await page.locator('.btn-continuar').click();
      await this._wait(1000);

      // Confirm "¿Enviar?"
      // Sometimes there is a second confirmation or it takes time
      const confirmBtn = page.getByRole('button', { name: 'Confirmar' });
      if (await confirmBtn.isVisible()) {
          await confirmBtn.click();
      } else {
          // If Confirmar is not immediately visible, wait for it
          await confirmBtn.waitFor({ state: 'visible', timeout: 5000 });
          await confirmBtn.click();
      }
      
      await this._wait(1000);

      // Confirm "Envíos solicitados" (Final OK)
      // Wait longer for processing
      await page.getByRole('button', { name: 'OK' }).waitFor({ state: 'visible', timeout: 60000 });
      await page.getByRole('button', { name: 'OK' }).click();
      await this._wait(1000);

      // Scrape Pending Shipments
      console.log(`[${instance.id}] Navigating to pending shipments for details...`);
      await page.goto('https://pro.shalom.pe/#/solicitud/pendientes', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('text=N° de Orden', { timeout: 10000 }).catch(() => console.log('No shipments found or timeout'));
      await this._wait(1500);

      const shipments = await page.evaluate(() => {
        const results = [];
        const elements = Array.from(document.querySelectorAll('*'));
        const orderLabels = elements.filter(el => 
            el.children.length === 0 && el.textContent && el.textContent.includes('N° de Orden')
        );

        orderLabels.forEach(label => {
            let container = label.parentElement;
            let attempts = 0;
            while (container && attempts < 6) {
                const text = container.innerText || '';
                if (text.includes('Código') && text.includes('S/')) {
                    const orderMatch = text.match(/N° de Orden:?\s*(\d+)/i);
                    const codeMatch = text.match(/Código:?\s*([A-Z0-9]+)/i);
                    const costMatch = text.match(/S\/\.?\s*([\d.]+)/);
                      // Check for class 'time-deleted' on the container, its ancestors, or inside it
                      const isDeleted = !!container.closest('.time-deleted') || !!container.querySelector('.time-deleted');
 
                      if (orderMatch && !isDeleted) {
                         const exists = results.find(r => r.orderNumber === orderMatch[1]);
                         if (!exists) {
                             results.push({
                                 orderNumber: orderMatch[1],
                                 code: codeMatch ? codeMatch[1] : 'N/A',
                                 cost: costMatch ? costMatch[1] : '0.00'
                             });
                         }
                    }
                    break;
                }
                container = container.parentElement;
                attempts++;
            }
        });
         // Return only the last valid result (as requested by user)
         return results.length > 0 ? [results[results.length - 1]] : [];
       });

      const elapsed = Date.now() - startTime;
      console.log(`[${instance.id}] Massive registration completed in ${elapsed}ms. Found ${shipments.length} shipment(s).`);
      
      instance.lastShipmentTime = Date.now();
      await this._saveStorageState(apiKey);

      return { 
          success: true, 
          message: 'Massive shipment registered successfully', 
          elapsed,
          shipments
      };

    } catch (error) {
      console.error(`[${instance.id}] Massive registration error:`, error);
      try {
        await page.screenshot({ path: `error-massive-${instance.id}-${Date.now()}.png` });
      } catch (e) { }
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
