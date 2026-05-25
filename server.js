require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const ValidatorRunner = require('./validators/runner');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const originalName = path.parse(file.originalname).name;
    const ext = path.extname(file.originalname);
    cb(null, `${originalName}-${timestamp}${ext}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    // Only accept .xlsx files
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        file.mimetype === 'application/vnd.ms-excel' ||
        file.originalname.endsWith('.xlsx')) {
      cb(null, true);
    } else {
      cb(new Error('Only .xlsx files are allowed'), false);
    }
  },
  limits: {
    fileSize: 20 * 1024 * 1024 // 20 MB
  }
});

/**
 * Main page - serves the HTML interface
 */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'fm-validator.html'));
});

/**
 * Also serve at /fm-validator for website integration
 */
app.get('/fm-validator', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'fm-validator.html'));
});

/**
 * Upload endpoint - accepts file and returns validator results
 * POST /api/validate
 */
app.post('/api/validate', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        status: 'error',
        message: 'No file uploaded'
      });
    }

    // Run validator on uploaded file
    const validator = new ValidatorRunner();
    const filePath = req.file.path;
    const results = validator.validate(filePath);

    // Add upload metadata
    results.uploadedFile = {
      originalName: req.file.originalname,
      size: req.file.size,
      uploadedAt: new Date().toISOString()
    };

    // Send results
    res.json({
      status: 'success',
      data: results
    });

    // Clean up uploaded file after processing (optional)
    // fs.unlink(filePath, err => {
    //   if (err) console.error('Failed to delete file:', err);
    // });

  } catch (error) {
    console.error('Validation error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Validation failed'
    });
  }
});

/**
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

/**
 * Get available checklists
 */
app.get('/api/checklists', (req, res) => {
  try {
    const checklistsDir = path.join(__dirname, 'checklists');
    const config = JSON.parse(fs.readFileSync(path.join(checklistsDir, 'config.json'), 'utf-8'));
    
    res.json({
      status: 'success',
      data: config.availableChecklists || []
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Failed to load checklists'
    });
  }
});

/**
 * Get validation results history (optional - for demo purposes)
 */
const validationHistory = [];

app.get('/api/history', (req, res) => {
  res.json({
    status: 'success',
    data: validationHistory
  });
});

/**
 * Error handler middleware
 */
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        status: 'error',
        message: 'File size exceeds 20 MB limit'
      });
    }
  }

  res.status(error.status || 500).json({
    status: 'error',
    message: error.message || 'Internal server error'
  });
});

/**
 * 404 handler
 */
app.use((req, res) => {
  res.status(404).json({
    status: 'error',
    message: 'Endpoint not found'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Financial Model Validator server running on http://localhost:${PORT}`);
});

module.exports = app;
