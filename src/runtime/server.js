import express from 'express';
import path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ZenithDatabase } from './database.js';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';

// Setup database instance
const db = new ZenithDatabase('./zenith-db.json');

// Session/thread signature signing key generated on startup
let SESSION_SECRET = process.env.ZENITH_SESSION_SECRET || crypto.randomBytes(32).toString('hex');

if (process.env.NODE_ENV === 'production' && !process.env.ZENITH_SESSION_SECRET) {
  console.warn('⚠️ WARNING: The ZENITH_SESSION_SECRET environment variable is not set. A random session secret has been generated, which will cause active user threads to become unauthorized (403) upon server restarts/cold-starts.');
}

export function setSessionSecret(secret) {
  if (secret) {
    SESSION_SECRET = secret;
  }
}

export function signThread(threadId) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(threadId).digest('hex');
}

export function verifyThread(threadId, signature) {
  if (!threadId || !signature) return false;
  const expected = signThread(threadId);
  try {
    return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  } catch (e) {
    return false;
  }
}

// Map of active SSE streams by threadId
const activeStreams = new Map();

// Helper to send SSE event
function sendSSE(threadId, type, data) {
  const clients = activeStreams.get(threadId);
  if (clients) {
    clients.forEach(res => {
      res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    });
  }
}

// Main Zenith App Wrapper
export class ZenithServer {
  constructor(options = {}) {
    const {
      port = 3000,
      apiKey,
      systemPrompt,
      agentName = 'Agent',
      tools = [],
      distDir = './.zenith',
      sessionSecret,
      enableDashboard,
      maxMessageLength = 5000,
      disableRateLimit = false,
      rateLimitWindowMs = 15 * 60 * 1000,
      rateLimitMaxRequests = 100
    } = options;

    this.port = port;
    this.apiKey = apiKey || process.env.GEMINI_API_KEY;
    this.systemPrompt = systemPrompt;
    this.agentName = agentName;
    this.distDir = path.resolve(distDir);

    this.maxMessageLength = maxMessageLength;
    this.disableRateLimit = disableRateLimit;
    this.rateLimitWindowMs = rateLimitWindowMs;
    this.rateLimitMaxRequests = rateLimitMaxRequests;

    this.enableDashboard = enableDashboard !== undefined 
      ? enableDashboard 
      : (process.env.NODE_ENV !== 'production' && String(process.env.NODE_ENV).toLowerCase() !== 'prod');

    if (sessionSecret) {
      setSessionSecret(sessionSecret);
    }
    
    // Tools map
    this.tools = new Map();
    tools.forEach(t => this.tools.set(t.name, t));

    // Page agent registry
    this.pages = new Map();

    this.app = express();
    this.app.use(express.json());
    
    // Block Dev Console routes if dashboard is not enabled
    this.app.use((req, res, next) => {
      const isConsolePath = req.path.startsWith('/__zenith') || req.path.startsWith('/api/dashboard');
      if (isConsolePath && !this.enableDashboard) {
        return res.status(403).send('Forbidden: Zenith Developer Console is disabled.');
      }
      next();
    });

    // Serve generated client static assets (pages, client js, dashboard assets)
    this.app.use(express.static(path.join(this.distDir, 'public')));

    // Initialize DB async
    db.init().catch(err => console.error('[ZenithDatabase] Init failed:', err));

    // Initialize API routes
    this.setupRoutes();
  }

  registerPage(routeName, { systemPrompt, agentName, tools = [] }) {
    console.log(`[ZenithServer] Registering page "${routeName}" with ${tools.length} tools:`, tools.map(t => t.name));
    const pageTools = new Map();
    tools.forEach(t => pageTools.set(t.name, t));

    this.pages.set(routeName, {
      systemPrompt: systemPrompt || this.systemPrompt,
      agentName: agentName || this.agentName,
      tools: pageTools
    });
  }

  setupRoutes() {
    // Apply rate limiter to chat API
    if (!this.disableRateLimit) {
      const chatLimiter = rateLimit({
        windowMs: this.rateLimitWindowMs,
        max: this.rateLimitMaxRequests,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'Too many requests, please try again later.' }
      });
      this.app.use('/api/chat', chatLimiter);
    }

    // 0. Dashboard static delivery
    this.app.get(['/__zenith', '/__zenith.html'], (req, res) => {
      res.sendFile(path.join(this.distDir, 'public', '__zenith.html'));
    });
    // 1. SSE Stream endpoint
    this.app.get('/api/chat/stream', (req, res) => {
      const { threadId, threadToken } = req.query;
      if (!threadId) {
        return res.status(400).send('threadId is required');
      }
      if (!verifyThread(threadId, threadToken)) {
        return res.status(403).send('Unauthorized: Invalid thread token');
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      if (!activeStreams.has(threadId)) {
        activeStreams.set(threadId, []);
      }
      activeStreams.get(threadId).push(res);

      req.on('close', () => {
        const streams = activeStreams.get(threadId) || [];
        const index = streams.indexOf(res);
        if (index > -1) {
          streams.splice(index, 1);
        }
        if (streams.length === 0) {
          activeStreams.delete(threadId);
        }
      });
    });

    // 2. Chat POST API
    this.app.post('/api/chat', async (req, res) => {
      const { threadId, threadToken, message, agent } = req.body;
      let activeThreadId = threadId;

      if (typeof message !== 'string' || message.length > this.maxMessageLength) {
        return res.status(400).json({ error: `Invalid message. Message must be a string under ${this.maxMessageLength} characters.` });
      }

      if (!activeThreadId) {
        const thread = await db.createThread(null, agent);
        activeThreadId = thread.id;
      } else {
        if (!verifyThread(activeThreadId, threadToken)) {
          return res.status(403).json({ error: 'Unauthorized: Invalid thread token' });
        }
      }

      // Save user message to database
      await db.addMessage(activeThreadId, 'user', message);
      
      // Execute the agent async loop (so SSE client can stream)
      this.runAgentLoop(activeThreadId, message, agent).catch(err => {
        console.error('Agent loop failed:', err);
        sendSSE(activeThreadId, 'error', { error: err.message });
      });

      res.json({ threadId: activeThreadId, threadToken: signThread(activeThreadId) });
    });

    // 3. Load Thread History
    this.app.get('/api/thread', async (req, res) => {
      const { threadId, threadToken } = req.query;
      if (!threadId) return res.status(400).json({ error: 'threadId required' });
      if (!verifyThread(threadId, threadToken)) {
        return res.status(403).json({ error: 'Unauthorized: Invalid thread token' });
      }
      const messages = await db.getMessages(threadId);
      res.json({ messages });
    });

    // --- Dev Dashboard API Routes ---
    this.app.get('/api/dashboard/threads', async (req, res) => {
      const threads = await db.getThreads();
      const threadsWithTokens = threads.map(t => ({
        ...t,
        threadToken: signThread(t.id)
      }));
      res.json(threadsWithTokens);
    });

    this.app.get('/api/dashboard/traces', async (req, res) => {
      const { threadId } = req.query;
      const traces = await db.getTraces(threadId);
      res.json(traces);
    });

    this.app.get('/api/dashboard/tools', (req, res) => {
      const { agent } = req.query;
      console.log(`[ZenithServer] GET /api/dashboard/tools agent=${agent}, pagesKeys=[${Array.from(this.pages.keys()).join(', ')}]`);
      let toolsMap = this.tools;

      if (agent && this.pages.has(agent)) {
        toolsMap = this.pages.get(agent).tools;
      } else if (this.pages.has('index')) {
        toolsMap = this.pages.get('index').tools;
      }

      console.log(`[ZenithServer] Found toolsMap size=${toolsMap.size}`);
      const toolsInfo = Array.from(toolsMap.values()).map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }));
      res.json(toolsInfo);
    });

    this.app.delete('/api/dashboard/threads', async (req, res) => {
      const { threadId } = req.query;
      await db.deleteThread(threadId);
      res.json({ success: true });
    });

    this.app.get('/api/dashboard/pages', (req, res) => {
      const pageNames = Array.from(this.pages.keys());
      res.json(pageNames.length > 0 ? pageNames : ['index']);
    });

    this.app.post('/api/dashboard/threads', async (req, res) => {
      const { agent } = req.body;
      const thread = await db.createThread(null, agent || 'index');
      res.json({
        id: thread.id,
        agent: thread.agent,
        threadToken: signThread(thread.id),
        createdAt: thread.createdAt
      });
    });
  }

  // Core Agentic LLM execution loop
  async runAgentLoop(threadId, latestUserMessage, pageName = 'index') {
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY is not set.');
    }

    const genAI = new GoogleGenerativeAI(this.apiKey);
    
    // Resolve page configuration
    const page = this.pages.get(pageName) || {
      systemPrompt: this.systemPrompt,
      agentName: this.agentName,
      tools: this.tools
    };

    // Assemble tools in Gemini format
    const geminiTools = page.tools.size > 0 ? [{
      functionDeclarations: Array.from(page.tools.values()).map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }))
    }] : [];

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: page.systemPrompt,
      tools: geminiTools
    });

    // 1. Retrieve message history from database
    const dbMessages = await db.getMessages(threadId);
    
    // 2. Format history for Gemini API
    const contents = [];
    dbMessages.forEach(msg => {
      if (msg.role === 'user') {
        contents.push({ role: 'user', parts: [{ text: msg.content }] });
      } else if (msg.role === 'model') {
        contents.push({ role: 'model', parts: [{ text: msg.content }] });
      }
    });

    let loop = true;
    let fullResponseText = '';
    const executionStart = Date.now();

    await db.addTrace(threadId, 'Agent Started', 'prompt', 'completed', 0, { latestUserMessage });

    while (loop) {
      const llmStart = Date.now();
      await db.addTrace(threadId, 'LLM Generation Start', 'llm', 'running');

      // Call Gemini API
      const response = await model.generateContent({ contents });
      const duration = Date.now() - llmStart;
      
      const candidate = response.response.candidates?.[0];
      const part = candidate?.content?.parts?.[0];

      await db.addTrace(threadId, 'LLM Generation Complete', 'llm', 'completed', duration, {
        usage: response.response.usageMetadata,
        candidateText: part?.text || null,
        functionCalls: part?.functionCall ? [part.functionCall] : null
      });

      // Handle function call if requested
      if (part?.functionCall) {
        const call = part.functionCall;
        const toolName = call.name;
        const toolArgs = call.args;

        // Add model function call to contents sequence
        contents.push({
          role: 'model',
          parts: [{ functionCall: call }]
        });

        // Log and stream tool start
        await db.addTrace(threadId, `Execute Tool: ${toolName}`, 'tool', 'running', 0, { args: toolArgs });
        sendSSE(threadId, 'tool_start', { name: toolName, args: toolArgs });

        // Execute tool securely on server
        const tool = page.tools.get(toolName);
        let result;
        const toolStart = Date.now();
        
        try {
          if (!tool) throw new Error(`Tool ${toolName} not found`);
          result = await tool.execute(toolArgs);
          
          const toolDuration = Date.now() - toolStart;
          await db.addTrace(threadId, `Tool ${toolName} Finished`, 'tool', 'completed', toolDuration, { result });
          sendSSE(threadId, 'tool_end', { name: toolName, result });
        } catch (err) {
          result = { error: err.message };
          const toolDuration = Date.now() - toolStart;
          await db.addTrace(threadId, `Tool ${toolName} Failed`, 'tool', 'error', toolDuration, { error: err.message });
          sendSSE(threadId, 'tool_end', { name: toolName, result });
        }

        // Add tool response to contents sequence
        contents.push({
          role: 'user', // Function response role must be user in modern SDK
          parts: [{
            functionResponse: {
              name: toolName,
              response: (typeof result === 'object' && result !== null && !Array.isArray(result)) ? result : { result }
            }
          }]
        });

        // Continue the agent loop
        continue;
      }

      // Handle text response
      if (part?.text) {
        fullResponseText += part.text;
        
        // Stream text token to client
        sendSSE(threadId, 'token', { content: part.text });
      }

      // If no function call, loop terminates
      loop = false;
    }

    // Save final response message in database
    await db.addMessage(threadId, 'model', fullResponseText);

    // Track final trace complete
    const totalDuration = Date.now() - executionStart;
    await db.addTrace(threadId, 'Agent Completed Response', 'response', 'completed', totalDuration, {
      responseText: fullResponseText
    });

    // Stream finished signal
    sendSSE(threadId, 'done', { fullContent: fullResponseText });
  }

  // Start the server
  start() {
    this.app.listen(this.port, () => {
      console.log(`\n\x1b[36m🚀 Zenith Server is running at http://localhost:${this.port}\x1b[0m`);
      console.log(`\x1b[35m📊 Zenith Dashboard: http://localhost:${this.port}/__zenith\x1b[0m\n`);
    });
  }
}
