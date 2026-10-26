import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
export type RecommendationCategory =
  | 'Parsing and formatting'
  | 'Required sections'
  | 'Skills and keywords'
  | 'Experience quality'
  | 'Content quality'
  | 'ATS compatibility'
  | 'Target-job alignment';
export interface Recommendation {
  id: string;
  category: RecommendationCategory;
  priority: 'high' | 'medium' | 'low';
  title: string;
  reason: string;
  evidence: string[];
  action: string;
  suggestedRewrite?: string;
  relatedSection?:
    | 'summary'
    | 'experience'
    | 'education'
    | 'projects'
    | 'skills'
    | 'certifications';
  jobSpecific: boolean;
}
export type ScoreCategory =
  | 'Parsing and formatting'
  | 'Required sections'
  | 'Skills and keywords'
  | 'Experience quality'
  | 'Content quality'
  | 'ATS compatibility'
  | 'Target-job alignment';

export interface ScoreDeduction {
  ruleId: string;
  category: ScoreCategory;
  pointsChange: number;
  reason: string;
  action: string;
}

@Schema({ _id: false })
export class CategoryScore {
  @Prop({ required: true })
  category: ScoreCategory;

  @Prop({ required: true })
  earned: number;

  @Prop({ required: true })
  max: number;
}
export const CategoryScoreSchema = SchemaFactory.createForClass(CategoryScore);

export type ResumeAnalysisDocument = HydratedDocument<ResumeAnalysis>;

@Schema({ timestamps: true })
export class ResumeAnalysis {
  @Prop({ required: true, index: true })
  resumeId: string;

  @Prop({ required: true })
  userId: string;

  @Prop({ required: true, min: 0, max: 100 })
  totalScore: number;

  @Prop({ type: [CategoryScoreSchema], default: [] })
  categoryScores: CategoryScore[];

  @Prop({ type: Array, default: [] })
  deductions: ScoreDeduction[];

  @Prop({ type: [String], default: [] })
  extractedSkills: string[];

  @Prop()
  jobDescription?: string;
  @Prop({ type: [Object], default: [] })
  recommendations: Recommendation[];
}

export const ResumeAnalysisSchema =
  SchemaFactory.createForClass(ResumeAnalysis);
