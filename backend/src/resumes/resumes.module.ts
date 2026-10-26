import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { randomBytes } from 'crypto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ResumesService } from './resumes.service';
import { ResumesController } from './resumes.controller';
import { Resume, ResumeSchema } from './schemas/resumes.schema';
import { ParserModule } from '../parser/parser.module';
import { ScoringModule } from '../scoring/scoring.module';
import {
  ResumeAnalysis,
  ResumeAnalysisSchema,
} from '../scoring/schemas/resume-analysis.schema';
import { UsersModule } from 'src/users/users.module';
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Resume.name, schema: ResumeSchema },
      { name: ResumeAnalysis.name, schema: ResumeAnalysisSchema },
    ]),
    ParserModule,
    ScoringModule,
    UsersModule,
    MulterModule.register({
      storage: diskStorage({
        destination: UPLOAD_DIR,
        filename: (_req, file, cb) => {
          const ext = extname(file.originalname).toLowerCase();
          const name = randomBytes(16).toString('hex');
          cb(null, `${name}${ext}`);
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
    }),
  ],
  controllers: [ResumesController],
  providers: [ResumesService, JwtAuthGuard],
  exports: [ResumesService],
})
export class ResumesModule {}
