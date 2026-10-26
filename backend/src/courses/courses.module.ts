import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CoursesController } from './courses.controller';
import { YouTubeCoursesService } from './youtube-courses.service';

@Module({
  imports: [AuthModule],
  controllers: [CoursesController],
  providers: [JwtAuthGuard, YouTubeCoursesService],
})
export class CoursesModule {}
