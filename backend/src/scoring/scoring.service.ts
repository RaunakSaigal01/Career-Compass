import { Injectable } from '@nestjs/common';
import {
  ResumeAnalysis,
  Recommendation,
  ScoreCategory,
  ScoreDeduction,
} from './schemas/resume-analysis.schema';
import { RecommendationService } from './recommendation.service';
import { ScoreInput, SCORE_RULES, CATEGORY_MAX } from './scoring.rules';

export interface ScoreResult {
  totalScore: number;
  categoryScores: Array<{
    category: ScoreCategory;
    earned: number;
    max: number;
  }>;
  deductions: ScoreDeduction[];
}

@Injectable()
export class ScoringService {
     constructor(private readonly recommendationService: RecommendationService) {}
  score(input: ScoreInput): ScoreResult {
    const categoryEarned = new Map<ScoreCategory, number>();
    for (const cat of Object.keys(CATEGORY_MAX) as ScoreCategory[]) {
      categoryEarned.set(cat, 0);
    }

    const deductions: ScoreDeduction[] = [];

    for (const rule of SCORE_RULES) {
      const change = rule.evaluate(input);

if (change !== 0) {
  categoryEarned.set(
    rule.category,
    (categoryEarned.get(rule.category) ?? 0) + change,
  );
}

const needsImprovement =
  change < 0 ||
  (rule.maxPoints !== undefined && change < rule.maxPoints);

if (needsImprovement && rule.reasonWhenLost(input) && rule.action) {
  deductions.push({
    ruleId: rule.id,
    category: rule.category,
    pointsChange: change - (rule.maxPoints ?? 0),
    reason: rule.reasonWhenLost(input),
    action: rule.action,
  });
}
    }

    // Clamp each category to [0, max]
    const categoryScores = (Object.keys(CATEGORY_MAX) as ScoreCategory[]).map(
      (category) => ({
        category,
        earned: Math.max(
          0,
          Math.min(CATEGORY_MAX[category], categoryEarned.get(category) ?? 0),
        ),
        max: CATEGORY_MAX[category],
      }),
    );

    const totalRaw = categoryScores.reduce((sum, c) => sum + c.earned, 0);
    const totalScore = Math.max(0, Math.min(100, Math.round(totalRaw)));

    return { totalScore, categoryScores, deductions };
  }

  buildAnalysis(
    resumeId: string,
    userId: string,
    input: ScoreInput,
    jobDescription?: string,
  ): Partial<ResumeAnalysis> {
    const { totalScore, categoryScores, deductions } = this.score(input);
        const recommendations: Recommendation[] = this.recommendationService.generate(
      {
        rawText: input.rawText,
        skills: input.skills,
        basics: input.basics,
        sections: input.sections,
      },
      jobDescription,
    );

    return {
      resumeId,
      userId,
      totalScore,
      categoryScores,
      deductions,
      extractedSkills: input.skills,
      jobDescription,
      recommendations,
    };
  }
}
