import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SavedJobDocument = SavedJob & Document;

@Schema({ timestamps: true, collection: 'saved_jobs' })
export class SavedJob {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true })
  jobId: string;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  company: string;

  @Prop({ default: 'India' })
  location: string;

  @Prop({ default: 'On-Site' })
  workMode: string;

  @Prop({ default: '' })
  salarySnippet: string;

  @Prop({ required: true })
  platform: string;

  @Prop({ required: true })
  applyUrl: string;

  @Prop({ default: 85, min: 0, max: 100 })
  matchScore: number;

  @Prop({ type: [String], default: [] })
  matchedSkills: string[];

  @Prop({ type: [String], default: [] })
  missingSkills: string[];

  @Prop({
    required: true,
    enum: ['saved', 'applied', 'interviewing', 'rejected', 'offer'],
    default: 'saved',
  })
  status: string;

  @Prop({ default: '' })
  notes: string;

  @Prop({ default: Date.now })
  appliedDate: Date;
}

export const SavedJobSchema = SchemaFactory.createForClass(SavedJob);