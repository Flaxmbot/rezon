import fs from 'fs';
import path from 'path';
import pg from 'pg';

const { Pool } = pg;

export class ZenithDatabase {
  constructor(dbPath = './zenith-db.json') {
    this.dbPath = path.resolve(dbPath);
    this.isPostgres = !!process.env.DATABASE_URL;
    this.writeQueue = Promise.resolve();
    
    if (this.isPostgres) {
      console.log('🔌 Connecting to Postgres Database via DATABASE_URL...');
      this.pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes('sslmode=') ? undefined : { rejectUnauthorized: false } // Auto-enable SSL for Supabase/Neon
      });
    } else {
      console.log(`💾 Utilizing Local File Database at ${this.dbPath}`);
      this.data = {
        threads: {},
        messages: [],
        traces: []
      };
    }
  }

  async init() {
    if (this.isPostgres) {
      try {
        // Create tables if not exist
        await this.pool.query(`
          CREATE TABLE IF NOT EXISTS zenith_threads (
            id VARCHAR(50) PRIMARY KEY,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
        try {
          await this.pool.query("ALTER TABLE zenith_threads ADD COLUMN IF NOT EXISTS agent VARCHAR(50) DEFAULT 'index';");
        } catch (e) {
          // Ignore if column already exists
        }
        await this.pool.query(`
          CREATE TABLE IF NOT EXISTS zenith_messages (
            id VARCHAR(50) PRIMARY KEY,
            thread_id VARCHAR(50) REFERENCES zenith_threads(id) ON DELETE CASCADE,
            role VARCHAR(50),
            content TEXT,
            status VARCHAR(50),
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
        await this.pool.query(`
          CREATE TABLE IF NOT EXISTS zenith_traces (
            id VARCHAR(50) PRIMARY KEY,
            thread_id VARCHAR(50) REFERENCES zenith_threads(id) ON DELETE CASCADE,
            step VARCHAR(255),
            type VARCHAR(50),
            status VARCHAR(50),
            duration INT,
            data JSONB,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
      } catch (err) {
        console.error('❌ Failed to initialize Postgres tables:', err);
      }
    } else {
      try {
        if (fs.existsSync(this.dbPath)) {
          const raw = fs.readFileSync(this.dbPath, 'utf-8');
          this.data = JSON.parse(raw);
          if (!this.data.threads) this.data.threads = {};
          if (!this.data.messages) this.data.messages = [];
          if (!this.data.traces) this.data.traces = [];
        } else {
          this.save();
        }
      } catch (e) {
        console.error('Failed to load JSON database:', e);
      }
    }
  }

  save() {
    if (this.isPostgres) return Promise.resolve();
    
    // Queue the write operation sequentially to prevent race conditions and concurrent write locks
    this.writeQueue = this.writeQueue.then(async () => {
      try {
        const serialized = JSON.stringify(this.data, null, 2);
        await fs.promises.writeFile(this.dbPath, serialized, 'utf-8');
      } catch (e) {
        console.error('Failed to save JSON Database asynchronously:', e);
      }
    });
    
    return this.writeQueue;
  }

  // Thread operations
  async createThread(threadId, agent = 'index') {
    const id = threadId || Math.random().toString(36).substring(2, 11);
    
    if (this.isPostgres) {
      await this.pool.query(
        'INSERT INTO zenith_threads (id, agent) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [id, agent]
      );
      return { id, agent, createdAt: new Date().toISOString() };
    } else {
      if (!this.data.threads[id]) {
        this.data.threads[id] = {
          id,
          agent,
          createdAt: new Date().toISOString()
        };
        this.save();
      }
      return this.data.threads[id];
    }
  }

  async getThreads() {
    if (this.isPostgres) {
      const res = await this.pool.query('SELECT id, agent, created_at as "createdAt" FROM zenith_threads ORDER BY created_at DESC');
      return res.rows;
    } else {
      return Object.values(this.data.threads).sort((a, b) => 
        new Date(b.createdAt) - new Date(a.createdAt)
      );
    }
  }

  async getThread(threadId) {
    if (this.isPostgres) {
      const res = await this.pool.query('SELECT id, created_at as "createdAt" FROM zenith_threads WHERE id = $1', [threadId]);
      return res.rows[0];
    } else {
      return this.data.threads[threadId];
    }
  }

  async deleteThread(threadId) {
    if (this.isPostgres) {
      await this.pool.query('DELETE FROM zenith_threads WHERE id = $1', [threadId]);
    } else {
      delete this.data.threads[threadId];
      this.data.messages = this.data.messages.filter(m => m.threadId !== threadId);
      this.data.traces = this.data.traces.filter(t => t.threadId !== threadId);
      this.save();
    }
  }

  // Message operations
  async getMessages(threadId) {
    if (this.isPostgres) {
      const res = await this.pool.query(
        'SELECT id, thread_id as "threadId", role, content, status, timestamp FROM zenith_messages WHERE thread_id = $1 ORDER BY timestamp ASC',
        [threadId]
      );
      return res.rows;
    } else {
      return this.data.messages.filter(m => m.threadId === threadId)
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    }
  }

  async addMessage(threadId, role, content, status = 'completed') {
    const id = Math.random().toString(36).substring(2, 11);
    const timestamp = new Date().toISOString();

    if (this.isPostgres) {
      const res = await this.pool.query(
        'INSERT INTO zenith_messages (id, thread_id, role, content, status, timestamp) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        [id, threadId, role, content, status, timestamp]
      );
      const row = res.rows[0];
      return {
        id: row.id,
        threadId: row.thread_id,
        role: row.role,
        content: row.content,
        status: row.status,
        timestamp: row.timestamp
      };
    } else {
      const msg = { id, threadId, role, content, status, timestamp };
      this.data.messages.push(msg);
      this.save();
      return msg;
    }
  }

  async updateMessage(messageId, content, status = 'completed') {
    const timestamp = new Date().toISOString();

    if (this.isPostgres) {
      const res = await this.pool.query(
        'UPDATE zenith_messages SET content = $1, status = $2, timestamp = $3 WHERE id = $4 RETURNING *',
        [content, status, timestamp, messageId]
      );
      const row = res.rows[0];
      if (!row) return null;
      return {
        id: row.id,
        threadId: row.thread_id,
        role: row.role,
        content: row.content,
        status: row.status,
        timestamp: row.timestamp
      };
    } else {
      const msg = this.data.messages.find(m => m.id === messageId);
      if (msg) {
        msg.content = content;
        msg.status = status;
        msg.timestamp = timestamp;
        this.save();
      }
      return msg;
    }
  }

  // Trace operations
  async getTraces(threadId) {
    if (this.isPostgres) {
      const res = await this.pool.query(
        'SELECT id, thread_id as "threadId", step, type, status, duration, data, timestamp FROM zenith_traces WHERE thread_id = $1 ORDER BY timestamp ASC',
        [threadId]
      );
      return res.rows;
    } else {
      return this.data.traces.filter(t => t.threadId === threadId)
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    }
  }

  async addTrace(threadId, step, type, status, duration = 0, data = {}) {
    const id = Math.random().toString(36).substring(2, 11);
    const timestamp = new Date().toISOString();

    if (this.isPostgres) {
      const res = await this.pool.query(
        'INSERT INTO zenith_traces (id, thread_id, step, type, status, duration, data, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
        [id, threadId, step, type, status, duration, JSON.stringify(data), timestamp]
      );
      const row = res.rows[0];
      return {
        id: row.id,
        threadId: row.thread_id,
        step: row.step,
        type: row.type,
        status: row.status,
        duration: row.duration,
        data: row.data,
        timestamp: row.timestamp
      };
    } else {
      const trace = { id, threadId, step, type, status, duration, data, timestamp };
      this.data.traces.push(trace);
      this.save();
      return trace;
    }
  }
}
