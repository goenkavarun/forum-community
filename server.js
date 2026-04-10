const express = require('express');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 5000;

// ─────────────────────────────────────────────────────────────
// SECURITY MIDDLEWARE
// ─────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(','),
  credentials: true
}));

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100
});

app.use(limiter);
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));

// ─────────────────────────────────────────────────────────────
// DATABASE SETUP
// ─────────────────────────────────────────────────────────────
const dbPath = process.env.DB_PATH || path.join(__dirname, 'forum.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('Database connection error:', err);
  else console.log('✅ Connected to SQLite database');
});

// Initialize database tables
function initializeDatabase() {
  db.serialize(() => {
    // Users table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT UNIQUE,
        email TEXT UNIQUE,
        password_hash TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Posts table
    db.run(`
      CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        author_name TEXT NOT NULL,
        author_email TEXT NOT NULL,
        category TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        helpful_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(title, author_email)
      )
    `);

    // Comments table
    db.run(`
      CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY,
        post_id INTEGER NOT NULL,
        author_name TEXT NOT NULL,
        author_email TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(post_id) REFERENCES posts(id) ON DELETE CASCADE
      )
    `);

    // Admin sessions table
    db.run(`
      CREATE TABLE IF NOT EXISTS admin_sessions (
        id INTEGER PRIMARY KEY,
        token TEXT UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME DEFAULT (datetime('now', '+24 hours'))
      )
    `);

    console.log('✅ Database tables initialized');
  });
}

initializeDatabase();

// ─────────────────────────────────────────────────────────────
// STATIC FILES & ROUTES
// ─────────────────────────────────────────────────────────────

// Serve all static files from root directory
app.use(express.static(path.join(__dirname)));

// Serve main index.html at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve community main page
app.get('/community/', (req, res) => {
  res.sendFile(path.join(__dirname, 'community', 'index.html'));
});

// Serve admin panel
app.get('/community/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'community', 'admin.html'));
});

// ─────────────────────────────────────────────────────────────
// API ROUTES - FORUM POSTS
// ─────────────────────────────────────────────────────────────

// GET all posts
app.get('/api/posts', (req, res) => {
  db.all('SELECT * FROM posts WHERE status = ? ORDER BY created_at DESC', ['approved'], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows || []);
  });
});

// GET single post
app.get('/api/posts/:id', (req, res) => {
  db.get('SELECT * FROM posts WHERE id = ?', [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!row) return res.status(404).json({ error: 'Post not found' });
    res.json(row);
  });
});

// POST new post
app.post('/api/posts', (req, res) => {
  const { title, author_name, author_email, category, description } = req.body;
  
  if (!title || !author_name || !author_email || !category || !description) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  db.run(
    'INSERT INTO posts (title, author_name, author_email, category, description, status) VALUES (?, ?, ?, ?, ?, ?)',
    [title, author_name, author_email, category, description, 'pending'],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(400).json({ error: 'You have already posted this. Please wait for approval.' });
        }
        return res.status(500).json({ error: 'Database error' });
      }
      res.status(201).json({ id: this.lastID, message: 'Post submitted! Awaiting approval.' });
    }
  );
});

// Mark post as helpful
app.post('/api/posts/:id/helpful', (req, res) => {
  db.run('UPDATE posts SET helpful_count = helpful_count + 1 WHERE id = ?', [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json({ message: 'Helpful count updated' });
  });
});

// ─────────────────────────────────────────────────────────────
// API ROUTES - ADMIN PANEL
// ─────────────────────────────────────────────────────────────

// Admin login
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

  if (password !== adminPassword) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  const token = generateToken();
  db.run('INSERT INTO admin_sessions (token) VALUES (?)', [token], (err) => {
    if (err) return res.status(500).json({ error: 'Session error' });
    res.json({ token, message: 'Login successful' });
  });
});

// Get pending posts
app.get('/api/admin/posts/pending', (req, res) => {
  const token = req.headers['x-admin-token'];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  db.get('SELECT id FROM admin_sessions WHERE token = ?', [token], (err, session) => {
    if (err || !session) return res.status(401).json({ error: 'Unauthorized' });

    db.all('SELECT * FROM posts WHERE status = ? ORDER BY created_at DESC', ['pending'], (err, rows) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json(rows || []);
    });
  });
});

// Approve post
app.post('/api/admin/posts/:id/approve', (req, res) => {
  const token = req.headers['x-admin-token'];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  db.get('SELECT id FROM admin_sessions WHERE token = ?', [token], (err, session) => {
    if (err || !session) return res.status(401).json({ error: 'Unauthorized' });

    db.run('UPDATE posts SET status = ? WHERE id = ?', ['approved', req.params.id], (err) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json({ message: 'Post approved' });
    });
  });
});

// Delete/Reject post
app.delete('/api/admin/posts/:id', (req, res) => {
  const token = req.headers['x-admin-token'];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  db.get('SELECT id FROM admin_sessions WHERE token = ?', [token], (err, session) => {
    if (err || !session) return res.status(401).json({ error: 'Unauthorized' });

    db.run('DELETE FROM posts WHERE id = ?', [req.params.id], (err) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json({ message: 'Post deleted' });
    });
  });
});

// Get forum stats
app.get('/api/admin/stats', (req, res) => {
  db.all('SELECT COUNT(*) as total FROM posts', (err, totalRows) => {
    db.all('SELECT COUNT(*) as today FROM posts WHERE DATE(created_at) = DATE("now")', (err, todayRows) => {
      db.all('SELECT COUNT(DISTINCT author_email) as members FROM posts', (err, membersRows) => {
        res.json({
          total_posts: totalRows?.[0]?.total || 0,
          posts_today: todayRows?.[0]?.today || 0,
          active_members: membersRows?.[0]?.members || 0
        });
      });
    });
  });
});

// ─────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────

function generateToken() {
  return Math.random().toString(36).substr(2) + Date.now().toString(36);
}

// ─────────────────────────────────────────────────────────────
// API DOCS
// ─────────────────────────────────────────────────────────────
app.get('/api/docs', (req, res) => {
  res.json({
    api_version: '1.0.0',
    endpoints: {
      posts: {
        'GET /api/posts': 'Get all approved posts',
        'GET /api/posts/:id': 'Get specific post',
        'POST /api/posts': 'Create new post',
        'POST /api/posts/:id/helpful': 'Mark as helpful'
      },
      admin: {
        'POST /api/admin/login': 'Admin login',
        'GET /api/admin/posts/pending': 'Get pending posts',
        'POST /api/admin/posts/:id/approve': 'Approve post',
        'DELETE /api/admin/posts/:id': 'Delete post',
        'GET /api/admin/stats': 'Get forum statistics'
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────
// ERROR HANDLING
// ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// ─────────────────────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('🚀 FORUM SERVER RUNNING');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log(`✅ Server: http://localhost:${PORT}`);
  console.log(`✅ Main page: http://localhost:${PORT}/`);
  console.log(`✅ Community: http://localhost:${PORT}/community/`);
  console.log(`✅ API Docs: http://localhost:${PORT}/api/docs`);
  console.log(`✅ Database: ${dbPath}`);
  console.log('═══════════════════════════════════════════════════════════════════════════════');
});

module.exports = app;
