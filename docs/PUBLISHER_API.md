# iPauseAds Publisher Event API Documentation

## Overview

The iPauseAds Publisher Event API allows streaming publishers (Netflix, Hulu, Tubi, etc.) to send pause impression and QR conversion events to the iPauseAds platform. This enables real-time tracking of Attention-to-Action Rate (A2AR) metrics and automated billing.


**Production API:** `https://api.ipauseads.com/v1`

## What's New (v1.1)

- **ASV (Attention Scan Velocity)**: Track how fast users scan QR codes
- **New field**: `qr_appeared_at` in pause impression events
- **Enhanced response**: Conversion events now return ASV data

## Authentication

The API supports two authentication methods:

### 1. API Key Authentication (Recommended)

Include your API key in the `Authorization` header:

```http
Authorization: Bearer pk_your_api_key_here
```

### 2. Signed Webhook Authentication

For enhanced security, you can sign your requests:

```http
X-iPause-Timestamp: 1703376000
X-iPause-Signature: sha256=abc123...
```

**Signature Generation:**
```javascript
const crypto = require('crypto');

const timestamp = Math.floor(Date.now() / 1000);
const rawBody = JSON.stringify(payload);
const signature = 'sha256=' + crypto
  .createHmac('sha256', webhookSecret)
  .update(timestamp + '.' + rawBody)
  .digest('hex');
```

## Required Headers

| Header | Required | Description |
|--------|----------|-------------|
| `Authorization` | Yes* | Bearer token with API key |
| `Content-Type` | Yes | Must be `application/json` |
| `Idempotency-Key` | Yes | Unique key for request deduplication |
| `X-iPause-Timestamp` | No* | Unix timestamp for signed requests |
| `X-iPause-Signature` | No* | HMAC signature for signed requests |

*Either `Authorization` OR (`X-iPause-Timestamp` + `X-iPause-Signature`) is required.

---

## Endpoints

### POST /v1/events

Submit a pause impression or QR conversion event.

#### Request Body

The request body varies based on `event_type`:

---

### Event Type: `pause_impression`

Sent when a pause ad is displayed on screen.

```json
{
  "event_type": "pause_impression",
  "event_version": "1.0",
  "event_id": "evt_abc123_1703376000",
  "event_time_utc": "2024-12-24T00:00:00.000Z",
  "qr_appeared_at": "2024-12-24T00:00:00.500Z",
  
  "publisher": {
    "publisher_id": "pub_hulu",
    "publisher_name": "Hulu",
    "app_id": "com.hulu.plus",
    "supply_type": "FAST"
  },
  
  "session": {
    "session_id": "sess_xyz789",
    "content_session_id": "content_sess_abc456",
    "ipause_opportunity_id": "opp_unique_12345"
  },
  
  "content": {
    "content_id": "cnt_stranger_things_s4e3",
    "title": "Stranger Things",
    "series": "Stranger Things",
    "season": "4",
    "episode": "3",
    "genre": ["Sci-Fi", "Horror", "Drama"],
    "rating": "TV-MA"
  },
  
  "playback": {
    "pause_timestamp_ms": 1435000,
    "is_live": false
  },
  
  "ad": {
    "ipause_ad_id": "ipa_starbucks_summer_001",
    "campaign_id": "STARBUCKS-SUMMER-2024",
    "brand": "Starbucks",
    "creative_id": "cr_summer_drink_v2",
    "qr_enabled": true
  },
  
  "device": {
    "device_type": "CTV",
    "os": "RokuOS"
  },
  
  "geo": {
    "country": "US",
    "region": "CA"
  }
}
```

#### Field Reference - pause_impression

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `event_type` | string | Yes | Must be `"pause_impression"` |
| `event_version` | string | No | API version (default: "1.0") |
| `event_id` | string | Yes | Unique event identifier |
| `event_time_utc` | string | Yes | ISO 8601 timestamp |
| `qr_appeared_at` | string | No | ISO 8601 timestamp when QR code displayed (for ASV calculation) |
| **publisher** | object | Yes | Publisher information |
| `publisher.publisher_id` | string | Yes | Your publisher ID |
| `publisher.publisher_name` | string | No | Display name |
| `publisher.app_id` | string | No | App bundle ID |
| `publisher.supply_type` | string | No | FAST, AVOD, SVOD, etc. |
| **session** | object | Yes | Session information |
| `session.session_id` | string | No | Viewer session ID |
| `session.content_session_id` | string | No | Content viewing session |
| `session.ipause_opportunity_id` | string | Yes | **Unique ID linking pause to conversion** |
| **content** | object | Yes | Content information |
| `content.content_id` | string | No | Content identifier |
| `content.title` | string | No | Content title |
| `content.series` | string | No | Series name |
| `content.season` | string | No | Season number |
| `content.episode` | string | No | Episode number |
| `content.genre` | array | No | Genre tags |
| `content.rating` | string | No | Content rating |
| **playback** | object | No | Playback state |
| `playback.pause_timestamp_ms` | number | No | Position when paused (ms) |
| `playback.is_live` | boolean | No | Live content flag |
| **ad** | object | Yes | Ad/campaign information |
| `ad.ipause_ad_id` | string | No | iPauseAds ad ID |
| `ad.campaign_id` | string | No | Campaign identifier |
| `ad.brand` | string | No | Brand name |
| `ad.creative_id` | string | No | Creative identifier |
| `ad.qr_enabled` | boolean | No | QR code displayed |
| **device** | object | No | Device information |
| `device.device_type` | string | No | CTV, Mobile, Desktop, Tablet |
| `device.os` | string | No | Operating system |
| **geo** | object | No | Geographic information |
| `geo.country` | string | No | ISO country code |
| `geo.region` | string | No | State/region code |

---

### Event Type: `qr_conversion`

Sent when a viewer scans the QR code.

```json
{
  "event_type": "qr_conversion",
  "event_version": "1.0",
  "event_id": "evt_conv_xyz789_1703376005",
  "event_time_utc": "2024-12-24T00:00:05.000Z",
  
  "publisher": {
    "publisher_id": "pub_hulu"
  },
  
  "session": {
    "ipause_opportunity_id": "opp_unique_12345"
  },
  
  "conversion": {
    "conversion_type": "qr_scan",
    "result": "success",
    "qr_destination_id": "dest_starbucks_menu"
  }
}
```

#### Field Reference - qr_conversion

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `event_type` | string | Yes | Must be `"qr_conversion"` |
| `event_version` | string | No | API version (default: "1.0") |
| `event_id` | string | Yes | Unique event identifier |
| `event_time_utc` | string | Yes | ISO 8601 timestamp |
| **publisher** | object | Yes | Publisher information |
| `publisher.publisher_id` | string | Yes | Your publisher ID |
| **session** | object | Yes | Session information |
| `session.ipause_opportunity_id` | string | Yes | **Must match the pause_impression** |
| **conversion** | object | Yes | Conversion details |
| `conversion.conversion_type` | string | No | Type: qr_scan, deep_link, etc. |
| `conversion.result` | string | No | success, failed, timeout |
| `conversion.qr_destination_id` | string | No | Destination identifier |

---

## Responses

### Success Response

```json
{
  "status": "accepted",
  "receipt_id": "rct_507f1f77bcf86cd799439011",
  "ingested_at": "2024-12-24T00:00:00.123Z"
}
```

For conversions, also includes ASV (Attention Scan Velocity) data:
```json
{
  "status": "accepted",
  "receipt_id": "rct_507f1f77bcf86cd799439012",
  "ingested_at": "2024-12-24T00:00:05.456Z",
  "matched_pause_id": "rct_507f1f77bcf86cd799439011",
  "asv": {
    "asvSeconds": 5.0,
    "asvTier": 5,
    "asvLabel": "Exceptional"
  }
}
```

### ASV (Attention Scan Velocity) Tiers

| Tier | Label | Range | Description |
|------|-------|-------|-------------|
| 5 | Exceptional | < 5 sec | Instant scan response |
| 4 | Strong | 5-10 sec | Quick scan response |
| 3 | Average | 10-20 sec | Standard scan response |
| 2 | Fair | 20-40 sec | Moderate scan response |
| 1 | Low | > 40 sec | Slow scan response |

**Note:** Lower scan time = higher tier. ASV measures viewer engagement quality.

### Duplicate Response (Idempotency)

```json
{
  "status": "duplicate",
  "receipt_id": "rct_507f1f77bcf86cd799439011",
  "message": "Event already processed"
}
```

### Error Responses

#### 400 Bad Request
```json
{
  "error": "missing_required_fields",
  "required": ["event_id", "event_time_utc", "publisher", "session", "content", "ad"]
}
```

#### 401 Unauthorized
```json
{
  "error": "invalid_credentials",
  "message": "Invalid or inactive API key"
}
```

#### 404 Not Found (Conversion without Pause)
```json
{
  "error": "pause_not_found",
  "message": "No matching pause_impression found for this ipause_opportunity_id"
}
```

#### 500 Internal Server Error
```json
{
  "error": "processing_failed",
  "message": "Internal processing error"
}
```

---

## The ipause_opportunity_id

The `ipause_opportunity_id` is the **critical linking field** between pause impressions and conversions.

### How it works:

1. **Generate a unique ID** when displaying a pause ad
2. **Encode it in the QR code** (as a URL parameter or in the QR payload)
3. **Send it with the pause_impression** event
4. **Extract it when QR is scanned** and send with qr_conversion event

### Example Flow:

```
1. User pauses video
   └── Publisher displays QR ad with opportunity_id: "opp_abc123"
   └── Publisher sends pause_impression with ipause_opportunity_id: "opp_abc123"

2. User scans QR code
   └── QR contains: https://brand.com/offer?ipause_opp=opp_abc123
   └── Publisher detects scan and sends qr_conversion with ipause_opportunity_id: "opp_abc123"

3. iPauseAds links the events
   └── Calculates A2AR metrics
   └── Processes billing
```

---

## Idempotency

All requests **must** include an `Idempotency-Key` header. This ensures:

- Duplicate requests return the same response
- Network retries don't create duplicate events
- Safe to retry failed requests

**Best Practice:** Use a combination of event_id and timestamp:
```
Idempotency-Key: evt_abc123_1703376000
```

Idempotency keys are cached for **24 hours**.

---

## Rate Limits

| Tier | Requests/Minute | Burst |
|------|-----------------|-------|
| Standard | 100 | 150 |
| Enterprise | 1000 | 1500 |

Rate limit headers are included in responses:
```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1703376060
```

---

## Code Examples

### Node.js

```javascript
const axios = require('axios');

async function sendPauseImpression(data) {
  const response = await axios.post(
    'https://api.ipauseads.com/v1/events',
    {
      event_type: 'pause_impression',
      event_id: `evt_${Date.now()}`,
      event_time_utc: new Date().toISOString(),
      publisher: {
        publisher_id: 'pub_your_id',
        publisher_name: 'Your App'
      },
      session: {
        ipause_opportunity_id: data.opportunityId
      },
      content: {
        title: data.contentTitle
      },
      ad: {
        campaign_id: data.campaignId,
        qr_enabled: true
      }
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.IPAUSE_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `pause_${data.opportunityId}`
      }
    }
  );
  
  return response.data;
}
```

### Python

```python
import requests
import os
from datetime import datetime

def send_pause_impression(opportunity_id, content_title, campaign_id):
    response = requests.post(
        'https://api.ipauseads.com/v1/events',
        json={
            'event_type': 'pause_impression',
            'event_id': f'evt_{int(datetime.now().timestamp() * 1000)}',
            'event_time_utc': datetime.utcnow().isoformat() + 'Z',
            'publisher': {
                'publisher_id': 'pub_your_id',
                'publisher_name': 'Your App'
            },
            'session': {
                'ipause_opportunity_id': opportunity_id
            },
            'content': {
                'title': content_title
            },
            'ad': {
                'campaign_id': campaign_id,
                'qr_enabled': True
            }
        },
        headers={
            'Authorization': f'Bearer {os.environ["IPAUSE_API_KEY"]}',
            'Content-Type': 'application/json',
            'Idempotency-Key': f'pause_{opportunity_id}'
        }
    )
    
    return response.json()
```

### cURL

```bash
curl -X POST https://api.ipauseads.com/v1/events \
  -H "Authorization: Bearer pk_your_api_key" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: evt_unique_123" \
  -d '{
    "event_type": "pause_impression",
    "event_id": "evt_unique_123",
    "event_time_utc": "2024-12-24T00:00:00.000Z",
    "publisher": {
      "publisher_id": "pub_your_id"
    },
    "session": {
      "ipause_opportunity_id": "opp_unique_456"
    },
    "content": {
      "title": "Sample Show"
    },
    "ad": {
      "campaign_id": "CAMPAIGN-001",
      "qr_enabled": true
    }
  }'
```

---

## Support

For integration support, contact your iPauseAds account manager or email: **support@ipauseads.com**

---

## Changelog

### v1.0 (December 2024)
- Initial release
- pause_impression and qr_conversion events
- API key and signed webhook authentication
- Idempotency support
- Publisher management endpoints
