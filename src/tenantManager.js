const { chromium } = require('playwright');
const { v4: uuidv4 } = require('uuid');

class TenantManager {
  constructor() {
    this.instances = new Map(); // Map<apiKey, { browser, page, context, id }>
  }

  // Helper function to wait (use sparingly - prefer waitFor methods)
  _wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async createInstance() {
    const apiKey = uuidv4();
    const id = uuidv4();

    console.log(`Creating instance ${id} with API Key ${apiKey}`);

    const browser = await chromium.launch({
      headless: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    // Configurar timeouts más cortos para mejor rendimiento
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(20000);

    await page.goto('https://pro.shalom.pe/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this._wait(1500); // Reducido de 3000

    this.instances.set(apiKey, {
      id,
      apiKey,
      browser,
      context,
      page,
      createdAt: new Date(),
      username: null,
      lastShipmentTime: null // Para tracking de registros consecutivos
    });

    return { apiKey, id };
  }

  getInstance(apiKey) {
    return this.instances.get(apiKey);
  }

  async getStatus(apiKey) {
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
    const instance = this.getInstance(apiKey);
    if (!instance) throw new Error('Instance not found');

    const { page } = instance;

    if (!page.url().includes('login')) {
      if (!instance.username) instance.username = username;
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
          return { success: true, message: 'Login successful', url: currentUrl };
        }

        const content = await page.content();
        if (content.includes('incorrectas') || content.includes('error')) {
          if (attempt < retries) {
            await this._wait(1000); // Reducido de 2000
            continue;
          }
          return { success: false, message: 'Invalid credentials' };
        }

      } catch (error) {
        console.error(`Login error:`, error.message);
        if (attempt === retries) return { success: false, message: error.message };
        await this._wait(1000); // Reducido de 2000
      }
    }
    return { success: false, message: 'Login failed' };
  }

  async logout(apiKey) {
    const instance = this.getInstance(apiKey);
    if (!instance) throw new Error('Instance not found');
    const { page, context } = instance;
    await context.clearCookies();
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    instance.username = null;
    await page.goto('https://pro.shalom.pe/login', { waitUntil: 'domcontentloaded', timeout: 20000 });
    return { success: true, message: 'Logged out' };
  }

  async closeInstance(apiKey) {
    const instance = this.getInstance(apiKey);
    if (instance) {
      await instance.browser.close();
      this.instances.delete(apiKey);
      return true;
    }
    return false;
  }

  listInstances() {
    return Array.from(this.instances.values()).map(i => ({ id: i.id, apiKey: i.apiKey, createdAt: i.createdAt }));
  }

  async registerShipment(apiKey, shipmentData) {
    const instance = this.getInstance(apiKey);
    if (!instance) throw new Error('Instance not found');
    const { page } = instance;

    console.log(`[${instance.id}] Starting shipment registration (optimized)...`);
    const startTime = Date.now();

    try {
      // OPTIMIZACIÓN: Navegar a home y envios para resetear Vue state
      // Usamos Promise para navegación más rápida
      console.log(`[${instance.id}] Resetting Vue state...`);
      await page.goto('https://pro.shalom.pe/#/home', { waitUntil: 'commit', timeout: 15000 });
      await page.goto('https://pro.shalom.pe/#/envios', { waitUntil: 'domcontentloaded', timeout: 15000 });

      // Esperar a que el formulario esté listo
      await page.getByText('¿Qué tipo de producto', { exact: false }).waitFor({ state: 'visible', timeout: 8000 });

      // PASO 1: Tipo de Producto
      const typeMap = { 'sobre': 'Sobre', 'xxs': 'Caja Paquete XXS', 'xs': 'Caja Paquete XS', 's': 'Caja Paquete S', 'm': 'Caja Paquete M', 'l': 'Caja Paquete L', 'custom': 'Otra Medida' };
      const typeName = typeMap[shipmentData.productType.toLowerCase()] || 'Sobre';

      console.log(`[${instance.id}] Step 1: Product type: ${typeName}`);
      await page.getByText(typeName, { exact: true }).first().click();
      await page.getByRole('button', { name: 'Continuar' }).click();

      // Esperar a que aparezca el siguiente paso en lugar de wait fijo
      await page.getByText('¿A dónde', { exact: false }).waitFor({ state: 'visible', timeout: 8000 });

      // PASO 2: Origen y Destino (OPTIMIZADO)
      console.log(`[${instance.id}] Step 2: Origin & Destination`);
      await this._selectLocationFast(page, 'Origen', shipmentData.origin);
      await this._selectLocationFast(page, 'Destino', shipmentData.destination);

      await page.getByRole('button', { name: 'Continuar' }).click();
      await this._wait(800); // Pequeña espera para transición

      // PASO 3: Garantía
      console.log(`[${instance.id}] Step 3: Warranty`);
      if (!shipmentData.warranty) {
        await page.getByText('No deseo Garantía').click().catch(() => { });
      }
      await page.getByRole('button', { name: 'Continuar' }).click();

      // Esperar al campo DNI del destinatario
      const dniInput = page.locator('input[placeholder="DNI"]').nth(1);
      await dniInput.waitFor({ state: 'visible', timeout: 8000 });

      // PASO 4: Destinatario
      console.log(`[${instance.id}] Step 4: Recipient DNI`);
      await dniInput.fill(shipmentData.recipient.documentNumber);

      // Esperar validación RENIEC (esto es obligatorio, pero podemos optimizar)
      await this._wait(2000); // RENIEC toma ~2s mínimo

      await page.getByRole('button', { name: 'Continuar' }).click();
      await this._wait(800);

      // PASO 5: Cobro Seguro
      console.log(`[${instance.id}] Step 5: Secure Billing`);
      if (!shipmentData.secureBilling) {
        await page.getByText('No deseo el servicio').click().catch(() => { });
      }
      await page.getByRole('button', { name: 'Continuar' }).click();
      await this._wait(800);

      // PASO 6: Declaración Jurada (si existe)
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

      // PASO 7: Clave de Seguridad
      console.log(`[${instance.id}] Step 7: Security Code`);
      const code = shipmentData.securityCode || '5858';

      // Esperar a que el teclado sea visible
      await page.getByRole('button', { name: code[0], exact: true }).waitFor({ state: 'visible', timeout: 8000 });

      // Ingresar código rápidamente
      for (const digit of code) {
        await page.getByRole('button', { name: digit, exact: true }).click();
        await this._wait(150); // Reducido de 300
      }

      await page.getByRole('button', { name: 'Continuar' }).click();

      // Esperar resultado
      await page.getByText('Registrado', { exact: false }).waitFor({ state: 'visible', timeout: 10000 }).catch(() => { });
      await this._wait(500);

      // PASO 8: Resultado
      const result = await this._getRegistrationResult(page);

      const elapsed = Date.now() - startTime;
      console.log(`[${instance.id}] Registration completed in ${elapsed}ms`);

      instance.lastShipmentTime = Date.now();
      return result;

    } catch (error) {
      console.error(`[${instance.id}] Registration failed:`, error.message);
      throw error;
    }
  }

  // Versión optimizada de selección de ubicación
  async _selectLocationFast(page, placeholder, text) {
    // Abrir el multiselect
    const multiselect = page.locator('.multiselect').filter({ hasText: placeholder }).first();
    await multiselect.click();

    // Escribir y esperar filtrado
    const input = page.getByPlaceholder(placeholder).first();
    await input.fill(text);
    await this._wait(1500); // Reducido de 3000 - tiempo mínimo para API de búsqueda

    // Seleccionar primera opción
    await page.keyboard.press('ArrowDown');
    await this._wait(200); // Reducido de 500
    await page.keyboard.press('Enter');

    // Pequeña espera para que se confirme la selección
    await this._wait(400); // Reducido de 1500
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
}

module.exports = new TenantManager();
