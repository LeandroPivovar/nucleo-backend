const twilio = require('twilio');
require('dotenv').config();
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
client.content.v1.contents('HX5e9c47ed6c485143dd7aefc68e20c433').fetch().then(c => console.log(JSON.stringify(c, null, 2))).catch(console.error);
