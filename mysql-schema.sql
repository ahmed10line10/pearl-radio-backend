-- ========================================
-- Pearl Radio Station MySQL Database Schema
-- Version 1.0 - MySQL 5.7+ / MariaDB 10.2+
-- ========================================
-- 
-- SETUP INSTRUCTIONS:
-- 1. Create a new MySQL database: CREATE DATABASE pearl_radio CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- 2. Run this script: mysql -u your_username -p pearl_radio < mysql-schema.sql
-- 3. Update the backend configuration with your MySQL credentials
-- ========================================

-- Drop existing tables if they exist (for clean setup)
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS playlist_songs;
DROP TABLE IF EXISTS playlist_store_activation;
DROP TABLE IF EXISTS time_slots;
DROP TABLE IF EXISTS playlists;
DROP TABLE IF EXISTS announcements;
DROP TABLE IF EXISTS songs;
DROP TABLE IF EXISTS branch_users;
DROP TABLE IF EXISTS stores;
DROP TABLE IF EXISTS company_profiles;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS system_settings;
DROP TABLE IF EXISTS superadmin;
SET FOREIGN_KEY_CHECKS = 1;

-- ========================================
-- 1. SUPER ADMIN TABLE
-- ========================================
CREATE TABLE superadmin (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  username VARCHAR(100) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert default superadmin
-- Email: superadmin@pearl-solution.com
-- Password: superadmin123
INSERT INTO superadmin (id, username, email, password_hash) VALUES 
('superadmin-001', 'superadmin', 'superadmin@pearl-solution.com', '$2a$10$rVZvQN.R7xVh7VJBxw/t8eDqPQGYFvM8RbFVGYKL4xWVGYKL4xWVGY');

-- ========================================
-- 2. USERS TABLE (Company Admins)
-- ========================================
CREATE TABLE users (
  id VARCHAR(36) PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  company_name VARCHAR(255) NOT NULL,
  store_licenses INT NOT NULL DEFAULT 10,
  stores_created INT NOT NULL DEFAULT 0,
  account_status ENUM('pending', 'active', 'expired', 'banned') NOT NULL DEFAULT 'pending',
  subscription_start TIMESTAMP NULL,
  subscription_end TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email (email),
  INDEX idx_status (account_status),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- 3. COMPANY PROFILES TABLE
-- ========================================
CREATE TABLE company_profiles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(36) UNIQUE NOT NULL,
  company_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  address TEXT,
  city VARCHAR(100),
  country VARCHAR(100) DEFAULT 'Iraq',
  contact_person VARCHAR(255),
  logo_url TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- 4. STORES TABLE
-- ========================================
CREATE TABLE stores (
  id VARCHAR(50) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  address TEXT,
  branch_code VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_id (user_id),
  INDEX idx_branch_code (branch_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- 5. SONGS TABLE
-- ========================================
CREATE TABLE songs (
  id VARCHAR(50) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  artist VARCHAR(255),
  file_size BIGINT NOT NULL,
  file_url TEXT NOT NULL,
  duration INT, -- in seconds
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_id (user_id),
  INDEX idx_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- 6. PLAYLISTS TABLE
-- ========================================
CREATE TABLE playlists (
  id VARCHAR(50) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  shuffle BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_id (user_id),
  INDEX idx_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- 7. PLAYLIST SONGS TABLE (Many-to-Many)
-- ========================================
CREATE TABLE playlist_songs (
  playlist_id VARCHAR(50) NOT NULL,
  song_id VARCHAR(50) NOT NULL,
  position INT NOT NULL DEFAULT 0,
  PRIMARY KEY (playlist_id, song_id),
  FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
  FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
  INDEX idx_position (position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- 8. PLAYLIST STORE ACTIVATION TABLE
-- ========================================
CREATE TABLE playlist_store_activation (
  id INT AUTO_INCREMENT PRIMARY KEY,
  playlist_id VARCHAR(50) NOT NULL,
  store_id VARCHAR(50) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  activated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_playlist_store (playlist_id, store_id),
  FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_playlist_id (playlist_id),
  INDEX idx_store_id (store_id),
  INDEX idx_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- 9. TIME SLOTS TABLE (Time-based scheduling)
-- ========================================
CREATE TABLE time_slots (
  id VARCHAR(50) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  playlist_id VARCHAR(50) NOT NULL,
  playlist_name VARCHAR(255) NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  days_of_week JSON, -- Array of day numbers: [0=Sunday, 1=Monday, ..., 6=Saturday]
  is_24_hours BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
  INDEX idx_user_id (user_id),
  INDEX idx_playlist_id (playlist_id),
  INDEX idx_time_range (start_time, end_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- 10. ANNOUNCEMENTS TABLE
-- ========================================
CREATE TABLE announcements (
  id VARCHAR(50) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  title VARCHAR(255) NOT NULL,
  audio_url TEXT NOT NULL,
  interval_minutes INT NOT NULL DEFAULT 30,
  volume INT NOT NULL DEFAULT 100,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_id (user_id),
  INDEX idx_enabled (enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- 11. BRANCH USERS TABLE
-- ========================================
CREATE TABLE branch_users (
  id VARCHAR(50) PRIMARY KEY,
  company_id VARCHAR(36) NOT NULL, -- References users.id (the company admin)
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL, -- Plain text for now (can be hashed later)
  role ENUM('branch_user', 'branch_manager') DEFAULT 'branch_user',
  assigned_store VARCHAR(50), -- References stores.id
  status ENUM('active', 'inactive') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_store) REFERENCES stores(id) ON DELETE SET NULL,
  INDEX idx_company_id (company_id),
  INDEX idx_email (email),
  INDEX idx_assigned_store (assigned_store)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- 12. SYSTEM SETTINGS TABLE
-- ========================================
CREATE TABLE system_settings (
  setting_key VARCHAR(100) PRIMARY KEY,
  setting_value TEXT,
  description VARCHAR(255),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert default system settings
INSERT INTO system_settings (setting_key, setting_value, description) VALUES
('maintenance_mode', 'false', 'Enable/disable maintenance mode'),
('maintenance_message', 'System is currently under maintenance. Please check back later.', 'Message shown during maintenance'),
('app_name', 'Pearl Radio Station', 'Application name'),
('company_name', 'Pearl-Solution.com Inc.', 'Company name'),
('subscription_price', '11', 'Monthly subscription price in USD'),
('max_song_size_mb', '50', 'Maximum song file size in MB'),
('default_store_licenses', '10', 'Default number of store licenses per account');

-- ========================================
-- VERIFICATION QUERIES
-- ========================================
-- Run these to verify the setup:

-- Check all tables were created
SELECT TABLE_NAME, TABLE_ROWS 
FROM INFORMATION_SCHEMA.TABLES 
WHERE TABLE_SCHEMA = DATABASE()
ORDER BY TABLE_NAME;

-- Check system settings
SELECT * FROM system_settings;

-- ========================================
-- SETUP COMPLETE! 🎉
-- ========================================
-- Next steps:
-- 1. Update backend configuration with MySQL credentials
-- 2. Deploy the Node.js/Express backend
-- 3. Test the connection from your application
-- ========================================