// Pearl Radio Station - SuperAdmin Initialization Script
// This script creates the superadmin user in the database

const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function initializeSuperAdmin() {
  console.log('========================================');
  console.log('Pearl Radio Station - SuperAdmin Setup');
  console.log('========================================\n');

  let connection;

  try {
    // Connect to MySQL
    console.log('📡 Connecting to MySQL database...');
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'pearl_radio',
    });
    console.log('✅ Connected to MySQL\n');

    // Check if superadmin already exists
    console.log('🔍 Checking for existing superadmin...');
    const [existingUsers] = await connection.query(
      'SELECT id FROM users WHERE email = ?',
      ['superadmin@pearl-solution.com']
    );

    if (existingUsers.length > 0) {
      console.log('⚠️  SuperAdmin already exists!');
      console.log('   Email: superadmin@pearl-solution.com');
      console.log('   Password: superadmin123');
      console.log('\n✅ You can now login with these credentials\n');
      await connection.end();
      return;
    }

    // Hash password
    console.log('🔐 Hashing password...');
    const passwordHash = await bcrypt.hash('superadmin123', 10);
    console.log('✅ Password hashed\n');

    // Insert superadmin user
    console.log('💾 Creating SuperAdmin account...');
    await connection.query(
      `INSERT INTO users (
        id, 
        email, 
        password_hash, 
        company_name, 
        store_licenses, 
        stores_created,
        account_status,
        subscription_start,
        subscription_end
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'superadmin',
        'superadmin@pearl-solution.com',
        passwordHash,
        'Pearl Solution Inc.',
        999,
        0,
        'active',
        new Date(),
        new Date('2099-12-31')
      ]
    );

    console.log('✅ SuperAdmin created successfully!\n');
    console.log('========================================');
    console.log('SuperAdmin Login Credentials:');
    console.log('========================================');
    console.log('Email:    superadmin@pearl-solution.com');
    console.log('Password: superadmin123');
    console.log('========================================\n');
    console.log('🎉 You can now start the server and login!');
    console.log('   Run: npm start\n');

    await connection.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('\nPlease ensure:');
    console.error('  1. MySQL server is running');
    console.error('  2. Database "pearl_radio" exists');
    console.error('  3. .env file has correct database credentials');
    console.error('  4. Schema has been imported (mysql-schema.sql)\n');
    
    if (connection) {
      await connection.end();
    }
    process.exit(1);
  }
}

// Run the initialization
initializeSuperAdmin();
