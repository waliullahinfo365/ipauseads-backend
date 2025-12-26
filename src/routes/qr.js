// src/routes/qr.js
const express = require('express');
const Scan = require('../models/Scan');
const QrCode = require('../models/QrCode');
const PauseEvent = require('../models/PauseEvent');
const A2ARMetric = require('../models/A2ARMetric');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const geoip = require('geoip-lite');
const UAParser = require('ua-parser-js');

// Cache for storing device info
const deviceCache = new Map();

/**
 * Enhanced UserAgent → Device parser with caching
 */
function parseDevice(userAgent) {
  if (!userAgent) {
    return {
      deviceType: 'unknown',
      os: 'unknown',
      browser: 'unknown',
      isMobile: false,
      isTablet: false,
      isDesktop: true
    };
  }

  // Check cache first


  const cacheKey = userAgent.substring(0, 200); // Limit key size
  if (deviceCache.has(cacheKey)) {
    return deviceCache.get(cacheKey);
  }

  // Parse with ua-parser-js for better accuracy
  const parser = new UAParser(userAgent);
  const result = parser.getResult();
  
  // Determine device type
  let deviceType = 'desktop';
  if (result.device.type === 'mobile') deviceType = 'mobile';
  if (result.device.type === 'tablet') deviceType = 'tablet';
  if (result.device.type === 'smarttv') deviceType = 'smarttv';
  if (result.device.type === 'wearable') deviceType = 'wearable';
  if (result.device.type === 'console') deviceType = 'console';
  
  // Prepare device info
  const deviceInfo = {
    deviceType,
    os: result.os.name || 'unknown',
    osVersion: result.os.version || '',
    browser: result.browser.name || 'unknown',
    browserVersion: result.browser.version || '',
    device: result.device.model || result.device.vendor || 'unknown',
    cpu: result.cpu.architecture || 'unknown',
    engine: result.engine.name || 'unknown',
    engineVersion: result.engine.version || '',
    isMobile: result.device.type === 'mobile',
    isTablet: result.device.type === 'tablet',
    isDesktop: !result.device.type || result.device.type === '',
    raw: {
      userAgent: userAgent,
      ua: result.ua,
      browser: result.browser,
      device: result.device,
      os: result.os,
      engine: result.engine
    }
  };

  // Cache the result
  deviceCache.set(cacheKey, deviceInfo);
  
  return deviceInfo;

  // Detect device type and OS
  if (/Android/i.test(ua)) {
    type = 'mobile';
    os = 'Android';
    
    // Extract Android version
    const androidMatch = ua.match(/Android\s+([\d.]+)/i);
    if (androidMatch) osVersion = androidMatch[1];
    
    // Extract device model (Samsung, etc.)
    const samsungMatch = ua.match(/Samsung\s+([^;)]+)/i) || ua.match(/SM-([^;)]+)/i);
    const huaweiMatch = ua.match(/Huawei\s+([^;)]+)/i);
    const xiaomiMatch = ua.match(/Xiaomi\s+([^;)]+)/i) || ua.match(/Mi\s+([^;)]+)/i);
    
    if (samsungMatch) deviceName = `Samsung ${samsungMatch[1].trim()}`;
    else if (huaweiMatch) deviceName = `Huawei ${huaweiMatch[1].trim()}`;
    else if (xiaomiMatch) deviceName = `Xiaomi ${xiaomiMatch[1].trim()}`;
    else {
      const buildMatch = ua.match(/Build\/([^;)]+)/i);
      if (buildMatch) deviceName = buildMatch[1].trim();
    }
  } else if (/iPhone/i.test(ua)) {
    type = 'mobile';
    os = 'iOS';
    deviceName = 'iPhone';
    
    // Extract iOS version
    const iosMatch = ua.match(/OS\s+([\d_]+)/i);
    if (iosMatch) osVersion = iosMatch[1].replace(/_/g, '.');
    
    // Try to detect iPhone model
    const modelMatch = ua.match(/iPhone\s*(\d+[,\d]*)/i);
    if (modelMatch) deviceName = `iPhone ${modelMatch[1]}`;
  } else if (/iPad/i.test(ua)) {
    type = 'tablet';
    os = 'iOS';
    deviceName = 'iPad';
    
    const iosMatch = ua.match(/OS\s+([\d_]+)/i);
    if (iosMatch) osVersion = iosMatch[1].replace(/_/g, '.');
  } else if (/Windows NT/i.test(ua)) {
    os = 'Windows';
    
    // Extract Windows version
    const winMatch = ua.match(/Windows NT\s+([\d.]+)/i);
    if (winMatch) {
      const ver = winMatch[1];
      if (ver === '10.0') osVersion = '10/11';
      else if (ver === '6.3') osVersion = '8.1';
      else if (ver === '6.2') osVersion = '8';
      else if (ver === '6.1') osVersion = '7';
      else osVersion = ver;
    }
    deviceName = 'Windows Desktop';
  } else if (/Mac OS X/i.test(ua)) {
    os = 'macOS';
    
    // Extract macOS version
    const macMatch = ua.match(/Mac OS X\s+([\d_]+)/i);
    if (macMatch) osVersion = macMatch[1].replace(/_/g, '.');
    
    deviceName = 'MacBook/iMac';
  } else if (/Linux/i.test(ua)) {
    os = 'Linux';
    deviceName = 'Linux Desktop';
  }

  // Detect browser
  if (/Chrome/i.test(ua) && !/Edg/i.test(ua)) browser = 'Chrome';
  else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari';
  else if (/Firefox/i.test(ua)) browser = 'Firefox';
  else if (/Edg/i.test(ua)) browser = 'Edge';
  else if (/MSIE|Trident/i.test(ua)) browser = 'IE';

  // Build model string
  model = deviceName || type;

  return { type, os, osVersion, model, browser, deviceName };
}

/**
 * GET /:qrId
 * New billing-aware QR endpoint: looks up QR configuration, logs scan, then redirects.
 * Example: /qr/TEST-001?publisher=Hulu&creative=TestAd&sessionId=abc123
 */
router.get('/:qrId', async (req, res) => {
  try {
    const { qrId } = req.params;
    const { publisher, creative, sessionId } = req.query;

    // 1. Get QR code details from database
    const qr = await QrCode.findOne({ id: qrId, active: true }).lean();

    if (!qr) {
      return res.redirect(302, 'https://www.iPauseAds.com');
    }

    // Get client IP address
    const ip = (req.headers['x-forwarded-for'] || req.connection.remoteAddress || '')
      .split(',')[0]
      .trim();

    const userAgent = req.get('user-agent') || '';
    const referrer = req.get('referer') || req.get('referrer') || '';

    const deviceInfo = parseDevice(userAgent);
    const geo = geoip.lookup(ip) || {};

    const scanData = {
      qrId,
      ip,
      userAgent,
      device: `${deviceInfo.deviceType}/${deviceInfo.os} ${deviceInfo.osVersion}`.trim(),
      deviceInfo: {
        ...deviceInfo,
        geo: {
          country: geo.country,
          region: geo.region,
          city: geo.city,
          ll: geo.ll,
          timezone: geo.timezone
        }
      },
      referrer,
      // Billing metadata
      publisher: publisher || qr.publisher || 'Direct',
      program: qr.program || undefined,
      advertiser: qr.advertiser,
      creativeId: creative || qr.creativeId || 'N/A',
      thumbnailUrl: qr.thumbnailUrl || null,
      conversionFee: qr.conversionFee || 0,
      meta: {
        headers: {
          'user-agent': userAgent,
          referer: referrer,
          'accept-language': req.get('accept-language'),
          'x-forwarded-for': req.get('x-forwarded-for')
        },
        query: req.query,
        params: req.params
      }
    };

    const scan = await new Scan(scanData).save();

    // Link to pause event if sessionId provided
    if (sessionId) {
      try {
        const pauseEvent = await PauseEvent.findOne({ sessionId });
        if (pauseEvent) {
          // Update pause event with scan reference
          pauseEvent.scanId = scan._id;
          await pauseEvent.save();

          // Update A2AR metrics with scan
          if (pauseEvent.advertiser) {
            await A2ARMetric.updateMetrics({
              date: new Date(),
              advertiser: pauseEvent.advertiser,
              publisher: pauseEvent.publisher,
              programTitle: pauseEvent.programTitle,
              scan: true
            });
          }
        }
      } catch (linkError) {
        console.error('Error linking pause event to scan:', linkError);
      }
    }

    // Set a cookie to identify returning visitors (reuse existing logic)
    const visitorId = req.cookies?.visitorId || uuidv4();
    res.cookie('visitorId', visitorId, {
      maxAge: 365 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });

    // Build destination URL with tracking params
    const destinationUrl = new URL(qr.destinationUrl);
    destinationUrl.searchParams.append('ipause_scan', scan._id.toString());
    destinationUrl.searchParams.append('ipause_qr', qrId);

    return res.redirect(302, destinationUrl.toString());
  } catch (error) {
    console.error('QR tracking error (billing-aware):', error);
    return res.redirect(302, 'https://www.iPauseAds.com');
  }
});

/**
 * GET /track/:qrId
 * Legacy analytics endpoint kept for backward compatibility.
 */
router.get('/track/:qrId', async (req, res) => {
  try {
    const { qrId } = req.params;
    const {
      source,
      medium,
      campaign,
      term,
      content,
      publisher,
      program,
      ref,
      redirect = 'https://www.iPauseAds.com'
    } = req.query;

    // Get client IP address
    const ip = (req.headers['x-forwarded-for'] || req.connection.remoteAddress || '')
      .split(',')[0]
      .trim();
    
    // Get user agent and parse device info
    const userAgent = req.get('user-agent') || '';
    const referrer = req.get('referer') || req.get('referrer') || ref || '';
    
    // Parse device information
    const deviceInfo = parseDevice(userAgent);
    
    // Get geo location from IP
    const geo = geoip.lookup(ip) || {};
    
    // Prepare scan data
    const scanData = {
      qrId,
      ip,
      userAgent,
      device: `${deviceInfo.deviceType}/${deviceInfo.os} ${deviceInfo.osVersion}`.trim(),
      deviceInfo: {
        ...deviceInfo,
        geo: {
          country: geo.country,
          region: geo.region,
          city: geo.city,
          ll: geo.ll,
          timezone: geo.timezone
        }
      },
      referrer,
      source: source || (referrer ? new URL(referrer).hostname : 'direct'),
      medium: medium || (referrer ? 'referral' : 'direct'),
      campaign,
      term,
      content,
      publisher,
      program,
      thumbnailUrl: null,
      meta: {
        headers: {
          'user-agent': userAgent,
          referer: referrer,
          'accept-language': req.get('accept-language'),
          'x-forwarded-for': req.get('x-forwarded-for')
        },
        query: req.query,
        params: req.params
      }
    };

    // Save scan to database
    const scan = await new Scan(scanData).save();
    
    // If redirect target is iPauseAds, treat as a conversion
    try {
      const targetUrl = new URL(redirect);
      const host = (targetUrl.hostname || '').toLowerCase();
      if (host.endsWith('ipauseads.com')) {
        scan.conversion = true;
        scan.conversionAction = 'Page View';
        await scan.save();
      }
    } catch (e) {
      // if redirect is not a valid URL, ignore and continue
    }
    
    // Set a cookie to identify returning visitors
    const visitorId = req.cookies.visitorId || uuidv4();
    res.cookie('visitorId', visitorId, { 
      maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });

    // Redirect to target URL
    const redirectUrl = new URL(redirect);
    
    // Add tracking parameters to redirect URL
    const params = new URLSearchParams({
      _scanId: scan._id,
      _visitorId: visitorId,
      _qrId: qrId,
      _source: source || 'qr',
      _medium: medium || 'qr',
      ...(campaign && { _campaign: campaign }),
      ...(term && { _term: term }),
      ...(content && { _content: content })
    });
    
    redirectUrl.search = params.toString();
    
    return res.redirect(302, redirectUrl.toString());
    
  } catch (error) {
    console.error('QR tracking error:', error);
    // Always redirect even if tracking fails
    return res.redirect(302, req.query.redirect || 'https://www.iPauseAds.com');
  }
});

/**
 * GET /qr/scan
 * Legacy endpoint - redirects to the new tracking endpoint
 */
router.get('/scan', (req, res) => {
  const { qrId = 'unknown', publisher, program, ...rest } = req.query;
  const params = new URLSearchParams({
    ...rest,
    qrId,
    ...(publisher && { publisher }),
    ...(program && { program })
  });
  return res.redirect(302, `/qr/track/${qrId}?${params.toString()}`);
});

/**
 * POST /qr/scan
 * Log scan via JSON
 */
router.post('/scan', async (req, res) => {
  try {
    const { qrId, publisher, program, conversion, conversionAction, meta } = req.body;

    const userAgent = req.get('user-agent') || req.body.device || '';

    const ip = (req.headers['x-forwarded-for'] || req.ip || '')
      .split(',')[0]
      .trim();

    const deviceInfo = parseDevice(userAgent);

    // Validate conversionAction if provided
    const validActions = ['Button Click', 'Form Submit', 'Page View', 'Download'];
    const action = conversion && conversionAction && validActions.includes(conversionAction) 
      ? conversionAction 
      : null;

    const scan = await Scan.create({
      qrId: qrId || 'unknown',
      ip,
      device: userAgent,
      deviceInfo,
      conversion: !!conversion,
      conversionAction: action,
      publisher,
      program,
      meta: meta || {}
    });

    return res.json({ ok: true, scanId: scan._id });

  } catch (err) {
    console.error('POST /qr/scan error:', err.message, err);
    return res.status(500).json({ ok: false, error: 'server error' });
  }
});

/**
 * POST /qr/conversion
 * Mark as conversion
 */
router.post('/conversion', async (req, res) => {
  try {
    const { scanId, qrId, conversionAction } = req.body;

    // Validate conversionAction if provided
    const validActions = ['Button Click', 'Form Submit', 'Page View', 'Download'];
    const action = conversionAction && validActions.includes(conversionAction) 
      ? conversionAction 
      : 'Button Click'; // default

    // If scanId exists → update directly
    if (scanId) {
      const updated = await Scan.findByIdAndUpdate(
        scanId,
        { conversion: true, conversionAction: action },
        { new: true }
      );

      if (!updated)
        return res.status(404).json({ ok: false, error: 'Scan not found' });

      return res.json({ ok: true, scan: updated });
    }

    // If no scanId → fallback search using qrId + IP
    if (!qrId)
      return res.status(400).json({ ok: false, error: 'scanId or qrId required' });

    const ip = (req.headers['x-forwarded-for'] || req.ip || '')
      .split(',')[0]
      .trim();

    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);

    const scan = await Scan.findOne({
      qrId,
      ip,
      timestamp: { $gte: tenMinAgo }
    }).sort({ timestamp: -1 });

    if (!scan)
      return res.status(404).json({ ok: false, error: 'scan not found' });

    scan.conversion = true;
    scan.conversionAction = action;
    await scan.save();

    return res.json({ ok: true });

  } catch (err) {
    console.error('POST /qr/conversion error:', err.message, err);
    return res.status(500).json({ ok: false, error: 'server error' });
  }
});

module.exports = router;
