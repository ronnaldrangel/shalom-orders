require('dotenv').config();

const buildApp = async () => {
  const fastify = require('fastify')({ logger: true });
  const tenantManager = require('./tenantManager');

  // Register Swagger
  await fastify.register(require('@fastify/swagger'), {
    openapi: {
      info: {
        title: 'Shalom Multitenant API',
        description: 'API de automatización para gestión de sesiones en Shalom Pro',
        version: '1.0.0'
      },
      servers: [
        { url: 'http://localhost:3000', description: 'Local server' }
      ],
      components: {
        securitySchemes: {
          ApiKeyAuth: {
            type: 'apiKey',
            in: 'header',
            name: 'x-api-key',
            description: 'API Key de la instancia o Admin API Key'
          }
        }
      },
      tags: [
        { name: 'Instances', description: 'Gestión de instancias de navegador' },
        { name: 'Authentication', description: 'Login y logout de sesiones' },
        { name: 'Shipments', description: 'Registro de envíos' }
      ]
    }
  });

  await fastify.register(require('@fastify/swagger-ui'), {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true
    }
  });

  // Route: Health Check
  fastify.get('/', async (request, reply) => {
    return { status: 'ok', uptime: process.uptime() };
  });

  fastify.get('/health', async (request, reply) => {
    return { status: 'ok', uptime: process.uptime() };
  });

  // Middleware to check Admin API Key only
  const checkAdminApiKey = async (request, reply) => {
    const apiKey = request.headers['x-api-key'];
    if (!apiKey) {
      reply.code(401).send({ error: 'Missing x-api-key header' });
      return;
    }

    const adminApiKey = process.env.ADMIN_API_KEY;
    if (!adminApiKey || apiKey !== adminApiKey) {
      reply.code(403).send({ error: 'Invalid Admin API Key' });
      return;
    }
  };

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
      if (!instanceId) {
        reply.code(400).send({ error: 'Missing instanceId in request body' });
        return;
      }

      const allInstances = await tenantManager.listInstances();
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

    const instance = tenantManager.getInstance(apiKey);
    if (!instance) {
      reply.code(403).send({ error: 'Invalid API Key or Instance not active' });
      return;
    }

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

  // Route: Create instance
  fastify.post('/instances', {
    preHandler: checkAdminApiKey,
    schema: {
      tags: ['Instances'],
      summary: 'Crear nueva instancia',
      description: 'Crea una nueva instancia de navegador y navega a la página de login de Shalom Pro. Requiere Admin API Key.',
      security: [{ ApiKeyAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string', example: 'created' },
            apiKey: { type: 'string', example: '550e8400-e29b-41d4-a716-446655440000' },
            instanceId: { type: 'string', example: '7c9e6679-7425-40de-944b-e07fc1f90ae7' },
            message: { type: 'string', example: 'Instance created and browser opened' }
          }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { apiKey, id } = await tenantManager.createInstance();
      return { status: 'created', apiKey, instanceId: id, message: 'Instance created and browser opened' };
    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: 'Failed to create instance' });
    }
  });

  // Route: List instances
  fastify.get('/instances', {
    preHandler: checkAdminApiKey,
    schema: {
      tags: ['Instances'],
      summary: 'Listar instancias',
      description: 'Devuelve todas las instancias activas. Requiere Admin API Key.',
      security: [{ ApiKeyAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            instances: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  apiKey: { type: 'string' },
                  createdAt: { type: 'string', format: 'date-time' }
                }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const instances = await tenantManager.listInstances();
    return { instances };
  });

  // Route: Get status
  fastify.post('/status', {
    preHandler: checkApiKey,
    schema: {
      tags: ['Authentication'],
      summary: 'Obtener estado de instancia',
      description: 'Verifica el estado de autenticación de una instancia.',
      security: [{ ApiKeyAuth: [] }],
      body: {
        type: 'object',
        required: ['instanceId'],
        properties: {
          instanceId: { type: 'string', description: 'ID de la instancia' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            isLoggedIn: { type: 'boolean' },
            username: { type: 'string', nullable: true },
            url: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const status = await tenantManager.getStatus(request.instance.apiKey);
      return status;
    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: 'Failed to get status', details: err.message });
    }
  });

  // Route: Login
  fastify.post('/login', {
    preHandler: checkApiKey,
    schema: {
      tags: ['Authentication'],
      summary: 'Iniciar sesión',
      description: 'Realiza el inicio de sesión automático en Shalom Pro.',
      security: [{ ApiKeyAuth: [] }],
      body: {
        type: 'object',
        required: ['instanceId', 'username', 'password'],
        properties: {
          instanceId: { type: 'string', description: 'ID de la instancia' },
          username: { type: 'string', description: 'Usuario/Email para iniciar sesión' },
          password: { type: 'string', description: 'Contraseña del usuario' },
          retries: { type: 'number', default: 3, description: 'Número de reintentos' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
            url: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { username, password, retries } = request.body || {};

    if (!username || !password) {
      reply.code(400).send({ error: 'Username and password are required' });
      return;
    }

    try {
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

  // Route: Logout
  fastify.post('/logout', {
    preHandler: checkApiKey,
    schema: {
      tags: ['Authentication'],
      summary: 'Cerrar sesión',
      description: 'Cierra la sesión actual y limpia cookies/almacenamiento.',
      security: [{ ApiKeyAuth: [] }],
      body: {
        type: 'object',
        required: ['instanceId'],
        properties: {
          instanceId: { type: 'string', description: 'ID de la instancia' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const result = await tenantManager.logout(request.instance.apiKey);
      return result;
    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: 'Logout failed', details: err.message });
    }
  });

  // Route: Delete instance
  fastify.delete('/instances', {
    preHandler: checkApiKey,
    schema: {
      tags: ['Instances'],
      summary: 'Eliminar instancia',
      description: 'Cierra el navegador y elimina la instancia del sistema.',
      security: [{ ApiKeyAuth: [] }],
      body: {
        type: 'object',
        required: ['instanceId'],
        properties: {
          instanceId: { type: 'string', description: 'ID de la instancia a eliminar' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string', example: 'closed' },
            message: { type: 'string', example: 'Instance closed successfully' }
          }
        }
      }
    }
  }, async (request, reply) => {
    try {
      await tenantManager.closeInstance(request.instance.apiKey);
      return { status: 'closed', message: 'Instance closed successfully' };
    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: 'Failed to close instance' });
    }
  });

  // Route: Register shipment
  fastify.post('/shipments', {
    preHandler: checkApiKey,
    schema: {
      tags: ['Shipments'],
      summary: 'Registrar envío',
      description: 'Registra un nuevo envío en Shalom Pro de forma automatizada.',
      security: [{ ApiKeyAuth: [] }],
      body: {
        type: 'object',
        required: ['instanceId', 'productType', 'origin', 'destination', 'recipient'],
        properties: {
          instanceId: { type: 'string', description: 'ID de la instancia' },
          productType: {
            type: 'string',
            enum: ['sobre', 'xxs', 'xs', 's', 'm', 'l', 'custom'],
            description: 'Tipo de producto'
          },
          origin: { type: 'string', description: 'Ubicación de origen' },
          destination: { type: 'string', description: 'Ubicación de destino' },
          recipient: {
            type: 'object',
            required: ['documentNumber'],
            properties: {
              documentType: { type: 'string', enum: ['dni', 'ruc', 'ce'], default: 'dni' },
              documentNumber: { type: 'string', description: 'Número de documento' },
              phone: { type: 'string', description: 'Teléfono (opcional)' }
            }
          },
          warranty: { type: 'boolean', default: false },
          secureBilling: { type: 'boolean', default: false },
          securityCode: { type: 'string', default: '5858' },
          customDimensions: {
            type: 'object',
            properties: {
              largo: { type: 'number' },
              ancho: { type: 'number' },
              alto: { type: 'number' },
              peso: { type: 'number' }
            }
          }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            registrationNumber: { type: 'string' },
            price: { type: 'number' },
            message: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const shipmentData = request.body;

    if (!shipmentData) {
      reply.code(400).send({ error: 'Request body is required' });
      return;
    }

    if (!shipmentData.productType) {
      reply.code(400).send({ error: 'productType is required' });
      return;
    }

    if (!shipmentData.origin) {
      reply.code(400).send({ error: 'origin is required' });
      return;
    }

    if (!shipmentData.destination) {
      reply.code(400).send({ error: 'destination is required' });
      return;
    }

    if (!shipmentData.recipient || !shipmentData.recipient.documentNumber) {
      reply.code(400).send({ error: 'recipient.documentNumber is required' });
      return;
    }

    if (shipmentData.securityCode) {
      if (!/^\d{4}$/.test(shipmentData.securityCode)) {
        reply.code(400).send({ error: 'securityCode must be exactly 4 digits' });
        return;
      }
      const code = shipmentData.securityCode;
      const isConsecutive =
        (parseInt(code[1]) === parseInt(code[0]) + 1 &&
          parseInt(code[2]) === parseInt(code[1]) + 1 &&
          parseInt(code[3]) === parseInt(code[2]) + 1) ||
        (parseInt(code[1]) === parseInt(code[0]) - 1 &&
          parseInt(code[2]) === parseInt(code[1]) - 1 &&
          parseInt(code[3]) === parseInt(code[2]) - 1);

      if (isConsecutive) {
        reply.code(400).send({ error: 'securityCode cannot have consecutive digits' });
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

  return fastify;
};

const start = async () => {
  try {
    const fastify = await buildApp();
    const tenantManager = require('./tenantManager');

    // Initialize tenant manager (restore sessions from DB)
    await tenantManager.initialize();

    // Register shutdown hook
    fastify.addHook('onClose', async () => {
      await tenantManager.shutdown();
    });

    const port = process.env.PORT || 3000;
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`Server listening on ${fastify.server.address().port}`);
    console.log(`📚 Swagger docs available at http://localhost:${port}/docs`);

    // Graceful shutdown handlers
    const shutdown = async (signal) => {
      console.log(`\n${signal} received. Shutting down gracefully...`);
      await fastify.close();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (err) {
    console.error('Error starting server:', err);
    process.exit(1);
  }
};

process.on('uncaughtException', async (err) => {
  console.error('Uncaught Exception:', err);
  const tenantManager = require('./tenantManager');
  await tenantManager.shutdown();
  process.exit(1);
});

process.on('unhandledRejection', async (err) => {
  console.error('Unhandled Rejection:', err);
  const tenantManager = require('./tenantManager');
  await tenantManager.shutdown();
  process.exit(1);
});

start();
