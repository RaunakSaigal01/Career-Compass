import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { YouTubeCoursesService } from './youtube-courses.service';

@Controller('courses')
@UseGuards(JwtAuthGuard)
export class CoursesController {
  constructor(private readonly youtubeCoursesService: YouTubeCoursesService) {}

  @Post('youtube')
  recommendYouTubeVideos(@Body('skills') skills: unknown) {
    if (
      !Array.isArray(skills) ||
      skills.length > 5 ||
      skills.some((skill) => typeof skill !== 'string')
    ) {
      throw new BadRequestException('Provide up to five skill names.');
    }

    return this.youtubeCoursesService.recommendForSkills(skills);
  }
}
