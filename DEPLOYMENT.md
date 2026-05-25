# Financial Model Validator - Deployment Guide

## Overview
This is a Node.js/Express application that provides a web interface for validating financial models (Excel files) against a predefined checklist of rules.

## Features
- ✅ HTML-based file upload interface
- ✅ Excel validation against financial checklist
- ✅ Real-time progress tracking
- ✅ Detailed validation reports with pass/fail statistics
- ✅ Support for multiple checklist profiles
- ✅ File size limit: 20 MB
- ✅ Format support: .xlsx only

## System Requirements
- **Node.js**: v14 or higher
- **npm**: v6 or higher
- **Disk space**: 100 MB minimum
- **Port**: 3000 (configurable via .env)

## Installation & Setup

### 1. Deploy Files
Copy the entire project to your web host:
```bash
cp -r fm-validator /path/to/deployment
cd /path/to/deployment
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment
Copy `.env.example` to `.env` and update settings:
```bash
cp .env.example .env
```

Edit `.env`:
```
PORT=3000
NODE_ENV=production
ACTIVE_CHECKLIST=checklist.json
```

### 4. Create Upload Directory
```bash
mkdir -p uploads
chmod 755 uploads
```

### 5. Start Server
```bash
# Development
npm start

# Or with process manager (recommended for production)
pm2 start server.js --name "fm-validator"
```

The application will be available at:
```
http://localhost:3000
```

## Project Structure
```
fm-validator/
├── server.js                 # Express server & API endpoints
├── package.json              # Dependencies
├── .env.example              # Environment configuration template
├── public/
│   └── index.html            # Web interface (HTML + JS)
├── validators/
│   └── runner.js             # Validation engine
├── checklists/
│   ├── checklist.json        # Default validation rules (18 rules)
│   ├── checklist-full.json   # Comprehensive validation (38 rules)
│   └── config.json           # Checklist configuration
└── uploads/                  # Temporary file storage (auto-created)
```

## API Endpoints

### GET /
Returns the main HTML interface.

### POST /api/validate
Upload and validate an Excel file.

**Request:**
- Method: `POST`
- Content-Type: `multipart/form-data`
- File parameter: `file` (.xlsx only, max 20 MB)

**Response:**
```json
{
  "status": "success",
  "data": {
    "timestamp": "2026-05-25T11:07:31.458Z",
    "fileName": "model.xlsx",
    "fileSize": 23738,
    "checklist": "checklist",
    "status": "completed",
    "results": {
      "passed": [...],
      "failed": [...],
      "warnings": [...]
    },
    "stats": {
      "total": 18,
      "passed": 18,
      "failed": 0,
      "passRate": 100
    }
  }
}
```

### GET /api/health
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-05-25T11:06:50.859Z",
  "version": "1.0.0"
}
```

### GET /api/checklists
Get available checklists configuration.

## Validation Process

1. User uploads `.xlsx` file via web interface
2. File is saved to `uploads/` directory
3. Validator engine runs checklist against file
4. Results include:
   - Individual pass/fail for each rule
   - Statistics (total, passed, failed, pass rate)
   - Detailed messages for failures
5. Results displayed in UI with summary report

## Checklists Explained

### checklist.json (18 rules - Active by default)
Core validation for essential financial model integrity:
- **Tier 1 (6 rules)**: Critical structural checks
  - Required sheets present
  - No formula errors
  - Model Issues tab empty
  - Balance sheet check exists
  - Cash flow reconciliation exists
  - No negative PP&E

- **Tier 2 (12 rules)**: Financial integrity
  - Balance sheet reconciliation
  - Cash flow reconciliation
  - Retained earnings flow-through
  - Debt and capex coherence
  - Margin plausibility
  - And 7 more financial checks

### checklist-full.json (38 rules - Optional)
Comprehensive audit-grade validation covering:
- Model purpose & transparency
- Input management
- Formula logic consistency
- All financial reconciliations
- Debt management
- Operations & returns
- Scenarios & sensitivities
- Model integrity & documentation

**To use full checklist:**
Edit `checklists/config.json` and set:
```json
{
  "activeChecklist": "checklist-full.json"
}
```

## Troubleshooting

### Port Already in Use
```bash
# Find process using port 3000
lsof -i :3000

# Change port in .env
PORT=3001
```

### File Upload Fails
- Check file is `.xlsx` format
- Verify file size < 20 MB
- Ensure `uploads/` directory exists and is writable

### Validation Always Passes
- This is normal for new models; validation checks for specific sheet structures
- See results details for which checks passed/failed

### Dependencies Installation Issues
```bash
# Clear npm cache
npm cache clean --force

# Reinstall
rm package-lock.json
npm install
```

## Production Deployment

### Using PM2 (Recommended)
```bash
# Install PM2 globally
npm install -g pm2

# Start application
pm2 start server.js --name "fm-validator" --instances max --exec-mode cluster

# Setup auto-restart on reboot
pm2 startup
pm2 save
```

### Using Docker (Optional)
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

### Using Nginx Reverse Proxy
```nginx
upstream fm_validator {
  server localhost:3000;
}

server {
  listen 80;
  server_name yourdomain.com;

  location / {
    proxy_pass http://fm_validator;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
  }
}
```

## Performance Tips

1. **Clean up old uploads regularly**
   ```bash
   find uploads -mtime +7 -delete  # Delete files older than 7 days
   ```

2. **Monitor server resources**
   ```bash
   pm2 monit
   ```

3. **Enable gzip compression in Nginx** for faster transfers

4. **Consider CDN** for static assets if serving globally

## Security Considerations

1. **Validate uploaded files** - Only .xlsx accepted, 20 MB limit
2. **Sanitize file paths** - Using multer's storage configuration
3. **Error handling** - Generic error messages to prevent info disclosure
4. **CORS** - Configure as needed for client applications
5. **Environment variables** - Never commit `.env` file with secrets

## Support & Maintenance

### Regular Maintenance
- Monitor error logs
- Clean up `uploads/` directory
- Update dependencies: `npm audit fix`
- Backup database/config if using persistent storage

### Monitoring
```bash
# Check application status
pm2 status

# View logs
pm2 logs fm-validator

# View specific errors
pm2 logs fm-validator --err
```

## Version History
- **1.0.0** - Initial release with 18-rule core checklist and 38-rule full checklist

## License
ISC
