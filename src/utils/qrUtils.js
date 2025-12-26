const crypto = require('crypto');
const geoip = require('geoip-lite');
const UAParser = require('ua-parser-js');

// Cache for device info to improve performance
const deviceCache = new Map();

/**
 * Parse user agent string to extract device information
 * @param {string} userAgent - The user agent string
 * @returns {Object} Parsed device information
 */
function parseDevice(userAgent = '') {
  if (!userAgent) {
    return getDefaultDeviceInfo();
  }

  // Check cache first
  const cacheKey = userAgent.substring(0, 200); // Limit key size
  if (deviceCache.has(cacheKey)) {
    return deviceCache.get(cacheKey);
  }

  // Parse with ua-parser-js
  const parser = new UAParser(userAgent);
  const result = parser.getResult();
  
  // Determine device type
  let deviceType = 'desktop';
  if (result.device.type) {
    deviceType = result.device.type;
  } else if (result.browser.name && /mobile/i.test(result.ua)) {
    deviceType = 'mobile';
  }
  
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
    isMobile: deviceType === 'mobile' || deviceType === 'tablet',
    isTablet: deviceType === 'tablet',
    isDesktop: deviceType === 'desktop',
    raw: {
      userAgent,
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
}

/**
 * Get default device information when user agent is not available
 * @returns {Object} Default device information
 */
function getDefaultDeviceInfo() {
  return {
    deviceType: 'desktop',
    os: 'unknown',
    osVersion: '',
    browser: 'unknown',
    browserVersion: '',
    device: 'unknown',
    cpu: 'unknown',
    engine: 'unknown',
    engineVersion: '',
    isMobile: false,
    isTablet: false,
    isDesktop: true,
    raw: {}
  };
}

/**
 * Get geo information from IP address
 * @param {string} ip - IP address
 * @returns {Object} Geo information
 */
function getGeoInfo(ip) {
  if (!ip || ip === '::1' || ip === '127.0.0.1') {
    return {
      country: 'Local',
      region: 'Local',
      city: 'Local',
      ll: [0, 0],
      timezone: 'UTC'
    };
  }
  
  const geo = geoip.lookup(ip) || {};
  return {
    country: geo.country || 'Unknown',
    region: geo.region || 'Unknown',
    city: geo.city || 'Unknown',
    ll: geo.ll || [0, 0],
    timezone: geo.timezone || 'UTC'
  };
}

/**
 * Hash IP address for privacy
 * @param {string} ip - IP address to hash
 * @param {string} salt - Optional salt for hashing
 * @returns {string} Hashed IP address
 */
function hashIp(ip, salt = process.env.IP_HASH_SALT || 'default-salt') {
  if (!ip) return '';
  return crypto
    .createHash('sha256')
    .update(ip + salt)
    .digest('hex');
}

/**
 * Generate a tracking URL for a QR code
 * @param {string} qrId - The QR code ID
 * @param {Object} options - Additional options
 * @param {string} options.baseUrl - Base URL for the tracking endpoint
 * @param {string} options.redirect - Redirect URL after tracking
 * @param {Object} options.params - Additional query parameters
 * @returns {string} Generated tracking URL
 */
function generateTrackingUrl(qrId, options = {}) {
  const {
    baseUrl = process.env.API_BASE_URL || 'http://localhost:4000',
    redirect = process.env.DEFAULT_REDIRECT_URL || 'https://www.ipauseads.com',
    params = {}
  } = options;

  const url = new URL(`/qr/track/${encodeURIComponent(qrId)}`, baseUrl);
  const searchParams = new URLSearchParams({
    redirect,
    ...params
  });
  
  url.search = searchParams.toString();
  return url.toString();
}

/**
 * Generate a QR code URL for a given tracking URL
 * @param {string} trackingUrl - The tracking URL to encode in the QR code
 * @param {Object} options - QR code generation options
 * @param {string} options.qrCodeApi - QR code generation API endpoint
 * @returns {string} URL to the QR code image
 */
function generateQrCodeUrl(trackingUrl, options = {}) {
  const { qrCodeApi = 'https://api.qrserver.com/v1/create-qr-code/' } = options;
  const url = new URL(qrCodeApi);
  url.searchParams.append('size', '300x300');
  url.searchParams.append('data', trackingUrl);
  url.searchParams.append('format', 'png');
  url.searchParams.append('margin', '10');
  url.searchParams.append('qzone', '4');
  url.searchParams.append('color', '000000');
  url.searchParams.append('bgcolor', 'FFFFFF');
  
  return url.toString();
}

module.exports = {
  parseDevice,
  getGeoInfo,
  hashIp,
  generateTrackingUrl,
  generateQrCodeUrl
};
