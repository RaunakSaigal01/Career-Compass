import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class BookmarkJobDto {
  @IsNotEmpty()
  @IsString()
  jobId: string;

  @IsNotEmpty()
  @IsString()
  title: string;

  @IsNotEmpty()
  @IsString()
  company: string;

  @IsNotEmpty()
  @IsString()
  location: string;

  @IsOptional()
  @IsString()
  workMode?: string;

  @IsOptional()
  @IsString()
  salarySnippet?: string;

  @IsNotEmpty()
  @IsString()
  platform: string;

  @IsNotEmpty()
  @IsString()
  applyUrl: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  @Max(100)
  matchScore: number;

  @IsOptional()
  @IsString({ each: true })
  matchedSkills?: string[];

  @IsOptional()
  @IsString({ each: true })
  missingSkills?: string[];

  @IsOptional()
  @IsEnum(['saved', 'applied', 'interviewing', 'rejected', 'offer'])
  status?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  appliedDate?: Date;

  // Pass-through optional metadata fields so ValidationPipe never rejects requests
  @IsOptional()
  _id?: string;

  @IsOptional()
  externalId?: string;

  @IsOptional()
  description?: string;

  @IsOptional()
  postedAt?: any;

  @IsOptional()
  __v?: number;
}