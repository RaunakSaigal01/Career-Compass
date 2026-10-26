import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { JobsService } from './jobs.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class JobsScheduler {
  private readonly logger = new Logger(JobsScheduler.name);

  constructor(
    private jobsService: JobsService,
    private usersService: UsersService,
  ) {}

  @Cron('0 0 * * *') // Daily at midnight (Every 24 hours)
  async handleDailyCacheRefresh() {
    this.logger.log('Starting daily 24-hour job cache refresh...');

    try {
      // Get all distinct preferredRoles across active users
      const users = await this.usersService.findAll();
      const preferredRolesSet = new Set<string>();

      for (const user of users) {
        const profile = await this.usersService.getProfile(user.id);
        if (profile && profile.preferredRoles && Array.isArray(profile.preferredRoles)) {
          profile.preferredRoles.forEach((role) => preferredRolesSet.add(role));
        }
      }

      const preferredRoles = Array.from(preferredRolesSet);

      if (preferredRoles.length === 0) {
        this.logger.log('No preferred roles found, skipping daily cache refresh');
        return;
      }

      this.logger.log(`Refreshing cache for roles: ${preferredRoles.join(', ')}`);

      // Fetch fresh live jobs
      const newJobs = await this.jobsService.fetchExternalJobs(preferredRoles);

      // Upsert into cached_jobs collection
      for (const jobData of newJobs) {
        try {
          await this.jobsService.updateJob(jobData.externalId, {
            ...jobData,
            cachedAt: new Date(),
          });
        } catch (jobError) {
          this.logger.error(
            `Failed to upsert cached job ${jobData.externalId}: ${jobError.message}`,
          );
        }
      }

      this.logger.log(
        `Daily job cache refresh completed. Cached ${newJobs.length} live jobs.`,
      );
    } catch (error) {
      this.logger.error(`Daily job cache refresh failed: ${error.message}`);
    }
  }
}