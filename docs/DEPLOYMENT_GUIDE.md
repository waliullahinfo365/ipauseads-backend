# iPauseAds Production Deployment Guide

## Overview

This guide covers deploying the iPauseAds platform to production:
- **Backend**: Node.js API on VPS
- **Frontend**: React app on domain (Netlify/Vercel/VPS)

---

## Part 1: Backend Deployment (VPS)

### Prerequisites

- VPS with Ubuntu 20.04+ (DigitalOcean, AWS EC2, Linode, etc.)
- Domain pointing to VPS (e.g., `api.ipauseads.com`)
- MongoDB Atlas account (or self-hosted MongoDB)
- Node.js 18+ installed
- PM2 for process management
- Nginx for reverse proxy
- SSL certificate (Let's Encrypt)

### Step 1: Server Setup

```bash
# SSH into your VPS
ssh root@your-vps-ip

# Update system
apt update && apt upgrade -y

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
apt install -y nodejs

# Install PM2 globally
npm install -g pm2

# Install Nginx
apt install -y nginx

# Install Certbot for SSL
apt install -y certbot python3-certbot-nginx
```

### Step 2: Clone & Configure Backend

```bash
# Create app directory
mkdir -p /var/www/ipauseads
cd /var/www/ipauseads

# Clone your repository (or upload files)
git clone https://github.com/your-repo/ipauseads-backend.git backend
cd backend

# Install dependencies
npm install --production

# Create production .env file
nano .env
```

### Step 3: Environment Variables (.env)

```env
# Server
NODE_ENV=production
PORT=4000

# MongoDB Atlas
MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/ipauseads?retryWrites=true&w=majority

# JWT Secret (generate a strong random string)
JWT_SECRET=your-super-secret-jwt-key-minimum-32-characters

# Frontend URL (for CORS)
FRONTEND_URL=https://app.ipauseads.com

# API Base URL
API_BASE_URL=https://api.ipauseads.com

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=100

# Optional: Conversion webhook secret
CONVERSION_WEBHOOK_SECRET=your-webhook-secret
```

### Step 4: Start with PM2

```bash
# Start the application
pm2 start src/index.js --name "ipauseads-api"

# Save PM2 process list
pm2 save

# Setup PM2 to start on boot
pm2 startup
```

### Step 5: Configure Nginx

```bash
# Create Nginx config
nano /etc/nginx/sites-available/ipauseads-api
```

```nginx
server {
    listen 80;
    server_name api.ipauseads.com;

    location / {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
# Enable the site
ln -s /etc/nginx/sites-available/ipauseads-api /etc/nginx/sites-enabled/

# Test Nginx config
nginx -t

# Restart Nginx
systemctl restart nginx
```

### Step 6: Setup SSL (HTTPS)

```bash
# Get SSL certificate
certbot --nginx -d api.ipauseads.com

# Auto-renewal is set up automatically
```

### Step 7: Verify Backend

```bash
# Test health endpoint
curl https://api.ipauseads.com/health

# Expected response:
# {"status":"ok","version":"1.0","api_versions":["v1"],"timestamp":"..."}
```

---

## Part 2: Frontend Deployment

### Option A: Netlify (Recommended)

1. **Build the frontend locally:**
```bash
cd ipauseads-frontend
npm install
npm run build
```

2. **Deploy to Netlify:**
   - Go to [netlify.com](https://netlify.com)
   - Drag & drop the `build` folder
   - Or connect your GitHub repo for auto-deploy

3. **Set environment variables in Netlify:**
```
REACT_APP_API_URL=https://api.ipauseads.com
```

4. **Configure custom domain:**
   - Add your domain in Netlify settings
   - Update DNS to point to Netlify

### Option B: VPS (Same Server)

```bash
# Build frontend
cd /var/www/ipauseads/frontend
npm install
npm run build

# Nginx config for frontend
nano /etc/nginx/sites-available/ipauseads-app
```

```nginx
server {
    listen 80;
    server_name app.ipauseads.com;
    root /var/www/ipauseads/frontend/build;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/ipauseads-app /etc/nginx/sites-enabled/
certbot --nginx -d app.ipauseads.com
systemctl restart nginx
```

---

## Part 3: Post-Deployment Testing Checklist

### A. Backend Health Checks

```bash
# 1. Health endpoint
curl https://api.ipauseads.com/health

# 2. Root endpoint
curl https://api.ipauseads.com/
```

### B. Authentication Tests

```bash
# 1. Register a test user
curl -X POST https://api.ipauseads.com/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "TestPassword123!",
    "fullName": "Test User",
    "brand": "Test Brand"
  }'

# 2. Login
curl -X POST https://api.ipauseads.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "TestPassword123!"
  }'

# Save the token from response for next tests
```

### C. Publisher API Tests

```bash
# 1. Setup test publisher (non-production only)
curl -X POST https://api.ipauseads.com/v1/test/setup

# 2. Create pause impression
curl -X POST https://api.ipauseads.com/v1/test/pause-impression \
  -H "Content-Type: application/json" \
  -d '{"title": "Test Show", "campaign_id": "TEST-001"}'

# 3. Create conversion (use the ipause_opportunity_id from step 2)
curl -X POST https://api.ipauseads.com/v1/test/conversion \
  -H "Content-Type: application/json" \
  -d '{"ipause_opportunity_id": "opp_test_xxxxx"}'

# 4. Check stats
curl https://api.ipauseads.com/v1/test/stats
```

### D. Admin Publisher Management

```bash
# Requires admin JWT token
TOKEN="your-admin-jwt-token"

# 1. Create a real publisher
curl -X POST https://api.ipauseads.com/v1/admin/publishers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "publisher_id": "pub_hulu",
    "publisher_name": "Hulu",
    "contact_email": "integrations@hulu.com"
  }'

# 2. List publishers
curl https://api.ipauseads.com/v1/admin/publishers \
  -H "Authorization: Bearer $TOKEN"
```

### E. Full Event Flow Test

```bash
# Get publisher API key from admin endpoint above
PUB_API_KEY="pk_xxxxx"

# 1. Send pause impression
curl -X POST https://api.ipauseads.com/v1/events \
  -H "Authorization: Bearer $PUB_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: test_pause_001" \
  -d '{
    "event_type": "pause_impression",
    "event_id": "evt_test_001",
    "event_time_utc": "2024-12-24T00:00:00.000Z",
    "publisher": {
      "publisher_id": "pub_hulu",
      "publisher_name": "Hulu"
    },
    "session": {
      "ipause_opportunity_id": "opp_production_test_001"
    },
    "content": {
      "title": "Test Content"
    },
    "ad": {
      "campaign_id": "TEST-CAMPAIGN",
      "qr_enabled": true
    }
  }'

# 2. Send conversion
curl -X POST https://api.ipauseads.com/v1/events \
  -H "Authorization: Bearer $PUB_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: test_conv_001" \
  -d '{
    "event_type": "qr_conversion",
    "event_id": "evt_conv_001",
    "event_time_utc": "2024-12-24T00:00:05.000Z",
    "publisher": {
      "publisher_id": "pub_hulu"
    },
    "session": {
      "ipause_opportunity_id": "opp_production_test_001"
    },
    "conversion": {
      "conversion_type": "qr_scan",
      "result": "success"
    }
  }'
```

---

## Part 4: Files to Give to Client

### For Deployment:

1. **Backend folder**: `/ipauseads-backend/` (entire folder)
2. **Frontend folder**: `/ipauseads-frontend/` (entire folder)
3. **This deployment guide**: `DEPLOYMENT_GUIDE.md`

### For Publisher Integration:

1. **API Documentation**: `/docs/PUBLISHER_API.md`
2. **Publisher credentials** (generated after deployment)

### For Advertiser:

1. **Dashboard access** (frontend URL)
2. **Account credentials** (created via registration)

---

## Part 5: Production Checklist

### Before Going Live:

- [ ] MongoDB Atlas configured with production cluster
- [ ] Strong JWT_SECRET set (32+ characters)
- [ ] CORS configured for frontend domain only
- [ ] SSL certificates installed
- [ ] Rate limiting enabled
- [ ] PM2 configured for auto-restart
- [ ] Nginx configured as reverse proxy
- [ ] Firewall configured (only ports 80, 443, 22)
- [ ] Backups configured for MongoDB
- [ ] Monitoring setup (PM2 logs, server metrics)

### Security Checklist:

- [ ] Remove test endpoints in production (`NODE_ENV=production`)
- [ ] Use environment variables for all secrets
- [ ] Enable MongoDB authentication
- [ ] Regular security updates on VPS
- [ ] API rate limiting active

---

## Part 6: Monitoring & Maintenance

### View Logs

```bash
# PM2 logs
pm2 logs ipauseads-api

# Nginx logs
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log
```

### Restart Services

```bash
# Restart API
pm2 restart ipauseads-api

# Restart Nginx
systemctl restart nginx
```

### Update Code

```bash
cd /var/www/ipauseads/backend
git pull origin main
npm install --production
pm2 restart ipauseads-api
```

---

## Quick Reference

| Service | URL | Purpose |
|---------|-----|---------|
| Backend API | `https://api.ipauseads.com` | REST API |
| Frontend App | `https://app.ipauseads.com` | Dashboard |
| Health Check | `https://api.ipauseads.com/health` | Status |
| Publisher API | `https://api.ipauseads.com/v1/events` | Event ingestion |

---

## Support

For issues during deployment:
1. Check PM2 logs: `pm2 logs`
2. Check Nginx logs: `/var/log/nginx/error.log`
3. Verify MongoDB connection
4. Ensure all environment variables are set
