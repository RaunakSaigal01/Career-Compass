import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type JobDocument = Job & Document;

@Schema({ timestamps: true, collection: 'cached_jobs' })
export class Job {
  @Prop({ required: true, unique: true })
  externalId: string;

  @Prop({ required: true, index: true })
  title: string;

  @Prop({ default: '' })
  targetRole: string;

  @Prop({ required: true })
  company: string;

  @Prop({ default: '' })
  companyLogo: string;

  @Prop({ default: 'India' })
  location: string;

  @Prop({ default: 'On-Site' })
  workMode: string;

  @Prop({ required: true })
  platform: string;

  @Prop({ required: true })
  applyUrl: string;

  @Prop({ default: '' })
  description: string;

  @Prop({ type: [String], default: [] })
  requiredSkills: string[];

  @Prop({ default: '' })
  salarySnippet: string;

  @Prop({ default: Date.now })
  postedAt: Date;

  @Prop({ default: Date.now, index: true })
  cachedAt: Date;
}

export const JobSchema = SchemaFactory.createForClass(Job);