require('dotenv').config();

const buildApp = async () => {
  const fastify = require('fastify')({ logger: true });
  const tenantManager = require('./tenantManager');

  // Register Redis
  await fastify.register(require('@fastify/redis'), {
    url: process.env.REDIS_URL
  });

  // Register Rate Limit
  await fastify.register(require('@fastify/rate-limit'), {
    max: 100,
    timeWindow: '1 minute',
    redis: fastify.redis, // @fastify/redis instance
    keyGenerator: (req) => req.headers['x-api-key'] || req.ip
  });

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
  fastify.get('/', {
    schema: {
      hide: true
    }
  }, async (request, reply) => {
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

      const instance = await tenantManager.getOrRestoreInstance(instanceData.apiKey);
      if (!instance) {
        reply.code(404).send({ error: 'Instance not found' });
        return;
      }

      request.instance = instance;
      request.isAdmin = true;
      return;
    }

    const instance = await tenantManager.getOrRestoreInstance(apiKey);
    if (!instance) {
      reply.code(403).send({ error: 'Invalid API Key' });
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
      description: 'Devuelve todas las instancias. Requiere Admin API Key.',
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
                  username: { type: 'string' },
                  createdAt: { type: 'string', format: 'date-time' },
                  lastUsedAt: { type: 'string', format: 'date-time', nullable: true },
                  inMemory: { type: 'boolean' }
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



  const { generateMassiveShipmentExcel } = require('./utils/excel');

  // Route: Register massive shipment
  fastify.post('/register', {
    preHandler: checkApiKey,
    schema: {
      tags: ['Shipments'],
      summary: 'Registrar envíos masivos',
      description: 'Registra envíos masivamente desde un archivo o datos JSON.',
      security: [{ ApiKeyAuth: [] }],
      body: {
        type: 'object',
        properties: {
          instanceId: { type: 'string', description: 'ID de la instancia' },
          filePath: { type: 'string', description: 'Ruta del archivo (opcional si se envía shipments)' },
          shipments: { 
            type: 'array', 
            description: 'Lista de envíos para generar Excel',
            items: {
              type: 'object',
              properties: {
                recipientDoc: { type: 'string' },
                recipientPhone: { type: 'string' },
                contactDoc: { type: 'string' },
                contactPhone: { type: 'string' },
                grr: { type: 'string' },
                origin: { type: 'string' },
                destination: { type: 'string' },
                content: { type: 'string' },
                height: { type: 'number' },
                width: { type: 'number' },
                length: { type: 'number' },
                weight: { type: 'number' },
                quantity: { type: 'number' }
              }
            }
          },
          securityCode: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    let { filePath, shipments, securityCode } = request.body;

    if (!filePath && !shipments) {
      reply.code(400).send({ error: 'Either filePath or shipments must be provided' });
      return;
    }

    try {
      if (shipments && shipments.length > 0) {
        // Generate Excel from shipments
        filePath = generateMassiveShipmentExcel(shipments);
        request.log.info(`Generated Excel file at: ${filePath}`);
      }

      const result = await tenantManager.registerMassiveShipment(request.instance.apiKey, filePath, securityCode);
      return result;
    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: err.message });
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
