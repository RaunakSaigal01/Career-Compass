import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class GoogleTokenDto {
  @IsString()
  credential: string;

  @IsOptional()
  @IsBoolean()
  consentGiven?: boolean;
}
