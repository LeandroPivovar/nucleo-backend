import { JwtService } from '@nestjs/jwt';
import * as dotenv from 'dotenv';
dotenv.config();

const jwtService = new JwtService({
    secret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
    signOptions: { expiresIn: '7d' },
});

const payload = { sub: 1, email: 'test@example.com' };
console.log('Secret used:', process.env.JWT_SECRET || 'your-secret-key-change-in-production');

const token = jwtService.sign(payload);
console.log('Generated token:', token);

try {
    const decoded = jwtService.verify(token);
    console.log('Decoded successfully:', decoded);
} catch (e: any) {
    console.error('Verification failed:', e.message);
}
