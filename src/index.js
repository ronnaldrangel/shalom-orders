require('dotenv').config();
const fastify = require('fastify')({ logger: true });
const tenantManager = require('./tenantManager');

// Route to create a new instance (Tenant)
fastify.post('/instances', async (request, reply) => {
  try {
    const { apiKey, id } = await tenantManager.createInstance();
    return { status: 'created', apiKey, instanceId: id, message: 'Instance created and browser opened' };
  } catch (err) {
    request.log.error(err);
    reply.code(500).send({ error: 'Failed to create instance' });
  }
});

// Route to list instances (For debugging/management)
fastify.get('/instances', async (request, reply) => {
  const instances = tenantManager.listInstances();
  return { instances };
});

// Middleware/Hook to check API Key and instanceId for protected routes
const checkApiKey = async (request, reply) => {
  const apiKey = request.headers['x-api-key'];
  if (!apiKey) {
    reply.code(401).send({ error: 'Missing x-api-key header' });
    return;
  }

  const { instanceId } = request.body || {};

  // Check if it's the admin API key
  const adminApiKey = process.env.ADMIN_API_KEY;
  if (adminApiKey && apiKey === adminApiKey) {
    // Admin mode: find instance by instanceId from body
    if (!instanceId) {
      reply.code(400).send({ error: 'Missing instanceId in request body' });
      return;
    }

    // Find instance by instanceId
    const allInstances = tenantManager.listInstances();
    const instanceData = allInstances.find(i => i.id === instanceId);
    if (!instanceData) {
      reply.code(404).send({ error: 'Instance not found' });
      return;
    }

    const instance = tenantManager.getInstance(instanceData.apiKey);
    if (!instance) {
      reply.code(404).send({ error: 'Instance not active' });
      return;
    }

    request.instance = instance;
    request.isAdmin = true;
    return;
  }

  // Regular mode: validate apiKey belongs to an instance
  const instance = tenantManager.getInstance(apiKey);
  if (!instance) {
    reply.code(403).send({ error: 'Invalid API Key or Instance not active' });
    return;
  }

  // Validate instanceId from body
  if (!instanceId) {
    reply.code(400).send({ error: 'Missing instanceId in request body' });
    return;
  }

  if (instanceId !== instance.id) {
    reply.code(403).send({ error: 'instanceId does not match the API Key' });
    return;
  }

  request.instance = instance;
};

// Protected route: Check instance status
fastify.post('/status', { preHandler: checkApiKey }, async (request, reply) => {
  try {
    const status = await tenantManager.getStatus(request.instance.apiKey);
    return status;
  } catch (err) {
    request.log.error(err);
    reply.code(500).send({ error: 'Failed to get status', details: err.message });
  }
});

// Protected route: Login
fastify.post('/login', { preHandler: checkApiKey }, async (request, reply) => {
  const { username, password, retries } = request.body || {};

  if (!username || !password) {
    reply.code(400).send({ error: 'Username and password are required' });
    return;
  }

  try {
    // Default retries to 3 if not specified
    const result = await tenantManager.login(request.instance.apiKey, username, password, retries || 3);

    if (!result.success) {
      reply.code(401).send(result);
      return;
    }

    return result;
  } catch (err) {
    request.log.error(err);
    reply.code(500).send({ error: 'Login execution failed', details: err.message });
  }
});

// Protected route: Logout
fastify.post('/logout', { preHandler: checkApiKey }, async (request, reply) => {
  try {
    const result = await tenantManager.logout(request.instance.apiKey);
    return result;
  } catch (err) {
    request.log.error(err);
    reply.code(500).send({ error: 'Logout failed', details: err.message });
  }
});

// Protected route: Close instance
fastify.delete('/instances', { preHandler: checkApiKey }, async (request, reply) => {
  try {
    await tenantManager.closeInstance(request.instance.apiKey);
    return { status: 'closed', message: 'Instance closed successfully' };
  } catch (err) {
    request.log.error(err);
    reply.code(500).send({ error: 'Failed to close instance' });
  }
});

// Protected route: Register shipment
fastify.post('/shipments', { preHandler: checkApiKey }, async (request, reply) => {
  const shipmentData = request.body;

  // Validate required fields
  if (!shipmentData) {
    reply.code(400).send({ error: 'Request body is required' });
    return;
  }

  if (!shipmentData.productType) {
    reply.code(400).send({ error: 'productType is required (sobre, xxs, xs, s, m, l, or custom)' });
    return;
  }

  if (!shipmentData.origin) {
    reply.code(400).send({ error: 'origin is required (search text for origin location)' });
    return;
  }

  if (!shipmentData.destination) {
    reply.code(400).send({ error: 'destination is required (search text for destination location)' });
    return;
  }

  if (!shipmentData.recipient || !shipmentData.recipient.documentNumber) {
    reply.code(400).send({ error: 'recipient.documentNumber is required' });
    return;
  }

  // Validate security code if provided
  if (shipmentData.securityCode) {
    if (!/^\d{4}$/.test(shipmentData.securityCode)) {
      reply.code(400).send({ error: 'securityCode must be exactly 4 digits' });
      return;
    }
    // Check for consecutive digits
    const code = shipmentData.securityCode;
    const isConsecutive =
      (parseInt(code[1]) === parseInt(code[0]) + 1 &&
        parseInt(code[2]) === parseInt(code[1]) + 1 &&
        parseInt(code[3]) === parseInt(code[2]) + 1) ||
      (parseInt(code[1]) === parseInt(code[0]) - 1 &&
        parseInt(code[2]) === parseInt(code[1]) - 1 &&
        parseInt(code[3]) === parseInt(code[2]) - 1);

    if (isConsecutive) {
      reply.code(400).send({ error: 'securityCode cannot have consecutive digits (e.g., 1234, 4321)' });
      return;
    }
  }

  try {
    const result = await tenantManager.registerShipment(request.instance.apiKey, shipmentData);

    if (!result.success) {
      reply.code(400).send(result);
      return;
    }

    return result;
  } catch (err) {
    request.log.error(err);
    reply.code(500).send({ error: 'Shipment registration failed', details: err.message });
  }
});

const start = async () => {
  try {
    const port = process.env.PORT || 3000;
    await fastify.listen({ port });
    console.log(`Server listening on ${fastify.server.address().port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
  process.exit(1);
});

start();
