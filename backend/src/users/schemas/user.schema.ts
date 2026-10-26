import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop()
  passwordHash?: string;

  @Prop({ unique: true, sparse: true })
  googleId?: string;

  @Prop({ default: false })
  consentGiven: boolean;
}

export const UserSchema = SchemaFactory.createForClass(User);
