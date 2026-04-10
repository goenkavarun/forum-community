const express = require('express');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 5000;
app.set('trust proxy', 1);

// ─────────────────────────────────────────────────────────────
// EMAIL SETUP
// ─────────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE || 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

// Test email connection
transporter.verify((error, success) => {
  if (error) {
    console.log('⚠️ Email service not configured properly:', error.message);
  } else {
    console.log('✅ Email service ready - can send emails!');
  }
});

// Email sending function
async function sendEmail(to, subject, html) {
  try {
    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: to,
      subject: subject,
      html: html
    };

    const result = await transporter.sendMail(mailOptions);
    console.log('✅ Email sent:', result.response);
    return true;
  } catch (error) {
    console.error('❌ Email error:', error.message);
    return false;
  }
}

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

    // Subscribers table
    db.run(`
      CREATE TABLE IF NOT EXISTS subscribers (
        id INTEGER PRIMARY KEY,
        email TEXT UNIQUE,
        name TEXT,
        subscribed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'active'
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

// POST new post (with email notification to admin)
app.post('/api/posts', (req, res) => {
  const { title, author_name, author_email, category, description } = req.body;
  
  if (!title || !author_name || !author_email || !category || !description) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  db.run(
    'INSERT INTO posts (title, author_name, author_email, category, description, status) VALUES (?, ?, ?, ?, ?, ?)',
    [title, author_name, author_email, category, description, 'pending'],
    async function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(400).json({ error: 'You have already posted this. Please wait for approval.' });
        }
        return res.status(500).json({ error: 'Database error' });
      }

      // Send confirmation email to user
      const userEmailHtml = `
        <h2>Thank you for your post! 🎉</h2>
        <p>Hi ${author_name},</p>
        <p>Your post "<strong>${title}</strong>" has been submitted to the India Digital Marketing Forum.</p>
        <p><strong>Status:</strong> Awaiting moderation review</p>
        <p>Our team will review your post and it will be visible to the community once approved.</p>
        <hr>
        <p><strong>Post Details:</strong></p>
        <p><strong>Category:</strong> ${category}</p>
        <p><strong>Description:</strong> ${description}</p>
        <hr>
        <p>Thank you for contributing to our community!</p>
        <p>Best regards,<br>India Digital Marketing Forum Team</p>
      `;

      await sendEmail(author_email, 'Post Submitted Successfully', userEmailHtml);

      // Send notification email to admin
      const adminEmailHtml = `
        <h2>New Post Pending Review 📝</h2>
        <p><strong>Author:</strong> ${author_name}</p>
        <p><strong>Email:</strong> ${author_email}</p>
        <p><strong>Title:</strong> ${title}</p>
        <p><strong>Category:</strong> ${category}</p>
        <p><strong>Description:</strong></p>
        <p>${description}</p>
        <hr>
        <p><a href="https://indiadigitalmarketingforum.org/community/admin.html">Review in Admin Panel</a></p>
      `;

      await sendEmail(process.env.EMAIL_USER, `New Forum Post: ${title}`, adminEmailHtml);

      res.status(201).json({ id: this.lastID, message: 'Post submitted! Awaiting approval. Check your email for confirmation.' });
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
// API ROUTES - NEWSLETTER SUBSCRIPTION
// ─────────────────────────────────────────────────────────────

// Subscribe to newsletter
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

      // Send welcome email
      const emailHtml = `
        <h2>Welcome to India Digital Marketing Forum! 🎉</h2>
        <p>Hi ${name || 'Friend'},</p>
        <p>Thank you for subscribing to our newsletter!</p>
        <p>You'll receive monthly insights, trends, and exclusive content from our community.</p>
        <hr>
        <p><strong>What to expect:</strong></p>
        <ul>
          <li>Latest platform algorithm updates (Meta, Google, YouTube)</li>
          <li>India-specific marketing case studies</li>
          <li>Emerging tools and MarTech news</li>
          <li>Exclusive insights from our speaker community</li>
          <li>Job opportunities and community events</li>
        </ul>
        <hr>
        <p><a href="https://indiadigitalmarketingforum.org/community/">Visit Our Forum</a></p>
        <p>Best regards,<br>India Digital Marketing Forum Team</p>
      `;

      await sendEmail(email, 'Welcome to Our Newsletter!', emailHtml);

      res.status(201).json({ message: 'Successfully subscribed! Check your email.' });
    }
  );
});

// Get subscriber count
app.get('/api/subscribers/count', (req, res) => {
  db.all('SELECT COUNT(*) as count FROM subscribers WHERE status = ?', ['active'], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json({ count: rows?.[0]?.count || 0 });
  });
});

// Admin: Get all subscribers
app.get('/api/admin/subscribers', (req, res) => {
  const token = req.headers['x-admin-token'];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  db.get('SELECT id FROM admin_sessions WHERE token = ?', [token], (err, session) => {
    if (err || !session) return res.status(401).json({ error: 'Unauthorized' });

    db.all('SELECT email, name, subscribed_at FROM subscribers WHERE status = ? ORDER BY subscribed_at DESC', ['active'], (err, rows) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json(rows || []);
    });
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

// Approve post (with email notification to author)
app.post('/api/admin/posts/:id/approve', (req, res) => {
  const token = req.headers['x-admin-token'];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  db.get('SELECT id FROM admin_sessions WHERE token = ?', [token], (err, session) => {
    if (err || !session) return res.status(401).json({ error: 'Unauthorized' });

    // Get post details for email
    db.get('SELECT * FROM posts WHERE id = ?', [req.params.id], async (err, post) => {
      if (err || !post) return res.status(500).json({ error: 'Post not found' });

      db.run('UPDATE posts SET status = ? WHERE id = ?', ['approved', req.params.id], async (err) => {
        if (err) return res.status(500).json({ error: 'Database error' });

        // Send approval email to author
        const emailHtml = `
          <h2>Your Post Has Been Approved! 🎉</h2>
          <p>Hi ${post.author_name},</p>
          <p>Great news! Your post "<strong>${post.title}</strong>" has been approved and is now live in the community.</p>
          <p>Your post is now visible to all members of the India Digital Marketing Forum.</p>
          <hr>
          <p><a href="https://indiadigitalmarketingforum.org/community/">Visit the Forum</a></p>
          <p>Thank you for your contribution!</p>
        `;

        await sendEmail(post.author_email, 'Your Post Has Been Approved!', emailHtml);

        res.json({ message: 'Post approved and author notified' });
      });
    });
  });
});

// Delete/Reject post (with email notification to author)
app.delete('/api/admin/posts/:id', (req, res) => {
  const token = req.headers['x-admin-token'];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  db.get('SELECT id FROM admin_sessions WHERE token = ?', [token], (err, session) => {
    if (err || !session) return res.status(401).json({ error: 'Unauthorized' });

    // Get post details for email
    db.get('SELECT * FROM posts WHERE id = ?', [req.params.id], async (err, post) => {
      if (err || !post) return res.status(500).json({ error: 'Post not found' });

      db.run('DELETE FROM posts WHERE id = ?', [req.params.id], async (err) => {
        if (err) return res.status(500).json({ error: 'Database error' });

        // Send rejection email to author
        const emailHtml = `
          <h2>Post Review Update</h2>
          <p>Hi ${post.author_name},</p>
          <p>Thank you for your submission. Unfortunately, your post "<strong>${post.title}</strong>" did not meet our community guidelines and has not been approved.</p>
          <p>Please review our guidelines and feel free to submit another post that aligns with our community values.</p>
          <hr>
          <p>If you have any questions, please contact us.</p>
        `;

        await sendEmail(post.author_email, 'Post Review Decision', emailHtml);

        res.json({ message: 'Post deleted and author notified' });
      });
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
    features: ['Email notifications', 'Newsletter subscription', 'Post moderation', 'Forum statistics'],
    endpoints: {
      posts: {
        'GET /api/posts': 'Get all approved posts',
        'GET /api/posts/:id': 'Get specific post',
        'POST /api/posts': 'Create new post (sends email confirmation)',
        'POST /api/posts/:id/helpful': 'Mark as helpful'
      },
      subscription: {
        'POST /api/subscribe': 'Subscribe to newsletter',
        'GET /api/subscribers/count': 'Get subscriber count',
        'GET /api/admin/subscribers': 'Get all subscribers (admin only)'
      },
      admin: {
        'POST /api/admin/login': 'Admin login',
        'GET /api/admin/posts/pending': 'Get pending posts',
        'POST /api/admin/posts/:id/approve': 'Approve post (sends approval email)',
        'DELETE /api/admin/posts/:id': 'Delete post (sends rejection email)',
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
  console.log('🚀 FORUM SERVER WITH EMAIL & NEWSLETTER RUNNING');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log(`✅ Server: http://localhost:${PORT}`);
  console.log(`✅ Main page: http://localhost:${PORT}/`);
  console.log(`✅ Community: http://localhost:${PORT}/community/`);
  console.log(`✅ Email: Configured with ${process.env.EMAIL_SERVICE}`);
  console.log(`✅ Newsletter: Subscription enabled`);
  console.log(`✅ Database: ${dbPath}`);
  console.log('═══════════════════════════════════════════════════════════════════════════════');
});

module.exports = app;
