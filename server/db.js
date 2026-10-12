// Opens the SQLite database (one file) and makes sure the tables exist.
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'db', 'ridebuddy.db');
const SCHEMA_PATH = path.join(__dirname, '..', 'db', 'schema.sql');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON'); // SQLite ignores foreign keys unless this is on

// Create tables if they don't exist yet
db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));

module.exports = db;
