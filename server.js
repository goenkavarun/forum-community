const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'; // Change this!

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Initialize SQLite Database
const db = new sqlite3.Database('./forum.db', (err) => {
  if (err) {
    console.error('Database connection error:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

// Initialize database schema
function initializeDatabase() {
  db.serialize(() => {
    // Posts table
    db.run(`
      CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        author TEXT NOT NULL,
        email TEXT NOT NULL,
        category TEXT NOT NULL,
        approved INTEGER DEFAULT 0,
        views INTEGER DEFAULT 0,
        helpful_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Comments table
    db.run(`
      CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL,
        author TEXT NOT NULL,
        email TEXT NOT NULL,
        content TEXT NOT NULL,
        approved INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(post_id) REFERENCES posts(id) ON DELETE CASCADE
      )
    `);

    // Admin sessions table
    db.run(`
      CREATE TABLE IF NOT EXISTS admin_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME
      )
    `);

    console.log('Database schema initialized');
  });
}

// ──────────────────────────────────
// ADMIN AUTHENTICATION
// ──────────────────────────────────

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;

  if (password === ADMIN_PASSWORD) {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    db.run(
      'INSERT INTO admin_sessions (token, expires_at) VALUES (?, ?)',
      [token, expiresAt],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Failed to create session' });
        }
        res.json({ success: true, token });
      }
    );
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

function verifyAdminToken(req, res, next) {
  const token = req.headers['x-admin-token'];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  db.get(
    'SELECT * FROM admin_sessions WHERE token = ? AND expires_at > datetime("now")',
    [token],
    (err, row) => {
      if (err || !row) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
      next();
    }
  );
}

function generateToken() {
  return Math.random().toString(36).substr(2) + Date.now().toString(36);
}

// ──────────────────────────────────
// POSTS ENDPOINTS
// ──────────────────────────────────

// Create new post (requires approval)
app.post('/api/posts', (req, res) => {
  const { title, content, author, email, category } = req.body;

  if (!title || !content || !author || !email || !category) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  db.run(
    `INSERT INTO posts (title, content, author, email, category, approved)
     VALUES (?, ?, ?, ?, ?, 0)`,
    [title, content, author, email, category],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to create post' });
      }
      res.status(201).json({
        success: true,
        message: 'Post submitted successfully! Awaiting admin approval.',
        postId: this.lastID
      });
    }
  );
});

// Get all approved posts
app.get('/api/posts', (req, res) => {
  const category = req.query.category;
  let query = 'SELECT * FROM posts WHERE approved = 1 ORDER BY created_at DESC';
  let params = [];

  if (category && category !== 'all') {
    query = 'SELECT * FROM posts WHERE approved = 1 AND category = ? ORDER BY created_at DESC';
    params = [category];
  }

  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch posts' });
    }
    res.json(rows);
  });
});

// Get single post with comments
app.get('/api/posts/:id', (req, res) => {
  const postId = req.params.id;

  db.get('SELECT * FROM posts WHERE id = ? AND approved = 1', [postId], (err, post) => {
    if (err || !post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Increment views
    db.run('UPDATE posts SET views = views + 1 WHERE id = ?', [postId]);

    // Get approved comments
    db.all(
      'SELECT * FROM comments WHERE post_id = ? AND approved = 1 ORDER BY created_at DESC',
      [postId],
      (err, comments) => {
        res.json({ ...post, comments: comments || [] });
      }
    );
  });
});

// Mark post as helpful
app.post('/api/posts/:id/helpful', (req, res) => {
  const postId = req.params.id;

  db.run('UPDATE posts SET helpful_count = helpful_count + 1 WHERE id = ?', [postId], (err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to update helpful count' });
    }
    res.json({ success: true });
  });
});

// ──────────────────────────────────
// COMMENTS ENDPOINTS
// ──────────────────────────────────

// Create comment (requires approval)
app.post('/api/posts/:id/comments', (req, res) => {
  const postId = req.params.id;
  const { author, email, content } = req.body;

  if (!author || !email || !content) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  db.run(
    `INSERT INTO comments (post_id, author, email, content, approved)
     VALUES (?, ?, ?, ?, 0)`,
    [postId, author, email, content],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to create comment' });
      }
      res.status(201).json({
        success: true,
        message: 'Comment submitted! Awaiting admin approval.',
        commentId: this.lastID
      });
    }
  );
});

// ──────────────────────────────────
// ADMIN DASHBOARD ENDPOINTS
// ──────────────────────────────────

// Get pending posts
app.get('/api/admin/posts/pending', verifyAdminToken, (req, res) => {
  db.all(
    'SELECT * FROM posts WHERE approved = 0 ORDER BY created_at DESC',
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to fetch posts' });
      }
      res.json(rows);
    }
  );
});

// Get pending comments
app.get('/api/admin/comments/pending', verifyAdminToken, (req, res) => {
  db.all(
    `SELECT c.*, p.title as post_title FROM comments c
     JOIN posts p ON c.post_id = p.id
     WHERE c.approved = 0 ORDER BY c.created_at DESC`,
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to fetch comments' });
      }
      res.json(rows);
    }
  );
});

// Approve post
app.post('/api/admin/posts/:id/approve', verifyAdminToken, (req, res) => {
  const postId = req.params.id;

  db.run('UPDATE posts SET approved = 1 WHERE id = ?', [postId], function(err) {
    if (err || this.changes === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }
    res.json({ success: true, message: 'Post approved' });
  });
});

// Reject/delete post
app.delete('/api/admin/posts/:id', verifyAdminToken, (req, res) => {
  const postId = req.params.id;

  db.run('DELETE FROM posts WHERE id = ?', [postId], function(err) {
    if (err || this.changes === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }
    res.json({ success: true, message: 'Post deleted' });
  });
});

// Approve comment
app.post('/api/admin/comments/:id/approve', verifyAdminToken, (req, res) => {
  const commentId = req.params.id;

  db.run('UPDATE comments SET approved = 1 WHERE id = ?', [commentId], function(err) {
    if (err || this.changes === 0) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    res.json({ success: true, message: 'Comment approved' });
  });
});

// Reject/delete comment
app.delete('/api/admin/comments/:id', verifyAdminToken, (req, res) => {
  const commentId = req.params.id;

  db.run('DELETE FROM comments WHERE id = ?', [commentId], function(err) {
    if (err || this.changes === 0) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    res.json({ success: true, message: 'Comment deleted' });
  });
});

// Get forum statistics
app.get('/api/admin/stats', verifyAdminToken, (req, res) => {
  db.all(
    `SELECT 
      (SELECT COUNT(*) FROM posts WHERE approved = 1) as approved_posts,
      (SELECT COUNT(*) FROM posts WHERE approved = 0) as pending_posts,
      (SELECT COUNT(*) FROM comments WHERE approved = 1) as approved_comments,
      (SELECT COUNT(*) FROM comments WHERE approved = 0) as pending_comments`,
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to fetch stats' });
      }
      res.json(rows[0]);
    }
  );
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Forum server running on http://localhost:${PORT}`);
  console.log(`Admin password: ${ADMIN_PASSWORD}`);
});
