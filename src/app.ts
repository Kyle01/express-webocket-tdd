import 'dotenv/config';
import express, { Request, Response } from 'express';
import WebSocket from 'ws';

const app = express();
const port = process.env.PORT || 4000;

// Check required env vars
const requiredEnvVars = ['LAVA', 'LAVA_CONNECTION_SECRET', 'LAVA_PRODUCT_SECRET', 'OPENAI_API_KEY'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar] || process.env[envVar]?.startsWith('your_')) {
    console.warn(`⚠️  Missing or placeholder env var: ${envVar}`);
  }
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.get('/', (req: Request, res: Response) => {
  res.json({ message: 'Welcome to Express!' });
});

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/haiku', async (req: Request, res: Response) => {
  try {
    console.log('--- /haiku request started ---');
    
    // Build token payload manually
    const tokenPayload = {
      secret_key: process.env.LAVA!,
      connection_secret: process.env.LAVA_CONNECTION_SECRET!,
      product_secret: process.env.LAVA_PRODUCT_SECRET!,
      provider_key: process.env.OPENAI_API_KEY!,
    };
    console.log('Token payload:', { ...tokenPayload, secret_key: '***', provider_key: '***' });
    
    const forwardToken = Buffer.from(JSON.stringify(tokenPayload)).toString('base64');
    console.log('Forward token generated:', forwardToken.substring(0, 20) + '...');

    const requestBody = {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'user', content: 'Write me a haiku about coding.' },
      ],
    };
    console.log('Request body:', JSON.stringify(requestBody, null, 2));

    const url = 'http://localhost:3000/v1/forward?u=https://api.openai.com/v1/chat/completions';
    console.log('Fetching:', url);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${forwardToken}`,
      },
      body: JSON.stringify(requestBody),
    });

    console.log('Response status:', response.status);
    console.log('Response headers:', Object.fromEntries(response.headers.entries()));

    const data = await response.json() as any;
    console.log('Response data:', JSON.stringify(data, null, 2));

    const haiku = data.choices?.[0]?.message?.content;
    console.log('Extracted haiku:', haiku);

    res.json({ haiku, debug: { status: response.status, data } });
  } catch (error: any) {
    console.error('Error in /haiku:', error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

// OpenAI Realtime WebSocket test endpoint
app.post('/realtime', async (req: Request, res: Response) => {
  const { prompt } = req.body;
  
  if (!prompt || typeof prompt !== 'string') {
    res.status(400).json({ error: 'prompt is required and must be a string' });
    return;
  }

  console.log('--- /realtime request started ---');
  console.log('Prompt:', prompt);

  // Set up SSE headers to stream responses back
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const wsUrl = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17';
  console.log('Connecting to:', wsUrl);

  const ws = new WebSocket(wsUrl, {
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'OpenAI-Beta': 'realtime=v1',
    },
  });

  ws.on('open', () => {
    console.log('WebSocket connected');
    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

    // Configure the session for text
    const sessionUpdate = {
      type: 'session.update',
      session: {
        modalities: ['text'],
        instructions: 'You are a helpful assistant. Respond concisely.',
      },
    };
    console.log('Sending session.update');
    ws.send(JSON.stringify(sessionUpdate));

    // Send the user's prompt
    const conversationItem = {
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: prompt }],
      },
    };
    console.log('Sending conversation.item.create');
    ws.send(JSON.stringify(conversationItem));

    // Request a response
    const responseCreate = {
      type: 'response.create',
    };
    console.log('Sending response.create');
    ws.send(JSON.stringify(responseCreate));
  });

  ws.on('message', (data) => {
    try {
      const event = JSON.parse(data.toString());
      console.log('Received event:', event.type);

      // Stream event to client
      res.write(`data: ${JSON.stringify(event)}\n\n`);

      // Close when response is complete
      if (event.type === 'response.done') {
        console.log('Response complete, closing WebSocket');
        ws.close();
      }
    } catch (err: any) {
      console.error('Error parsing message:', err);
      res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
    res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
    res.end();
  });

  ws.on('close', (code, reason) => {
    console.log('WebSocket closed:', code, reason.toString());
    res.write(`data: ${JSON.stringify({ type: 'closed', code })}\n\n`);
    res.end();
  });

  // Handle client disconnect
  req.on('close', () => {
    console.log('Client disconnected');
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  });
});

// OpenAI Realtime WebSocket via Lava
app.post('/realtime-lava', async (req: Request, res: Response) => {
  const { prompt } = req.body;
  
  if (!prompt || typeof prompt !== 'string') {
    res.status(400).json({ error: 'prompt is required and must be a string' });
    return;
  }

  console.log('--- /realtime-lava request started ---');
  console.log('Prompt:', prompt);

  // Build Lava forward token (same as haiku)
  const tokenPayload = {
    secret_key: process.env.LAVA!,
    connection_secret: process.env.LAVA_CONNECTION_SECRET!,
    product_secret: process.env.LAVA_PRODUCT_SECRET!,
    provider_key: process.env.OPENAI_API_KEY!,
  };
  console.log('Token payload:', { ...tokenPayload, secret_key: '***', provider_key: '***' });
  
  const forwardToken = Buffer.from(JSON.stringify(tokenPayload)).toString('base64');
  console.log('Forward token generated:', forwardToken.substring(0, 20) + '...');

  // Set up SSE headers to stream responses back
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Connect to Lava's WebSocket forward, targeting OpenAI Realtime
  const targetUrl = encodeURIComponent('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17');
  const wsUrl = `ws://localhost:3000/v1/forward?u=${targetUrl}`;
  console.log('Connecting to Lava WebSocket:', wsUrl);

  const ws = new WebSocket(wsUrl, {
    headers: {
      'Authorization': `Bearer ${forwardToken}`,
      'OpenAI-Beta': 'realtime=v1',
    },
  });

  ws.on('open', () => {
    console.log('Lava WebSocket connected');
    res.write(`data: ${JSON.stringify({ type: 'connected', via: 'lava' })}\n\n`);

    // Configure the session for text
    const sessionUpdate = {
      type: 'session.update',
      session: {
        modalities: ['text'],
        instructions: 'You are a helpful assistant. Respond concisely.',
      },
    };
    console.log('Sending session.update');
    ws.send(JSON.stringify(sessionUpdate));

    // Send the user's prompt
    const conversationItem = {
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: prompt }],
      },
    };
    console.log('Sending conversation.item.create');
    ws.send(JSON.stringify(conversationItem));

    // Request a response
    const responseCreate = {
      type: 'response.create',
    };
    console.log('Sending response.create');
    ws.send(JSON.stringify(responseCreate));
  });

  ws.on('message', (data) => {
    try {
      const event = JSON.parse(data.toString());
      console.log('Received event:', event.type);

      // Stream event to client
      res.write(`data: ${JSON.stringify(event)}\n\n`);

      // Close when response is complete
      if (event.type === 'response.done') {
        console.log('Response complete, closing WebSocket');
        ws.close();
      }
    } catch (err: any) {
      console.error('Error parsing message:', err);
      res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
    }
  });

  ws.on('error', (err) => {
    console.error('Lava WebSocket error:', err);
    res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
    res.end();
  });

  ws.on('close', (code, reason) => {
    console.log('Lava WebSocket closed:', code, reason.toString());
    res.write(`data: ${JSON.stringify({ type: 'closed', code })}\n\n`);
    res.end();
  });

  // Handle client disconnect
  req.on('close', () => {
    console.log('Client disconnected');
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  });
});

// Start server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
