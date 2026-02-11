const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../db');

/**
 * Admin authentication middleware
 */
function requireAdmin(req, res, next) {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) {
    return res.status(500).json({ error: 'ADMIN_KEY not configured' });
  }

  const providedKey = req.headers['x-admin-key'];
  if (!providedKey || providedKey !== adminKey) {
    return res.status(401).json({ error: 'Unauthorized. Provide X-Admin-Key header or ?key= query param.' });
  }

  next();
}

/**
 * GET /admin/backup — JSON dump of all data
 */
router.get('/backup', requireAdmin, (req, res) => {
  try {
    const dump = db.fullDump();
    res.json(dump);
  } catch (error) {
    console.error('Backup error:', error);
    res.status(500).json({ error: 'Failed to create backup' });
  }
});

/**
 * GET /admin/backup/sqlite — Raw SQLite file download
 */
router.get('/backup/sqlite', requireAdmin, (req, res) => {
  try {
    const dbPath = db.getDbPath();
    if (!fs.existsSync(dbPath)) {
      return res.status(404).json({ error: 'Database file not found' });
    }

    res.setHeader('Content-Type', 'application/x-sqlite3');
    res.setHeader('Content-Disposition', `attachment; filename="verify-backup-${Date.now()}.db"`);
    const stream = fs.createReadStream(dbPath);
    stream.pipe(res);
  } catch (error) {
    console.error('SQLite backup error:', error);
    res.status(500).json({ error: 'Failed to download database' });
  }
});

module.exports = router;
