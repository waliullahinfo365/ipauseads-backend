# iPauseAds Client Handoff Package

## What to Give Your Client

This document lists everything your client needs to deploy and test the iPauseAds platform.

---

## 📁 Files to Deliver

### 1. Backend Code
```
ipauseads-backend/
├── src/
│   ├── index.js                    # Main server entry
│   ├── middleware/
│   │   └── auth.js                 # JWT authentication
│   ├── models/
│   │   ├── User.js                 # User accounts
│   │   ├── Wallet.js               # Advertiser wallets
│   │   ├── WalletTransaction.js    # Transaction history
│   │   ├── QrCode.js               # QR campaigns
│   │   ├── Scan.js                 # QR scan records
│   │   ├── PauseEvent.js           # Pause moments
│   │   ├── BillingRecord.js        # Billing/revenue split
│   │   ├── A2ARMetric.js           # A2AR analytics
│   │   ├── EventReceipt.js         # NEW: Publisher events
│   │   ├── PublisherApiKey.js      # NEW: Publisher credentials
│   │   └── IdempotencyCache.js     # NEW: Request deduplication
│   └── routes/
│       ├── auth.js                 # Login/register
│       ├── billing.js              # Wallet, QR codes
│       ├── pause.js                # Pause moments API
│       ├── a2ar.js                 # A2AR analytics
│       ├── qr.js                   # QR tracking
│       ├── users.js                # User management
│       ├── analytics.js            # General analytics
│       └── v1/                     # NEW: Publisher API v1
│           ├── events.js           # Event ingestion
│           ├── publishers.js       # Publisher management
│           └── test.js             # Test endpoints
├── docs/
│   ├── PUBLISHER_API.md            # Publisher integration docs
│   ├── DEPLOYMENT_GUIDE.md         # VPS deployment guide
│   ├── TESTING_CHECKLIST.md        # Complete test checklist
│   └── CLIENT_HANDOFF_PACKAGE.md   # This file
├── package.json
├── .env.example                    # Environment template
└── make-admin.js                   # Admin user script
```

### 2. Frontend Code
```
ipauseads-frontend/
├── src/
│   ├── pages/
│   │   ├── Dashboard.jsx
│   │   ├── SpotlightDashboard.jsx  # A2AR analytics
│   │   ├── Login.jsx
│   │   ├── Register.jsx
│   │   └── ...
│   ├── components/
│   └── ...
├── public/
├── package.json
└── .env.example
```

### 3. Documentation Files
- `PUBLISHER_API.md` - Give to publishers for integration
- `DEPLOYMENT_GUIDE.md` - VPS setup instructions
- `TESTING_CHECKLIST.md` - Complete testing guide
- `CLIENT_HANDOFF_PACKAGE.md` - This overview

---

## 🔧 Environment Variables

### Backend (.env)
```env
# Required
NODE_ENV=production
PORT=4000
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/ipauseads
JWT_SECRET=your-32-character-minimum-secret-key

# Frontend URL (for CORS)
FRONTEND_URL=https://app.ipauseads.com

# API URL (for QR tracking URLs)
API_BASE_URL=https://api.ipauseads.com

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=100
```

### Frontend (.env)
```env
REACT_APP_API_URL=https://api.ipauseads.com
```

---

## 🚀 Quick Deployment Steps

### Backend (VPS)

```bash
# 1. Upload code to VPS
scp -r ipauseads-backend/ user@vps:/var/www/ipauseads/

# 2. SSH into VPS
ssh user@vps

# 3. Install dependencies
cd /var/www/ipauseads/ipauseads-backend
npm install --production

# 4. Create .env file
cp .env.example .env
nano .env  # Edit with production values

# 5. Start with PM2
pm2 start src/index.js --name ipauseads-api
pm2 save
pm2 startup

# 6. Setup Nginx + SSL (see DEPLOYMENT_GUIDE.md)
```

### Frontend (Netlify)

```bash
# 1. Build locally
cd ipauseads-frontend
npm install
npm run build

# 2. Deploy to Netlify
# - Drag build/ folder to Netlify
# - Or connect GitHub repo

# 3. Set environment variable in Netlify:
# REACT_APP_API_URL=https://api.ipauseads.com

# 4. Configure custom domain
```

---

## 🧪 Testing After Deployment

### Quick Verification

```bash
# 1. Check backend health
curl https://api.ipauseads.com/health
# Expected: {"status":"ok","version":"1.0",...}

# 2. Setup test publisher
curl -X POST https://api.ipauseads.com/v1/test/setup
# Expected: API key and webhook secret

# 3. Test full flow
curl -X POST https://api.ipauseads.com/v1/test/full-flow \
  -H "Content-Type: application/json" \
  -d '{"title": "Test Show"}'
# Expected: Pause + conversion created

# 4. Check stats
curl https://api.ipauseads.com/v1/test/stats
# Expected: Event counts
```

See `TESTING_CHECKLIST.md` for complete testing guide.

---

## 👥 User Roles

### 1. Admin (Your Client)
- Create/manage publishers
- View all analytics
- Manage users
- Access billing records

**Make admin:**
```bash
node make-admin.js admin@ipauseads.com
```

### 2. Advertiser
- Deposit funds to wallet
- Create QR campaigns
- View A2AR analytics
- See billing history

### 3. Publisher (External)
- Receives API key from admin
- Sends pause_impression events
- Sends qr_conversion events
- Views own event history

---

## 🔗 API Endpoints Summary

### Public
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/auth/register` | POST | User registration |
| `/auth/login` | POST | User login |

### Authenticated (JWT)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/wallet` | GET | Get wallet balance |
| `/api/wallet/deposit` | POST | Add funds |
| `/api/qr-codes` | POST | Create QR campaign |
| `/api/a2ar/summary` | GET | A2AR metrics |
| `/api/pause/moments` | GET | Pause events |

### Admin Only
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/admin/publishers` | POST | Create publisher |
| `/v1/admin/publishers` | GET | List publishers |
| `/v1/admin/publishers/:id` | PATCH | Update publisher |

### Publisher API (API Key)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/events` | POST | Send event |
| `/v1/events` | GET | List events |

---

## 💰 Revenue Flow

```
Conversion Happens ($5 fee)
         │
         ▼
┌─────────────────────────┐
│ Advertiser Wallet: -$5  │
└─────────────────────────┘
         │
         ▼
┌─────────────────────────┐
│ Publisher Share: +$3    │ (60%)
│ iPauseAds Revenue: +$2  │ (40%)
└─────────────────────────┘
```

---

## 📋 What Client Does After Deployment

### Step 1: Create Admin Account
```bash
# Register via frontend or API
# Then make admin:
node make-admin.js client@ipauseads.com
```

### Step 2: Onboard Publishers
```bash
# Via API or future admin dashboard
POST /v1/admin/publishers
{
  "publisher_id": "pub_hulu",
  "publisher_name": "Hulu"
}
# → Get API key to send to publisher
```

### Step 3: Onboard Advertisers
- Advertisers register on frontend
- Deposit funds to wallet
- Create QR campaigns

### Step 4: Share with Publishers
- Send API key + documentation
- Publisher integrates event sending
- Events flow into system

### Step 5: Monitor
- View Spotlight dashboard
- Track A2AR metrics
- Review billing records

---

## 🆘 Troubleshooting

### Backend won't start
```bash
# Check logs
pm2 logs ipauseads-api

# Common issues:
# - MongoDB connection string wrong
# - Port already in use
# - Missing environment variables
```

### CORS errors
```bash
# Ensure FRONTEND_URL in .env matches your frontend domain
FRONTEND_URL=https://app.ipauseads.com
```

### Publisher can't authenticate
```bash
# Verify API key is active
curl https://api.ipauseads.com/v1/admin/publishers/pub_xxx \
  -H "Authorization: Bearer $ADMIN_TOKEN"
# Check status is "active"
```

### Events not linking
```bash
# Ensure ipause_opportunity_id matches between:
# - pause_impression event
# - qr_conversion event
```

---

## 📞 Support Contacts

For deployment issues:
- Check `DEPLOYMENT_GUIDE.md`
- Review PM2 logs: `pm2 logs`
- Check Nginx logs: `/var/log/nginx/error.log`

For API issues:
- Check `PUBLISHER_API.md`
- Use `TESTING_CHECKLIST.md` to verify

---

## ✅ Final Checklist Before Handoff

- [ ] Backend code complete and tested locally
- [ ] Frontend code complete and tested locally
- [ ] All documentation files included
- [ ] .env.example files created
- [ ] MongoDB Atlas cluster ready
- [ ] Domain DNS configured
- [ ] SSL certificates ready
- [ ] Client has VPS access
- [ ] Client understands the system flow
