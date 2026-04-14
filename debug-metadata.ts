import 'reflect-metadata';
import { User } from './src/entities/user.entity';

const metadataSid = Reflect.getMetadata('design:type', User.prototype, 'twilioAccountSid');
console.log('Type of twilioAccountSid:', metadataSid ? metadataSid.name : 'undefined');

const metadataExpires = Reflect.getMetadata('design:type', User.prototype, 'twoFactorExpires');
console.log('Type of twoFactorExpires:', metadataExpires ? metadataExpires.name : 'undefined');
