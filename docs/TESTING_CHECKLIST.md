# iPauseAds Complete Testing Checklist

Use this checklist to verify all features are working after production deployment.

---

## Quick Setup Commands

```bash
# Set your API URL
API_URL="https://api.ipauseads.com"

# Or for local testing
API_URL="http://localhost:4000"
```

---

## 1. System Health

### 1.1 Basic Health Check
```bash
curl $API_URL/health
```
**Expected:** `{"status":"ok","version":"1.0","api_versions":["v1"],...}`

### 1.2 Root Endpoint
```bash
curl $API_URL/
```
**Expected:** `{"ok":true,"msg":"iPauseAds backend running"}`

---

## 2. User Authentication

### 2.1 Register New User (Advertiser)
```bash
curl -X POST $API_URL/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "advertiser@test.com",
    "password": "Test123456!",
    "fullName": "Test Advertiser",
    "brand": "Test Brand Inc"
  }'
```
**Expected:** Success with user data and token

### 2.2 Login
```bash
curl -X POST $API_URL/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "advertiser@test.com",
    "password": "Test123456!"
  }'
```
**Expected:** `{"token": "eyJhbG...", "user": {...}}`

**Save the token:**
```bash
TOKEN="paste-token-here"
```

### 2.3 Get Current User
```bash
curl $API_URL/auth/me \
  -H "Authorization: Bearer $TOKEN"
```
**Expected:** User profile data

---

## 3. Admin Functions

### 3.1 Make User Admin (Run on server)
```bash
# SSH into server, then:
cd /var/www/ipauseads/backend
node make-admin.js advertiser@test.com
```

### 3.2 Create Publisher (Admin Only)
```bash
curl -X POST $API_URL/v1/admin/publishers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "publisher_id": "pub_netflix",
    "publisher_name": "Netflix",
    "contact_email": "api@netflix.com",
    "contact_name": "API Team"
  }'
```
**Expected:** Publisher created with API key and webhook secret

**Save publisher credentials:**
```bash
PUB_API_KEY="pk_xxxxx"
PUB_SECRET="whsec_xxxxx"
```

### 3.3 List Publishers
```bash
curl $API_URL/v1/admin/publishers \
  -H "Authorization: Bearer $TOKEN"
```
**Expected:** List of all publishers

### 3.4 Get Publisher Details
```bash
curl $API_URL/v1/admin/publishers/pub_netflix \
  -H "Authorization: Bearer $TOKEN"
```
**Expected:** Publisher details with 30-day stats

---

## 4. Wallet & Billing

### 4.1 Get Wallet Balance
```bash
curl $API_URL/api/wallet \
  -H "Authorization: Bearer $TOKEN"
```
**Expected:** Wallet with balance

### 4.2 Deposit Funds
```bash
curl -X POST $API_URL/api/wallet/deposit \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount": 100}'
```
**Expected:** `{"success":true,"newBalance":100,...}`

### 4.3 Get Wallet Transactions
```bash
curl $API_URL/api/wallet/transactions \
  -H "Authorization: Bearer $TOKEN"
```
**Expected:** List of transactions

---

## 5. QR Code Campaigns

### 5.1 Create QR Campaign
```bash
curl -X POST $API_URL/api/qr-codes \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "qrId": "NIKE-SUMMER-2024",
    "destinationUrl": "https://nike.com/summer-sale",
    "publisher": "Netflix",
    "program": "Stranger Things",
    "conversionFee": 5.0,
    "publisherShare": 3.0
  }'
```
**Expected:** QR code created with tracking URL

### 5.2 List QR Campaigns
```bash
curl $API_URL/api/qr-codes \
  -H "Authorization: Bearer $TOKEN"
```
**Expected:** List of advertiser's QR campaigns

---

## 6. Publisher Event API (Core Feature)

### 6.1 Send Pause Impression
```bash
OPPORTUNITY_ID="opp_test_$(date +%s)"

curl -X POST $API_URL/v1/events \
  -H "Authorization: Bearer $PUB_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: pause_$OPPORTUNITY_ID" \
  -d '{
    "event_type": "pause_impression",
    "event_id": "evt_pause_'$(date +%s)'",
    "event_time_utc": "'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'",
    "publisher": {
      "publisher_id": "pub_netflix",
      "publisher_name": "Netflix"
    },
    "session": {
      "session_id": "sess_12345",
      "ipause_opportunity_id": "'$OPPORTUNITY_ID'"
    },
    "content": {
      "title": "Stranger Things",
      "series": "Stranger Things",
      "season": "4",
      "episode": "3",
      "genre": ["Sci-Fi", "Horror"],
      "rating": "TV-MA"
    },
    "playback": {
      "pause_timestamp_ms": 1435000,
      "is_live": false
    },
    "ad": {
      "campaign_id": "NIKE-SUMMER-2024",
      "brand": "Nike",
      "creative_id": "cr_summer_001",
      "qr_enabled": true
    },
    "device": {
      "device_type": "CTV",
      "os": "FireTV"
    },
    "geo": {
      "country": "US",
      "region": "CA"
    }
  }'
```
**Expected:** `{"status":"accepted","receipt_id":"rct_xxx",...}`

### 6.2 Send QR Conversion
```bash
curl -X POST $API_URL/v1/events \
  -H "Authorization: Bearer $PUB_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: conv_$OPPORTUNITY_ID" \
  -d '{
    "event_type": "qr_conversion",
    "event_id": "evt_conv_'$(date +%s)'",
    "event_time_utc": "'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'",
    "publisher": {
      "publisher_id": "pub_netflix"
    },
    "session": {
      "ipause_opportunity_id": "'$OPPORTUNITY_ID'"
    },
    "conversion": {
      "conversion_type": "qr_scan",
      "result": "success",
      "qr_destination_id": "dest_nike_landing"
    }
  }'
```
**Expected:** `{"status":"accepted","receipt_id":"rct_xxx","matched_pause_id":"rct_xxx"}`

### 6.3 List Publisher Events
```bash
curl "$API_URL/v1/events?limit=10" \
  -H "Authorization: Bearer $PUB_API_KEY"
```
**Expected:** List of events for this publisher

### 6.4 Test Idempotency (Duplicate Request)
```bash
# Send same request again with same Idempotency-Key
curl -X POST $API_URL/v1/events \
  -H "Authorization: Bearer $PUB_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: pause_$OPPORTUNITY_ID" \
  -d '{...same payload...}'
```
**Expected:** Same response as original (cached)

---

## 7. A2AR Analytics

### 7.1 Get A2AR Summary
```bash
curl $API_URL/api/a2ar/summary \
  -H "Authorization: Bearer $TOKEN"
```
**Expected:** `{"pauseOpportunities":X,"verifiedConversions":Y,"a2ar":"Z.ZZ","tier":"..."}`

### 7.2 Get A2AR by Program
```bash
curl $API_URL/api/a2ar/by-program \
  -H "Authorization: Bearer $TOKEN"
```
**Expected:** Breakdown by program title

### 7.3 Get A2AR by Publisher
```bash
curl $API_URL/api/a2ar/by-publisher \
  -H "Authorization: Bearer $TOKEN"
```
**Expected:** Breakdown by publisher

---

## 8. Spotlight Dashboard Data

### 8.1 Get Pause Moments
```bash
curl $API_URL/api/pause/moments \
  -H "Authorization: Bearer $TOKEN"
```
**Expected:** List of pause events with conversion status

### 8.2 Get Pause Moments (Filtered)
```bash
curl "$API_URL/api/pause/moments?converted=true" \
  -H "Authorization: Bearer $TOKEN"
```
**Expected:** Only converted pause moments

---

## 9. Test Endpoints (Development Only)

### 9.1 Setup Test Publisher
```bash
curl -X POST $API_URL/v1/test/setup
```
**Expected:** Test publisher credentials

### 9.2 Generate Test Pause
```bash
curl -X POST $API_URL/v1/test/pause-impression \
  -H "Content-Type: application/json" \
  -d '{"title": "Test Show"}'
```
**Expected:** Test pause created with opportunity ID

### 9.3 Generate Test Conversion
```bash
curl -X POST $API_URL/v1/test/conversion \
  -H "Content-Type: application/json" \
  -d '{"ipause_opportunity_id": "opp_test_xxx"}'
```
**Expected:** Test conversion linked to pause

### 9.4 Full Flow Test
```bash
curl -X POST $API_URL/v1/test/full-flow \
  -H "Content-Type: application/json" \
  -d '{"title": "Full Test", "campaign_id": "TEST-001"}'
```
**Expected:** Complete pause + conversion flow

### 9.5 Get Test Stats
```bash
curl $API_URL/v1/test/stats
```
**Expected:** Event counts and A2AR percentage

### 9.6 Cleanup Test Data
```bash
curl -X DELETE "$API_URL/v1/test/cleanup?confirm=yes"
```
**Expected:** Test data deleted

---

## 10. Billing Verification

### 10.1 Check Wallet After Conversion
```bash
# After a successful conversion, wallet should be debited
curl $API_URL/api/wallet \
  -H "Authorization: Bearer $TOKEN"
```
**Expected:** Balance reduced by conversion fee ($5)

### 10.2 Check Billing Records
```bash
curl $API_URL/api/billing/records \
  -H "Authorization: Bearer $TOKEN"
```
**Expected:** Billing record with fee split (publisher share + iPauseAds cut)

---

## 11. Frontend Testing

### 11.1 Dashboard Access
- [ ] Login page loads
- [ ] Can register new account
- [ ] Can login with credentials
- [ ] Dashboard displays correctly

### 11.2 Spotlight Dashboard
- [ ] A2AR metrics display
- [ ] Pause moments list loads
- [ ] Filters work (publisher, content type, converted)
- [ ] Detail modal opens on click

### 11.3 Wallet
- [ ] Balance displays
- [ ] Can deposit funds
- [ ] Transaction history shows

### 11.4 QR Campaigns
- [ ] Can create new QR campaign
- [ ] Campaign list displays
- [ ] Tracking URL generated

### 11.5 User Management (Admin)
- [ ] User list displays
- [ ] Can edit user roles
- [ ] Can view user details

---

## 12. Error Handling Tests

### 12.1 Invalid API Key
```bash
curl -X POST $API_URL/v1/events \
  -H "Authorization: Bearer invalid_key" \
  -H "Content-Type: application/json" \
  -d '{}'
```
**Expected:** `{"error":"invalid_credentials",...}`

### 12.2 Missing Idempotency Key
```bash
curl -X POST $API_URL/v1/events \
  -H "Authorization: Bearer $PUB_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```
**Expected:** `{"error":"missing_idempotency_key",...}`

### 12.3 Invalid Event Type
```bash
curl -X POST $API_URL/v1/events \
  -H "Authorization: Bearer $PUB_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: test_123" \
  -d '{"event_type": "invalid"}'
```
**Expected:** `{"error":"invalid_event_type",...}`

### 12.4 Conversion Without Pause
```bash
curl -X POST $API_URL/v1/events \
  -H "Authorization: Bearer $PUB_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: orphan_conv_123" \
  -d '{
    "event_type": "qr_conversion",
    "event_id": "evt_orphan",
    "event_time_utc": "'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'",
    "publisher": {"publisher_id": "pub_netflix"},
    "session": {"ipause_opportunity_id": "non_existent_opp"},
    "conversion": {"result": "success"}
  }'
```
**Expected:** `{"error":"pause_not_found",...}`

---

## Summary Checklist

### Backend
- [ ] Health check passes
- [ ] User registration works
- [ ] User login works
- [ ] Admin can create publishers
- [ ] Publisher API key authentication works
- [ ] Pause impression events accepted
- [ ] QR conversion events accepted
- [ ] Events linked via opportunity ID
- [ ] Billing processed on conversion
- [ ] A2AR metrics calculated
- [ ] Idempotency working

### Frontend
- [ ] Dashboard loads
- [ ] Spotlight shows data
- [ ] Wallet functions work
- [ ] QR campaign creation works
- [ ] Responsive on mobile

### Integration
- [ ] Publisher can send events
- [ ] Advertiser sees analytics
- [ ] Billing records created
- [ ] Revenue split calculated

---

## Test Data Cleanup

After testing, clean up:

```bash
# Remove test events
curl -X DELETE "$API_URL/v1/test/cleanup?confirm=yes"

# Or manually in MongoDB:
# db.eventreceipts.deleteMany({idempotencyKey: /^test_/})
# db.idempotencycaches.deleteMany({idempotencyKey: /^test_/})
```
