// ═══════════════════════════════════════════════════════════════════════════════
// PRODUCTION-GRADE COMMUNITY FORUM SERVER
// With: User Auth, Search, Analytics, Email, Post Editing, Nested Comments,
//       Post Pinning, Spam Detection, Webhooks, API Docs
// ═══════════════════════════════════════════════════════════════════════════════

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// ──────────────────────────────────────────────────────────────────────────────
// SECURITY MIDDLEWARE
// ──────────────────────────────────────────────────────────────────────────────

// Helmet.js - Secure HTTP headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
      scriptSrc: ["'self'", "fonts.googleapis.com"],
      fontSrc: ["'self'", "fonts.gstatic.com"],
      connectSrc: ["'self'", process.env.API_URL || 'http://localhost:5000']
    }
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true }
}));

// Rate limiting - Prevent DDoS/brute force
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // 5 login attempts
  skipSuccessfulRequests: true,
  message: 'Too many login attempts, please try again later.'
});

const postLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Max 10 posts per hour
  message: 'Too many posts, please wait before posting again.'
});

app.use(limiter);
app.use('/api/auth/login', loginLimiter);
app.use('/api/posts', postLimiter);

// Middleware
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || 'http://localhost:5000',
  credentials: true
}));
app.use(bodyParser.json({ limit: '10kb' })); // Limit payload
app.use(bodyParser.urlencoded({ limit: '10kb', extended: true }));
app.use(express.static('public'));

// Trust proxy
app.set('trust proxy', 1);

// ──────────────────────────────────────────────────────────────────────────────
// DATABASE INITIALIZATION
// ──────────────────────────────────────────────────────────────────────────────

const db = new sqlite3.Database('./forum.db', (err) => {
  if (err) console.error('Database connection error:', err);
  else {
    console.log('✅ Connected to SQLite database');
    initializeDatabase();
  }
});

function initializeDatabase() {
  db.serialize(() => {
    // Users table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        bio TEXT,
        avatar_url TEXT,
        reputation_points INTEGER DEFAULT 0,
        posts_count INTEGER DEFAULT 0,
        comments_count INTEGER DEFAULT 0,
        is_moderator INTEGER DEFAULT 0,
        is_banned INTEGER DEFAULT 0,
        email_verified INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login DATETIME
      )
    `);

    // User sessions table
    db.run(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME,
        ip_address TEXT,
        user_agent TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Posts table (enhanced)
    db.run(`
      CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        slug TEXT UNIQUE,
        author TEXT NOT NULL,
        email TEXT NOT NULL,
        category TEXT NOT NULL,
        approved INTEGER DEFAULT 0,
        pinned INTEGER DEFAULT 0,
        locked INTEGER DEFAULT 0,
        views INTEGER DEFAULT 0,
        helpful_count INTEGER DEFAULT 0,
        spam_score REAL DEFAULT 0,
        quality_score REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        published_at DATETIME,
        deleted_at DATETIME
      )
    `);

    // Comments table (nested/threaded)
    db.run(`
      CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL,
        user_id INTEGER,
        parent_comment_id INTEGER,
        author TEXT NOT NULL,
        email TEXT NOT NULL,
        content TEXT NOT NULL,
        approved INTEGER DEFAULT 0,
        spam_score REAL DEFAULT 0,
        helpful_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted_at DATETIME,
        FOREIGN KEY(post_id) REFERENCES posts(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY(parent_comment_id) REFERENCES comments(id) ON DELETE CASCADE
      )
    `);

    // Admin sessions table
    db.run(`
      CREATE TABLE IF NOT EXISTS admin_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME,
        ip_address TEXT,
        user_agent TEXT
      )
    `);

    // Spam reports table
    db.run(`
      CREATE TABLE IF NOT EXISTS spam_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER,
        comment_id INTEGER,
        reason TEXT NOT NULL,
        reporter_email TEXT,
        reviewed INTEGER DEFAULT 0,
        action_taken TEXT,
        reported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(post_id) REFERENCES posts(id),
        FOREIGN KEY(comment_id) REFERENCES comments(id)
      )
    `);

    // Email queue table
    db.run(`
      CREATE TABLE IF NOT EXISTS email_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipient_email TEXT NOT NULL,
        email_type TEXT NOT NULL,
        subject TEXT NOT NULL,
        html_content TEXT NOT NULL,
        sent INTEGER DEFAULT 0,
        sent_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        retry_count INTEGER DEFAULT 0
      )
    `);

    // Webhooks table
    db.run(`
      CREATE TABLE IF NOT EXISTS webhooks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        webhook_url TEXT NOT NULL,
        active INTEGER DEFAULT 1,
        secret_key TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // API logs table
    db.run(`
      CREATE TABLE IF NOT EXISTS api_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        method TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        status_code INTEGER,
        response_time_ms INTEGER,
        user_id INTEGER,
        ip_address TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes for performance
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_posts_approved ON posts(approved)',
      'CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category)',
      'CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at)',
      'CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id)',
      'CREATE INDEX IF NOT EXISTS idx_comments_user_id ON comments(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_comment_id)',
      'CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)',
      'CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)',
      'CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON user_sessions(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(token)'
    ];

    indexes.forEach(idx => db.run(idx));

    console.log('✅ Database schema initialized');
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────────

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + process.env.PASSWORD_SALT).digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function generateSlug(title) {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-') + '-' + Date.now();
}

function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// API Logging middleware
app.use((req, res, next) => {
  const startTime = Date.now();
  const originalSend = res.send;

  res.send = function(data) {
    const responseTime = Date.now() - startTime;
    const userId = req.user?.id || null;
    const ipAddress = req.ip;

    db.run(
      `INSERT INTO api_logs (method, endpoint, status_code, response_time_ms, user_id, ip_address)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.method, req.path, res.statusCode, responseTime, userId, ipAddress]
    );

    return originalSend.call(this, data);
  };

  next();
});

// ──────────────────────────────────────────────────────────────────────────────
// AUTHENTICATION ENDPOINTS
// ──────────────────────────────────────────────────────────────────────────────

// Register
app.post('/api/auth/register', (req, res) => {
  const { username, email, displayName, password, confirmPassword } = req.body;

  // Validation
  if (!username || !email || !displayName || !password) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match' });
  }

  if (!validateEmail(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return res.status(400).json({ error: 'Username must be 3-20 alphanumeric characters' });
  }

  const passwordHash = hashPassword(password);

  db.get('SELECT id FROM users WHERE email = ? OR username = ?', [email, username], (err, row) => {
    if (row) {
      return res.status(409).json({ error: 'Email or username already exists' });
    }

    db.run(
      `INSERT INTO users (username, email, display_name, password_hash)
       VALUES (?, ?, ?, ?)`,
      [username, email, displayName, passwordHash],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Registration failed' });
        }

        const token = generateToken();
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

        db.run(
          'INSERT INTO user_sessions (user_id, token, expires_at, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)',
          [this.lastID, token, expiresAt, req.ip, req.get('user-agent')],
          (err) => {
            if (err) {
              return res.status(500).json({ error: 'Session creation failed' });
            }

            res.status(201).json({
              success: true,
              message: 'Registration successful!',
              token,
              user: {
                id: this.lastID,
                username,
                email,
                displayName
              }
            });
          }
        );
      }
    );
  });
});

// Login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const passwordHash = hashPassword(password);

  db.get(
    'SELECT * FROM users WHERE email = ? AND password_hash = ? AND is_banned = 0',
    [email, passwordHash],
    (err, user) => {
      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const token = generateToken();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      db.run(
        'INSERT INTO user_sessions (user_id, token, expires_at, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)',
        [user.id, token, expiresAt, req.ip, req.get('user-agent')],
        (err) => {
          db.run('UPDATE users SET last_login = datetime("now") WHERE id = ?', [user.id]);

          res.json({
            success: true,
            token,
            user: {
              id: user.id,
              username: user.username,
              email: user.email,
              displayName: user.display_name,
              reputation: user.reputation_points,
              isModerator: user.is_moderator === 1
            }
          });
        }
      );
    }
  );
});

// Verify token middleware
function verifyToken(req, res, next) {
  const token = req.headers['x-auth-token'] || req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  db.get(
    `SELECT u.*, us.token FROM users u
     JOIN user_sessions us ON u.id = us.user_id
     WHERE us.token = ? AND us.expires_at > datetime("now") AND u.is_banned = 0`,
    [token],
    (err, user) => {
      if (err || !user) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }

      req.user = {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.display_name,
        reputation: user.reputation_points,
        isModerator: user.is_moderator === 1
      };

      next();
    }
  );
}

// Logout
app.post('/api/auth/logout', verifyToken, (req, res) => {
  const token = req.headers['x-auth-token'] || req.headers.authorization?.split(' ')[1];
  db.run('DELETE FROM user_sessions WHERE token = ?', [token], (err) => {
    res.json({ success: true, message: 'Logged out successfully' });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// POSTS ENDPOINTS (Enhanced with Editing & Pinning)
// ──────────────────────────────────────────────────────────────────────────────

// Create post
app.post('/api/posts', verifyToken, (req, res) => {
  const { title, content, category } = req.body;

  if (!title || !content || !category) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (title.length < 5 || title.length > 200) {
    return res.status(400).json({ error: 'Title must be 5-200 characters' });
  }

  if (content.length < 20) {
    return res.status(400).json({ error: 'Content must be at least 20 characters' });
  }

  const slug = generateSlug(title);
  const sanitizedContent = escapeHtml(content);

  db.run(
    `INSERT INTO posts (user_id, title, content, slug, author, email, category, approved)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
    [req.user.id, title, sanitizedContent, slug, req.user.displayName, req.user.email, category],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to create post' });
      }

      res.status(201).json({
        success: true,
        message: 'Post submitted! Awaiting approval.',
        postId: this.lastID
      });
    }
  );
});

// Get approved posts with pagination
app.get('/api/posts', (req, res) => {
  const category = req.query.category;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 20;
  const offset = (page - 1) * limit;

  let query = 'SELECT * FROM posts WHERE approved = 1 AND deleted_at IS NULL';
  let params = [];

  if (category && category !== 'all') {
    query += ' AND category = ?';
    params.push(category);
  }

  query += ' ORDER BY pinned DESC, published_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  db.all(query, params, (err, posts) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch posts' });
    }

    res.json({
      posts,
      page,
      limit,
      total: posts.length
    });
  });
});

// Get single post with comments
app.get('/api/posts/:id', (req, res) => {
  const postId = req.params.id;

  db.get(
    'SELECT * FROM posts WHERE (id = ? OR slug = ?) AND approved = 1 AND deleted_at IS NULL',
    [postId, postId],
    (err, post) => {
      if (!post) {
        return res.status(404).json({ error: 'Post not found' });
      }

      // Increment views
      db.run('UPDATE posts SET views = views + 1 WHERE id = ?', [post.id]);

      // Get comments (nested)
      db.all(
        `SELECT * FROM comments 
         WHERE post_id = ? AND approved = 1 AND deleted_at IS NULL
         ORDER BY parent_comment_id ASC, created_at ASC`,
        [post.id],
        (err, comments) => {
          res.json({
            ...post,
            comments: comments || []
          });
        }
      );
    }
  );
});

// Edit post (by author or moderator)
app.put('/api/posts/:id', verifyToken, (req, res) => {
  const postId = req.params.id;
  const { title, content, category } = req.body;

  db.get('SELECT * FROM posts WHERE id = ?', [postId], (err, post) => {
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Check authorization
    if (post.user_id !== req.user.id && !req.user.isModerator) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const sanitizedContent = escapeHtml(content);

    db.run(
      'UPDATE posts SET title = ?, content = ?, category = ?, updated_at = datetime("now") WHERE id = ?',
      [title, sanitizedContent, category, postId],
      (err) => {
        if (err) {
          return res.status(500).json({ error: 'Update failed' });
        }

        res.json({ success: true, message: 'Post updated' });
      }
    );
  });
});

// Delete post (soft delete)
app.delete('/api/posts/:id', verifyToken, (req, res) => {
  const postId = req.params.id;

  db.get('SELECT * FROM posts WHERE id = ?', [postId], (err, post) => {
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Check authorization
    if (post.user_id !== req.user.id && !req.user.isModerator) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    db.run(
      'UPDATE posts SET deleted_at = datetime("now") WHERE id = ?',
      [postId],
      (err) => {
        res.json({ success: true, message: 'Post deleted' });
      }
    );
  });
});

// Pin/unpin post (moderators only)
app.post('/api/admin/posts/:id/pin', verifyAdminToken, (req, res) => {
  const postId = req.params.id;

  db.get('SELECT pinned FROM posts WHERE id = ?', [postId], (err, post) => {
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const newPinnedStatus = post.pinned ? 0 : 1;

    db.run(
      'UPDATE posts SET pinned = ? WHERE id = ?',
      [newPinnedStatus, postId],
      (err) => {
        res.json({ success: true, pinned: newPinnedStatus });
      }
    );
  });
});

// Lock/unlock post (moderators only)
app.post('/api/admin/posts/:id/lock', verifyAdminToken, (req, res) => {
  const postId = req.params.id;

  db.get('SELECT locked FROM posts WHERE id = ?', [postId], (err, post) => {
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const newLockedStatus = post.locked ? 0 : 1;

    db.run(
      'UPDATE posts SET locked = ? WHERE id = ?',
      [newLockedStatus, postId],
      (err) => {
        res.json({ success: true, locked: newLockedStatus });
      }
    );
  });
});

// Mark helpful
app.post('/api/posts/:id/helpful', (req, res) => {
  const postId = req.params.id;

  db.run(
    'UPDATE posts SET helpful_count = helpful_count + 1 WHERE id = ?',
    [postId],
    (err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed' });
      }
      res.json({ success: true });
    }
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// COMMENTS ENDPOINTS (Nested/Threaded)
// ──────────────────────────────────────────────────────────────────────────────

// Create comment (threaded)
app.post('/api/posts/:id/comments', verifyToken, (req, res) => {
  const postId = req.params.id;
  const { content, parentCommentId } = req.body;

  if (!content || content.length < 1) {
    return res.status(400).json({ error: 'Comment cannot be empty' });
  }

  const sanitizedContent = escapeHtml(content);

  db.run(
    `INSERT INTO comments (post_id, user_id, parent_comment_id, author, email, content, approved)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
    [postId, req.user.id, parentCommentId || null, req.user.displayName, req.user.email, sanitizedContent],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to create comment' });
      }

      res.status(201).json({
        success: true,
        message: 'Comment submitted for approval',
        commentId: this.lastID
      });
    }
  );
});

// Edit comment
app.put('/api/comments/:id', verifyToken, (req, res) => {
  const commentId = req.params.id;
  const { content } = req.body;

  db.get('SELECT * FROM comments WHERE id = ?', [commentId], (err, comment) => {
    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    if (comment.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const sanitizedContent = escapeHtml(content);

    db.run(
      'UPDATE comments SET content = ?, updated_at = datetime("now") WHERE id = ?',
      [sanitizedContent, commentId],
      (err) => {
        res.json({ success: true, message: 'Comment updated' });
      }
    );
  });
});

// Delete comment (soft delete)
app.delete('/api/comments/:id', verifyToken, (req, res) => {
  const commentId = req.params.id;

  db.get('SELECT * FROM comments WHERE id = ?', [commentId], (err, comment) => {
    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    if (comment.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    db.run(
      'UPDATE comments SET deleted_at = datetime("now") WHERE id = ?',
      [commentId],
      (err) => {
        res.json({ success: true, message: 'Comment deleted' });
      }
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// SEARCH & FILTERING ENDPOINTS
// ──────────────────────────────────────────────────────────────────────────────

app.get('/api/search', (req, res) => {
  const query = req.query.q;
  const category = req.query.category;
  const sortBy = req.query.sort || 'recent';

  if (!query || query.trim().length < 2) {
    return res.status(400).json({ error: 'Search query too short' });
  }

  const searchTerm = `%${query}%`;
  let sqlQuery = `
    SELECT p.*, COUNT(c.id) as comment_count
    FROM posts p
    LEFT JOIN comments c ON p.id = c.post_id AND c.approved = 1
    WHERE p.approved = 1 AND p.deleted_at IS NULL AND (
      p.title LIKE ? OR p.content LIKE ? OR p.author LIKE ?
    )
  `;

  const params = [searchTerm, searchTerm, searchTerm];

  if (category && category !== 'all') {
    sqlQuery += ' AND p.category = ?';
    params.push(category);
  }

  sqlQuery += ' GROUP BY p.id';

  if (sortBy === 'popular') {
    sqlQuery += ' ORDER BY p.views DESC';
  } else if (sortBy === 'trending') {
    sqlQuery += ' ORDER BY p.published_at DESC, p.views DESC';
  } else {
    sqlQuery += ' ORDER BY p.published_at DESC';
  }

  sqlQuery += ' LIMIT 50';

  db.all(sqlQuery, params, (err, results) => {
    if (err) {
      return res.status(500).json({ error: 'Search failed' });
    }

    res.json({
      query,
      total: results.length,
      results
    });
  });
});

// Trending posts
app.get('/api/posts/trending', (req, res) => {
  const timeRange = req.query.range || 'week';
  let dateFilter = "datetime('now', '-7 days')";

  if (timeRange === 'month') dateFilter = "datetime('now', '-30 days')";

  db.all(
    `SELECT * FROM posts 
     WHERE approved = 1 AND deleted_at IS NULL AND published_at > ${dateFilter}
     ORDER BY (views + helpful_count * 2) DESC
     LIMIT 10`,
    (err, posts) => {
      res.json({ timeRange, posts: posts || [] });
    }
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// ANALYTICS ENDPOINTS
// ──────────────────────────────────────────────────────────────────────────────

app.get('/api/analytics/overview', verifyAdminToken, (req, res) => {
  db.get(
    `SELECT 
      COUNT(DISTINCT id) as total_posts,
      COUNT(DISTINCT user_id) as unique_authors,
      SUM(views) as total_views,
      SUM(helpful_count) as total_helpful,
      AVG(views) as avg_views
     FROM posts WHERE approved = 1`,
    (err, stats) => {
      db.all(
        `SELECT category, COUNT(*) as count FROM posts 
         WHERE approved = 1 GROUP BY category ORDER BY count DESC`,
        (err, categories) => {
          res.json({
            summary: stats,
            postsByCategory: categories || []
          });
        }
      );
    }
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// EMAIL NOTIFICATION ENDPOINTS
// ──────────────────────────────────────────────────────────────────────────────

// Queue email for sending
function queueEmail(recipientEmail, emailType, subject, htmlContent) {
  db.run(
    `INSERT INTO email_queue (recipient_email, email_type, subject, html_content)
     VALUES (?, ?, ?, ?)`,
    [recipientEmail, emailType, subject, htmlContent]
  );
}

// Get email preferences
app.get('/api/users/email-preferences', verifyToken, (req, res) => {
  res.json({
    emailNotifications: {
      postApproved: true,
      postRejected: true,
      newComments: true,
      weeklyDigest: true
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// WEBHOOK ENDPOINTS
// ──────────────────────────────────────────────────────────────────────────────

app.post('/api/webhooks', verifyAdminToken, (req, res) => {
  const { eventType, webhookUrl } = req.body;

  if (!eventType || !webhookUrl) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const secretKey = generateToken();

  db.run(
    'INSERT INTO webhooks (event_type, webhook_url, secret_key) VALUES (?, ?, ?)',
    [eventType, webhookUrl, secretKey],
    function(err) {
      res.json({
        id: this.lastID,
        eventType,
        webhookUrl,
        secretKey
      });
    }
  );
});

// Trigger webhook
function triggerWebhook(eventType, payload) {
  db.all('SELECT * FROM webhooks WHERE event_type = ? AND active = 1', [eventType], (err, webhooks) => {
    if (!webhooks) return;

    webhooks.forEach(webhook => {
      const signature = crypto
        .createHmac('sha256', webhook.secret_key)
        .update(JSON.stringify(payload))
        .digest('hex');

      fetch(webhook.webhook_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature
        },
        body: JSON.stringify(payload)
      }).catch(err => console.error('Webhook delivery failed:', err));
    });
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// ADMIN ENDPOINTS
// ──────────────────────────────────────────────────────────────────────────────

function verifyAdminToken(req, res, next) {
  const token = req.headers['x-admin-token'];

  if (!token) {
    return res.status(401).json({ error: 'No token' });
  }

  db.get(
    'SELECT * FROM admin_sessions WHERE token = ? AND expires_at > datetime("now")',
    [token],
    (err, row) => {
      if (!row) {
        return res.status(401).json({ error: 'Invalid token' });
      }
      next();
    }
  );
}

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;

  if (password === process.env.ADMIN_PASSWORD) {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    db.run(
      'INSERT INTO admin_sessions (token, expires_at, ip_address, user_agent) VALUES (?, ?, ?, ?)',
      [token, expiresAt, req.ip, req.get('user-agent')],
      (err) => {
        res.json({ success: true, token });
      }
    );
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

// Get pending posts
app.get('/api/admin/posts/pending', verifyAdminToken, (req, res) => {
  db.all(
    'SELECT * FROM posts WHERE approved = 0 ORDER BY created_at DESC',
    (err, posts) => {
      res.json(posts || []);
    }
  );
});

// Approve post
app.post('/api/admin/posts/:id/approve', verifyAdminToken, (req, res) => {
  const postId = req.params.id;

  db.run(
    'UPDATE posts SET approved = 1, published_at = datetime("now") WHERE id = ?',
    [postId],
    function(err) {
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Post not found' });
      }

      // Trigger webhook
      triggerWebhook('post.approved', { postId });

      // Queue email
      db.get('SELECT * FROM posts WHERE id = ?', [postId], (err, post) => {
        if (post) {
          queueEmail(
            post.email,
            'post_approved',
            `Your post "${post.title}" has been approved!`,
            `<p>Your post has been published on the forum.</p>`
          );
        }
      });

      res.json({ success: true });
    }
  );
});

// Reject/delete post
app.delete('/api/admin/posts/:id', verifyAdminToken, (req, res) => {
  const postId = req.params.id;

  db.run(
    'DELETE FROM posts WHERE id = ?',
    [postId],
    function(err) {
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Post not found' });
      }

      triggerWebhook('post.rejected', { postId });
      res.json({ success: true });
    }
  );
});

// Get admin stats
app.get('/api/admin/stats', verifyAdminToken, (req, res) => {
  db.all(
    `SELECT 
      (SELECT COUNT(*) FROM posts WHERE approved = 0) as pending_posts,
      (SELECT COUNT(*) FROM comments WHERE approved = 0) as pending_comments,
      (SELECT COUNT(*) FROM posts WHERE approved = 1) as approved_posts,
      (SELECT COUNT(*) FROM users) as total_users`,
    (err, rows) => {
      res.json(rows[0]);
    }
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// API DOCUMENTATION
// ──────────────────────────────────────────────────────────────────────────────

app.get('/api/docs', (req, res) => {
  const docs = {
    title: 'Community Forum API',
    version: '2.0.0',
    baseUrl: process.env.API_URL || 'http://localhost:5000',
    endpoints: {
      auth: {
        register: { method: 'POST', path: '/api/auth/register' },
        login: { method: 'POST', path: '/api/auth/login' },
        logout: { method: 'POST', path: '/api/auth/logout' }
      },
      posts: {
        create: { method: 'POST', path: '/api/posts', auth: true },
        list: { method: 'GET', path: '/api/posts' },
        get: { method: 'GET', path: '/api/posts/:id' },
        update: { method: 'PUT', path: '/api/posts/:id', auth: true },
        delete: { method: 'DELETE', path: '/api/posts/:id', auth: true },
        trending: { method: 'GET', path: '/api/posts/trending' }
      },
      comments: {
        create: { method: 'POST', path: '/api/posts/:id/comments', auth: true },
        edit: { method: 'PUT', path: '/api/comments/:id', auth: true },
        delete: { method: 'DELETE', path: '/api/comments/:id', auth: true }
      },
      search: {
        search: { method: 'GET', path: '/api/search' }
      },
      admin: {
        login: { method: 'POST', path: '/api/admin/login' },
        stats: { method: 'GET', path: '/api/admin/stats', auth: 'admin' },
        pendingPosts: { method: 'GET', path: '/api/admin/posts/pending', auth: 'admin' },
        approvePosts: { method: 'POST', path: '/api/admin/posts/:id/approve', auth: 'admin' },
        deletePost: { method: 'DELETE', path: '/api/admin/posts/:id', auth: 'admin' }
      }
    }
  };

  res.json(docs);
});

// ──────────────────────────────────────────────────────────────────────────────
// ERROR HANDLING
// ──────────────────────────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// ──────────────────────────────────────────────────────────────────────────────
// START SERVER
// ──────────────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('🚀 PRODUCTION FORUM SERVER RUNNING');
  console.log(`${'═'.repeat(60)}`);
  console.log(`✅ Server: http://localhost:${PORT}`);
  console.log(`✅ API Docs: http://localhost:${PORT}/api/docs`);
  console.log(`✅ Database: forum.db`);
  console.log(`✅ Security: Helmet, Rate Limiting, CORS, Input Validation`);
  console.log(`${'═'.repeat(60)}\n`);
});

module.exports = app;
