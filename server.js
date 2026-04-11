const express = require('express');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 5000;

app.set('trust proxy', 1);

console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log('🚀 FORUM SERVER WITH CO-ADMIN SYSTEM...');
console.log('═══════════════════════════════════════════════════════════════════════════════');

// IMAGE UPLOAD SETUP
const uploadsDir = '/home/u277837837/domains/indiadigitalmarketingforum.org/data/uploads';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('✅ Uploads directory created');
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 1 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files allowed'));
    }
  }
});

console.log('✅ Image upload configured (Max: 1MB)');

// EMAIL SETUP
const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE || 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

transporter.verify((error, success) => {
  if (error) {
    console.log('⚠️ Email service issue:', error.message);
  } else {
    console.log('✅ Email service ready');
  }
});

async function sendEmail(to, subject, html) {
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: to,
      subject: subject,
      html: html
    });
    console.log('✅ Email sent to:', to);
    return true;
  } catch (error) {
    console.error('❌ Email error:', error.message);
    return false;
  }
}

// MIDDLEWARE
app.use(helmet());
app.use(cors({
  origin: (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(','),
  credentials: true
}));

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 500
});

app.use(limiter);
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));
app.use('/uploads', express.static(uploadsDir));

// DATABASE
const dbPath = process.env.DB_PATH || path.join(__dirname, 'forum.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('DB error:', err);
  else console.log('✅ Database connected');
});

function initializeDatabase() {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT UNIQUE,
      email TEXT UNIQUE,
      password_hash TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      author_name TEXT NOT NULL,
      author_email TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      image_url TEXT,
      status TEXT DEFAULT 'pending',
      helpful_count INTEGER DEFAULT 0,
      featured INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(title, author_email)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY,
      post_id INTEGER NOT NULL,
      author_name TEXT NOT NULL,
      author_email TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(post_id) REFERENCES posts(id) ON DELETE CASCADE
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS admin_sessions (
      id INTEGER PRIMARY KEY,
      token TEXT UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME DEFAULT (datetime('now', '+24 hours'))
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS co_admins (
      id INTEGER PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      email TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'active'
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS co_admin_sessions (
      id INTEGER PRIMARY KEY,
      token TEXT UNIQUE,
      co_admin_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME DEFAULT (datetime('now', '+24 hours')),
      FOREIGN KEY(co_admin_id) REFERENCES co_admins(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS subscribers (
      id INTEGER PRIMARY KEY,
      email TEXT UNIQUE,
      name TEXT,
      subscribed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'active'
    )`);

    console.log('✅ Database tables ready');
  });
}

initializeDatabase();

// UTILITY FUNCTIONS
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function generateToken() {
  return Math.random().toString(36).substr(2) + Date.now().toString(36);
}

app.use(express.static(path.join(__dirname)));

// ═══════════════════════════════════════════════════════════
// HTML ROUTES
// ═══════════════════════════════════════════════════════════

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/community', (req, res) => {
  res.redirect('/community/');
});

app.get('/community/', (req, res) => {
  try {
    const filePath = path.join(__dirname, 'community', 'index.html');
    res.sendFile(filePath);
  } catch (err) {
    res.status(404).send('Community page not found');
  }
});

app.get('/community/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'community', 'admin.html'));
});

app.get('/community/co-admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'community', 'co-admin.html'));
});

// ═══════════════════════════════════════════════════════════
// IMAGE UPLOAD
// ═══════════════════════════════════════════════════════════

app.post('/api/upload-image', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image provided' });
  }

  const imageUrl = `/uploads/${req.file.filename}`;
  res.json({ 
    success: true, 
    imageUrl: imageUrl,
    message: 'Image uploaded successfully'
  });
});

// ═══════════════════════════════════════════════════════════
// API - POSTS
// ═══════════════════════════════════════════════════════════

app.get('/api/posts', (req, res) => {
  db.all('SELECT * FROM posts WHERE status = ? ORDER BY featured DESC, created_at DESC', ['approved'], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows || []);
  });
});

app.get('/api/posts/:id', (req, res) => {
  db.get('SELECT * FROM posts WHERE id = ?', [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!row) return res.status(404).json({ error: 'Post not found' });
    res.json(row);
  });
});

app.post('/api/posts', (req, res) => {
  const { title, author_name, author_email, category, description, image_url } = req.body;
  
  if (!title || !author_name || !author_email || !category || !description) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  db.run(
    'INSERT INTO posts (title, author_name, author_email, category, description, image_url, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [title, author_name, author_email, category, description, image_url || null, 'pending'],
    async function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(400).json({ error: 'You have already posted this.' });
        }
        return res.status(500).json({ error: 'Database error' });
      }

      await sendEmail(author_email, 'Post Submitted', `<h2>Thank you!</h2><p>Your post has been submitted for review.</p>`);
      await sendEmail(process.env.EMAIL_USER, `New Post: ${title}`, `<h2>New post from ${author_name}</h2><p>${description}</p>${image_url ? `<p><img src="${image_url}" style="max-width:300px;"></p>` : ''}`);

      res.status(201).json({ id: this.lastID, message: 'Post submitted! Awaiting approval.' });
    }
  );
});

app.post('/api/posts/:id/helpful', (req, res) => {
  db.run('UPDATE posts SET helpful_count = helpful_count + 1 WHERE id = ?', [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json({ message: 'Updated' });
  });
});

// ═══════════════════════════════════════════════════════════
// API - NEWSLETTER
// ═══════════════════════════════════════════════════════════

app.post('/api/subscribe', (req, res) => {
  const { email, name } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  db.run(
    'INSERT INTO subscribers (email, name) VALUES (?, ?)',
    [email, name || 'Subscriber'],
    async function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(400).json({ error: 'Already subscribed!' });
        }
        return res.status(500).json({ error: 'Database error' });
      }

      await sendEmail(email, 'Welcome!', `<h2>Welcome to India Digital Marketing Forum!</h2><p>Thank you for subscribing!</p>`);

      res.status(201).json({ message: 'Successfully subscribed! Check your email.' });
    }
  );
});

app.get('/api/subscribers/count', (req, res) => {
  db.all('SELECT COUNT(*) as count FROM subscribers WHERE status = ?', ['active'], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json({ count: rows?.[0]?.count || 0 });
  });
});

app.get('/api/admin/subscribers', (req, res) => {
  const token = req.headers['x-admin-token'];
  
  if (!token) {
    return res.status(401).json({ error: 'No token' });
  }

  db.get('SELECT id FROM admin_sessions WHERE token = ?', [token], (err, session) => {
    if (err || !session) return res.status(401).json({ error: 'Unauthorized' });

    db.all('SELECT email, name, subscribed_at FROM subscribers WHERE status = ? ORDER BY subscribed_at DESC', ['active'], (err, rows) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json(rows || []);
    });
  });
});

// ═══════════════════════════════════════════════════════════
// API - MAIN ADMIN (Password-based)
// ═══════════════════════════════════════════════════════════

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  const token = generateToken();
  db.run('INSERT INTO admin_sessions (token) VALUES (?)', [token], (err) => {
    if (err) return res.status(500).json({ error: 'Session error' });
    res.json({ token, message: 'Login successful' });
  });
});

app.get('/api/admin/posts/pending', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (!token) return res.status(401).json({ error: 'No token' });

  db.get('SELECT id FROM admin_sessions WHERE token = ?', [token], (err, session) => {
    if (err || !session) return res.status(401).json({ error: 'Unauthorized' });

    db.all('SELECT * FROM posts WHERE status = ? ORDER BY created_at DESC', ['pending'], (err, rows) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json(rows || []);
    });
  });
});

app.get('/api/admin/posts/approved', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (!token) return res.status(401).json({ error: 'No token' });

  db.get('SELECT id FROM admin_sessions WHERE token = ?', [token], (err, session) => {
    if (err || !session) return res.status(401).json({ error: 'Unauthorized' });

    db.all('SELECT * FROM posts WHERE status = ? ORDER BY featured DESC, created_at DESC', ['approved'], (err, rows) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json(rows || []);
    });
  });
});

app.post('/api/admin/posts/:id/approve', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (!token) return res.status(401).json({ error: 'No token' });

  db.get('SELECT id FROM admin_sessions WHERE token = ?', [token], (err, session) => {
    if (err || !session) return res.status(401).json({ error: 'Unauthorized' });

    db.get('SELECT * FROM posts WHERE id = ?', [req.params.id], async (err, post) => {
      if (err || !post) return res.status(500).json({ error: 'Post not found' });

      db.run('UPDATE posts SET status = ? WHERE id = ?', ['approved', req.params.id], async (err) => {
        if (err) return res.status(500).json({ error: 'Database error' });

        await sendEmail(post.author_email, 'Your Post Approved!', `<h2>Your post has been approved!</h2>`);

        res.json({ message: 'Post approved' });
      });
    });
  });
});

app.delete('/api/admin/posts/approved/:id', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (!token) return res.status(401).json({ error: 'No token' });

  db.get('SELECT id FROM admin_sessions WHERE token = ?', [token], (err, session) => {
    if (err || !session) return res.status(401).json({ error: 'Unauthorized' });

    db.get('SELECT * FROM posts WHERE id = ? AND status = ?', [req.params.id, 'approved'], async (err, post) => {
      if (err || !post) return res.status(500).json({ error: 'Post not found' });

      db.run('DELETE FROM posts WHERE id = ?', [req.params.id], async (err) => {
        if (err) return res.status(500).json({ error: 'Database error' });

        await sendEmail(post.author_email, 'Post Removed', `<h2>Your post was removed</h2>`);

        res.json({ message: 'Post deleted' });
      });
    });
  });
});

app.delete('/api/admin/posts/:id', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (!token) return res.status(401).json({ error: 'No token' });

  db.get('SELECT id FROM admin_sessions WHERE token = ?', [token], (err, session) => {
    if (err || !session) return res.status(401).json({ error: 'Unauthorized' });

    db.get('SELECT * FROM posts WHERE id = ?', [req.params.id], async (err, post) => {
      if (err || !post) return res.status(500).json({ error: 'Post not found' });

      db.run('DELETE FROM posts WHERE id = ?', [req.params.id], async (err) => {
        if (err) return res.status(500).json({ error: 'Database error' });

        await sendEmail(post.author_email, 'Post Rejected', `<h2>Your post was rejected</h2>`);

        res.json({ message: 'Post deleted' });
      });
    });
  });
});

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

// ═══════════════════════════════════════════════════════════
// API - CO-ADMIN MANAGEMENT (Admin only)
// ═══════════════════════════════════════════════════════════

app.post('/api/admin/co-admins', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (!token) return res.status(401).json({ error: 'No token' });

  db.get('SELECT id FROM admin_sessions WHERE token = ?', [token], (err, session) => {
    if (err || !session) return res.status(401).json({ error: 'Unauthorized' });

    const { username, password, email } = req.body;

    if (!username || !password || password.length < 6) {
      return res.status(400).json({ error: 'Username and password (min 6 chars) required' });
    }

    const passwordHash = hashPassword(password);

    db.run(
      'INSERT INTO co_admins (username, password_hash, email) VALUES (?, ?, ?)',
      [username, passwordHash, email || null],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE')) {
            return res.status(400).json({ error: 'Username already exists' });
          }
          return res.status(500).json({ error: 'Database error' });
        }

        res.status(201).json({ 
          id: this.lastID, 
          message: 'Co-admin created successfully' 
        });
      }
    );
  });
});

app.get('/api/admin/co-admins', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (!token) return res.status(401).json({ error: 'No token' });

  db.get('SELECT id FROM admin_sessions WHERE token = ?', [token], (err, session) => {
    if (err || !session) return res.status(401).json({ error: 'Unauthorized' });

    db.all('SELECT id, username, email, created_at, status FROM co_admins ORDER BY created_at DESC', (err, rows) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json(rows || []);
    });
  });
});

app.delete('/api/admin/co-admins/:id', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (!token) return res.status(401).json({ error: 'No token' });

  db.get('SELECT id FROM admin_sessions WHERE token = ?', [token], (err, session) => {
    if (err || !session) return res.status(401).json({ error: 'Unauthorized' });

    db.run('DELETE FROM co_admins WHERE id = ?', [req.params.id], (err) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json({ message: 'Co-admin deleted' });
    });
  });
});

// ═══════════════════════════════════════════════════════════
// API - CO-ADMIN LOGIN & OPERATIONS
// ═══════════════════════════════════════════════════════════

app.post('/api/co-admin/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const passwordHash = hashPassword(password);

  db.get('SELECT id FROM co_admins WHERE username = ? AND password_hash = ? AND status = ?', 
    [username, passwordHash, 'active'], 
    (err, coAdmin) => {
      if (err || !coAdmin) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const token = generateToken();
      db.run('INSERT INTO co_admin_sessions (token, co_admin_id) VALUES (?, ?)', 
        [token, coAdmin.id], 
        (err) => {
          if (err) return res.status(500).json({ error: 'Session error' });
          res.json({ token, message: 'Login successful' });
        }
      );
    }
  );
});

// Co-admin: Get pending posts
app.get('/api/co-admin/posts/pending', (req, res) => {
  const token = req.headers['x-co-admin-token'];
  if (!token) return res.status(401).json({ error: 'No token' });

  db.get('SELECT co_admin_id FROM co_admin_sessions WHERE token = ?', [token], (err, session) => {
    if (err || !session) return res.status(401).json({ error: 'Unauthorized' });

    db.all('SELECT * FROM posts WHERE status = ? ORDER BY created_at DESC', ['pending'], (err, rows) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json(rows || []);
    });
  });
});

// Co-admin: Get approved posts (read-only)
app.get('/api/co-admin/posts/approved', (req, res) => {
  const token = req.headers['x-co-admin-token'];
  if (!token) return res.status(401).json({ error: 'No token' });

  db.get('SELECT co_admin_id FROM co_admin_sessions WHERE token = ?', [token], (err, session) => {
    if (err || !session) return res.status(401).json({ error: 'Unauthorized' });

    db.all('SELECT * FROM posts WHERE status = ? ORDER BY featured DESC, created_at DESC', ['approved'], (err, rows) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json(rows || []);
    });
  });
});

// Co-admin: Approve post
app.post('/api/co-admin/posts/:id/approve', (req, res) => {
  const token = req.headers['x-co-admin-token'];
  if (!token) return res.status(401).json({ error: 'No token' });

  db.get('SELECT co_admin_id FROM co_admin_sessions WHERE token = ?', [token], (err, session) => {
    if (err || !session) return res.status(401).json({ error: 'Unauthorized' });

    db.get('SELECT * FROM posts WHERE id = ?', [req.params.id], async (err, post) => {
      if (err || !post) return res.status(500).json({ error: 'Post not found' });

      db.run('UPDATE posts SET status = ? WHERE id = ?', ['approved', req.params.id], async (err) => {
        if (err) return res.status(500).json({ error: 'Database error' });

        await sendEmail(post.author_email, 'Your Post Approved!', `<h2>Your post has been approved!</h2>`);

        res.json({ message: 'Post approved' });
      });
    });
  });
});

// Co-admin: Reject post
app.delete('/api/co-admin/posts/:id', (req, res) => {
  const token = req.headers['x-co-admin-token'];
  if (!token) return res.status(401).json({ error: 'No token' });

  db.get('SELECT co_admin_id FROM co_admin_sessions WHERE token = ?', [token], (err, session) => {
    if (err || !session) return res.status(401).json({ error: 'Unauthorized' });

    db.get('SELECT * FROM posts WHERE id = ?', [req.params.id], async (err, post) => {
      if (err || !post) return res.status(500).json({ error: 'Post not found' });

      db.run('DELETE FROM posts WHERE id = ?', [req.params.id], async (err) => {
        if (err) return res.status(500).json({ error: 'Database error' });

        await sendEmail(post.author_email, 'Post Rejected', `<h2>Your post was rejected</h2>`);

        res.json({ message: 'Post deleted' });
      });
    });
  });
});

// Co-admin: Get stats (read-only)
app.get('/api/co-admin/stats', (req, res) => {
  const token = req.headers['x-co-admin-token'];
  if (!token) return res.status(401).json({ error: 'No token' });

  db.get('SELECT co_admin_id FROM co_admin_sessions WHERE token = ?', [token], (err, session) => {
    if (err || !session) return res.status(401).json({ error: 'Unauthorized' });

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
});

// ═══════════════════════════════════════════════════════════
// ERROR HANDLING
// ═══════════════════════════════════════════════════════════

app.use((err, req, res, next) => {
  console.error('Error:', err);
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Max 1MB.' });
    }
  }
  res.status(500).json({ error: 'Internal server error' });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// ═══════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════

app.listen(PORT, () => {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('🚀 FORUM WITH CO-ADMIN SYSTEM RUNNING');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log(`✅ Server: http://localhost:${PORT}`);
  console.log(`✅ Main: http://localhost:${PORT}/`);
  console.log(`✅ Community: http://localhost:${PORT}/community/`);
  console.log(`✅ Co-Admin System: Active`);
  console.log('═══════════════════════════════════════════════════════════════════════════════');
});

module.exports = app;
