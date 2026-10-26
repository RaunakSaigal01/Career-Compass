import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BookmarkJobDto } from './dto/bookmark-job.dto';

@Controller('jobs')
@UseGuards(JwtAuthGuard)
export class JobsController {
  constructor(private jobsService: JobsService) {}

  @Get('recommendations')
  async getRecommendations(@Request() req) {
    const userId = req.user.id;
    return await this.jobsService.fetchRecommendations(userId);
  }

  @Get('platform-links')
  async getPlatformLinks(@Request() req) {
    const userId = req.user.id;
    const profile = await this.jobsService['usersService'].getProfile(userId);
    if (!profile) {
      throw new Error('User profile not found');
    }
    const role = profile.preferredRoles?.[0] || 'Software Engineer';
    const location =
      profile.preferredLocations && profile.preferredLocations.length > 0
        ? profile.preferredLocations[0]
        : 'Remote';
    return this.jobsService.getPlatformDeepLinks(role, location);
  }

  @Get('saved')
  async getSavedJobs(@Request() req) {
    const userId = req.user.id;
    return await this.jobsService.listSavedJobs(userId);
  }

  @Post('saved')
  async bookmarkJob(@Request() req, @Body() dto: BookmarkJobDto) {
    const userId = req.user.id;
    return await this.jobsService.bookmarkJob(userId, dto);
  }

  @Patch('saved/:id')
  async updateSavedJobStatus(
    @Request() req,
    @Param('id') id: string,
    @Body() updateDto: { status: string; notes?: string },
  ) {
    const userId = req.user.id;
    return await this.jobsService.updateSavedJobStatus(
      userId,
      id,
      updateDto.status,
      updateDto.notes,
    );
  }

  @Delete('saved/:id')
  async deleteSavedJob(@Request() req, @Param('id') id: string) {
    const userId = req.user.id;
    return await this.jobsService.deleteSavedJob(userId, id);
  }
}