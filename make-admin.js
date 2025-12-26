// Script to make a user an admin
const mongoose = require('mongoose');
require('dotenv').config();

const User = require('./src/models/User');

async function makeAdmin() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    // Get email from command line or use default
    const email = process.argv[2] || 'waliullahinfo365@gmail.com';

    const user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user) {
      console.log(`❌ User not found: ${email}`);
      process.exit(1);
    }

    console.log(`\nFound user: ${user.name || user.fullName || 'Unknown'}`);
    console.log(`Current role: ${user.role}`);

    // Update to admin
    user.role = 'admin';
    user.status = 'active';
    
    // If user has 'name' but not 'fullName', copy it
    if (user.name && !user.fullName) {
      user.fullName = user.name;
    }
    
    await user.save();

    console.log(`\n✅ User updated successfully!`);
    console.log(`New role: ${user.role}`);
    console.log(`Status: ${user.status}`);
    console.log(`\nPlease logout and login again to see the User Management button.`);

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

makeAdmin();
