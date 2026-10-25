import 'dotenv/config';
import mongoose from 'mongoose';
import { app } from './server.js';

const required = ['MONGODB_URI', 'SESSION_SECRET'];
const missing = required.filter(key => !process.env[key]);
if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
const port = Number(process.env.PORT || 5000);
await mongoose.connect(process.env.MONGODB_URI);
app.listen(port, () => console.log(`AI Mystery Room API listening on ${port}`));
