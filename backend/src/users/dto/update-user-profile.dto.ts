import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class UpdateUserProfileDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  headline?: string;

  @IsOptional()
  @IsString()
  bio?: string;

  @IsOptional()
  @IsString()
  linkedin?: string;

  @IsOptional()
  @IsString()
  github?: string;

  @IsOptional()
  @IsString()
  portfolio?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  preferredRoles?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  preferredLocations?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  preferredWorkModes?: string[];

  @IsOptional()
  @IsNumber()
  minExpectedSalary?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  masterSkills?: string[];

  @IsOptional()
  @IsString()
  primaryResumeId?: string;

  // Allow read-only metadata fields without validation errors
  @IsOptional()
  email?: string;

  @IsOptional()
  userId?: string;

  @IsOptional()
  _id?: string;

  @IsOptional()
  __v?: number;

  @IsOptional()
  createdAt?: string;

  @IsOptional()
  updatedAt?: string;
}