// ═══════════════════════════════════════════════════════════════════════════
// INDIA DIGITAL MARKETING FORUM - COMPLETE SERVER WITH LOGIN & OAUTH
// ═══════════════════════════════════════════════════════════════════════════

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const bodyParser = require('body-parser');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 5000;

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG & MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════

app.set('trust proxy', 1);
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            fontSrc: ["'self'", "data:"]
        }
    }
}));

app.use(cors({
    origin: [
        'http://localhost:3000',
        'http://localhost:5000',
        'https://indiadigitalmarketingforum.org',
        'https://www.indiadigitalmarketingforum.org'
    ],
    credentials: true
}));

app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

const dataDir = '/home/u277837837/domains/indiadigitalmarketingforum.org/data';
const uploadsDir = path.join(dataDir, 'uploads');

// Create directories if they don't exist
const fs = require('fs');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

app.use('/uploads', express.static(path.join(uploadsDir)));

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    skip: (req) => req.path.startsWith('/api/')
});
app.use(limiter);

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE SETUP
// ═══════════════════════════════════════════════════════════════════════════

const db = new sqlite3.Database(path.join(dataDir, 'forum.db'), (err) => {
    if (err) console.error('Database error:', err);
    else console.log('✅ Database connected');
});

db.serialize(() => {
    // Users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        email TEXT UNIQUE,
        password_hash TEXT,
        google_id TEXT,
        is_verified BOOLEAN DEFAULT 0,
        is_approved BOOLEAN DEFAULT 1,
        verification_token TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Posts table
    db.run(`CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        author_name TEXT,
        author_email TEXT,
        user_id INTEGER,
        category TEXT,
        tags TEXT,
        description TEXT,
        image_url TEXT,
        status TEXT DEFAULT 'pending',
        helpful_count INTEGER DEFAULT 0,
        featured BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    // Comments table
    db.run(`CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER,
        user_id INTEGER,
        author_name TEXT,
        author_email TEXT,
        content TEXT,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (post_id) REFERENCES posts(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    // Subscribers table
    db.run(`CREATE TABLE IF NOT EXISTS subscribers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE,
        name TEXT,
        subscribed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Admin sessions
    db.run(`CREATE TABLE IF NOT EXISTS admin_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token TEXT UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Co-admins
    db.run(`CREATE TABLE IF NOT EXISTS co_admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        email TEXT UNIQUE,
        password_hash TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Co-admin sessions
    db.run(`CREATE TABLE IF NOT EXISTS co_admin_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        co_admin_id INTEGER,
        token TEXT UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (co_admin_id) REFERENCES co_admins(id)
    )`);

    console.log('✅ Database tables ready');
});

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function hashPassword(password) {
    const salt = process.env.PASSWORD_SALT || 'default_salt_change_this';
    return crypto.createHash('sha256').update(password + salt).digest('hex');
}

function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

// ═══════════════════════════════════════════════════════════════════════════
// MULTER - IMAGE UPLOAD
// ═══════════════════════════════════════════════════════════════════════════

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '_' + Math.random().toString(36).substring(7) + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (extname && mimetype) {
            return cb(null, true);
        } else {
            cb(new Error('Only image files allowed'));
        }
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// STATIC FILES
// ═══════════════════════════════════════════════════════════════════════════

app.use(express.static(path.join(__dirname)));

// ═══════════════════════════════════════════════════════════════════════════
// AUTH ENDPOINTS - LOGIN / REGISTER / GOOGLE OAUTH
// ═══════════════════════════════════════════════════════════════════════════

// Register user
app.post('/api/register', (req, res) => {
    console.log('📝 Register request:', req.body.email);
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
        return res.status(400).json({ error: 'All fields required' });
    }

    const passwordHash = hashPassword(password);

    db.run(
        `INSERT INTO users (username, email, password_hash, is_verified) VALUES (?, ?, ?, 1)`,
        [username, email, passwordHash],
        function(err) {
            if (err) {
                console.error('Register error:', err);
                return res.status(500).json({ error: 'Email or username already exists' });
            }

            const token = generateToken();
            console.log('✅ User registered:', email);
            res.json({
                message: 'Registration successful',
                token: token,
                userId: this.lastID,
                username: username,
                email: email
            });
        }
    );
});

// Login user
app.post('/api/login', (req, res) => {
    console.log('🔐 Login request:', req.body.email);
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password required' });
    }

    db.get(
        `SELECT * FROM users WHERE email = ?`,
        [email],
        (err, user) => {
            if (err || !user) {
                console.error('Login error - user not found:', email);
                return res.status(401).json({ error: 'Invalid email or password' });
            }

            const passwordHash = hashPassword(password);
            if (user.password_hash !== passwordHash) {
                console.error('Login error - wrong password');
                return res.status(401).json({ error: 'Invalid email or password' });
            }

            const token = generateToken();
            console.log('✅ User logged in:', email);
            res.json({
                message: 'Login successful',
                token: token,
                userId: user.id,
                username: user.username,
                email: user.email
            });
        }
    );
});

// Google OAuth callback
app.post('/api/auth/google', (req, res) => {
    console.log('🔵 Google OAuth request');
    const { token, email, name, googleId } = req.body;

    if (!email || !googleId) {
        return res.status(400).json({ error: 'Email and Google ID required' });
    }

    // Check if user exists
    db.get(
        `SELECT * FROM users WHERE google_id = ? OR email = ?`,
        [googleId, email],
        (err, user) => {
            if (user) {
                // User exists - login
                console.log('✅ Google user logged in:', email);
                res.json({
                    message: 'Login successful',
                    token: generateToken(),
                    userId: user.id,
                    username: user.username || name,
                    email: user.email
                });
            } else {
                // New user - create
                db.run(
                    `INSERT INTO users (username, email, google_id, is_verified) VALUES (?, ?, ?, 1)`,
                    [name || email.split('@')[0], email, googleId],
                    function(err) {
                        if (err) {
                            console.error('Google auth error:', err);
                            return res.status(500).json({ error: 'Failed to create account' });
                        }

                        console.log('✅ New Google user created:', email);
                        res.json({
                            message: 'Account created and logged in',
                            token: generateToken(),
                            userId: this.lastID,
                            username: name || email.split('@')[0],
                            email: email
                        });
                    }
                );
            }
        }
    );
});

// ═══════════════════════════════════════════════════════════════════════════
// POST ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

// Get all approved posts
app.get('/api/posts', (req, res) => {
    db.all(
        `SELECT * FROM posts WHERE status = 'approved' ORDER BY featured DESC, created_at DESC`,
        (err, posts) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to fetch posts' });
            }
            res.json(posts || []);
        }
    );
});

// Create post
app.post('/api/posts', (req, res) => {
    console.log('📝 Post submission');
    const { title, author_name, author_email, category, description, image_url, user_id } = req.body;

    if (!title || !author_name || !author_email || !category || !description) {
        return res.status(400).json({ error: 'Required fields missing' });
    }

    db.run(
        `INSERT INTO posts (title, author_name, author_email, user_id, category, description, image_url, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [title, author_name, author_email, user_id || null, category, description, image_url || null],
        function(err) {
            if (err) {
                console.error('Post error:', err);
                return res.status(500).json({ error: 'Failed to submit post' });
            }
            console.log('✅ Post submitted:', this.lastID);
            res.json({ message: 'Post submitted for approval!', postId: this.lastID });
        }
    );
});

// Upload image
app.post('/api/upload-image', upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    const imageUrl = '/uploads/' + req.file.filename;
    console.log('✅ Image uploaded:', imageUrl);
    res.json({ imageUrl: imageUrl });
});

// Search posts
app.get('/api/search', (req, res) => {
    const query = req.query.q || '';
    const searchTerm = '%' + query + '%';

    db.all(
        `SELECT * FROM posts WHERE status = 'approved' AND (title LIKE ? OR description LIKE ? OR author_name LIKE ?)
         ORDER BY created_at DESC`,
        [searchTerm, searchTerm, searchTerm],
        (err, posts) => {
            if (err) {
                return res.status(500).json({ error: 'Search failed' });
            }
            res.json(posts || []);
        }
    );
});

// Mark post helpful
app.post('/api/posts/:id/helpful', (req, res) => {
    db.run(
        `UPDATE posts SET helpful_count = helpful_count + 1 WHERE id = ?`,
        [req.params.id],
        (err) => {
            if (err) return res.status(500).json({ error: 'Failed' });
            res.json({ message: 'Marked as helpful' });
        }
    );
});

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

// Admin login
app.post('/api/admin/login', (req, res) => {
    console.log('👑 Admin login');
    const { password } = req.body;
    const adminPassword = process.env.ADMIN_PASSWORD || 'Ganesh@2025';

    if (password !== adminPassword) {
        return res.status(401).json({ error: 'Invalid password' });
    }

    const token = generateToken();
    db.run(`INSERT INTO admin_sessions (token) VALUES (?)`, [token]);
    console.log('✅ Admin logged in');
    res.json({ token: token, message: 'Admin login successful' });
});

// Get pending posts
app.get('/api/admin/posts/pending', (req, res) => {
    db.all(
        `SELECT * FROM posts WHERE status = 'pending' ORDER BY created_at DESC`,
        (err, posts) => {
            if (err) return res.status(500).json({ error: 'Failed' });
            res.json(posts || []);
        }
    );
});

// Get approved posts
app.get('/api/admin/posts/approved', (req, res) => {
    db.all(
        `SELECT * FROM posts WHERE status = 'approved' ORDER BY featured DESC, created_at DESC`,
        (err, posts) => {
            if (err) return res.status(500).json({ error: 'Failed' });
            res.json(posts || []);
        }
    );
});

// Approve post
app.post('/api/admin/posts/:id/approve', (req, res) => {
    console.log('✅ Approving post:', req.params.id);
    db.run(
        `UPDATE posts SET status = 'approved' WHERE id = ?`,
        [req.params.id],
        (err) => {
            if (err) return res.status(500).json({ error: 'Failed' });
            res.json({ message: 'Post approved' });
        }
    );
});

// Delete post
app.delete('/api/admin/posts/:id', (req, res) => {
    console.log('🗑️ Deleting post:', req.params.id);
    db.run(`DELETE FROM posts WHERE id = ?`, [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: 'Failed' });
        res.json({ message: 'Post deleted' });
    });
});

// Toggle featured
app.post('/api/admin/posts/:id/featured', (req, res) => {
    const { featured } = req.body;
    console.log('⭐ Toggle featured:', req.params.id, featured);
    db.run(
        `UPDATE posts SET featured = ? WHERE id = ?`,
        [featured ? 1 : 0, req.params.id],
        (err) => {
            if (err) return res.status(500).json({ error: 'Failed' });
            res.json({ message: featured ? 'Featured' : 'Unfeatured' });
        }
    );
});

// Get pending comments
app.get('/api/admin/comments/pending', (req, res) => {
    db.all(
        `SELECT c.*, p.title as post_title FROM comments c
         JOIN posts p ON c.post_id = p.id
         WHERE c.status = 'pending'
         ORDER BY c.created_at DESC`,
        (err, comments) => {
            if (err) return res.status(500).json({ error: 'Failed' });
            res.json(comments || []);
        }
    );
});

// Approve comment
app.post('/api/admin/comments/:id/approve', (req, res) => {
    db.run(`UPDATE comments SET status = 'approved' WHERE id = ?`, [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: 'Failed' });
        res.json({ message: 'Comment approved' });
    });
});

// Delete comment
app.delete('/api/admin/comments/:id', (req, res) => {
    db.run(`DELETE FROM comments WHERE id = ?`, [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: 'Failed' });
        res.json({ message: 'Comment deleted' });
    });
});

// Get pending users
app.get('/api/admin/users/pending', (req, res) => {
    db.all(
        `SELECT id, username, email, is_approved, created_at FROM users WHERE is_approved = 0`,
        (err, users) => {
            if (err) return res.status(500).json({ error: 'Failed' });
            res.json(users || []);
        }
    );
});

// Approve user
app.post('/api/admin/users/:id/approve', (req, res) => {
    db.run(`UPDATE users SET is_approved = 1 WHERE id = ?`, [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: 'Failed' });
        res.json({ message: 'User approved' });
    });
});

// Delete user
app.delete('/api/admin/users/:id', (req, res) => {
    db.run(`DELETE FROM users WHERE id = ?`, [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: 'Failed' });
        res.json({ message: 'User deleted' });
    });
});

// Get subscribers
app.get('/api/admin/subscribers', (req, res) => {
    db.all(`SELECT * FROM subscribers ORDER BY subscribed_at DESC`, (err, subs) => {
        if (err) return res.status(500).json({ error: 'Failed' });
        res.json(subs || []);
    });
});

// Subscriber count
app.get('/api/subscribers/count', (req, res) => {
    db.get(`SELECT COUNT(*) as count FROM subscribers`, (err, result) => {
        if (err) return res.status(500).json({ error: 'Failed' });
        res.json({ count: result.count });
    });
});

// Create co-admin
app.post('/api/admin/co-admins/create', (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
        return res.status(400).json({ error: 'All fields required' });
    }
    const passwordHash = hashPassword(password);
    db.run(
        `INSERT INTO co_admins (username, email, password_hash) VALUES (?, ?, ?)`,
        [username, email, passwordHash],
        function(err) {
            if (err) return res.status(500).json({ error: 'Failed to create' });
            res.json({ message: 'Co-admin created', coAdminId: this.lastID });
        }
    );
});

// Get co-admins
app.get('/api/admin/co-admins', (req, res) => {
    db.all(`SELECT id, username, email FROM co_admins ORDER BY created_at DESC`, (err, admins) => {
        if (err) return res.status(500).json({ error: 'Failed' });
        res.json(admins || []);
    });
});

// Delete co-admin
app.delete('/api/admin/co-admins/:id', (req, res) => {
    db.run(`DELETE FROM co_admins WHERE id = ?`, [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: 'Failed' });
        res.json({ message: 'Co-admin deleted' });
    });
});

// Change password
app.post('/api/admin/change-password', (req, res) => {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ error: 'Password must be 6+ characters' });
    }
    res.json({ message: 'Password changed (in production)' });
});

// ═══════════════════════════════════════════════════════════════════════════
// CO-ADMIN ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

app.post('/api/co-admin/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM co_admins WHERE username = ?`, [username], (err, coAdmin) => {
        if (err || !coAdmin) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const passwordHash = hashPassword(password);
        if (coAdmin.password_hash !== passwordHash) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const token = generateToken();
        res.json({ token: token, coAdminId: coAdmin.id });
    });
});

app.get('/api/co-admin/comments/pending', (req, res) => {
    db.all(
        `SELECT c.*, p.title as post_title FROM comments c
         JOIN posts p ON c.post_id = p.id
         WHERE c.status = 'pending'
         ORDER BY c.created_at DESC`,
        (err, comments) => {
            if (err) return res.status(500).json({ error: 'Failed' });
            res.json(comments || []);
        }
    );
});

// ═══════════════════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════════════════

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📍 Database: ${path.join(dataDir, 'forum.db')}`);
    console.log(`📁 Uploads: ${uploadsDir}`);
});


// ═══════════════════════════════════════════════════════════════════════════
// ADDITIONAL MISSING ENDPOINTS (Added for completeness)
// ═══════════════════════════════════════════════════════════════════════════

// Subscribe to newsletter
app.post('/api/subscribe', (req, res) => {
    console.log('📧 Subscribe request');
    const { email, name } = req.body;

    if (!email) {
        return res.status(400).json({ error: 'Email required' });
    }

    db.run(
        `INSERT OR IGNORE INTO subscribers (email, name) VALUES (?, ?)`,
        [email, name || null],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Failed to subscribe' });
            }
            console.log('✅ New subscriber:', email);
            res.json({ message: 'Thank you for subscribing!' });
        }
    );
});

// Get featured posts
app.get('/api/posts/featured', (req, res) => {
    db.all(
        `SELECT * FROM posts WHERE status = 'approved' AND featured = 1 ORDER BY created_at DESC LIMIT 10`,
        (err, posts) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to fetch' });
            }
            res.json(posts || []);
        }
    );
});

// Post comment
app.post('/api/comments', (req, res) => {
    console.log('💬 Comment submission');
    const { post_id, author_name, author_email, content, user_id } = req.body;

    if (!post_id || !author_name || !author_email || !content) {
        return res.status(400).json({ error: 'Required fields missing' });
    }

    db.run(
        `INSERT INTO comments (post_id, user_id, author_name, author_email, content, status)
         VALUES (?, ?, ?, ?, ?, 'pending')`,
        [post_id, user_id || null, author_name, author_email, content],
        function(err) {
            if (err) {
                console.error('Comment error:', err);
                return res.status(500).json({ error: 'Failed to submit comment' });
            }
            console.log('✅ Comment submitted:', this.lastID);
            res.json({ message: 'Comment submitted for approval!', commentId: this.lastID });
        }
    );
});

// Get comments for a post
app.get('/api/posts/:id/comments', (req, res) => {
    db.all(
        `SELECT * FROM comments WHERE post_id = ? AND status = 'approved' ORDER BY created_at DESC`,
        [req.params.id],
        (err, comments) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to fetch' });
            }
            res.json(comments || []);
        }
    );
});

// Get user profile
app.get('/api/users/:id', (req, res) => {
    db.get(
        `SELECT id, username, email, created_at FROM users WHERE id = ?`,
        [req.params.id],
        (err, user) => {
            if (err || !user) {
                return res.status(404).json({ error: 'User not found' });
            }
            res.json(user);
        }
    );
});

// Get user's posts
app.get('/api/users/:id/posts', (req, res) => {
    db.all(
        `SELECT * FROM posts WHERE user_id = ? AND status = 'approved' ORDER BY created_at DESC`,
        [req.params.id],
        (err, posts) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to fetch' });
            }
            res.json(posts || []);
        }
    );
});

// Get all users (for directory)
app.get('/api/users', (req, res) => {
    db.all(
        `SELECT id, username, created_at FROM users WHERE is_approved = 1 ORDER BY created_at DESC`,
        (err, users) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to fetch' });
            }
            res.json(users || []);
        }
    );
});

console.log('✅ All endpoints loaded');

