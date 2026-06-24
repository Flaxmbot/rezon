// Client-side runtime for Zenith AI Web Framework
class ZenithClient {
  constructor(initialState = {}) {
    const self = this;

    // Create reactive state Proxy
    this.state = new Proxy(initialState, {
      set(target, key, value) {
        target[key] = value;
        self.scheduleUpdate();
        return true;
      }
    });

    this.updateScheduled = false;
    this.templates = new Map();

    // Agent helper
    this.agent = {
      send: async (text) => {
        if (!text || text.trim() === '') return;

        // Add user message to history
        const userMsg = { role: 'user', content: text, timestamp: new Date().toISOString() };
        self.state.messages = [...(self.state.messages || []), userMsg];

        // Add placeholder for AI response
        const aiMsgId = Math.random().toString(36).substring(2, 11);
        const aiMsg = { id: aiMsgId, role: 'model', content: '', status: 'running', timestamp: new Date().toISOString() };
        self.state.messages = [...self.state.messages, aiMsg];

        try {
          const threadId = self.state.threadId || localStorage.getItem('zenith_thread_id') || '';
          const threadToken = self.state.threadToken || localStorage.getItem('zenith_thread_token') || '';
          const routeName = window.location.pathname.replace(/^\/|\.html$/g, '') || 'index';

          // Request conversation stream
          const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              threadId,
              threadToken,
              message: text,
              agent: routeName
            })
          });

          if (!response.ok) throw new Error('Network response was not ok');
          const data = await response.json();

          // Save thread ID and token signature
          if (data.threadId) {
            self.state.threadId = data.threadId;
            self.state.threadToken = data.threadToken;
            localStorage.setItem('zenith_thread_id', data.threadId);
            localStorage.setItem('zenith_thread_token', data.threadToken);
          }

          // Open SSE for stream output
          const sseUrl = `/api/chat/stream?threadId=${data.threadId}&threadToken=${data.threadToken || ''}`;
          const eventSource = new EventSource(sseUrl);

          eventSource.onmessage = (event) => {
            const chunk = JSON.parse(event.data);

            if (chunk.type === 'token') {
              // Append LLM token text
              self.updateMessageContent(aiMsgId, chunk.content, 'running');
            } else if (chunk.type === 'tool_start') {
              // Log tool invocation start
              console.log(`[Tool Call] Executing ${chunk.name} with args:`, chunk.args);
            } else if (chunk.type === 'tool_end') {
              // Log tool completion
              console.log(`[Tool Result] ${chunk.name} output:`, chunk.result);
            } else if (chunk.type === 'done') {
              // Complete response
              self.updateMessageContent(aiMsgId, chunk.fullContent, 'completed');
              eventSource.close();
            } else if (chunk.type === 'error') {
              self.updateMessageContent(aiMsgId, `Error: ${chunk.error}`, 'error');
              eventSource.close();
            }
          };

          eventSource.onerror = (err) => {
            console.error('SSE Error:', err);
            self.updateMessageContent(aiMsgId, 'Connection lost.', 'error');
            eventSource.close();
          };

        } catch (error) {
          console.error('Chat error:', error);
          self.updateMessageContent(aiMsgId, `Failed to connect to agent: ${error.message}`, 'error');
        }
      }
    };
  }

  updateMessageContent(msgId, content, status) {
    this.state.messages = this.state.messages.map(m => {
      if (m.id === msgId || (m.role === 'model' && m.status === 'running' && !m.id)) {
        return { ...m, id: msgId, content: m.content + content, status };
      }
      if (m.id === msgId) {
        return { ...m, content: content !== undefined ? content : m.content, status };
      }
      return m;
    });
  }

  scheduleUpdate() {
    if (this.updateScheduled) return;
    this.updateScheduled = true;
    requestAnimationFrame(() => {
      this.render();
      this.updateScheduled = false;
    });
  }

  // Compile and index DOM templates with z-directives
  initDOM() {
    // 1. Index z-each elements and keep their template copies
    const eachElements = document.querySelectorAll('[z-each]');
    eachElements.forEach((el, index) => {
      const expression = el.getAttribute('z-each');
      const commentMarker = document.createComment(`z-each:${expression}`);
      el.parentNode.insertBefore(commentMarker, el);

      this.templates.set(commentMarker, {
        element: el,
        expression,
        rendered: []
      });

      el.remove(); // Remove template element from DOM
    });

    // 2. Setup standard bindings and event listeners
    this.setupListeners();
    this.render();
  }

  setupListeners() {
    // Input bindings
    document.querySelectorAll('[z-bind]').forEach(el => {
      const prop = el.getAttribute('z-bind');
      el.value = this.state[prop] || '';
      el.addEventListener('input', (e) => {
        this.state[prop] = e.target.value;
      });
    });

    // Click events
    document.querySelectorAll('[z-click]').forEach(el => {
      const code = el.getAttribute('z-click');
      el.addEventListener('click', () => {
        try {
          this.executeClick(code, this.state, this.agent);
        } catch (e) {
          console.error(`Error executing z-click: ${code}`, e);
        }
      });
    });
  }

  render() {
    // Update simple inputs if out of sync
    document.querySelectorAll('[z-bind]').forEach(el => {
      const prop = el.getAttribute('z-bind');
      if (el.value !== this.state[prop]) {
        el.value = this.state[prop] || '';
      }
    });

    // Render z-each lists
    this.templates.forEach((tmpl, marker) => {
      const match = tmpl.expression.match(/^\s*(\w+)\s+in\s+(\w+)\s*$/);
      if (!match) return;

      const itemName = match[1];
      const listName = match[2];
      const items = this.state[listName] || [];

      // Remove previously rendered nodes
      tmpl.rendered.forEach(node => node.remove());
      tmpl.rendered = [];

      const parent = marker.parentNode;
      let nextSibling = marker.nextSibling;

      items.forEach((item, index) => {
        const clone = tmpl.element.cloneNode(true);
        clone.removeAttribute('z-each');

        // Set local scope on the clone
        const context = {
          ...this.state,
          [itemName]: item,
          $index: index
        };

        this.interpolateElement(clone, context);
        parent.insertBefore(clone, nextSibling);
        tmpl.rendered.push(clone);
      });
    });

    // Simple text node interpolations in static elements
    this.interpolateStatic(document.body, this.state);
  }

  evaluateZIf(el, context) {
    if (!el.hasAttribute('z-if')) return;
    const expression = el.getAttribute('z-if');
    try {
      const show = this.resolveValue(expression, context);
      if (show) {
        el.style.removeProperty('display');
      } else {
        el.style.display = 'none';
      }
    } catch (e) {
      console.error(`Error in z-if: ${expression}`, e);
    }
  }

  interpolateElement(element, context) {
    // Process z-if on the element itself if present
    if (element.hasAttribute('z-if')) {
      this.evaluateZIf(element, context);
    }

    // 1. Process attributes on the element itself
    for (let i = 0; i < element.attributes.length; i++) {
      const attr = element.attributes[i];
      if (attr.name.startsWith('z-') || attr.name === 'class') {
        // Evaluate dynamic class names or other bindings
        if (attr.name === 'class' && attr.value.includes('{')) {
          if (!element.originalClass) {
            element.originalClass = attr.value;
          }
          attr.value = this.replaceInterpolations(element.originalClass, context);
        }
      }
    }

    // 2. Recurse through children
    const childNodes = Array.from(element.childNodes);
    childNodes.forEach(child => {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent;
        if (text.includes('{')) {
          if (!child.originalText) {
            child.originalText = text;
          }
          child.textContent = this.replaceInterpolations(child.originalText, context);
        }
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        // Skip child templates that have z-each (they will run dynamically)
        if (!child.hasAttribute('z-each')) {
          this.interpolateElement(child, context);
        }
      }
    });
  }

  isRenderedByEach(node) {
    let current = node;
    while (current && current !== document.body) {
      for (const tmpl of this.templates.values()) {
        if (tmpl.rendered.includes(current)) {
          return true;
        }
      }
      current = current.parentNode;
    }
    return false;
  }

  interpolateStatic(parent, context) {
    parent.childNodes.forEach(child => {
      // If child is rendered by a z-each loop, skip it (it has its own local context)
      if (this.isRenderedByEach(child)) {
        return;
      }

      // Only process static text nodes not inside templates
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent;
        // Check if it's dynamic (e.g. contains {variable})
        if (text.includes('{') && !this.isInTemplate(child)) {
          // Keep original content if we haven't stored it
          if (!child.originalText) {
            child.originalText = text;
          }
          child.textContent = this.replaceInterpolations(child.originalText, context);
        }
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        if (!child.hasAttribute('z-each') && child.tagName !== 'SCRIPT' && child.tagName !== 'STYLE') {
          if (child.hasAttribute('z-if')) {
            this.evaluateZIf(child, context);
          }
          this.interpolateStatic(child, context);
        }
      }
    });
  }

  isInTemplate(node) {
    let parent = node.parentNode;
    while (parent) {
      if (parent.tagName === 'TEMPLATE' || parent.hasAttribute('z-each')) {
        return true;
      }
      parent = parent.parentNode;
    }
    return false;
  }

  resolveValue(expr, context) {
    expr = expr.trim();
    if (!expr) return '';

    // Check for string literals: 'abc' or "abc"
    if ((expr.startsWith("'") && expr.endsWith("'")) || (expr.startsWith('"') && expr.endsWith('"'))) {
      return expr.slice(1, -1);
    }

    // Check for number literals
    if (/^\d+$/.test(expr)) {
      return parseInt(expr, 10);
    }

    // Check for booleans
    if (expr === 'true') return true;
    if (expr === 'false') return false;

    // Check for ternary: condition ? val1 : val2
    const ternaryMatch = expr.match(/^([^?]+)\s*\?\s*([^:]+)\s*:\s*(.*)$/);
    if (ternaryMatch) {
      const cond = this.resolveValue(ternaryMatch[1], context);
      return cond ? this.resolveValue(ternaryMatch[2], context) : this.resolveValue(ternaryMatch[3], context);
    }

    // Check for binary comparison (===, !==, ==, !=, <, >)
    const compMatch = expr.match(/^([\w.]+)\s*(===|!==|==|!=)\s*(.*)$/);
    if (compMatch) {
      const left = this.resolveValue(compMatch[1], context);
      const op = compMatch[2];
      const right = this.resolveValue(compMatch[3], context);
      if (op === '===' || op === '==') return left === right;
      if (op === '!==' || op === '!=') return left !== right;
    }

    // Resolve property path
    return expr.split('.').reduce((acc, part) => {
      if (acc === null || acc === undefined) return undefined;
      return acc[part];
    }, context);
  }

  executeClick(statement, context, agent) {
    const parts = statement.split(';').map(s => s.trim()).filter(s => s.length > 0);
    parts.forEach(part => {
      // 1. Function Call: agent.send(...)
      const sendMatch = part.match(/^agent\.send\((.*)\)$/);
      if (sendMatch) {
        const argExpr = sendMatch[1];
        // Support simple string concatenation: 'Help me plan ' + destination
        let argVal = '';
        if (argExpr.includes('+')) {
          argVal = argExpr.split('+').map(s => this.resolveValue(s, context)).join('');
        } else {
          argVal = this.resolveValue(argExpr, context);
        }
        agent.send(argVal);
        return;
      }

      // 2. Assignment: varName = value
      const assignMatch = part.match(/^(\w+)\s*=\s*(.*)$/);
      if (assignMatch) {
        const prop = assignMatch[1];
        const valExpr = assignMatch[2];
        context[prop] = this.resolveValue(valExpr, context);
        return;
      }
    });
  }

  replaceInterpolations(text, context) {
    return text.replace(/\{([^}]+)\}/g, (match, expression) => {
      try {
        const val = this.resolveValue(expression, context);
        return val !== undefined ? val : '';
      } catch (e) {
        return '';
      }
    });
  }

  // Load chat history on start
  async loadHistory() {
    const threadId = localStorage.getItem('zenith_thread_id');
    const threadToken = localStorage.getItem('zenith_thread_token') || '';
    if (threadId) {
      try {
        const res = await fetch(`/api/thread?threadId=${threadId}&threadToken=${threadToken}`);
        if (res.ok) {
          const data = await res.json();
          this.state.threadId = threadId;
          this.state.threadToken = threadToken;
          this.state.messages = data.messages || [];
        } else {
          localStorage.removeItem('zenith_thread_id');
          localStorage.removeItem('zenith_thread_token');
        }
      } catch (e) {
        console.error('Failed to load chat history:', e);
      }
    }
  }
}

window.ZenithClient = ZenithClient;
