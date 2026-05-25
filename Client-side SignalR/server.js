const express = require('express');
const { CosmosClient } = require('@azure/cosmos');
const { WebPubSubServiceClient } = require('@azure/web-pubsub');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// === Cosmos DB ===
const cosmosEndpoint = process.env.COSMOS_ENDPOINT;
const cosmosKey = process.env.COSMOS_KEY;
const cosmosClient = new CosmosClient({ endpoint: cosmosEndpoint, key: cosmosKey });
const databaseId = 'CvChatDb';
const containerId = 'Messages';

// Inisialisasi database/container (pertama kali)
async function initCosmos() {
  const { database } = await cosmosClient.databases.createIfNotExists({ id: databaseId });
  await database.containers.createIfNotExists({ id: containerId, partitionKey: '/sessionId' });
}
initCosmos().catch(console.error);

const container = cosmosClient.database(databaseId).container(containerId);

// === SignalR (Azure Web PubSub) ===
const hubName = 'chat';
const pubSubClient = new WebPubSubServiceClient(process.env.SIGNALR_CONNECTION_STRING, hubName);

// Endpoint negosiasi untuk client
app.get('/api/negotiate', async (req, res) => {
  // Misalnya kita tidak pakai user khusus, berikan token untuk semua
  const token = await pubSubClient.getClientAccessToken({
    roles: [`webpubsub.sendToGroup`, `webpubsub.joinLeaveGroup`]
  });
  res.json({ url: token.url });
});

// Kirim pesan
app.post('/api/chat/send', async (req, res) => {
  const { message, sessionId } = req.body;
  if (!message || !sessionId) return res.status(400).json({ error: 'message and sessionId required' });
  
  const msgDoc = {
    id: uuidv4(),
    sessionId,
    message,
    sender: 'visitor',
    timestamp: new Date().toISOString()
  };
  await container.items.create(msgDoc);

  // Kirim ke semua client di group (agar admin dan visitor dapat)
  await pubSubClient.sendToGroup(sessionId, { type: 'newMessage', data: msgDoc }, { contentType: 'application/json' });
  
  res.json({ success: true });
});

// Ambil riwayat percakapan untuk satu session
app.get('/api/chat/history/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const querySpec = {
    query: 'SELECT * FROM c WHERE c.sessionId = @sessionId ORDER BY c.timestamp',
    parameters: [{ name: '@sessionId', value: sessionId }]
  };
  const { resources } = await container.items.query(querySpec).fetchAll();
  res.json(resources);
});

// Admin: balas pesan (dilindungi API key sederhana, nanti bisa diganti AAD)
app.post('/api/admin/reply', async (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.ADMIN_API_KEY) return res.status(403).json({ error: 'Forbidden' });

  const { message, sessionId } = req.body;
  if (!message || !sessionId) return res.status(400).json({ error: 'message and sessionId required' });

  const msgDoc = {
    id: uuidv4(),
    sessionId,
    message,
    sender: 'admin',
    timestamp: new Date().toISOString()
  };
  await container.items.create(msgDoc);

  await pubSubClient.sendToGroup(sessionId, { type: 'newMessage', data: msgDoc }, { contentType: 'application/json' });
  res.json({ success: true });
});

// Admin: daftar semua session yang pernah chat (untuk dashboard admin)
app.get('/api/admin/sessions', async (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.ADMIN_API_KEY) return res.status(403).json({ error: 'Forbidden' });

  const querySpec = {
    query: 'SELECT DISTINCT c.sessionId FROM c'
  };
  const { resources } = await container.items.query(querySpec).fetchAll();
  res.json(resources.map(r => r.sessionId));
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`CV Chat running on port ${port}`));
