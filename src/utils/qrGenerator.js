// FILE: src/utils/qrGenerator.js
const QRCode = require('qrcode');


async function generateQrData(qrId) {
// We will generate a short tracking redirect url that points to iPauseAds landing
const target = (process.env.QR_BASE_URL || 'https://www.iPauseAds.com') + `?qrId=${encodeURIComponent(qrId)}`;
const dataUrl = await QRCode.toDataURL(target);
return { url: target, dataUrl };
}


module.exports = { generateQrData };