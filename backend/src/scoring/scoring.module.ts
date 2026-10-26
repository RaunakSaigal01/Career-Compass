import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScoringService } from './scoring.service';
import { RecommendationService } from './recommendation.service';
import {
  ResumeAnalysis,
  ResumeAnalysisSchema,
} from './schemas/resume-analysis.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ResumeAnalysis.name, schema: ResumeAnalysisSchema },
    ]),
  ],
  providers: [ScoringService, RecommendationService],
  exports: [ScoringService, RecommendationService],
})
export class ScoringModule {}

