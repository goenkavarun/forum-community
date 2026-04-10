═══════════════════════════════════════════════════════════════════════════════
               COMPLETE FOLDER STRUCTURE & EXACT PLACEMENT GUIDE
═══════════════════════════════════════════════════════════════════════════════

FINAL DIRECTORY STRUCTURE:

forum-community/ (GitHub repository root)
│
├── index.html (YOUR ORIGINAL - KEEP AS-IS)
├── server.js (Node.js backend)
├── package.json (dependencies)
├── .env (environment variables)
│
└── community/ (Subfolder for forum)
    ├── index.html (forum page)
    └── admin.html (admin panel)

═══════════════════════════════════════════════════════════════════════════════

EXACT FILE PLACEMENT & INSTRUCTIONS:

1. ROOT LEVEL FILES (In forum-community/ folder):
   ────────────────────────────────────────────────────

   a) index.html
      Location: forum-community/index.html
      Content: YOUR ORIGINAL index.html (download as index-KEEP_ORIGINAL.html, rename to index.html)
      Action: NO CHANGES - Keep exactly as-is
      
   b) server.js
      Location: forum-community/server.js
      Content: Node.js Express backend (download server-GITHUB-CORRECT.json - need actual server.js)
      Action: Add to root level
      
   c) package.json
      Location: forum-community/package.json
      Content: Dependencies list (download package-GITHUB-CORRECT.json)
      Action: Add to root level
      
   d) .env
      Location: forum-community/.env
      Content: Environment variables
      Action: Create with these variables:
      ────────────────────────────────────
      NODE_ENV=production
      ADMIN_PASSWORD=Ganesh@2025
      PASSWORD_SALT=aB7cD9eF2gH4iJ6kL8mN0oP2qR4sT6u8
      ALLOWED_ORIGINS=indiadigitalmarketingforum.org,www.indiadigitalmarketingforum.org
      API_URL=https://indiadigitalmarketingforum.org/api
      PORT=5000
      DB_PATH=./forum.db
      LOG_LEVEL=info

2. COMMUNITY SUBFOLDER (In forum-community/community/ folder):
   ──────────────────────────────────────────────────────────

   a) community/index.html
      Location: forum-community/community/index.html
      Content: Forum landing/main page
      Action: Download and place in community/ subfolder
      
   b) community/admin.html
      Location: forum-community/community/admin.html
      Content: Admin panel
      Action: Download and place in community/ subfolder

═══════════════════════════════════════════════════════════════════════════════

FILES YOU NEED TO DOWNLOAD:

From /mnt/user-data/outputs/:

1. index-KEEP_ORIGINAL.html
   → Rename to: index.html
   → Place in: forum-community/ (root level)
   
2. package-GITHUB-CORRECT.json
   → Rename to: package.json
   → Place in: forum-community/ (root level)
   
3. community-index.html (NEED TO CREATE)
   → Place in: forum-community/community/index.html
   
4. community-admin.html (NEED TO CREATE)
   → Place in: forum-community/community/admin.html
   
5. server.js (NEED TO VERIFY)
   → Place in: forum-community/server.js

═══════════════════════════════════════════════════════════════════════════════

FOLDER STRUCTURE ON YOUR COMPUTER (Before pushing to GitHub):

forum-community/
│
├── 📄 index.html (from index-KEEP_ORIGINAL.html)
├── 📄 server.js
├── 📄 package.json (from package-GITHUB-CORRECT.json)
├── 📄 .env (create manually)
│
└── 📁 community/
    ├── 📄 index.html (forum page)
    └── 📄 admin.html (admin panel)

═══════════════════════════════════════════════════════════════════════════════

STEP-BY-STEP SETUP:

STEP 1: Create folder structure locally
─────────────────────────────────────────
1. Create folder: forum-community/
2. Inside it, create subfolder: community/

STEP 2: Download and place root files
──────────────────────────────────────
1. Download index-KEEP_ORIGINAL.html
   → Rename to index.html
   → Place in forum-community/ root

2. Download package-GITHUB-CORRECT.json
   → Rename to package.json
   → Place in forum-community/ root

3. Get server.js (verify from GitHub or create)
   → Place in forum-community/ root

4. Create .env file with values listed above
   → Place in forum-community/ root

STEP 3: Download and place community files
───────────────────────────────────────────
1. Download community-index.html
   → Place in forum-community/community/index.html

2. Download community-admin.html
   → Place in forum-community/community/admin.html

STEP 4: Verify structure
─────────────────────────
Your folder should look EXACTLY like:

forum-community/
├── index.html ✓
├── server.js ✓
├── package.json ✓
├── .env ✓
└── community/
    ├── index.html ✓
    └── admin.html ✓

STEP 5: Push to GitHub
──────────────────────
cd forum-community
git add .
git commit -m "Complete forum setup: main site + community subfolder"
git push

STEP 6: Deploy on Hostinger
────────────────────────────
1. Go to Hostinger
2. Create Node.js application
3. Connect to GitHub: goenkavarun/forum-community
4. Root directory: / (default)
5. Add environment variables from .env
6. Deploy

═══════════════════════════════════════════════════════════════════════════════

EXPECTED RESULT AFTER DEPLOYMENT:

https://indiadigitalmarketingforum.org/
  → Shows your original index.html
  → Perfect layout, same content
  
https://indiadigitalmarketingforum.org/community/
  → Shows forum (community/index.html)
  
https://indiadigitalmarketingforum.org/api/posts
  → API endpoint working
  
https://indiadigitalmarketingforum.org/community/ + admin button
  → Admin panel opens with password: Ganesh@2025

═══════════════════════════════════════════════════════════════════════════════

FILES CHECKLIST:

Before pushing to GitHub, verify you have:

☐ index.html (your original, unchanged)
☐ server.js (backend)
☐ package.json (with correct versions)
☐ .env (with all 8 variables)
☐ community/index.html (forum page)
☐ community/admin.html (admin panel)

═══════════════════════════════════════════════════════════════════════════════

NEXT: I'll provide the actual community files to download.

═══════════════════════════════════════════════════════════════════════════════
