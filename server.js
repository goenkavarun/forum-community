const express = require('express');
const sqlite3 = require('sqlite3');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Security middleware
app.use(helmet());
app.set('trust proxy', 1);
app.use(cors({
    origin: [
        'indiadigitalmarketingforum.org',
        'www.indiadigitalmarketingforum.org',
        'localhost',
        'localhost:3000'
    ]
}));

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(path.join(__dirname)));
app.use('/uploads', express.static(path.join(dataDir, 'uploads')));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,  // Increased from 100
    message: 'Too many requests, please try again later',
    skip: (req) => req.path.startsWith('/api/')  // Skip rate limit for API
});
app.use(limiter);

// Create data directory if it doesn't exist
const dataDir = '/home/u277837837/domains/indiadigitalmarketingforum.org/data';
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const uploadsDir = path.join(dataDir, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Database setup
const dbPath = path.join(dataDir, 'forum.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error('Database error:', err);
    else console.log('✅ Database connected');
});

// Image upload setup
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 1 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only images allowed'));
        }
    }
});

// ═══════════════════════════════════════════════════════════
// DATABASE INITIALIZATION WITH NEW SCHEMA
// ═══════════════════════════════════════════════════════════

function initializeDatabase() {
    db.serialize(() => {
        // Users table
        db.run(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT,
                google_id TEXT,
                is_verified INTEGER DEFAULT 0,
                is_approved INTEGER DEFAULT 0,
                verification_token TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Posts table (updated)
        db.run(`
            CREATE TABLE IF NOT EXISTS posts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                author_name TEXT NOT NULL,
                author_email TEXT NOT NULL,
                user_id INTEGER,
                category TEXT NOT NULL,
                tags TEXT,
                description TEXT NOT NULL,
                image_url TEXT,
                status TEXT DEFAULT 'pending',
                helpful_count INTEGER DEFAULT 0,
                featured INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
        `);

        // Comments table (NEW)
        db.run(`
            CREATE TABLE IF NOT EXISTS comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                post_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                author_name TEXT NOT NULL,
                author_email TEXT NOT NULL,
                content TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(post_id) REFERENCES posts(id),
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
        `);

        // Admin sessions table
        db.run(`
            CREATE TABLE IF NOT EXISTS admin_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                expires_at DATETIME
            )
        `);

        // Co-admin sessions table
        db.run(`
            CREATE TABLE IF NOT EXISTS co_admin_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token TEXT NOT NULL,
                co_admin_id INTEGER NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                expires_at DATETIME
            )
        `);

        // Co-admins table
        db.run(`
            CREATE TABLE IF NOT EXISTS co_admins (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                email TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                status TEXT DEFAULT 'active'
            )
        `);

        // Subscribers table
        db.run(`
            CREATE TABLE IF NOT EXISTS subscribers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                name TEXT,
                subscribed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                status TEXT DEFAULT 'active'
            )
        `);

        console.log('✅ Database tables initialized');
    });
}

initializeDatabase();

// ═══════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════

function generateToken() {
    return Math.random().toString(36).substr(2) + Date.now().toString(36);
}

function hashPassword(password) {
    return require('crypto').createHash('sha256').update(password).digest('hex');
}

// ═══════════════════════════════════════════════════════════
// USER REGISTRATION & LOGIN ENDPOINTS
// ═══════════════════════════════════════════════════════════

// Sign up with email
app.post('/api/auth/signup', (req, res) => {
    const { username, email, password, name } = req.body;

    if (!username || !email || !password) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    const passwordHash = hashPassword(password);
    const verificationToken = generateToken();

    db.run(
        `INSERT INTO users (username, email, password_hash, verification_token, is_verified, is_approved)
         VALUES (?, ?, ?, ?, 0, 0)`,
        [username, email, passwordHash, verificationToken],
        function(err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(400).json({ error: 'Email or username already exists' });
                }
                return res.status(500).json({ error: 'Signup failed' });
            }

            // TODO: Send verification email
            res.json({
                message: 'Signup successful! Check your email to verify.',
                userId: this.lastID,
                verificationToken: verificationToken
            });
        }
    );
});

// Verify email
app.post('/api/auth/verify-email', (req, res) => {
    const { token } = req.body;

    db.run(
        `UPDATE users SET is_verified = 1, is_approved = 1 WHERE verification_token = ?`,
        [token],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Verification failed' });
            }

            if (this.changes === 0) {
                return res.status(400).json({ error: 'Invalid or expired token' });
            }

            res.json({ message: 'Email verified successfully! You can now login.' });
        }
    );
});

// Login with email
app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password required' });
    }

    const passwordHash = hashPassword(password);

    db.get(
        `SELECT * FROM users WHERE email = ? AND password_hash = ?`,
        [email, passwordHash],
        (err, user) => {
            if (err) {
                return res.status(500).json({ error: 'Login failed' });
            }

            if (!user) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            if (!user.is_verified) {
                return res.status(403).json({ error: 'Please verify your email first' });
            }

            if (!user.is_approved) {
                return res.status(403).json({ error: 'Your account is pending admin approval' });
            }

            const token = generateToken();
            res.json({
                token: token,
                userId: user.id,
                username: user.username,
                email: user.email
            });
        }
    );
});

// Google OAuth callback (simplified)
app.post('/api/auth/google', (req, res) => {
    const { googleId, email, name } = req.body;

    db.get(
        `SELECT * FROM users WHERE google_id = ?`,
        [googleId],
        (err, user) => {
            if (err) {
                return res.status(500).json({ error: 'Auth failed' });
            }

            if (user) {
                // Existing user
                const token = generateToken();
                return res.json({
                    token: token,
                    userId: user.id,
                    username: user.username,
                    email: user.email,
                    isNewUser: false
                });
            }

            // New Google user - auto-verify and approve
            db.run(
                `INSERT INTO users (username, email, google_id, is_verified, is_approved)
                 VALUES (?, ?, ?, 1, 1)`,
                [name || email.split('@')[0], email, googleId],
                function(err) {
                    if (err) {
                        return res.status(500).json({ error: 'Auth failed' });
                    }

                    const token = generateToken();
                    res.json({
                        token: token,
                        userId: this.lastID,
                        username: name || email.split('@')[0],
                        email: email,
                        isNewUser: true
                    });
                }
            );
        }
    );
});

// ═══════════════════════════════════════════════════════════
// POSTS ENDPOINTS
// ═══════════════════════════════════════════════════════════

// Get all approved posts with featured first
app.get('/api/posts', (req, res) => {
    db.all(
        `SELECT * FROM posts 
         WHERE status = 'approved' 
         ORDER BY featured DESC, created_at DESC`,
        (err, posts) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to fetch posts' });
            }
            res.json(posts || []);
        }
    );
});

// Get single post
app.get('/api/posts/:id', (req, res) => {
    db.get(
        `SELECT * FROM posts WHERE id = ? AND status = 'approved'`,
        [req.params.id],
        (err, post) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to fetch post' });
            }
            res.json(post);
        }
    );
});

// Submit new post
app.post('/api/posts', (req, res) => {
    const { title, author_name, author_email, category, tags, description, image_url, user_id } = req.body;

    if (!title || !author_name || !author_email || !category || !description) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    db.run(
        `INSERT INTO posts (title, author_name, author_email, user_id, category, tags, description, image_url, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [title, author_name, author_email, user_id || null, category, tags || null, description, image_url || null],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Failed to submit post' });
            }
            res.json({
                message: 'Post submitted successfully!',
                postId: this.lastID
            });
        }
    );
});

// Mark post as helpful
app.post('/api/posts/:id/helpful', (req, res) => {
    db.run(
        `UPDATE posts SET helpful_count = helpful_count + 1 WHERE id = ?`,
        [req.params.id],
        (err) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to update' });
            }
            res.json({ message: 'Marked as helpful!' });
        }
    );
});

// Upload image
app.post('/api/upload-image', upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No image provided' });
    }

    const imageUrl = `/uploads/${req.file.filename}`;
    res.json({
        message: 'Image uploaded successfully',
        imageUrl: imageUrl
    });
});

// ═══════════════════════════════════════════════════════════
// COMMENTS ENDPOINTS
// ═══════════════════════════════════════════════════════════

// Get approved comments for a post
app.get('/api/posts/:postId/comments', (req, res) => {
    db.all(
        `SELECT * FROM comments 
         WHERE post_id = ? AND status = 'approved'
         ORDER BY created_at DESC`,
        [req.params.postId],
        (err, comments) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to fetch comments' });
            }
            res.json(comments || []);
        }
    );
});

// Submit comment (requires login)
app.post('/api/posts/:postId/comments', (req, res) => {
    const { userId, authorName, authorEmail, content } = req.body;
    const postId = req.params.postId;

    if (!userId || !authorName || !authorEmail || !content) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    db.run(
        `INSERT INTO comments (post_id, user_id, author_name, author_email, content, status)
         VALUES (?, ?, ?, ?, ?, 'pending')`,
        [postId, userId, authorName, authorEmail, content],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Failed to submit comment' });
            }
            res.json({
                message: 'Comment submitted for approval!',
                commentId: this.lastID
            });
        }
    );
});

// ═══════════════════════════════════════════════════════════
// ADMIN ENDPOINTS
// ═══════════════════════════════════════════════════════════

// Admin login
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    const adminPassword = process.env.ADMIN_PASSWORD || 'Ganesh@2025';

    if (password === adminPassword) {
        const token = generateToken();
        res.json({ token: token, message: 'Admin login successful' });
    } else {
        res.status(401).json({ error: 'Invalid password' });
    }
});

// Get pending posts
app.get('/api/admin/posts/pending', (req, res) => {
    db.all(
        `SELECT * FROM posts WHERE status = 'pending' ORDER BY created_at DESC`,
        (err, posts) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to fetch pending posts' });
            }
            res.json(posts || []);
        }
    );
});

// Get approved posts
app.get('/api/admin/posts/approved', (req, res) => {
    db.all(
        `SELECT * FROM posts WHERE status = 'approved' ORDER BY created_at DESC`,
        (err, posts) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to fetch approved posts' });
            }
            res.json(posts || []);
        }
    );
});

// Approve post
app.post('/api/admin/posts/:id/approve', (req, res) => {
    db.run(
        `UPDATE posts SET status = 'approved' WHERE id = ?`,
        [req.params.id],
        (err) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to approve' });
            }
            res.json({ message: 'Post approved!' });
        }
    );
});

// Delete pending post
app.delete('/api/admin/posts/:id', (req, res) => {
    db.run(
        `DELETE FROM posts WHERE id = ? AND status = 'pending'`,
        [req.params.id],
        (err) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to delete' });
            }
            res.json({ message: 'Post deleted!' });
        }
    );
});

// Delete approved post
app.delete('/api/admin/posts/approved/:id', (req, res) => {
    db.run(
        `DELETE FROM posts WHERE id = ? AND status = 'approved'`,
        [req.params.id],
        (err) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to delete' });
            }
            res.json({ message: 'Post deleted!' });
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
            if (err) {
                return res.status(500).json({ error: 'Failed to fetch comments' });
            }
            res.json(comments || []);
        }
    );
});

// Approve comment
app.post('/api/admin/comments/:id/approve', (req, res) => {
    db.run(
        `UPDATE comments SET status = 'approved' WHERE id = ?`,
        [req.params.id],
        (err) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to approve' });
            }
            res.json({ message: 'Comment approved!' });
        }
    );
});

// Delete comment
app.delete('/api/admin/comments/:id', (req, res) => {
    db.run(
        `DELETE FROM comments WHERE id = ?`,
        [req.params.id],
        (err) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to delete' });
            }
            res.json({ message: 'Comment deleted!' });
        }
    );
});

// Toggle featured post
app.post('/api/admin/posts/:id/featured', (req, res) => {
    const { featured } = req.body;
    db.run(
        `UPDATE posts SET featured = ? WHERE id = ?`,
        [featured ? 1 : 0, req.params.id],
        (err) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to update' });
            }
            res.json({ message: featured ? 'Post featured!' : 'Post unfeatured!' });
        }
    );
});

// Get subscribers
app.get('/api/admin/subscribers', (req, res) => {
    db.all(
        `SELECT * FROM subscribers ORDER BY subscribed_at DESC`,
        (err, subscribers) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to fetch subscribers' });
            }
            res.json(subscribers || []);
        }
    );
});

// Get statistics
app.get('/api/admin/stats', (req, res) => {
    db.get(
        `SELECT 
            (SELECT COUNT(*) FROM posts WHERE status = 'approved') as totalPosts,
            (SELECT COUNT(*) FROM posts WHERE DATE(created_at) = DATE('now')) as postsToday,
            (SELECT COUNT(DISTINCT user_id) FROM posts) as activeMembers,
            (SELECT COUNT(*) FROM subscribers) as subscribers,
            (SELECT COUNT(*) FROM comments WHERE status = 'pending') as pendingComments,
            (SELECT COUNT(*) FROM users WHERE is_approved = 1) as approvedUsers`,
        (err, stats) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to fetch stats' });
            }
            res.json(stats || {});
        }
    );
});

// Get pending users
app.get('/api/admin/users/pending', (req, res) => {
    db.all(
        `SELECT id, username, email, created_at FROM users 
         WHERE is_approved = 0 AND is_verified = 1
         ORDER BY created_at DESC`,
        (err, users) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to fetch users' });
            }
            res.json(users || []);
        }
    );
});

// Approve user
app.post('/api/admin/users/:id/approve', (req, res) => {
    db.run(
        `UPDATE users SET is_approved = 1 WHERE id = ?`,
        [req.params.id],
        (err) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to approve user' });
            }
            res.json({ message: 'User approved!' });
        }
    );
});

// Reject user
app.delete('/api/admin/users/:id', (req, res) => {
    db.run(
        `DELETE FROM users WHERE id = ? AND is_approved = 0`,
        [req.params.id],
        (err) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to reject user' });
            }
            res.json({ message: 'User rejected!' });
        }
    );
});

// ═══════════════════════════════════════════════════════════
// SEARCH ENDPOINT
// ═══════════════════════════════════════════════════════════

app.get('/api/search', (req, res) => {
    const { q } = req.query;

    if (!q || q.length < 2) {
        return res.json([]);
    }

    const searchTerm = `%${q}%`;

    db.all(
        `SELECT p.*, 'post' as type FROM posts p
         WHERE p.status = 'approved' AND (p.title LIKE ? OR p.description LIKE ? OR p.tags LIKE ?)
         UNION
         SELECT c.id, c.post_id, c.content as description, c.author_name as title, c.author_email, null, null, c.status, 0, 0, c.created_at, 'comment' as type
         FROM comments c
         WHERE c.status = 'approved' AND c.content LIKE ?
         ORDER BY created_at DESC`,
        [searchTerm, searchTerm, searchTerm, searchTerm],
        (err, results) => {
            if (err) {
                return res.status(500).json({ error: 'Search failed' });
            }
            res.json(results || []);
        }
    );
});

// ═══════════════════════════════════════════════════════════
// NEWSLETTER ENDPOINTS
// ═══════════════════════════════════════════════════════════

app.post('/api/subscribe', (req, res) => {
    const { email, name } = req.body;

    if (!email) {
        return res.status(400).json({ error: 'Email required' });
    }

    db.run(
        `INSERT OR IGNORE INTO subscribers (email, name) VALUES (?, ?)`,
        [email, name || ''],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Subscription failed' });
            }
            res.json({ message: 'Subscribed successfully!' });
        }
    );
});

app.get('/api/subscribers/count', (req, res) => {
    db.get(
        `SELECT COUNT(*) as count FROM subscribers`,
        (err, result) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to fetch count' });
            }
            res.json(result);
        }
    );
});

// ═══════════════════════════════════════════════════════════
// CO-ADMIN ENDPOINTS (Same as Admin but limited)
// ═══════════════════════════════════════════════════════════

app.post('/api/co-admin/login', (req, res) => {
    const { username, password } = req.body;

    db.get(
        `SELECT * FROM co_admins WHERE username = ?`,
        [username],
        (err, coAdmin) => {
            if (err || !coAdmin) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            const passwordHash = hashPassword(password);
            if (coAdmin.password_hash !== passwordHash) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            const token = generateToken();
            res.json({ token: token, coAdminId: coAdmin.id });
        }
    );
});

// Co-admin pending comments (same approval endpoints)
app.get('/api/co-admin/comments/pending', (req, res) => {
    db.all(
        `SELECT c.*, p.title as post_title FROM comments c
         JOIN posts p ON c.post_id = p.id
         WHERE c.status = 'pending'
         ORDER BY c.created_at DESC`,
        (err, comments) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to fetch comments' });
            }
            res.json(comments || []);
        }
    );
});

// Co-admin stats (analytics)
app.get('/api/co-admin/stats', (req, res) => {
    db.get(
        `SELECT 
            (SELECT COUNT(*) FROM posts WHERE status = 'approved') as totalPosts,
            (SELECT COUNT(*) FROM comments WHERE status = 'approved') as approvedComments,
            (SELECT COUNT(*) FROM comments WHERE status = 'pending') as pendingComments,
            (SELECT COUNT(*) FROM users WHERE is_approved = 1) as approvedUsers`,
        (err, stats) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to fetch stats' });
            }
            res.json(stats || {});
        }
    );
});

// ═══════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════

app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`✅ All 6 EPIC features ready!`);
});
