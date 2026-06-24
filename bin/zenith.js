#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

const command = process.argv[2] || 'dev';
const projectName = process.argv[3] || '.';

// ─────────────────────────────────────────────
// rezon init — scaffold a new project
// ─────────────────────────────────────────────

if (command === 'init') {
  const targetDir = projectName === '.' ? process.cwd() : path.resolve(process.cwd(), projectName);
  const dirName = path.basename(targetDir);

  console.log(`\n  ⚡ \x1b[36mRezon\x1b[0m  Creating a new project...\n`);

  // Create directories
  fs.mkdirSync(path.join(targetDir, 'src', 'pages'), { recursive: true });

  // 1. package.json
  const pkg = {
    name: dirName,
    version: "0.1.0",
    private: true,
    type: "module",
    scripts: {
      dev: "rezon dev",
      build: "rezon build"
    },
    dependencies: {
      rezon: "^1.0.0"
    }
  };
  fs.writeFileSync(path.join(targetDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf-8');

  // 2. .gitignore
  const gitignore = `node_modules/\n.zenith/\nzenith-db.json\n`;
  fs.writeFileSync(path.join(targetDir, '.gitignore'), gitignore, 'utf-8');

  // 3. .env.example
  const envExample = `# Get your key at https://aistudio.google.com/apikey\nGEMINI_API_KEY=your_key_here\n`;
  fs.writeFileSync(path.join(targetDir, '.env.example'), envExample, 'utf-8');

  // 4. Starter page
  const starterPage = `<script type="zenith">
  agent.name = "Assistant";
  agent.systemPrompt = "You are a friendly and helpful AI assistant powered by Rezon.";

  let messages = [];
  let prompt = "";

  /**
   * Get the current date and time
   */
  server tool getDateTime() {
    return new Date().toLocaleString();
  }
</script>

<template>
  <div class="app">
    <header>
      <h1>⚡ Rezon</h1>
      <p class="tagline">Your AI app is live. Start building.</p>
    </header>

    <div class="chat">
      <div class="messages" z-each="msg in messages">
        <div class="msg {msg.role}">
          <span class="label" z-if="msg.role === 'user'">You</span>
          <span class="label" z-if="msg.role === 'model'">AI</span>
          <p>{msg.content}</p>
        </div>
      </div>

      <div class="input-area">
        <input type="text" z-bind="prompt" placeholder="Ask me anything..." />
        <button z-click="agent.send(prompt); prompt = ''">Send</button>
      </div>
    </div>
  </div>
</template>

<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    background: #0f172a;
    color: #e2e8f0;
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    display: flex;
    justify-content: center;
    padding: 40px 20px;
    min-height: 100vh;
  }

  .app {
    width: 100%;
    max-width: 640px;
  }

  header {
    text-align: center;
    margin-bottom: 32px;
  }

  header h1 {
    font-size: 2rem;
    font-weight: 700;
    background: linear-gradient(135deg, #818cf8, #06b6d4);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  .tagline {
    color: #64748b;
    margin-top: 6px;
    font-size: 0.9rem;
  }

  .chat {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 16px;
    padding: 24px;
  }

  .messages {
    max-height: 420px;
    overflow-y: auto;
    margin-bottom: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .msg {
    padding: 12px 16px;
    border-radius: 12px;
    font-size: 0.9rem;
    line-height: 1.5;
  }

  .msg.user {
    background: #4f46e5;
    color: white;
    align-self: flex-end;
    max-width: 80%;
    border-bottom-right-radius: 4px;
  }

  .msg.model {
    background: rgba(255, 255, 255, 0.05);
    align-self: flex-start;
    max-width: 80%;
    border-bottom-left-radius: 4px;
  }

  .label {
    display: block;
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    opacity: 0.5;
    margin-bottom: 4px;
  }

  .input-area {
    display: flex;
    gap: 8px;
  }

  .input-area input {
    flex: 1;
    padding: 12px 16px;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(0, 0, 0, 0.3);
    color: #e2e8f0;
    font-size: 0.9rem;
    outline: none;
    transition: border-color 0.2s;
  }

  .input-area input:focus {
    border-color: #6366f1;
  }

  .input-area button {
    padding: 12px 24px;
    border-radius: 12px;
    border: none;
    background: linear-gradient(135deg, #4f46e5, #06b6d4);
    color: white;
    font-weight: 600;
    font-size: 0.9rem;
    cursor: pointer;
    transition: opacity 0.2s;
  }

  .input-area button:hover {
    opacity: 0.9;
  }
</style>
`;
  fs.writeFileSync(path.join(targetDir, 'src', 'pages', 'index.html'), starterPage, 'utf-8');

  // Print success
  const relPath = projectName === '.' ? '' : projectName;
  console.log(`  ✅ Project created${relPath ? ` in \x1b[36m${relPath}/\x1b[0m` : ''}\n`);
  console.log(`  Next steps:\n`);
  if (relPath) {
    console.log(`    cd ${relPath}`);
  }
  console.log(`    npm install`);
  console.log(`    set GEMINI_API_KEY=your_key_here`);
  console.log(`    npm run dev\n`);
  console.log(`  Then open \x1b[36mhttp://localhost:3000\x1b[0m\n`);
  process.exit(0);
}

// ─────────────────────────────────────────────
// rezon --help / rezon help
// ─────────────────────────────────────────────

if (command === '--help' || command === 'help' || command === '-h') {
  console.log(`
  \x1b[36m⚡ Rezon\x1b[0m — AI-first web framework

  \x1b[1mUsage:\x1b[0m
    rezon init [dir]     Scaffold a new Rezon project
    rezon dev            Start the development server (port 3000)
    rezon build          Build for production (output: .zenith/)

  \x1b[1mExamples:\x1b[0m
    rezon init my-app    Create project in ./my-app
    rezon init .         Scaffold in the current directory
    rezon dev            Start dev server with hot reload
    rezon build          Compile for Vercel deployment

  \x1b[1mEnvironment:\x1b[0m
    GEMINI_API_KEY       Required. Your Google Gemini API key.
    DATABASE_URL         Optional. PostgreSQL connection string.
    ZENITH_SESSION_SECRET  Recommended for production.

  \x1b[2mhttps://www.npmjs.com/package/rezon\x1b[0m
`);
  process.exit(0);
}

// ─────────────────────────────────────────────
// rezon dev / rezon build — runtime commands
// (lazy-import heavy dependencies only when needed)
// ─────────────────────────────────────────────

const srcDir = './src';
const distDir = './.zenith';

const { default: chokidar } = await import('chokidar');
const { ZenithCompiler } = await import('../src/compiler.js');
const { ZenithServer } = await import('../src/runtime/server.js');

const compiler = new ZenithCompiler({ srcDir, distDir });

async function compileAll() {
  console.log('📦 Compiling Zenith components...');
  const pagesDir = path.resolve(srcDir, 'pages');
  
  if (!fs.existsSync(pagesDir)) {
    fs.mkdirSync(pagesDir, { recursive: true });
  }

  // If no pages exist, generate a default starter page
  const existing = fs.readdirSync(pagesDir).filter(f => f.endsWith('.html') || f.endsWith('.zenith'));
  if (existing.length === 0) {
    const defaultPage = `<script type="zenith">
  agent.name = "Assistant";
  agent.systemPrompt = "You are a helpful AI assistant.";
  let messages = [];
  let prompt = "";
</script>

<template>
  <div class="app">
    <h1>⚡ Rezon</h1>
    <div class="messages" z-each="msg in messages">
      <div class="msg {msg.role}">{msg.content}</div>
    </div>
    <div class="input-area">
      <input type="text" z-bind="prompt" placeholder="Ask anything..." />
      <button z-click="agent.send(prompt); prompt = ''">Send</button>
    </div>
  </div>
</template>

<style>
  body { background: #0f172a; color: #e2e8f0; display: flex; justify-content: center; align-items: center; min-height: 100vh; font-family: system-ui, sans-serif; }
  .app { width: 100%; max-width: 560px; padding: 24px; }
  h1 { text-align: center; font-size: 1.8rem; background: linear-gradient(135deg, #818cf8, #06b6d4); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 24px; }
  .messages { max-height: 400px; overflow-y: auto; margin-bottom: 16px; }
  .msg { padding: 10px 14px; border-radius: 10px; margin-bottom: 8px; font-size: 0.9rem; }
  .msg.user { background: #4f46e5; color: white; text-align: right; margin-left: 20%; }
  .msg.model { background: rgba(255,255,255,0.05); margin-right: 20%; }
  .input-area { display: flex; gap: 8px; }
  .input-area input { flex: 1; padding: 10px 14px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.08); background: rgba(0,0,0,0.3); color: #e2e8f0; outline: none; }
  .input-area input:focus { border-color: #6366f1; }
  .input-area button { padding: 10px 20px; border-radius: 10px; border: none; background: linear-gradient(135deg, #4f46e5, #06b6d4); color: white; font-weight: 600; cursor: pointer; }
</style>`;
    fs.writeFileSync(path.join(pagesDir, 'index.html'), defaultPage, 'utf-8');
  }

  // Find all HTML / Zenith files in pages directory
  const files = fs.readdirSync(pagesDir).filter(f => f.endsWith('.html') || f.endsWith('.zenith'));
  const routes = [];

  for (const file of files) {
    const routeName = file.replace(/\.(html|zenith)$/, '');
    const filePath = path.join(pagesDir, file);
    console.log(`  - Compiling [${file}] -> [/${routeName}]`);
    
    compiler.compileFile(filePath, routeName);
    routes.push(routeName);
  }

  // Copy static assets (runtimes, dashboard index & js)
  compiler.copyStaticAssets();
  
  // Generate Vercel Serverless assets
  compiler.generateVercelEntrypoint(routes);
  compiler.copyVercelConfig();
  
  return routes;
}

async function loadRouteModule(server, routeName) {
  const routePath = path.resolve(distDir, 'pages', `${routeName}.js`);
  
  try {
    // Append a query param tag to bypass ESM cache on re-imports
    const fileUrl = `file://${routePath.replace(/\\/g, '/')}?update=${Date.now()}`;
    const pageModule = await import(fileUrl);
    
    server.registerPage(routeName, {
      systemPrompt: pageModule.agentConfig.systemPrompt,
      agentName: pageModule.agentConfig.name,
      tools: pageModule.tools
    });
    console.log(`  ✅ Registered agent/tools for route: /${routeName}`);
  } catch (err) {
    console.error(`  ❌ Failed to load server tools for route ${routeName}:`, err);
  }
}

async function run() {
  if (command === 'build') {
    console.log('Building Rezon for production...');
    await compileAll();
    console.log('✅ Build complete. Output written to ./.zenith');
    process.exit(0);
  }

  if (command === 'dev') {
    console.log('✨ Starting Rezon Development Server...');
    
    if (!process.env.GEMINI_API_KEY) {
      console.warn('\x1b[33m⚠️  Warning: GEMINI_API_KEY environment variable is not set. AI agent calls will fail.\x1b[0m');
    }

    const routes = await compileAll();

    // Start Express Server
    const server = new ZenithServer({
      port: 3000,
      distDir
    });

    // Load page modules
    for (const route of routes) {
      await loadRouteModule(server, route);
    }

    // Start server
    server.start();

    // Setup Watcher
    console.log('👀 Watching source files for changes...');
    const watcher = chokidar.watch(['./src/pages/**/*', './src/dashboard/**/*', './src/runtime/client.js'], {
      ignoreInitial: true
    });

    watcher.on('all', async (event, filePath) => {
      console.log(`\n🔄 Change detected in [${filePath}], re-compiling...`);
      try {
        const routes = await compileAll();
        
        // Re-import modified routes to update tools
        for (const route of routes) {
          await loadRouteModule(server, route);
        }
        console.log('⚡ Reloaded successfully.');
      } catch (err) {
        console.error('❌ Compilation / Reload failed:', err);
      }
    });
  }
}

run().catch(console.error);
