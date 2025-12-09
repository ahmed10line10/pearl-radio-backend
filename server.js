// ========================================
// Pearl Radio Station - MySQL Backend Server
// Node.js + Express + MySQL
// ========================================

const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// ========================================
// MySQL Connection Pool
// ========================================
const pool = mysql.createPool({
  host: process.env.MYSQLHOST || process.env.DB_HOST || 'localhost',
  port: process.env.MYSQLPORT || process.env.DB_PORT || 3306,
  user: process.env.MYSQLUSER || process.env.DB_USER || 'root',
  password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD || '',
  database: process.env.MYSQLDATABASE || process.env.DB_NAME || 'pearl_radio',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4'
});

// Test database connection
pool.getConnection()
  .then(connection => {
    console.log('✅ MySQL database connected successfully');
    connection.release();
  })
  .catch(err => {
    console.error('❌ MySQL connection error:', err.message);
  });

// ========================================
// Middleware
// ========================================
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// ========================================
// Helper Functions
// ========================================

// Generate UUID
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Generate short ID
function generateShortId() {
  return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Verify JWT token
function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    req.userEmail = decoded.email;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ========================================
// Health Check
// ========================================
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Pearl Radio Station MySQL API is running',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Pearl Radio Station MySQL API is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    database: 'MySQL'
  });
});

// ========================================
// AUTHENTICATION ROUTES
// ========================================

// Register new company admin
app.post('/auth/register', async (req, res) => {
  try {
    const { email, password, companyName, storeLicenses = 10 } = req.body;
    
    if (!email || !password || !companyName) {
      return res.status(400).json({ error: 'Email, password, and company name are required' });
    }
    
    // Check if user already exists
    const [existingUsers] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existingUsers.length > 0) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }
    
    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);
    const userId = generateUUID();
    
    // Insert new user
    await pool.query(
      `INSERT INTO users (id, email, password_hash, company_name, store_licenses, account_status) 
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [userId, email, passwordHash, companyName, storeLicenses]
    );
    
    console.log('✅ User registered:', email);
    
    res.json({
      success: true,
      user: {
        id: userId,
        email,
        company_name: companyName,
        store_licenses: storeLicenses,
        account_status: 'pending'
      }
    });
  } catch (error) {
    console.error('❌ Registration error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Login (for both company admins and branch users)
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    // Check if it's a branch user first
    const [branchUsers] = await pool.query('SELECT * FROM branch_users WHERE email = ?', [email]);
    
    if (branchUsers.length > 0) {
      const branchUser = branchUsers[0];
      
      // For branch users, we're using plain text passwords (you can hash these later)
      if (branchUser.password !== password) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      
      if (branchUser.status !== 'active') {
        return res.status(401).json({ error: 'Your account is inactive. Please contact your administrator.' });
      }
      
      // Generate token
      const token = jwt.sign(
        { userId: branchUser.id, email: branchUser.email, role: 'branch_user' },
        JWT_SECRET,
        { expiresIn: '7d' }
      );
      
      console.log('✅ Branch user login successful:', email);
      
      return res.json({
        success: true,
        user: {
          id: branchUser.id,
          email: branchUser.email,
          user_metadata: {
            name: branchUser.name,
            role: branchUser.role,
            company_id: branchUser.company_id,
            assigned_store: branchUser.assigned_store
          }
        },
        session: {
          access_token: token,
          user: {
            id: branchUser.id,
            email: branchUser.email
          }
        },
        isBranchUser: true
      });
    }
    
    // Check if it's a company admin
    const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    
    if (users.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    const user = users[0];
    
    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    // Check account status
    if (user.account_status === 'pending') {
      return res.status(403).json({ 
        error: 'Your account is pending approval. Please wait for admin to approve your account.' 
      });
    }
    
    if (user.account_status === 'expired') {
      return res.status(403).json({ 
        error: 'Your subscription has expired. Please contact support to renew your account.' 
      });
    }
    
    if (user.account_status === 'banned') {
      return res.status(403).json({ 
        error: 'Your account has been suspended. Please contact support for assistance.' 
      });
    }
    
    if (user.account_status !== 'active') {
      return res.status(403).json({ 
        error: 'Your account is not active. Please contact support.' 
      });
    }
    
    // Generate token
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: 'admin' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    console.log('✅ Admin login successful:', email);
    
    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        user_metadata: {
          company_name: user.company_name
        }
      },
      session: {
        access_token: token,
        user: {
          id: user.id,
          email: user.email
        }
      },
      isBranchUser: false
    });
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Superadmin login
app.post('/auth/superadmin-login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    // Check superadmin table
    const [superadmins] = await pool.query('SELECT * FROM superadmin WHERE email = ?', [email]);
    
    if (superadmins.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    const superadmin = superadmins[0];
    
    // Verify password
    const isValidPassword = await bcrypt.compare(password, superadmin.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    // Generate token
    const token = jwt.sign(
      { userId: superadmin.id, email: superadmin.email, role: 'superadmin' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    console.log('✅ Superadmin login successful:', email);
    
    res.json({
      success: true,
      user: {
        id: superadmin.id,
        email: superadmin.email,
        user_metadata: {
          role: 'superadmin'
        }
      },
      session: {
        access_token: token,
        user: {
          id: superadmin.id,
          email: superadmin.email
        }
      },
      isSuperAdmin: true
    });
  } catch (error) {
    console.error('❌ Superadmin login error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// USERS API (Company Admins)
// ========================================

// Get all users
app.get('/users', async (req, res) => {
  try {
    const [users] = await pool.query(
      'SELECT id, email, company_name, store_licenses, stores_created, account_status, created_at, subscription_start, subscription_end FROM users ORDER BY created_at DESC'
    );
    console.log('📊 Fetching all users:', users.length);
    res.json(users);
  } catch (error) {
    console.error('❌ Error fetching users:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get user by ID
app.get('/users/:id', async (req, res) => {
  try {
    const [users] = await pool.query(
      'SELECT id, email, company_name, store_licenses, stores_created, account_status, created_at, subscription_start, subscription_end FROM users WHERE id = ?',
      [req.params.id]
    );
    
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    console.log('👤 Fetching user:', req.params.id);
    res.json(users[0]);
  } catch (error) {
    console.error('❌ Error fetching user:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update user
app.put('/users/:id', async (req, res) => {
  try {
    const updates = req.body;
    const allowedFields = ['company_name', 'store_licenses', 'account_status', 'subscription_start', 'subscription_end'];
    
    const updateFields = [];
    const updateValues = [];
    
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        updateFields.push(`${field} = ?`);
        updateValues.push(updates[field]);
      }
    }
    
    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    
    updateValues.push(req.params.id);
    
    await pool.query(
      `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );
    
    const [updatedUser] = await pool.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
    
    console.log('✅ User updated:', req.params.id);
    res.json(updatedUser[0]);
  } catch (error) {
    console.error('❌ Error updating user:', error);
    res.status(500).json({ error: error.message });
  }
});

// Approve user
app.post('/users/:id/approve', async (req, res) => {
  try {
    const subscriptionStart = new Date();
    const subscriptionEnd = new Date(subscriptionStart);
    subscriptionEnd.setDate(subscriptionEnd.getDate() + 30);
    
    // Update user status to active
    await pool.query(
      `UPDATE users SET account_status = 'active', subscription_start = ?, subscription_end = ? WHERE id = ?`,
      [subscriptionStart, subscriptionEnd, req.params.id]
    );
    
    // Get the user info to create company profile
    const [users] = await pool.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
    const user = users[0];
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if company_profiles record already exists
    const [existingProfiles] = await pool.query(
      'SELECT id FROM company_profiles WHERE user_id = ?',
      [req.params.id]
    );
    
    // Create company_profiles record if it doesn't exist
    if (existingProfiles.length === 0) {
      await pool.query(
        `INSERT INTO company_profiles (user_id, company_name, email, phone, address, city, country) 
         VALUES (?, ?, ?, '', '', '', '')`,
        [req.params.id, user.company_name, user.email]
      );
      console.log('✅ Company profile created for user:', req.params.id);
    }
    
    console.log('✅ User approved:', req.params.id);
    res.json(user);
  } catch (error) {
    console.error('❌ Error approving user:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete user
app.delete('/users/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    
    console.log('🗑️ Starting user deletion process for:', userId);
    
    // Helper function to safely delete from table if it exists
    const safeDelete = async (tableName, column, value) => {
      try {
        // Check if table exists
        const [tables] = await pool.query(
          "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
          [tableName]
        );
        
        if (tables.length > 0) {
          await pool.query(`DELETE FROM ${tableName} WHERE ${column} = ?`, [value]);
          console.log(`✅ Deleted from ${tableName}`);
        } else {
          console.log(`⚠️ Table ${tableName} does not exist, skipping...`);
        }
      } catch (error) {
        console.error(`⚠️ Error deleting from ${tableName}:`, error.message);
        // Continue with other deletions even if one fails
      }
    };
    
    // Delete in the correct order to avoid foreign key constraints
    await safeDelete('company_profiles', 'user_id', userId);
    await safeDelete('branch_users', 'company_id', userId);
    await safeDelete('stores', 'user_id', userId);
    await safeDelete('playlists', 'user_id', userId);
    await safeDelete('announcements', 'user_id', userId);
    await safeDelete('songs', 'user_id', userId);
    await safeDelete('music', 'user_id', userId); // Try both table names
    
    // Finally delete the user
    await pool.query('DELETE FROM users WHERE id = ?', [userId]);
    console.log('✅ User deleted:', userId);
    
    res.json({ success: true, message: 'User and all associated data deleted successfully' });
  } catch (error) {
    console.error('❌ Error deleting user:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// COMPANY PROFILES API
// ========================================

// Get profile by user ID
app.get('/profiles/:userId', async (req, res) => {
  try {
    const [profiles] = await pool.query('SELECT * FROM company_profiles WHERE user_id = ?', [req.params.userId]);
    
    if (profiles.length === 0) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    
    res.json(profiles[0]);
  } catch (error) {
    console.error('❌ Error fetching profile:', error);
    res.status(500).json({ error: error.message });
  }
});

// Save/update profile
app.post('/profiles', async (req, res) => {
  try {
    const profile = req.body;
    
    console.log('📝 Received profile save request for user:', profile.user_id);
    console.log('📝 Profile data:', profile);
    
    // Validate required fields
    if (!profile.user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }
    
    // Check if profile exists
    const [existing] = await pool.query('SELECT id FROM company_profiles WHERE user_id = ?', [profile.user_id]);
    
    if (existing.length > 0) {
      // Update existing profile
      console.log('🔄 Updating existing profile');
      await pool.query(
        `UPDATE company_profiles SET company_name = ?, email = ?, phone = ?, address = ?, city = ?, country = ?, contact_person = ?, logo_url = ? WHERE user_id = ?`,
        [profile.company_name, profile.email, profile.phone, profile.address, profile.city, profile.country, profile.contact_person, profile.logo_url || null, profile.user_id]
      );
    } else {
      // Insert new profile
      console.log('➕ Creating new profile');
      await pool.query(
        `INSERT INTO company_profiles (user_id, company_name, email, phone, address, city, country, contact_person, logo_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [profile.user_id, profile.company_name, profile.email, profile.phone, profile.address, profile.city, profile.country, profile.contact_person, profile.logo_url || null]
      );
    }
    
    const [updatedProfile] = await pool.query('SELECT * FROM company_profiles WHERE user_id = ?', [profile.user_id]);
    console.log('✅ Profile saved successfully:', profile.company_name);
    res.json({ success: true, profile: updatedProfile[0] });
  } catch (error) {
    console.error('❌ Error saving profile:', error);
    console.error('❌ Error details:', error.message);
    console.error('❌ SQL State:', error.sqlState);
    console.error('❌ SQL Message:', error.sqlMessage);
    res.status(500).json({ error: error.message || 'Failed to save profile' });
  }
});

// ========================================
// STORES API
// ========================================

// Get stores by user ID
app.get('/stores', async (req, res) => {
  try {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }
    
    const [stores] = await pool.query('SELECT * FROM stores WHERE user_id = ? ORDER BY created_at DESC', [userId]);
    console.log('📍 Fetching stores for user:', userId, '- Count:', stores.length);
    res.json(stores);
  } catch (error) {
    console.error('❌ Error fetching stores:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create store
app.post('/stores', async (req, res) => {
  try {
    const { user_id, name, address, branch_code } = req.body;
    const storeId = generateShortId();
    
    await pool.query(
      'INSERT INTO stores (id, user_id, name, address, branch_code) VALUES (?, ?, ?, ?, ?)',
      [storeId, user_id, name, address, branch_code]
    );
    
    // Update stores_created count
    await pool.query('UPDATE users SET stores_created = stores_created + 1 WHERE id = ?', [user_id]);
    
    const [newStore] = await pool.query('SELECT * FROM stores WHERE id = ?', [storeId]);
    console.log('💾 Store created:', name);
    res.json(newStore[0]);
  } catch (error) {
    console.error('❌ Error creating store:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update store
app.put('/stores/:id', async (req, res) => {
  try {
    const { userId } = req.query;
    const { name, address, branch_code } = req.body;
    
    await pool.query(
      'UPDATE stores SET name = ?, address = ?, branch_code = ? WHERE id = ? AND user_id = ?',
      [name, address, branch_code, req.params.id, userId]
    );
    
    const [updatedStore] = await pool.query('SELECT * FROM stores WHERE id = ?', [req.params.id]);
    console.log('✏️ Store updated:', name);
    res.json(updatedStore[0]);
  } catch (error) {
    console.error('❌ Error updating store:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete store
app.delete('/stores/:id', async (req, res) => {
  try {
    const { userId } = req.query;
    
    await pool.query('DELETE FROM stores WHERE id = ? AND user_id = ?', [req.params.id, userId]);
    await pool.query('UPDATE users SET stores_created = GREATEST(stores_created - 1, 0) WHERE id = ?', [userId]);
    
    console.log('🗑️ Store deleted:', req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error deleting store:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// SONGS API
// ========================================

// Get songs by user ID
app.get('/songs', async (req, res) => {
  try {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }
    
    const [songs] = await pool.query('SELECT * FROM songs WHERE user_id = ? ORDER BY uploaded_at DESC', [userId]);
    console.log('🎵 Fetching songs for user:', userId, '- Count:', songs.length);
    res.json(songs);
  } catch (error) {
    console.error('❌ Error fetching songs:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create song
app.post('/songs', async (req, res) => {
  try {
    const { user_id, name, artist, file_size, file_url, duration } = req.body;
    const songId = generateShortId();
    
    await pool.query(
      'INSERT INTO songs (id, user_id, name, artist, file_size, file_url, duration) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [songId, user_id, name, artist || null, file_size, file_url, duration || null]
    );
    
    const [newSong] = await pool.query('SELECT * FROM songs WHERE id = ?', [songId]);
    console.log('💾 Song created:', name);
    res.json(newSong[0]);
  } catch (error) {
    console.error('❌ Error creating song:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete song
app.delete('/songs/:id', async (req, res) => {
  try {
    const { userId } = req.query;
    
    await pool.query('DELETE FROM songs WHERE id = ? AND user_id = ?', [req.params.id, userId]);
    console.log('🗑️ Song deleted:', req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error deleting song:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// PLAYLISTS API
// ========================================

// Get playlists by user ID
app.get('/playlists', async (req, res) => {
  try {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }
    
    const [playlists] = await pool.query('SELECT * FROM playlists WHERE user_id = ? ORDER BY created_at DESC', [userId]);
    
    // Get active stores for each playlist
    for (const playlist of playlists) {
      const [activations] = await pool.query(
        'SELECT store_id FROM playlist_store_activation WHERE playlist_id = ? AND is_active = TRUE',
        [playlist.id]
      );
      playlist.active_stores = activations.map(a => a.store_id);
      
      // Get songs in playlist
      const [playlistSongs] = await pool.query(
        `SELECT s.* FROM songs s 
         INNER JOIN playlist_songs ps ON s.id = ps.song_id 
         WHERE ps.playlist_id = ? 
         ORDER BY ps.position`,
        [playlist.id]
      );
      playlist.songs = playlistSongs;
    }
    
    console.log('🎵 Fetching playlists for user:', userId, '- Count:', playlists.length);
    res.json(playlists);
  } catch (error) {
    console.error('❌ Error fetching playlists:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create playlist
app.post('/playlists', async (req, res) => {
  try {
    const { user_id, name, description, shuffle, songs = [] } = req.body;
    const playlistId = generateShortId();
    
    await pool.query(
      'INSERT INTO playlists (id, user_id, name, description, shuffle) VALUES (?, ?, ?, ?, ?)',
      [playlistId, user_id, name, description || null, shuffle || false]
    );
    
    // Add songs to playlist
    for (let i = 0; i < songs.length; i++) {
      await pool.query(
        'INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES (?, ?, ?)',
        [playlistId, songs[i], i]
      );
    }
    
    const [newPlaylist] = await pool.query('SELECT * FROM playlists WHERE id = ?', [playlistId]);
    console.log('💾 Playlist created:', name);
    res.json(newPlaylist[0]);
  } catch (error) {
    console.error('❌ Error creating playlist:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update playlist
app.put('/playlists/:id', async (req, res) => {
  try {
    const { userId } = req.query;
    const updates = req.body;
    
    const allowedFields = ['name', 'description', 'shuffle', 'active_stores'];
    const updateFields = [];
    const updateValues = [];
    
    for (const field of allowedFields) {
      if (updates[field] !== undefined && field !== 'active_stores') {
        updateFields.push(`${field} = ?`);
        updateValues.push(updates[field]);
      }
    }
    
    if (updateFields.length > 0) {
      updateValues.push(req.params.id, userId);
      await pool.query(
        `UPDATE playlists SET ${updateFields.join(', ')} WHERE id = ? AND user_id = ?`,
        updateValues
      );
    }
    
    // Handle active_stores update
    if (updates.active_stores !== undefined) {
      // Remove all existing activations
      await pool.query('DELETE FROM playlist_store_activation WHERE playlist_id = ?', [req.params.id]);
      
      // Add new activations
      for (const storeId of updates.active_stores) {
        await pool.query(
          'INSERT INTO playlist_store_activation (playlist_id, store_id, user_id) VALUES (?, ?, ?)',
          [req.params.id, storeId, userId]
        );
      }
    }
    
    const [updatedPlaylist] = await pool.query('SELECT * FROM playlists WHERE id = ?', [req.params.id]);
    console.log('✅ Playlist updated:', req.params.id);
    res.json(updatedPlaylist[0]);
  } catch (error) {
    console.error('❌ Error updating playlist:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete playlist
app.delete('/playlists/:id', async (req, res) => {
  try {
    const { userId } = req.query;
    
    await pool.query('DELETE FROM playlists WHERE id = ? AND user_id = ?', [req.params.id, userId]);
    console.log('🗑️ Playlist deleted:', req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error deleting playlist:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// TIME SLOTS API
// ========================================

// Get time slots
app.get('/timeslots', async (req, res) => {
  try {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }
    
    const [timeSlots] = await pool.query(
      'SELECT * FROM time_slots WHERE user_id = ? ORDER BY start_time',
      [userId]
    );
    
    // Parse JSON days_of_week field
    timeSlots.forEach(slot => {
      if (slot.days_of_week) {
        slot.days_of_week = JSON.parse(slot.days_of_week);
      }
    });
    
    console.log('⏰ Fetching time slots for user:', userId, '- Count:', timeSlots.length);
    res.json(timeSlots);
  } catch (error) {
    console.error('❌ Error fetching time slots:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create time slot
app.post('/timeslots', async (req, res) => {
  try {
    const { user_id, playlist_id, playlist_name, start_time, end_time, days_of_week, is_24_hours } = req.body;
    
    // Validate 24-hour rule
    if (is_24_hours) {
      const [existing24Hr] = await pool.query(
        'SELECT id FROM time_slots WHERE user_id = ? AND is_24_hours = TRUE',
        [user_id]
      );
      
      if (existing24Hr.length > 0) {
        return res.status(400).json({
          error: 'Only one playlist can be set to 24 hours. Please remove the existing 24-hour playlist first.'
        });
      }
    }
    
    const timeSlotId = generateShortId();
    
    await pool.query(
      'INSERT INTO time_slots (id, user_id, playlist_id, playlist_name, start_time, end_time, days_of_week, is_24_hours) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [timeSlotId, user_id, playlist_id, playlist_name, start_time, end_time, JSON.stringify(days_of_week), is_24_hours || false]
    );
    
    const [newTimeSlot] = await pool.query('SELECT * FROM time_slots WHERE id = ?', [timeSlotId]);
    if (newTimeSlot[0].days_of_week) {
      newTimeSlot[0].days_of_week = JSON.parse(newTimeSlot[0].days_of_week);
    }
    
    console.log('💾 Time slot created:', start_time, '-', end_time);
    res.json(newTimeSlot[0]);
  } catch (error) {
    console.error('❌ Error creating time slot:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update time slot
app.put('/timeslots/:id', async (req, res) => {
  try {
    const { userId } = req.query;
    const updates = req.body;
    
    const allowedFields = ['playlist_id', 'playlist_name', 'start_time', 'end_time', 'days_of_week', 'is_24_hours'];
    const updateFields = [];
    const updateValues = [];
    
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        if (field === 'days_of_week') {
          updateFields.push(`${field} = ?`);
          updateValues.push(JSON.stringify(updates[field]));
        } else {
          updateFields.push(`${field} = ?`);
          updateValues.push(updates[field]);
        }
      }
    }
    
    if (updateFields.length > 0) {
      updateValues.push(req.params.id, userId);
      await pool.query(
        `UPDATE time_slots SET ${updateFields.join(', ')} WHERE id = ? AND user_id = ?`,
        updateValues
      );
    }
    
    const [updatedSlot] = await pool.query('SELECT * FROM time_slots WHERE id = ?', [req.params.id]);
    if (updatedSlot[0].days_of_week) {
      updatedSlot[0].days_of_week = JSON.parse(updatedSlot[0].days_of_week);
    }
    
    console.log('✅ Time slot updated:', req.params.id);
    res.json(updatedSlot[0]);
  } catch (error) {
    console.error('❌ Error updating time slot:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete time slot
app.delete('/timeslots/:id', async (req, res) => {
  try {
    const { userId } = req.query;
    
    await pool.query('DELETE FROM time_slots WHERE id = ? AND user_id = ?', [req.params.id, userId]);
    console.log('🗑️ Time slot deleted:', req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error deleting time slot:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// BRANCH USERS API
// ========================================

// Get branch users by company
app.get('/branch-users', async (req, res) => {
  try {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }
    
    const [branchUsers] = await pool.query(
      'SELECT * FROM branch_users WHERE company_id = ? ORDER BY created_at DESC',
      [userId]
    );
    
    console.log('👥 Fetching branch users for company:', userId, '- Count:', branchUsers.length);
    res.json(branchUsers);
  } catch (error) {
    console.error('❌ Error fetching branch users:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create branch user
app.post('/branch-users', async (req, res) => {
  try {
    const { company_id, name, email, password, role, assigned_store, status } = req.body;
    const userId = generateShortId();
    
    await pool.query(
      'INSERT INTO branch_users (id, company_id, name, email, password, role, assigned_store, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [userId, company_id, name, email, password, role || 'branch_user', assigned_store || null, status || 'active']
    );
    
    const [newUser] = await pool.query('SELECT * FROM branch_users WHERE id = ?', [userId]);
    console.log('💾 Branch user created:', name);
    res.json(newUser[0]);
  } catch (error) {
    console.error('❌ Error creating branch user:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update branch user
app.put('/branch-users/:id', async (req, res) => {
  try {
    const { companyId } = req.query;
    const updates = req.body;
    
    const allowedFields = ['name', 'email', 'password', 'role', 'assigned_store', 'status'];
    const updateFields = [];
    const updateValues = [];
    
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        updateFields.push(`${field} = ?`);
        updateValues.push(updates[field]);
      }
    }
    
    if (updateFields.length > 0) {
      updateValues.push(req.params.id, companyId);
      await pool.query(
        `UPDATE branch_users SET ${updateFields.join(', ')} WHERE id = ? AND company_id = ?`,
        updateValues
      );
    }
    
    const [updatedUser] = await pool.query('SELECT * FROM branch_users WHERE id = ?', [req.params.id]);
    console.log('✅ Branch user updated:', req.params.id);
    res.json(updatedUser[0]);
  } catch (error) {
    console.error('❌ Error updating branch user:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete branch user
app.delete('/branch-users/:id', async (req, res) => {
  try {
    const { companyId } = req.query;
    
    await pool.query('DELETE FROM branch_users WHERE id = ? AND company_id = ?', [req.params.id, companyId]);
    console.log('🗑️ Branch user deleted:', req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error deleting branch user:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// ANNOUNCEMENTS API
// ========================================

// Get announcements
app.get('/announcements', async (req, res) => {
  try {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }
    
    const [announcements] = await pool.query(
      'SELECT * FROM announcements WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );
    
    console.log('📢 Fetching announcements for user:', userId, '- Count:', announcements.length);
    res.json(announcements);
  } catch (error) {
    console.error('❌ Error fetching announcements:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create announcement
app.post('/announcements', async (req, res) => {
  try {
    const { user_id, title, audio_url, interval_minutes, volume, enabled } = req.body;
    const announcementId = generateShortId();
    
    await pool.query(
      'INSERT INTO announcements (id, user_id, title, audio_url, interval_minutes, volume, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [announcementId, user_id, title, audio_url, interval_minutes || 30, volume || 100, enabled !== false]
    );
    
    const [newAnnouncement] = await pool.query('SELECT * FROM announcements WHERE id = ?', [announcementId]);
    console.log('💾 Announcement created:', title);
    res.json(newAnnouncement[0]);
  } catch (error) {
    console.error('❌ Error creating announcement:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update announcement
app.put('/announcements/:id', async (req, res) => {
  try {
    const { userId } = req.query;
    const updates = req.body;
    
    const allowedFields = ['title', 'audio_url', 'interval_minutes', 'volume', 'enabled'];
    const updateFields = [];
    const updateValues = [];
    
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        updateFields.push(`${field} = ?`);
        updateValues.push(updates[field]);
      }
    }
    
    if (updateFields.length > 0) {
      updateValues.push(req.params.id, userId);
      await pool.query(
        `UPDATE announcements SET ${updateFields.join(', ')} WHERE id = ? AND user_id = ?`,
        updateValues
      );
    }
    
    const [updatedAnnouncement] = await pool.query('SELECT * FROM announcements WHERE id = ?', [req.params.id]);
    console.log('✅ Announcement updated:', req.params.id);
    res.json(updatedAnnouncement[0]);
  } catch (error) {
    console.error('❌ Error updating announcement:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete announcement
app.delete('/announcements/:id', async (req, res) => {
  try {
    const { userId } = req.query;
    
    await pool.query('DELETE FROM announcements WHERE id = ? AND user_id = ?', [req.params.id, userId]);
    console.log('🗑️ Announcement deleted:', req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error deleting announcement:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// SYSTEM SETTINGS API
// ========================================

// Get all settings
app.get('/settings', async (req, res) => {
  try {
    const [settings] = await pool.query('SELECT * FROM system_settings');
    const settingsObj = {};
    settings.forEach(s => {
      settingsObj[s.setting_key] = s.setting_value;
    });
    res.json(settingsObj);
  } catch (error) {
    console.error('❌ Error fetching settings:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update setting
app.put('/settings/:key', async (req, res) => {
  try {
    const { value } = req.body;
    
    await pool.query(
      'INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
      [req.params.key, value, value]
    );
    
    res.json({ success: true, key: req.params.key, value });
  } catch (error) {
    console.error('❌ Error updating setting:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// Error Handler
// ========================================
app.use((err, req, res, next) => {
  console.error('❌ Server error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// ========================================
// Start Server
// ========================================
app.listen(PORT, () => {
  console.log(`\n🎵 Pearl Radio Station MySQL Backend`);
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 Database: ${process.env.DB_NAME || 'pearl_radio'}`);
  console.log(`⏰ Started at: ${new Date().toISOString()}\n`);
});

module.exports = app;