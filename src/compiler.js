import fs from 'fs';
import path from 'path';

export class ZenithCompiler {
  constructor(options = {}) {
    this.srcDir = path.resolve(options.srcDir || './src');
    this.distDir = path.resolve(options.distDir || './.zenith');
  }

  // Parse a single-file component
  compileFile(filePath, routeName) {
    if (!/^[a-zA-Z0-9_-]+$/.test(routeName)) {
      throw new Error(`Invalid route name: "${routeName}". Route names must be alphanumeric and can only include dashes or underscores (no dots, slashes, or path sequences).`);
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    
    // Extract blocks using regex
    const scriptMatch = raw.match(/<script type="zenith">([\s\S]*?)<\/script>/);
    const templateMatch = raw.match(/<template>([\s\S]*?)<\/template>/);
    const styleMatch = raw.match(/<style>([\s\S]*?)<\/style>/);

    const scriptContent = scriptMatch ? scriptMatch[1] : '';
    const templateContent = templateMatch ? templateMatch[1] : '';
    const styleContent = styleMatch ? styleMatch[1] : '';

    // Parse the script block for tools, state and config
    const { compiledScript, tools, agentConfig, clientState } = this.parseScript(scriptContent);

    // Create the output directories
    fs.mkdirSync(path.join(this.distDir, 'public'), { recursive: true });
    fs.mkdirSync(path.join(this.distDir, 'pages'), { recursive: true });

    // 1. Generate client HTML page
    const clientHTML = this.generateClientHTML({
      template: templateContent,
      style: styleContent,
      state: clientState,
      routeName
    });
    fs.writeFileSync(path.join(this.distDir, 'public', `${routeName}.html`), clientHTML, 'utf-8');

    // 2. Generate server router ESM module
    const toolsExport = tools.map(t => `{
      name: ${JSON.stringify(t.name)},
      description: ${JSON.stringify(t.description)},
      parameters: ${JSON.stringify(t.parameters)},
      execute: ${t.name}
    }`).join(', ');

    const serverModuleCode = `
// Compiled Script:
const agent = {};
${compiledScript}

export const agentConfig = ${JSON.stringify(agentConfig)};
export const tools = [ ${toolsExport} ];
`;
    fs.writeFileSync(path.join(this.distDir, 'pages', `${routeName}.js`), serverModuleCode, 'utf-8');

    // 3. Return compiled server configuration
    return {
      routeName,
      tools,
      agentConfig,
      compiledScript
    };
  }

  copyStaticAssets() {
    fs.mkdirSync(path.join(this.distDir, 'public', '__zenith'), { recursive: true });

    // Copy client runtime
    const clientPath = path.join(this.srcDir, 'runtime/client.js');
    if (fs.existsSync(clientPath)) {
      fs.copyFileSync(clientPath, path.join(this.distDir, 'public/zenith-client.js'));
    }

    // Copy dashboard HTML
    const dashHtmlPath = path.join(this.srcDir, 'dashboard/index.html');
    if (fs.existsSync(dashHtmlPath)) {
      fs.copyFileSync(dashHtmlPath, path.join(this.distDir, 'public/__zenith.html'));
    }

    // Copy dashboard JS
    const dashJsPath = path.join(this.srcDir, 'dashboard/dashboard.js');
    if (fs.existsSync(dashJsPath)) {
      fs.copyFileSync(dashJsPath, path.join(this.distDir, 'public/__zenith/dashboard.js'));
    }
  }

  generateVercelEntrypoint(routes) {
    fs.mkdirSync(path.join(this.distDir, 'api'), { recursive: true });

    // Determine ZenithServer import location:
    // If the compiling project is the framework repository itself, use local path,
    // otherwise import from the installed 'rezon' dependency.
    let serverImportPath = 'rezon';
    try {
      const pkg = JSON.parse(fs.readFileSync(path.resolve('./package.json'), 'utf-8'));
      if (pkg.name === 'rezon' && fs.existsSync(path.resolve('./src/runtime/server.js'))) {
        serverImportPath = '../src/runtime/server.js';
      }
    } catch (e) {}

    const importsCode = routes.map((r, i) => `import * as route_${i} from '../pages/${r}.js';`).join('\n');
    const registrationCode = routes.map((r, i) => `
server.registerPage(${JSON.stringify(r)}, {
  systemPrompt: route_${i}.agentConfig.systemPrompt,
  agentName: route_${i}.agentConfig.name,
  tools: route_${i}.tools
});`).join('\n');

    const entryCode = `
import { ZenithServer } from '${serverImportPath}';
import path from 'path';

${importsCode}

const server = new ZenithServer({
  port: process.env.PORT || 3000,
  distDir: path.resolve('./public')
});

${registrationCode}

export default server.app;
`;
    fs.writeFileSync(path.join(this.distDir, 'api', 'index.js'), entryCode, 'utf-8');
  }

  copyVercelConfig() {
    const config = {
      "version": 2,
      "cleanUrls": true,
      "rewrites": [
        { "source": "/api/chat/stream", "destination": "/api/index" },
        { "source": "/api/(.*)", "destination": "/api/index" },
        { "source": "/__zenith", "destination": "/api/index" },
        { "source": "/__zenith.html", "destination": "/api/index" }
      ]
    };
    fs.writeFileSync(path.join(this.distDir, 'vercel.json'), JSON.stringify(config, null, 2), 'utf-8');

    // Copy package.json to the build output directory for serverless dependency management
    const pkgPath = path.resolve('./package.json');
    if (fs.existsSync(pkgPath)) {
      fs.copyFileSync(pkgPath, path.join(this.distDir, 'package.json'));
    }
  }

  parseScript(script) {
    const tools = [];
    const agentConfig = { name: 'Agent', systemPrompt: '' };
    const clientState = {};

    // 1. Extract agent configuration (e.g., agent.name = "Assistant", agent.systemPrompt = "...")
    const nameMatch = script.match(/agent\.name\s*=\s*(['"`])(.*?)\1/);
    if (nameMatch) agentConfig.name = nameMatch[2];

    const promptMatch = script.match(/agent\.systemPrompt\s*=\s*(['"`])([\s\S]*?)\1/);
    if (promptMatch) agentConfig.systemPrompt = promptMatch[2];

    const providerMatch = script.match(/agent\.provider\s*=\s*(['"`])(.*?)\1/);
    if (providerMatch) agentConfig.provider = providerMatch[2];

    const modelMatch = script.match(/agent\.model\s*=\s*(['"`])(.*?)\1/);
    if (modelMatch) agentConfig.model = modelMatch[2];

    const baseUrlMatch = script.match(/agent\.baseUrl\s*=\s*(['"`])(.*?)\1/);
    if (baseUrlMatch) agentConfig.baseUrl = baseUrlMatch[2];

    // 2. Find and extract server tools (reordering before clientState extraction to prevent scope leak):
    let index = 0;
    let cleanScript = script;
    let scriptForState = script;

    while (index < cleanScript.length) {
      const toolMatch = cleanScript.slice(index).match(/(?:\/\*\*([\s\S]*?)\*\/)?\s*server\s+tool\s+(\w+)\s*\(([^)]*)\)\s*\{/);
      if (!toolMatch) break;

      const fullMatchString = toolMatch[0];
      const matchIndex = cleanScript.indexOf(fullMatchString, index);
      
      const jsdocComment = toolMatch[1] || '';
      const toolName = toolMatch[2];
      const paramsString = toolMatch[3];
      const paramNames = paramsString.split(',').map(s => s.trim()).filter(s => s.length > 0);

      // Find the closing brace of the tool body using brace counting
      const bodyStartIndex = matchIndex + fullMatchString.length;
      let braceCount = 1;
      let bodyEndIndex = bodyStartIndex;

      while (braceCount > 0 && bodyEndIndex < cleanScript.length) {
        if (cleanScript[bodyEndIndex] === '{') braceCount++;
        else if (cleanScript[bodyEndIndex] === '}') braceCount--;
        bodyEndIndex++;
      }

      const bodyContent = cleanScript.slice(bodyStartIndex, bodyEndIndex - 1);

      // Parse JSDoc parameters and description
      const { description, paramInfo } = this.parseJSDoc(jsdocComment, paramNames);

      // Save tool metadata
      tools.push({
        name: toolName,
        description: description || `Executes tool ${toolName}`,
        parameters: {
          type: 'object',
          properties: paramInfo,
          required: paramNames
        },
        body: bodyContent,
        paramNames
      });

      // Replace tool declaration with server function registration placeholder
      const before = cleanScript.slice(0, matchIndex);
      const after = cleanScript.slice(bodyEndIndex);
      
      const replacement = `
        async function ${toolName}({ ${paramNames.join(', ')} }) {
          ${bodyContent}
        }
      `;
      cleanScript = before + replacement + after;
      index = matchIndex + replacement.length;

      // Strip tool blocks from scriptForState to prevent local variables from matching state variables
      const origMatchIndex = scriptForState.indexOf(fullMatchString);
      if (origMatchIndex !== -1) {
        const origBodyStartIndex = origMatchIndex + fullMatchString.length;
        let origBraceCount = 1;
        let origBodyEndIndex = origBodyStartIndex;
        while (origBraceCount > 0 && origBodyEndIndex < scriptForState.length) {
          if (scriptForState[origBodyEndIndex] === '{') origBraceCount++;
          else if (scriptForState[origBodyEndIndex] === '}') origBraceCount--;
          origBodyEndIndex++;
        }
        scriptForState = scriptForState.slice(0, origMatchIndex) + ' ' + scriptForState.slice(origBodyEndIndex);
      }
    }

    // 3. Extract client state variables (e.g. let messages = []; or let count = 0;) from clean scriptForState
    // Note: variables declared with 'const' are treated as server-only constants (not client state) to prevent leaking secrets.
    const stateRegex = /(?:let|var)\s+(\w+)\s*=\s*([^;\n]+)/g;
    let stateMatch;
    while ((stateMatch = stateRegex.exec(scriptForState)) !== null) {
      const name = stateMatch[1];
      if (name !== 'agent') {
        const valStr = stateMatch[2].trim();
        clientState[name] = valStr; // Store raw initializer string securely (no eval)
      }
    }

    return {
      compiledScript: cleanScript,
      tools,
      agentConfig,
      clientState
    };
  }

  parseJSDoc(comment, paramNames) {
    if (!comment) {
      const paramInfo = {};
      paramNames.forEach(p => {
        paramInfo[p] = { type: 'string', description: p };
      });
      return { description: '', paramInfo };
    }

    // Extract main description
    const lines = comment.split('\n').map(l => l.replace(/^\s*\*\s?/, '').trim());
    const descLines = [];
    const paramInfo = {};

    lines.forEach(line => {
      if (line.startsWith('@param')) {
        // Parse @param {type} name description
        const match = line.match(/@param\s+(?:\{([^}]+)\})?\s*(\w+)?\s*(.*)/);
        if (match) {
          const type = match[1] || 'string';
          const name = match[2];
          const desc = match[3] || '';
          if (name) {
            paramInfo[name] = { 
              type: this.mapType(type), 
              description: desc 
            };
          }
        }
      } else if (!line.startsWith('@') && line.length > 0) {
        descLines.push(line);
      }
    });

    // Backfill any missing parameters
    paramNames.forEach(p => {
      if (!paramInfo[p]) {
        paramInfo[p] = { type: 'string', description: p };
      }
    });

    return {
      description: descLines.join(' ').trim(),
      paramInfo
    };
  }

  mapType(type) {
    const t = type.toLowerCase().trim();
    if (t === 'int' || t === 'float' || t === 'number') return 'number';
    if (t === 'bool' || t === 'boolean') return 'boolean';
    if (t === 'array') return 'array';
    if (t === 'object') return 'object';
    return 'string';
  }

  generateClientHTML({ template, style, state, routeName }) {
    // Format client state object literal properties securely without eval
    const stateProps = Object.entries(state)
      .map(([k, v]) => `${k}: ${v}`)
      .join(',\n      ');
    const stateObj = stateProps ? `{\n      ${stateProps}\n    }` : '{}';

    // Inject client-runtime, stylesheet, and template nodes
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Zenith App - ${routeName}</title>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap">
  <style>
    :root {
      --font-family: 'Outfit', sans-serif;
      --bg-dark: #131314;
      --card-bg: #1e1f20;
      --card-border: rgba(255, 255, 255, 0.04);
      --primary: #a8c7fa;
      --primary-hover: #7cacf8;
    }
    body {
      margin: 0;
      padding: 0;
      font-family: var(--font-family);
      background-color: var(--bg-dark);
      color: #e3e3e3;
      overflow-x: hidden;
    }
    ${style}
  </style>
</head>
<body>
  ${template}

  <!-- Include client runtime -->
  <script src="/zenith-client.js"></script>
  
  <script>
    document.addEventListener('DOMContentLoaded', async () => {
      // Initialize states and mount
      const client = new ZenithClient(${stateObj});
      client.initDOM();
      await client.loadHistory();
    });
  </script>
</body>
</html>`;
  }
}
