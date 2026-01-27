const { Queue, Worker, QueueEvents } = require('bullmq');
const tenantManager = require('./tenantManager');
const IORedis = require('ioredis');

// Parse Redis URL or use it directly if supported by IORedis constructor properly
// IORedis handles redis:// URLs automatically
const connection = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null
});

const shipmentQueue = new Queue('shipments', { connection });
const queueEvents = new QueueEvents('shipments', { connection });

const setupWorker = () => {
  const worker = new Worker('shipments', async job => {
    const { apiKey, shipmentData } = job.data;
    console.log(`Processing shipment job ${job.id} for instance ${apiKey}`); // Mask API key in logs ideally
    try {
      // Ensure tenantManager is initialized (it handles its own init state)
      // Call the registerShipment method
      const result = await tenantManager.registerShipment(apiKey, shipmentData);
      return result;
    } catch (error) {
      console.error(`Job ${job.id} failed:`, error);
      throw error; // BullMQ will mark as failed
    }
  }, { 
    connection,
    concurrency: 5, // Limit concurrent browser operations to ensure stability
    limiter: {
      max: 10, // Max 10 jobs
      duration: 1000 // per 1 second (Global rate limit for the worker)
    }
  });

  worker.on('completed', job => {
    console.log(`Job ${job.id} has completed!`);
  });

  worker.on('failed', (job, err) => {
    console.log(`Job ${job.id} has failed with ${err.message}`);
  });
  
  return worker;
};

module.exports = { shipmentQueue, setupWorker, connection, queueEvents };
