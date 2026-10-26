import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ResumeDocument = HydratedDocument<Resume>;

@Schema({ timestamps: true })
export class Resume {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true })
  originalName: string;

  @Prop({ required: true })
  storagePath: string;

  @Prop({ required: true })
  mimeType: string;

  @Prop({ default: 'pending' })
  status: 'pending' | 'parsed' | 'failed';

  @Prop({ type: Object })
  parsedProfile?: Record<string, unknown>;

  @Prop()
  rawText?: string;
}

export const ResumeSchema = SchemaFactory.createForClass(Resume);
