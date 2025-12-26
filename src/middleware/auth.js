// FILE: src/middleware/auth.js
const jwt = require('jsonwebtoken');


function authMiddleware(req, res, next) {
const header = req.headers.authorization;
if (!header) return res.status(401).json({ error: 'Missing Authorization header' });


const token = header.split(' ')[1];
if (!token) return res.status(401).json({ error: 'Invalid token format' });


try {
const payload = jwt.verify(token, process.env.JWT_SECRET);
req.user = payload;
next();
} catch (err) {
return res.status(401).json({ error: 'Invalid or expired token' });
}
}


module.exports = authMiddleware;