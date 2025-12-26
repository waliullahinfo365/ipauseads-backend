# Publisher Onboarding Email Template

Use this template when onboarding a new publisher to iPauseAds.

---

## Email Template

**Subject:** iPauseAds Integration Package - [Publisher Name]

---

Hi [Publisher Contact Name],

Welcome to iPauseAds! Below are your API credentials and integration instructions for connecting your streaming platform to our pause ad system.

### Your API Credentials

| Item | Value |
|------|-------|
| **Publisher ID** | `[PUBLISHER_ID]` |
| **API Key** | `[API_KEY]` |
| **Webhook Secret** | `[WEBHOOK_SECRET]` (optional, for signed requests) |
| **API Base URL** | `https://api.ipauseads.com/v1` |

⚠️ **Important:** Store these credentials securely. The API key authenticates all your requests.

---

### Quick Start

**1. When a user pauses video and you display a QR ad, send this:**

```bash
curl -X POST https://api.ipauseads.com/v1/events \
  -H "Authorization: Bearer [API_KEY]" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: pause_[unique_id]" \
  -d '{
    "event_type": "pause_impression",
    "event_id": "evt_[unique_id]",
    "event_time_utc": "[ISO_TIMESTAMP]",
    "publisher": {
      "publisher_id": "[PUBLISHER_ID]"
    },
    "session": {
      "ipause_opportunity_id": "[OPPORTUNITY_ID]"
    },
    "content": {
      "title": "[SHOW_TITLE]"
    },
    "ad": {
      "campaign_id": "[CAMPAIGN_ID]",
      "qr_enabled": true
    }
  }'
```

**2. When the QR code is scanned, send this:**

```bash
curl -X POST https://api.ipauseads.com/v1/events \
  -H "Authorization: Bearer [API_KEY]" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: conv_[unique_id]" \
  -d '{
    "event_type": "qr_conversion",
    "event_id": "evt_conv_[unique_id]",
    "event_time_utc": "[ISO_TIMESTAMP]",
    "publisher": {
      "publisher_id": "[PUBLISHER_ID]"
    },
    "session": {
      "ipause_opportunity_id": "[SAME_OPPORTUNITY_ID_AS_PAUSE]"
    },
    "conversion": {
      "conversion_type": "qr_scan",
      "result": "success"
    }
  }'
```

**Key Point:** The `ipause_opportunity_id` must be the same in both events to link them together.

---

### Active Campaigns

Here are the campaigns currently available for your platform:

| Campaign ID | Brand | QR Image |
|-------------|-------|----------|
| `[CAMPAIGN_ID_1]` | [Brand 1] | [QR_IMAGE_URL_1] |
| `[CAMPAIGN_ID_2]` | [Brand 2] | [QR_IMAGE_URL_2] |

Display the QR image when a user pauses, and include the `campaign_id` in your `pause_impression` event.

---

### Documentation

Full API documentation is attached: **PUBLISHER_API.md**

This includes:
- Complete field reference
- Code examples (Node.js, Python, cURL)
- Error handling
- Rate limits

---

### Integration Checklist

- [ ] Store API credentials securely
- [ ] Implement pause detection in your player
- [ ] Display QR overlay on pause
- [ ] Generate unique `ipause_opportunity_id` for each pause
- [ ] Send `pause_impression` when QR is displayed
- [ ] Detect QR scan (via redirect or tracking)
- [ ] Send `qr_conversion` with matching `ipause_opportunity_id`
- [ ] Handle API errors and retries

---

### Support

If you have questions during integration:
- **Email:** api-support@ipauseads.com
- **Documentation:** https://docs.ipauseads.com

Best regards,
[Your Name]
iPauseAds Integration Team

---

## How to Generate Credentials

As the iPauseAds admin, run this command to create a new publisher:

```bash
# 1. Login to get admin token
curl -X POST https://api.ipauseads.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@ipauseads.com", "password": "YOUR_PASSWORD"}'

# Save the token
TOKEN="[paste token from response]"

# 2. Create publisher
curl -X POST https://api.ipauseads.com/v1/admin/publishers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "publisher_id": "pub_netflix",
    "publisher_name": "Netflix",
    "contact_email": "integrations@netflix.com",
    "contact_name": "Integration Team"
  }'
```

Response will contain the `api_key` and `webhook_secret` to send to the publisher.

---

## Example: Onboarding Hulu

### Step 1: Create Publisher
```bash
TOKEN="eyJhbGciOiJIUzI1NiIs..."

curl -X POST https://api.ipauseads.com/v1/admin/publishers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "publisher_id": "pub_hulu",
    "publisher_name": "Hulu",
    "contact_email": "api@hulu.com",
    "contact_name": "API Team"
  }'
```

### Step 2: Copy Credentials from Response
```json
{
  "credentials": {
    "api_key": "pk_c453fa799bc3...",
    "webhook_secret": "whsec_8b93a977d9..."
  }
}
```

### Step 3: Fill in Email Template
Replace placeholders:
- `[Publisher Name]` → Hulu
- `[PUBLISHER_ID]` → pub_hulu
- `[API_KEY]` → pk_c453fa799bc3...
- `[WEBHOOK_SECRET]` → whsec_8b93a977d9...

### Step 4: Attach PUBLISHER_API.md and Send

---

## Files to Send to Publisher

1. **This email** (filled in with their credentials)
2. **PUBLISHER_API.md** (full documentation)
3. **QR code images** (for active campaigns)
