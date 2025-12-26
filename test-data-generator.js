// test-data-generator.js
// Quick script to generate sample QR scan data for testing the dashboard
// Run with: node test-data-generator.js

const mongoose = require('mongoose');
require('dotenv').config();

const ScanSchema = new mongoose.Schema({
  qrId: { type: String, index: true },
  timestamp: { type: Date, default: Date.now, index: true },
  ip: { type: String },
  hashedIp: { type: String, index: true },
  device: { type: String },
  deviceInfo: {
    type: mongoose.Schema.Types.Mixed,
    required: false
  },
  referrer: { type: String },
  conversion: { type: Boolean, default: false, index: true },
  conversionAction: { type: String, enum: ['Button Click', 'Form Submit', 'Page View', 'Download', null], default: null },
  publisher: { type: String },
  program: { type: String },
  meta: { type: Object },
  createdAt: { type: Date, default: Date.now }
});

ScanSchema.index({ qrId: 1, timestamp: -1 });
const Scan = mongoose.model('Scan', ScanSchema);

// Sample data generators
const qrIds = ['QR001', 'QR002', 'QR003', 'QR004', 'QR005'];
const conversionActions = ['Button Click', 'Form Submit', 'Page View', 'Download'];
const publishers = ['Publisher A', 'Publisher B', 'Publisher C'];
const programs = ['Program X', 'Program Y', 'Program Z'];

const deviceConfigs = [
  {
    type: 'mobile',
    os: 'iOS',
    osVersion: '17.2',
    deviceName: 'iPhone 14 Pro',
    model: 'iPhone 14 Pro',
    browser: 'Safari'
  },
  {
    type: 'mobile',
    os: 'Android',
    osVersion: '13',
    deviceName: 'Samsung Galaxy S23',
    model: 'Samsung Galaxy S23',
    browser: 'Chrome'
  },
  {
    type: 'desktop',
    os: 'Windows',
    osVersion: '10/11',
    deviceName: 'Windows Desktop',
    model: 'Windows Desktop',
    browser: 'Chrome'
  },
  {
    type: 'desktop',
    os: 'macOS',
    osVersion: '14.1',
    deviceName: 'MacBook/iMac',
    model: 'MacBook/iMac',
    browser: 'Safari'
  },
  {
    type: 'tablet',
    os: 'iOS',
    osVersion: '16.5',
    deviceName: 'iPad',
    model: 'iPad',
    browser: 'Safari'
  },
  {
    type: 'mobile',
    os: 'Android',
    osVersion: '12',
    deviceName: 'Xiaomi Mi 11',
    model: 'Xiaomi Mi 11',
    browser: 'Chrome'
  }
];

function randomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomIP() {
  return `${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
}

function randomDate(daysAgo) {
  const now = new Date();
  const past = new Date(now.getTime() - (daysAgo * 24 * 60 * 60 * 1000));
  const random = new Date(past.getTime() + Math.random() * (now.getTime() - past.getTime()));
  return random;
}

async function generateTestData(count = 100) {
  console.log(`Generating ${count} test scan records...`);
  
  const scans = [];
  
  for (let i = 0; i < count; i++) {
    const hasConversion = Math.random() > 0.6; // 40% conversion rate
    const deviceInfo = randomElement(deviceConfigs);
    
    scans.push({
      qrId: randomElement(qrIds),
      timestamp: randomDate(7), // Last 7 days
      ip: randomIP(),
      deviceInfo,
      conversion: hasConversion,
      conversionAction: hasConversion ? randomElement(conversionActions) : null,
      publisher: Math.random() > 0.5 ? randomElement(publishers) : null,
      program: Math.random() > 0.5 ? randomElement(programs) : null,
      meta: { source: 'test-data-generator' }
    });
  }
  
  try {
    await Scan.insertMany(scans);
    console.log(`✅ Successfully inserted ${count} test records`);
  } catch (err) {
    console.error('Error inserting test data:', err);
  }
}

async function main() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/ipauseads';
    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');
    
    // Generate test data
    await generateTestData(100);
    
    // Show summary
    const total = await Scan.countDocuments();
    const conversions = await Scan.countDocuments({ conversion: true });
    const uniqueIps = await Scan.distinct('ip');
    
    console.log('\n📊 Database Summary:');
    console.log(`Total Scans: ${total}`);
    console.log(`Conversions: ${conversions}`);
    console.log(`Conversion Rate: ${((conversions / total) * 100).toFixed(2)}%`);
    console.log(`Unique IPs: ${uniqueIps.length}`);
    
    await mongoose.disconnect();
    console.log('\n✅ Done!');
    
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

main();
