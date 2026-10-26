import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserProfileDocument = HydratedDocument<UserProfile>;

@Schema({ timestamps: true, collection: 'user_profiles' })
export class UserProfile {
  @Prop({ required: true, unique: true, index: true })
  userId: string;

  @Prop({ default: '' })
  name: string;

  @Prop({ default: '' })
  phone: string;

  @Prop({ default: '' })
  location: string;

  @Prop({ default: '' })
  headline: string; // e.g. "Senior Backend Engineer | Node.js & Go"

  @Prop({ default: '' })
  bio: string;

  @Prop({ default: '' })
  linkedin: string;

  @Prop({ default: '' })
  github: string;

  @Prop({ default: '' })
  portfolio: string;

  // Master Career Preferences
  @Prop({ type: [String], default: [] })
  preferredRoles: string[]; // e.g. ["Backend Engineer", "Software Architect"]

  @Prop({ type: [String], default: [] })
  preferredLocations: string[]; // e.g. ["San Francisco, CA", "Bangalore", "Remote"]

  @Prop({ type: [String], default: ['remote', 'hybrid'] })
  preferredWorkModes: string[]; // 'remote' | 'hybrid' | 'onsite'

  @Prop({ default: 0 })
  minExpectedSalary: number;

  @Prop({ type: [String], default: [] })
  masterSkills: string[]; // Consolidated master skills from all resumes/inputs

  @Prop()
  primaryResumeId?: string;
}

export const UserProfileSchema = SchemaFactory.createForClass(UserProfile);