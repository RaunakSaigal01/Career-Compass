import {
  Body,
  Patch,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ResumesService } from './resumes.service';

interface AuthedRequest {
  user: { id: string; email: string };
}

@UseGuards(JwtAuthGuard)
@Controller('resumes')
export class ResumesController {
  constructor(private readonly resumesService: ResumesService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  upload(@Req() req: AuthedRequest, @UploadedFile() file: Express.Multer.File) {
    return this.resumesService.validateAndCreate(req.user.id, file);
  }

  @Get()
  list(@Req() req: AuthedRequest) {
    return this.resumesService.listForUser(req.user.id);
  }
  @Get(':id')
  get(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.resumesService.getForUser(req.user.id, id);
  }

  @Post(':id/parse')
  parse(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.resumesService.parseAndStore(req.user.id, id);
  }

  @Patch(':id/profile')
  saveProfile(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: { profile: unknown; jobDescription?: string },
  ) {
    return this.resumesService.saveProfile(
      req.user.id,
      id,
      body.profile,
      body.jobDescription,
    );
  }

  @Post(':id/score')
  score(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: { jobDescription?: string },
  ) {
    return this.resumesService.scoreResume(
      req.user.id,
      id,
      body.jobDescription,
    );
  }

  @Get(':id/analysis')
  latestAnalysis(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.resumesService.getLatestAnalysis(req.user.id, id);
  }
  @Delete(':id')
  delete(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.resumesService.deleteForUser(req.user.id, id);
  }
}
