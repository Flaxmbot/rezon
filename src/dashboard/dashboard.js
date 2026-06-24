let activeThreadId = null;
let sseConnection = null;
const threadTokens = new Map();
const threadAgents = new Map();

// Tab switcher
window.switchTab = function(tabName) {
  document.querySelectorAll('.tab-button').forEach(btn => {
    btn.classList.remove('active');
    if (btn.innerText.toLowerCase().includes(tabName)) {
      btn.classList.add('active');
    }
  });

  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.remove('active');
  });
  document.getElementById(`tab-${tabName}`).classList.add('active');
};

document.addEventListener('DOMContentLoaded', () => {
  loadThreads();
  loadTools();

  // Input listener
  const input = document.getElementById('playground-input');
  const btnSend = document.getElementById('btn-send');

  btnSend.addEventListener('click', sendMessage);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
  });
});

// Load threads list
async function loadThreads() {
  try {
    const res = await fetch('/api/dashboard/threads');
    if (!res.ok) throw new Error('Failed to load threads');
    const threads = await res.json();
    
    const container = document.getElementById('threads-list');
    container.innerHTML = '';

    if (threads.length === 0) {
      container.innerHTML = '<div style="font-size:12px; color:var(--text-muted); padding:20px 0; text-align:center;">No threads found</div>';
      return;
    }

    threads.forEach(t => {
      threadTokens.set(t.id, t.threadToken);
      threadAgents.set(t.id, t.agent || 'index');
      const el = document.createElement('div');
      el.className = `thread-item ${t.id === activeThreadId ? 'active' : ''}`;
      el.onclick = () => selectThread(t.id);

      const dateStr = new Date(t.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + 
        ' - ' + new Date(t.createdAt).toLocaleDateString();

      el.innerHTML = `
        <div class="thread-info">
          <span class="thread-id">Thread #${escapeHtml(t.id)}</span>
          <span class="thread-date">${escapeHtml(dateStr)}</span>
        </div>
        <button class="btn-delete-thread">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      `;

      const deleteBtn = el.querySelector('.btn-delete-thread');
      deleteBtn.onclick = (e) => {
        e.stopPropagation();
        deleteThread(t.id);
      };

      container.appendChild(el);
    });
  } catch (err) {
    console.error(err);
  }
}

// Load registered tools list
async function loadTools(agentName = '') {
  try {
    const url = agentName ? `/api/dashboard/tools?agent=${encodeURIComponent(agentName)}` : '/api/dashboard/tools';
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to load tools');
    const tools = await res.json();

    const container = document.getElementById('tool-list');
    container.innerHTML = '';

    if (tools.length === 0) {
      container.innerHTML = '<div style="font-size:12px; color:var(--text-muted); text-align:center; padding-top:20px;">No page tools registered</div>';
      return;
    }

    tools.forEach(t => {
      const el = document.createElement('div');
      el.className = 'tool-card';
      el.innerHTML = `
        <div class="tool-card-name">${escapeHtml(t.name)}()</div>
        <div class="tool-card-desc">${escapeHtml(t.description)}</div>
        <div class="tool-card-params">
          <strong>Parameters schema:</strong>
          <pre style="margin-top:6px; color:#e2e8f0; font-size:11px;">${escapeHtml(JSON.stringify(t.parameters, null, 2))}</pre>
        </div>
      `;
      container.appendChild(el);
    });
  } catch (err) {
    console.error(err);
  }
}

// Select specific conversation thread
async function selectThread(threadId) {
  activeThreadId = threadId;
  const token = threadTokens.get(threadId) || '';
  const agent = threadAgents.get(threadId) || 'index';
  
  // Highlight active thread in list
  document.querySelectorAll('.thread-item').forEach(el => {
    el.classList.remove('active');
    if (el.querySelector('.thread-id').innerText.includes(threadId)) {
      el.classList.add('active');
    }
  });

  document.getElementById('active-thread-title').innerText = `Thread #${threadId} (${agent})`;
  
  // Enable UI controls
  document.getElementById('playground-input').disabled = false;
  document.getElementById('btn-send').disabled = false;

  // Clear existing SSE
  if (sseConnection) {
    sseConnection.close();
  }

  // Load chat messages
  await refreshChatHistory(threadId, token);

  // Load traces
  await refreshTraces(threadId);

  // Load tools list for the selected agent
  await loadTools(agent);

  // Open SSE connection to monitor execution in real time
  setupSSE(threadId, token);
}

// Refresh active chat playground DOM
async function refreshChatHistory(threadId, token) {
  try {
    const res = await fetch(`/api/thread?threadId=${threadId}&threadToken=${token || ''}`);
    const data = await res.json();
    const chat = document.getElementById('playground-chat');
    chat.innerHTML = '';

    if (data.messages.length === 0) {
      chat.innerHTML = '<div style="font-size:12px; color:var(--text-muted); text-align:center; padding-top:40px;">Send a message to start conversing.</div>';
      return;
    }

    data.messages.forEach(msg => {
      const el = document.createElement('div');
      el.className = `msg ${msg.role} ${msg.status || ''}`;
      el.innerText = msg.content;
      chat.appendChild(el);
    });
    chat.scrollTop = chat.scrollHeight;
  } catch (err) {
    console.error(err);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Refresh trace nodes in inspector
async function refreshTraces(threadId) {
  try {
    const res = await fetch(`/api/dashboard/traces?threadId=${threadId}`);
    const traces = await res.json();
    const container = document.getElementById('trace-timeline');
    container.innerHTML = '';

    if (traces.length === 0) {
      container.innerHTML = '<div style="font-size:12px; color:var(--text-muted); text-align:center; padding-top:20px;">No execution traces found</div>';
      return;
    }

    traces.forEach(t => {
      const el = document.createElement('div');
      el.className = 'trace-node';

      const statusClass = escapeHtml(t.status); // running, completed, error
      const durationStr = t.duration ? `${escapeHtml(t.duration)}ms` : '';
      const hasPayload = t.data && Object.keys(t.data).length > 0;

      el.innerHTML = `
        <div class="trace-dot ${statusClass}"></div>
        <div class="trace-card">
          <div class="trace-type-badge ${escapeHtml(t.type)}">${escapeHtml(t.type)}</div>
          <div class="trace-card-header">
            <span class="trace-name">${escapeHtml(t.step)}</span>
            <span class="trace-duration">${escapeHtml(durationStr)}</span>
          </div>
          ${hasPayload ? `
            <div class="trace-inspect">
              <pre>${escapeHtml(JSON.stringify(t.data, null, 2))}</pre>
            </div>
          ` : ''}
        </div>
      `;

      const card = el.querySelector('.trace-card');
      card.onclick = () => toggleTraceInspect(card);

      container.appendChild(el);
    });
  } catch (err) {
    console.error(err);
  }
}

window.toggleTraceInspect = function(cardElement) {
  const inspectPanel = cardElement.querySelector('.trace-inspect');
  if (inspectPanel) {
    inspectPanel.classList.toggle('open');
  }
};

// Monitor server-sent-events for execution logs
function setupSSE(threadId, token) {
  sseConnection = new EventSource(`/api/chat/stream?threadId=${threadId}&threadToken=${token || ''}`);

  sseConnection.onmessage = (event) => {
    const data = JSON.parse(event.data);
    const indicator = document.getElementById('status-indicator');
    const statusText = document.getElementById('status-text');

    if (data.type === 'token') {
      // Stream tokens into chat playground
      let activeMsg = document.querySelector('.msg.model.running');
      if (!activeMsg) {
        activeMsg = document.createElement('div');
        activeMsg.className = 'msg model running';
        document.getElementById('playground-chat').appendChild(activeMsg);
      }
      activeMsg.innerText += data.content;
      const chat = document.getElementById('playground-chat');
      chat.scrollTop = chat.scrollHeight;
    } else if (data.type === 'tool_start') {
      indicator.className = 'status-indicator active';
      statusText.innerText = `Running: ${data.name}`;
      refreshTraces(threadId);
    } else if (data.type === 'tool_end') {
      refreshTraces(threadId);
    } else if (data.type === 'done') {
      indicator.className = 'status-indicator';
      statusText.innerText = 'Idle';
      
      // Update playground and traces
      refreshChatHistory(threadId, token);
      refreshTraces(threadId);
    } else if (data.type === 'error') {
      indicator.className = 'status-indicator';
      statusText.innerText = 'Error';
      
      let activeMsg = document.querySelector('.msg.model.running');
      if (activeMsg) {
        activeMsg.className = 'msg model error';
        activeMsg.innerText = `Error: ${data.error}`;
      }
      refreshChatHistory(threadId, token);
      refreshTraces(threadId);
    }
  };

  sseConnection.onerror = () => {
    console.error('SSE lost connection');
    sseConnection.close();
  };
}

// Send Message
async function sendMessage() {
  const input = document.getElementById('playground-input');
  const text = input.value.trim();
  if (!text || !activeThreadId) return;

  input.value = '';
  
  // Set spinner
  const indicator = document.getElementById('status-indicator');
  const statusText = document.getElementById('status-text');
  indicator.className = 'status-indicator active';
  statusText.innerText = 'Thinking...';

  // Add user message to UI playground
  const chat = document.getElementById('playground-chat');
  const userEl = document.createElement('div');
  userEl.className = 'msg user';
  userEl.innerText = text;
  chat.appendChild(userEl);
  chat.scrollTop = chat.scrollHeight;

  const token = threadTokens.get(activeThreadId) || '';
  const agent = threadAgents.get(activeThreadId) || 'index';

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        threadId: activeThreadId,
        threadToken: token,
        message: text,
        agent: agent
      })
    });
    if (!res.ok) throw new Error('Failed to post message');
  } catch (err) {
    console.error(err);
    indicator.className = 'status-indicator';
    statusText.innerText = 'Error';
  }
}

// Delete Thread
async function deleteThread(threadId) {
  if (confirm(`Delete thread #${threadId}?`)) {
    try {
      const res = await fetch(`/api/dashboard/threads?threadId=${threadId}`, { method: 'DELETE' });
      if (res.ok) {
        if (activeThreadId === threadId) {
          activeThreadId = null;
          document.getElementById('playground-chat').innerHTML = `
            <div class="msg model">Select a thread from the sidebar or click '+' to begin.</div>
          `;
          document.getElementById('playground-input').disabled = true;
          document.getElementById('btn-send').disabled = true;
          document.getElementById('trace-timeline').innerHTML = '';
          document.getElementById('active-thread-title').innerText = 'Select or Create a Thread';
        }
        loadThreads();
      }
    } catch (e) {
      console.error(e);
    }
  }
}

// Modal actions for starting new threads
window.openNewThreadModal = async function() {
  try {
    const res = await fetch('/api/dashboard/pages');
    if (!res.ok) throw new Error('Failed to load registered pages');
    const pages = await res.json();
    
    const select = document.getElementById('new-thread-agent');
    select.innerHTML = '';
    
    pages.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.innerText = p;
      select.appendChild(opt);
    });
    
    const modal = document.getElementById('new-thread-modal');
    modal.style.display = 'flex';
  } catch (err) {
    console.error(err);
    alert('Failed to open modal: ' + err.message);
  }
};

window.closeNewThreadModal = function() {
  const modal = document.getElementById('new-thread-modal');
  modal.style.display = 'none';
};

window.createNewThread = async function() {
  const select = document.getElementById('new-thread-agent');
  const agent = select.value;
  
  try {
    const res = await fetch('/api/dashboard/threads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent })
    });
    
    if (!res.ok) throw new Error('Failed to create thread');
    const thread = await res.json();
    
    closeNewThreadModal();
    await loadThreads();
    await selectThread(thread.id);
  } catch (err) {
    console.error(err);
    alert('Failed to create thread: ' + err.message);
  }
};
