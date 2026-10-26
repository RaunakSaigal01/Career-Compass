import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { JobsService } from './jobs.service';
import { JobsScheduler } from './jobs.scheduler';
import { JobsController } from './jobs.controller';
import { Job, JobSchema } from './schemas/job.schema';
import { SavedJob, SavedJobSchema } from './schemas/saved-job.schema';
import { UsersModule } from '../users/users.module';
import { Resume, ResumeSchema } from '../resumes/schemas/resumes.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Job.name, schema: JobSchema },
      { name: SavedJob.name, schema: SavedJobSchema },
      { name: Resume.name, schema: ResumeSchema },
    ]),
    ScheduleModule.forRoot(),
    UsersModule,
  ],
  providers: [JobsService, JobsScheduler],
  controllers: [JobsController],
})
export class JobsModule {}
